// =========================================================
// cancel-reservation
// -----------------------------------------------------------
// Appelée depuis annulation.html (visiteur anonyme, pas de session
// Supabase — voir supabase/config.toml : verify_jwt = false).
// Permet au client d'annuler lui-même sa séance payée via son
// cancel_token, avec remboursement automatique :
//   - remboursement intégral si annulation +24h avant la séance
//   - 50% conservé si annulation -24h avant la séance
// Le pourcentage est TOUJOURS recalculé côté serveur à partir des
// données en base (jamais accepté depuis la requête du client).
//
// Body attendu : { "token": "<cancel_token>", "action": "preview" | "confirm" }
//
// Secrets requis (Dashboard > Edge Functions > Secrets) :
//   SUPABASE_URL              -> déjà fourni automatiquement par Supabase
//   SUPABASE_SERVICE_ROLE_KEY -> clé service_role
//   STRIPE_SECRET_KEY         -> clé secrète Stripe
//   RESEND_API_KEY            -> clé API Resend
//   FROM_EMAIL                -> adresse d'expédition validée sur Resend
//   NOTIFY_EMAIL              -> email de la sophrologue (notification d'annulation)
// =========================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'npm:stripe@^18';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '');

// Décalage (en minutes) entre l'heure de Paris et UTC à un instant donné,
// en tenant compte du changement d'heure été/hiver.
function parisOffsetMinutes(instant: Date): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Europe/Paris', hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(instant).map(x => [x.type, x.value]),
  );
  const asUTC = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute, +parts.second);
  return (asUTC - instant.getTime()) / 60000;
}

function appointmentInstant(dateSeance: string, heureSeance: string): Date {
  const [h, m] = heureSeance.split(':').map(Number);
  const guess = new Date(`${dateSeance}T00:00:00Z`);
  const offset = parisOffsetMinutes(guess);
  return new Date(Date.UTC(guess.getUTCFullYear(), guess.getUTCMonth(), guess.getUTCDate(), h, m) - offset * 60000);
}

function computeRefund(r: { date_seance: string; heure_seance: string; prix: number }) {
  const hoursUntil = (appointmentInstant(r.date_seance, r.heure_seance).getTime() - Date.now()) / 3_600_000;
  const pct = hoursUntil >= 24 ? 100 : 50;
  const montant = Math.round(Number(r.prix) * pct) / 100;
  return { pct, montant };
}

Deno.serve(async (req) => {
  try {
    const { token, action } = await req.json();
    if (!token || !['preview', 'confirm'].includes(action)) {
      return new Response(JSON.stringify({ ok: false, error: 'Paramètres invalides' }), { status: 400 });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: r, error: findError } = await admin
      .from('reservations')
      .select('*')
      .eq('cancel_token', token)
      .single();

    if (findError || !r) {
      return new Response(JSON.stringify({ ok: false, error: 'Lien d\'annulation invalide' }), { status: 404 });
    }

    if (r.statut === 'annule') {
      return new Response(JSON.stringify({
        ok: true, alreadyCancelled: true,
        pct: r.montant_rembourse != null && r.prix > 0 ? Math.round((r.montant_rembourse / r.prix) * 100) : null,
        montant: r.montant_rembourse,
      }), { status: 200 });
    }

    if (r.paiement_statut !== 'paye') {
      return new Response(JSON.stringify({ ok: false, error: 'Cette réservation n\'est pas payée, rien à annuler ici.' }), { status: 400 });
    }

    const { pct, montant } = computeRefund(r);

    if (action === 'preview') {
      return new Response(JSON.stringify({
        ok: true, pct, montant,
        prestation: r.prestation, date_seance: r.date_seance, heure_seance: r.heure_seance, prix: r.prix,
      }), { status: 200 });
    }

    // action === 'confirm'
    try {
      await stripe.refunds.create({
        payment_intent: r.stripe_payment_intent_id,
        amount: Math.round(montant * 100),
        reason: 'requested_by_customer',
      });
    } catch (stripeErr) {
      const msg = String(stripeErr);
      // Double-clic / déjà remboursé côté Stripe : traité comme un succès idempotent.
      if (!msg.toLowerCase().includes('already been refunded')) {
        return new Response(JSON.stringify({ ok: false, error: msg }), { status: 500 });
      }
    }

    const { error: updateError } = await admin
      .from('reservations')
      .update({
        statut: 'annule',
        paiement_statut: pct === 100 ? 'rembourse' : 'rembourse_partiel',
        montant_rembourse: montant,
      })
      .eq('id', r.id);

    if (updateError) {
      return new Response(JSON.stringify({ ok: false, error: updateError.message }), { status: 500 });
    }

    const resendKey = Deno.env.get('RESEND_API_KEY');
    const fromEmail = Deno.env.get('FROM_EMAIL') ?? 'onboarding@resend.dev';
    const notifyEmail = Deno.env.get('NOTIFY_EMAIL');

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: fromEmail,
        to: r.email,
        subject: `Séance du ${r.date_seance} annulée — remboursement de ${montant} €`,
        html: `<p>Bonjour ${r.prenom},</p>
               <p>Votre séance de <strong>${r.prestation}</strong> du <strong>${r.date_seance} à ${r.heure_seance}</strong>
               a bien été annulée. Un remboursement de <strong>${montant} €</strong> (${pct}%) a été déclenché sur votre
               moyen de paiement.</p>`,
      }),
    });

    if (notifyEmail) {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: fromEmail,
          to: notifyEmail,
          subject: `Annulation — ${r.prenom} ${r.nom} (${r.date_seance})`,
          html: `<p>${r.prenom} ${r.nom} a annulé sa séance du ${r.date_seance} à ${r.heure_seance}
                 (${r.prestation}). Remboursement automatique de ${montant} € (${pct}%) déclenché.</p>`,
        }),
      });
    }

    return new Response(JSON.stringify({ ok: true, pct, montant }), { status: 200 });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500 });
  }
});
