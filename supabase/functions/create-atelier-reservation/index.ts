// =========================================================
// create-atelier-reservation
// -----------------------------------------------------------
// Appelée depuis reservation.html (format "séance de groupe ouverte",
// visiteur anonyme — voir supabase/config.toml : verify_jwt = false).
// Réserve une place sur un atelier ouvert et lance immédiatement le
// paiement Stripe, en une seule opération côté serveur :
//   - la réservation est insérée avec la clé service_role (le public
//     n'a pas de policy SELECT sur `reservations`, donc un insert fait
//     depuis le navigateur ne pourrait jamais relire son pay_token) ;
//   - le prix, le lieu et l'horaire viennent de `ateliers_sessions` en
//     base, jamais de ce que le client envoie, pour ne pas pouvoir être
//     falsifiés ;
//   - la jauge est vérifiée par le trigger SQL check_atelier_capacity
//     (voir schema.sql) : l'insertion échoue proprement si la séance
//     vient de se remplir entre-temps.
//
// Body attendu : { "atelier_session_id", "prenom", "nom", "email",
//                   "telephone", "message"? }
//
// Secrets requis (Dashboard > Edge Functions > Secrets) :
//   SUPABASE_URL              -> déjà fourni automatiquement par Supabase
//   SUPABASE_SERVICE_ROLE_KEY -> clé service_role
//   STRIPE_SECRET_KEY         -> clé secrète Stripe
//   SITE_URL                  -> URL publique du site (success/cancel url)
// =========================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'npm:stripe@^18';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '');

Deno.serve(async (req) => {
  try {
    const { atelier_session_id, prenom, nom, email, telephone, message } = await req.json();
    if (!atelier_session_id || !prenom || !nom || !email || !telephone) {
      return new Response(JSON.stringify({ ok: false, error: 'Paramètres invalides' }), { status: 400 });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: atelier, error: atelierError } = await admin
      .from('ateliers_sessions')
      .select('*')
      .eq('id', atelier_session_id)
      .eq('statut', 'ouvert')
      .single();

    if (atelierError || !atelier) {
      return new Response(JSON.stringify({ ok: false, error: 'Séance introuvable ou fermée' }), { status: 404 });
    }

    const { data: r, error: insertError } = await admin
      .from('reservations')
      .insert({
        prestation: atelier.titre,
        prix: atelier.prix_place,
        lieu: atelier.lieu,
        date_seance: atelier.date_seance,
        heure_seance: atelier.heure_seance,
        prenom, nom, email, telephone,
        message: message || null,
        statut: 'confirme',
        paiement_statut: 'en_attente_paiement',
        atelier_session_id: atelier.id,
        nombre_participants: 1,
      })
      .select()
      .single();

    if (insertError || !r) {
      const msg = insertError?.message || '';
      if (msg.toLowerCase().includes('complète')) {
        return new Response(JSON.stringify({ ok: false, error: 'Cette séance est complète.' }), { status: 409 });
      }
      return new Response(JSON.stringify({ ok: false, error: msg || 'Impossible de créer la réservation' }), { status: 500 });
    }

    const siteUrl = Deno.env.get('SITE_URL') ?? '';

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      customer_email: r.email,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'eur',
          unit_amount: Math.round(Number(r.prix) * 100),
          product_data: { name: `${r.prestation} — ${r.date_seance} ${r.heure_seance}` },
        },
      }],
      metadata: { reservation_id: r.id },
      payment_intent_data: { metadata: { reservation_id: r.id } },
      success_url: `${siteUrl}/merci.html`,
      cancel_url: `${siteUrl}/reservation.html`,
    });

    await admin
      .from('reservations')
      .update({ stripe_checkout_session_id: session.id })
      .eq('id', r.id);

    return new Response(JSON.stringify({ ok: true, url: session.url }), { status: 200 });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500 });
  }
});
