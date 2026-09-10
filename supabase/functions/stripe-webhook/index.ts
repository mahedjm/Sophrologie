// =========================================================
// stripe-webhook
// -----------------------------------------------------------
// Appelée directement par Stripe (pas de session Supabase, pas de
// clé apikey — voir supabase/config.toml : verify_jwt = false).
// Écoute l'événement "checkout.session.completed" : marque la
// réservation comme payée et envoie au client le lien d'annulation
// en libre-service.
//
// À enregistrer dans Stripe Dashboard > Developers > Webhooks,
// pointant vers l'URL de cette fonction déployée, événement
// "checkout.session.completed" uniquement.
//
// Secrets requis (Dashboard > Edge Functions > Secrets) :
//   SUPABASE_URL              -> déjà fourni automatiquement par Supabase
//   SUPABASE_SERVICE_ROLE_KEY -> clé service_role
//   STRIPE_SECRET_KEY         -> clé secrète Stripe
//   STRIPE_WEBHOOK_SECRET     -> secret de signature du endpoint Stripe
//   RESEND_API_KEY            -> clé API Resend
//   FROM_EMAIL                -> adresse d'expédition validée sur Resend
//   SITE_URL                  -> URL publique du site (lien d'annulation)
// =========================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'npm:stripe@^18';
import { Buffer } from 'node:buffer';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '');
const cryptoProvider = Stripe.createSubtleCryptoProvider();

// Décalage (en minutes) entre l'heure de Paris et UTC à un instant donné.
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

// Fichier .ics minimal (1h par défaut, la durée précise n'est pas stockée
// en base) pour que le client ajoute la séance à son propre calendrier.
function buildIcsAttachment(r: { id: string; prestation: string; lieu: string; date_seance: string; heure_seance: string }) {
  const [h, m] = r.heure_seance.split(':').map(Number);
  const guess = new Date(`${r.date_seance}T00:00:00Z`);
  const offset = parisOffsetMinutes(guess);
  const start = new Date(Date.UTC(guess.getUTCFullYear(), guess.getUTCMonth(), guess.getUTCDate(), h, m) - offset * 60000);
  const end = new Date(start.getTime() + 60 * 60000);
  const toIcsDate = (d: Date) => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Au fil de soi//FR',
    'BEGIN:VEVENT',
    `UID:${r.id}@aufildesoi.fr`,
    `DTSTAMP:${toIcsDate(new Date())}`,
    `DTSTART:${toIcsDate(start)}`,
    `DTEND:${toIcsDate(end)}`,
    `SUMMARY:${r.prestation} — Au fil de soi`,
    `LOCATION:${r.lieu}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  return { filename: 'seance.ics', content: Buffer.from(ics, 'utf-8').toString('base64') };
}

Deno.serve(async (req) => {
  const signature = req.headers.get('Stripe-Signature');
  const body = await req.text(); // lire le texte brut avant tout parsing JSON

  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      signature ?? '',
      Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? '',
      undefined,
      cryptoProvider,
    );
  } catch (err) {
    return new Response(`Webhook signature invalide: ${err}`, { status: 400 });
  }

  if (event.type !== 'checkout.session.completed') {
    // On ne traite que cet événement — les autres sont simplement acquittés.
    return new Response(JSON.stringify({ ok: true, ignored: event.type }), { status: 200 });
  }

  try {
    const session = event.data.object as Stripe.Checkout.Session;
    const reservationId = session.metadata?.reservation_id;
    if (!reservationId) {
      return new Response(JSON.stringify({ ok: false, error: 'metadata.reservation_id manquant' }), { status: 400 });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: r, error: findError } = await admin
      .from('reservations')
      .select('*')
      .eq('id', reservationId)
      .single();

    if (findError || !r) {
      return new Response(JSON.stringify({ ok: false, error: 'Réservation introuvable' }), { status: 404 });
    }

    // Idempotence : Stripe peut renvoyer le même événement plusieurs fois.
    if (r.paiement_statut === 'paye') {
      return new Response(JSON.stringify({ ok: true, alreadyHandled: true }), { status: 200 });
    }

    const { error: updateError } = await admin
      .from('reservations')
      .update({
        paiement_statut: 'paye',
        stripe_payment_intent_id: session.payment_intent,
      })
      .eq('id', r.id);

    if (updateError) {
      return new Response(JSON.stringify({ ok: false, error: updateError.message }), { status: 500 });
    }

    const resendKey = Deno.env.get('RESEND_API_KEY');
    const fromEmail = Deno.env.get('FROM_EMAIL') ?? 'onboarding@resend.dev';
    const siteUrl = Deno.env.get('SITE_URL') ?? '';

    const html = `
      <p>Bonjour ${r.prenom},</p>
      <p>Votre paiement de <strong>${r.prix} €</strong> pour la séance de
      <strong>${r.prestation}</strong> le <strong>${r.date_seance} à ${r.heure_seance}</strong>
      a bien été reçu. Votre réservation est définitivement confirmée.</p>
      <p>Besoin d'annuler ? Remboursement intégral jusqu'à 24h avant la séance,
      50% au-delà. Vous pouvez annuler vous-même à tout moment via ce lien :</p>
      <p><a href="${siteUrl}/annulation.html?token=${r.cancel_token}">Annuler ma séance</a></p>
      <p>À bientôt.</p>
    `;

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromEmail,
        to: r.email,
        subject: `Paiement reçu — séance du ${r.date_seance} confirmée`,
        html,
        attachments: [buildIcsAttachment(r)],
      }),
    });

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500 });
  }
});
