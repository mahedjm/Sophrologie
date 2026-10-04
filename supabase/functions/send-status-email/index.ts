// =========================================================
// send-status-email
// -----------------------------------------------------------
// Appelée depuis admin.html quand la sophrologue clique sur
// "Confirmer" ou "Refuser". Vérifie qu'elle est bien connectée,
// met à jour le statut de la réservation, puis envoie un email
// au client pour l'informer de la décision.
//
// Si elle confirme, la réservation passe en attente de paiement et
// l'email contient un lien vers payer.html (qui crée la session de
// paiement Stripe à la volée) — pas de lien Stripe direct ici pour
// éviter les soucis d'expiration de session.
//
// Body attendu : { "id": "<uuid réservation>", "statut": "confirme" | "refuse", "prix"?: number }
// (le champ "prix" est optionnel, utilisé par exemple pour les séances
// de groupe où la sophrologue fixe le prix au moment de confirmer)
//
// Secrets requis (Dashboard > Edge Functions > Secrets) :
//   SUPABASE_URL              -> déjà fourni automatiquement par Supabase
//   SUPABASE_SERVICE_ROLE_KEY -> clé service_role (jamais exposée au front)
//   RESEND_API_KEY            -> clé API Resend
//   FROM_EMAIL                -> adresse d'expédition validée sur Resend
//   SITE_URL                  -> URL publique du site (pour construire le lien payer.html)
// =========================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { Buffer } from 'node:buffer';

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
    'PRODID:-//SoBiOse//FR',
    'BEGIN:VEVENT',
    `UID:${r.id}@sobiose.fr`,
    `DTSTAMP:${toIcsDate(new Date())}`,
    `DTSTART:${toIcsDate(start)}`,
    `DTEND:${toIcsDate(end)}`,
    `SUMMARY:${r.prestation} — SoBiOse`,
    `LOCATION:${r.lieu}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  return { filename: 'seance.ics', content: Buffer.from(ics, 'utf-8').toString('base64') };
}

Deno.serve(async (req) => {
  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.replace('Bearer ', '');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(supabaseUrl, serviceRoleKey);

    // Vérifie que l'appelant est bien authentifiée (la sophrologue) —
    // refuse toute tentative venant d'un client anonyme du site public.
    const { data: userData, error: authError } = await admin.auth.getUser(token);
    if (authError || !userData?.user) {
      return new Response(JSON.stringify({ ok: false, error: 'Non autorisé' }), { status: 401 });
    }

    const { id, statut, prix } = await req.json();
    if (!id || !['confirme', 'refuse'].includes(statut)) {
      return new Response(JSON.stringify({ ok: false, error: 'Paramètres invalides' }), { status: 400 });
    }

    const updateFields: Record<string, unknown> = { statut };
    if (statut === 'confirme') {
      updateFields.paiement_statut = 'en_attente_paiement';
      if (typeof prix === 'number' && prix >= 0) updateFields.prix = prix;
    }

    const { data: reservation, error: updateError } = await admin
      .from('reservations')
      .update(updateFields)
      .eq('id', id)
      .select()
      .single();

    if (updateError || !reservation) {
      return new Response(JSON.stringify({ ok: false, error: updateError?.message }), { status: 500 });
    }

    const resendKey = Deno.env.get('RESEND_API_KEY');
    const fromEmail = Deno.env.get('FROM_EMAIL') ?? 'onboarding@resend.dev';
    const siteUrl = Deno.env.get('SITE_URL') ?? '#';

    const subject = statut === 'confirme'
      ? `Votre séance du ${reservation.date_seance} est confirmée — reste à régler`
      : `À propos de votre demande du ${reservation.date_seance}`;

    const html = statut === 'confirme'
      ? `<p>Bonjour ${reservation.prenom},</p>
         <p>Votre séance de <strong>${reservation.prestation}</strong> (${reservation.lieu})
         est confirmée le <strong>${reservation.date_seance} à ${reservation.heure_seance}</strong>,
         pour un montant de <strong>${reservation.prix} €</strong>.</p>
         <p>Il ne reste plus qu'à régler en ligne pour finaliser votre réservation :</p>
         <p><a href="${siteUrl}/payer.html?token=${reservation.pay_token}">Payer ma séance (${reservation.prix} €)</a></p>
         <p>À bientôt.</p>`
      : `<p>Bonjour ${reservation.prenom},</p>
         <p>Je ne suis malheureusement pas en mesure de vous recevoir le
         ${reservation.date_seance} à ${reservation.heure_seance}. N'hésitez pas à
         choisir un autre créneau sur le site.</p>`;

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromEmail,
        to: reservation.email,
        subject,
        html,
        ...(statut === 'confirme' ? { attachments: [buildIcsAttachment(reservation)] } : {}),
      }),
    });

    return new Response(JSON.stringify({ ok: true, reservation }), { status: 200 });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500 });
  }
});
