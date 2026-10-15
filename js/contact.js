/* =========================================================
   SOBIOSE — contact.js
   Page contact.html : formulaire de demande de devis B2B, inséré
   directement dans la table `demandes_devis` (voir schema.sql). La
   cliente reçoit un email de notification (Edge Function
   notify-devis-request, déclenchée par un Database Webhook).
   ========================================================= */
document.addEventListener('DOMContentLoaded', () => {

  const form = document.getElementById('devis-form');
  if (!form) return;

  const errorEl = document.getElementById('devis-error');
  const submitBtn = document.getElementById('devis-submit');
  const successEl = document.getElementById('devis-success');

  // Préselection de l'objet via ?objet=entreprise|musique|collectivite
  const OBJET_LABELS = {
    entreprise: 'Intervention en entreprise / établissement de santé',
    musique: 'Sophro-sonore',
    collectivite: 'Atelier ou cycle collectivité / association',
    autre: 'Autre demande',
  };
  const params = new URLSearchParams(window.location.search);
  const objetParam = params.get('objet');
  if (objetParam && OBJET_LABELS[objetParam]) {
    form.objet.value = objetParam;
    if (objetParam === 'entreprise') form.type_structure.value = 'entreprise';
  }
  // Format choisi sur une carte tarif (entreprises.html) : repris dans le message
  const formatParam = params.get('format');
  if (formatParam) form.message.value = `Format envisagé : ${formatParam}\n`;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!form.checkValidity()) { form.reportValidity(); return; }

    errorEl.hidden = true;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Envoi…';

    const { error } = await supabaseClient.from('demandes_devis').insert({
      type_structure: form.type_structure.value,
      nom_structure: form.nom_structure.value.trim(),
      contact_prenom: form.contact_prenom.value.trim(),
      contact_nom: form.contact_nom.value.trim(),
      email: form.email.value.trim(),
      telephone: form.telephone.value.trim(),
      nombre_personnes: form.nombre_personnes.value.trim() || null,
      // L'objet n'a pas de colonne dédiée : on le préfixe au message pour ne
      // pas toucher au schéma Supabase.
      message: `[${OBJET_LABELS[form.objet.value]}] ${form.message.value.trim()}`.trim(),
    });

    submitBtn.disabled = false;
    submitBtn.textContent = 'Être rappelé·e';

    if (error) {
      console.error(error);
      errorEl.textContent = "Une erreur est survenue lors de l'envoi. Merci de réessayer ou de me contacter directement par email.";
      errorEl.hidden = false;
      return;
    }

    form.hidden = true;
    successEl.hidden = false;
    // Conversion pour Google Tag Manager (sans donnée personnelle ; n'est envoyée qu'après consentement)
    (window.dataLayer = window.dataLayer || []).push({ event: 'generate_lead', lead_type: 'devis', objet: form.objet.value });
  });

});
