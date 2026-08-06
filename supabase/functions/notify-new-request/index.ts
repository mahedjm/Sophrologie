// =========================================================
// notify-new-request
// -----------------------------------------------------------
// Déclenchée automatiquement par un Database Webhook Supabase
// (voir README.md) à chaque INSERT dans la table `reservations`.
// Envoie un email à la sophrologue pour l'informer d'une nouvelle
// demande à valider.
//
// Secrets requis (Dashboard > Edge Functions > Secrets) :
//   RESEND_API_KEY   -> clé API Resend
//   NOTIFY_EMAIL     -> email de la sophrologue (destinataire)
//   FROM_EMAIL       -> adresse d'expédition validée sur Resend
//   ADMIN_URL        -> URL de la page admin.html une fois en ligne
// =========================================================

Deno.serve(async (req) => {
  try {
    const payload = await req.json();
    const r = payload.record;

    const resendKey = Deno.env.get('RESEND_API_KEY');
    const notifyEmail = Deno.env.get('NOTIFY_EMAIL');
    const fromEmail = Deno.env.get('FROM_EMAIL') ?? 'onboarding@resend.dev';
    const adminUrl = Deno.env.get('ADMIN_URL') ?? '#';

    const html = `
      <p>Nouvelle demande de rendez-vous à valider :</p>
      <ul>
        <li><strong>Prestation :</strong> ${r.prestation} (${r.lieu})</li>
        <li><strong>Date :</strong> ${r.date_seance} à ${r.heure_seance}</li>
        <li><strong>Client :</strong> ${r.prenom} ${r.nom} — ${r.email} — ${r.telephone}</li>
        <li><strong>Message :</strong> ${r.message || '(aucun)'}</li>
      </ul>
      <p><a href="${adminUrl}">Ouvrir le tableau de bord</a> pour confirmer ou refuser.</p>
    `;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromEmail,
        to: notifyEmail,
        subject: `Nouvelle demande — ${r.prenom} ${r.nom} (${r.date_seance})`,
        html,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      return new Response(JSON.stringify({ ok: false, error: err }), { status: 500 });
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500 });
  }
});
