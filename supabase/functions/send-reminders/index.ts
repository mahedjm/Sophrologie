// =========================================================
// send-reminders
// -----------------------------------------------------------
// Appelée une fois par jour par une tâche planifiée (pg_cron + pg_net,
// voir README.md) — pas de session utilisateur ni d'appel Stripe, donc
// protégée par un secret partagé plutôt que par verify_jwt.
// Envoie un email de rappel aux clients dont la séance a lieu demain
// (calcul en fuseau Europe/Paris), et marque `rappel_envoye` pour ne
// jamais relancer deux fois.
//
// Header requis : "x-cron-secret: <CRON_SECRET>"
//
// Secrets requis (Dashboard > Edge Functions > Secrets) :
//   SUPABASE_URL              -> déjà fourni automatiquement par Supabase
//   SUPABASE_SERVICE_ROLE_KEY -> clé service_role
//   CRON_SECRET                -> secret partagé avec la tâche planifiée
//   RESEND_API_KEY             -> clé API Resend
//   FROM_EMAIL                 -> adresse d'expédition validée sur Resend
// =========================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

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

function tomorrowInParis(): string {
  const now = new Date();
  const parisNow = new Date(now.getTime() + parisOffsetMinutes(now) * 60000);
  parisNow.setUTCDate(parisNow.getUTCDate() + 1);
  return parisNow.toISOString().slice(0, 10); // 'YYYY-MM-DD'
}

Deno.serve(async (req) => {
  const cronSecret = Deno.env.get('CRON_SECRET');
  if (!cronSecret || req.headers.get('x-cron-secret') !== cronSecret) {
    return new Response(JSON.stringify({ ok: false, error: 'Non autorisé' }), { status: 401 });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const targetDate = tomorrowInParis();

    const { data: reservations, error } = await admin
      .from('reservations')
      .select('*')
      .eq('statut', 'confirme')
      .eq('paiement_statut', 'paye')
      .eq('rappel_envoye', false)
      .eq('date_seance', targetDate);

    if (error) {
      return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500 });
    }

    const resendKey = Deno.env.get('RESEND_API_KEY');
    const fromEmail = Deno.env.get('FROM_EMAIL') ?? 'onboarding@resend.dev';

    for (const r of reservations || []) {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: fromEmail,
          to: r.email,
          subject: `Rappel — votre séance de demain (${r.date_seance} à ${r.heure_seance})`,
          html: `<p>Bonjour ${r.prenom},</p>
                 <p>Petit rappel : votre séance de <strong>${r.prestation}</strong> a lieu
                 <strong>demain, ${r.date_seance} à ${r.heure_seance}</strong> (${r.lieu}).</p>
                 <p>À demain !</p>`,
        }),
      });

      await admin.from('reservations').update({ rappel_envoye: true }).eq('id', r.id);
    }

    return new Response(JSON.stringify({ ok: true, sent: (reservations || []).length }), { status: 200 });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500 });
  }
});
