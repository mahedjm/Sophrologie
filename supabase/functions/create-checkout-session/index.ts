// =========================================================
// create-checkout-session
// -----------------------------------------------------------
// Appelée depuis payer.html (visiteur anonyme, pas de session
// Supabase — voir supabase/config.toml : verify_jwt = false).
// Crée une session Stripe Checkout à la volée pour la réservation
// désignée par son pay_token, et renvoie l'URL de paiement.
//
// Body attendu : { "token": "<pay_token>" }
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
    const { token } = await req.json();
    if (!token) {
      return new Response(JSON.stringify({ ok: false, error: 'Paramètres invalides' }), { status: 400 });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: r, error: findError } = await admin
      .from('reservations')
      .select('*')
      .eq('pay_token', token)
      .single();

    if (findError || !r) {
      return new Response(JSON.stringify({ ok: false, error: 'Lien de paiement invalide' }), { status: 404 });
    }

    if (r.statut !== 'confirme') {
      return new Response(JSON.stringify({ ok: false, error: 'Cette réservation n\'est pas (ou plus) confirmée.' }), { status: 400 });
    }

    if (r.paiement_statut === 'paye') {
      return new Response(JSON.stringify({ ok: true, alreadyPaid: true }), { status: 200 });
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
      cancel_url: `${siteUrl}/payer.html?token=${token}`,
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
