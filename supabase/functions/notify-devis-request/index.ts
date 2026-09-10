// =========================================================
// notify-devis-request
// -----------------------------------------------------------
// Déclenchée automatiquement par un Database Webhook Supabase
// (voir README.md) à chaque INSERT dans la table `demandes_devis`.
// Envoie un email à la sophrologue pour l'informer d'une nouvelle
// demande de devis B2B (mairie, entreprise, association…).
//
// Secrets requis (Dashboard > Edge Functions > Secrets) :
//   RESEND_API_KEY   -> clé API Resend
//   NOTIFY_EMAIL     -> email de la sophrologue (destinataire)
//   FROM_EMAIL       -> adresse d'expédition validée sur Resend
//   ADMIN_URL        -> URL de la page admin.html une fois en ligne
// =========================================================

const TYPE_LABELS: Record<string, string> = {
  mairie: 'Mairie',
  ccas: 'CCAS',
  association: 'Association',
  entreprise: 'Entreprise',
  sante: 'Structure de santé',
  autre: 'Autre',
};

Deno.serve(async (req) => {
  try {
    const payload = await req.json();
    const d = payload.record;

    const resendKey = Deno.env.get('RESEND_API_KEY');
    const notifyEmail = Deno.env.get('NOTIFY_EMAIL');
    const fromEmail = Deno.env.get('FROM_EMAIL') ?? 'onboarding@resend.dev';
    const adminUrl = Deno.env.get('ADMIN_URL') ?? '#';

    const html = `
      <p>Nouvelle demande de devis à traiter :</p>
      <ul>
        <li><strong>Structure :</strong> ${d.nom_structure} (${TYPE_LABELS[d.type_structure] || d.type_structure})</li>
        <li><strong>Contact :</strong> ${d.contact_prenom} ${d.contact_nom} — ${d.email} — ${d.telephone}</li>
        <li><strong>Nombre de personnes estimé :</strong> ${d.nombre_personnes || '(non précisé)'}</li>
        <li><strong>Message :</strong> ${d.message || '(aucun)'}</li>
      </ul>
      <p><a href="${adminUrl}">Ouvrir le tableau de bord</a> pour la marquer traitée une fois répondue.</p>
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
        subject: `Demande de devis — ${d.nom_structure}`,
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
