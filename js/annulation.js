/* =========================================================
   SO-BIOSE — annulation.js
   Page annulation.html : affiche le montant remboursé (calculé
   côté serveur selon la règle des 24h) et déclenche l'annulation
   + le remboursement Stripe sur confirmation du client.
   ========================================================= */
document.addEventListener('DOMContentLoaded', () => {
  const messageEl = document.getElementById('cancel-message');
  const detailsEl = document.getElementById('cancel-details');
  const refundAmountEl = document.getElementById('cancel-refund-amount');
  const confirmBtn = document.getElementById('cancel-confirm-btn');
  const token = new URLSearchParams(window.location.search).get('token');

  if (!token) {
    messageEl.textContent = "Lien d'annulation invalide.";
    return;
  }

  async function loadPreview() {
    const { data, error } = await supabaseClient.functions.invoke('cancel-reservation', {
      body: { token, action: 'preview' },
    });

    if (error || !data?.ok) {
      messageEl.textContent = "Ce lien n'est plus valide, ou cette réservation ne peut pas être annulée ici. Contactez directement Marie-Laurence.";
      return;
    }

    if (data.alreadyCancelled) {
      messageEl.textContent = data.montant != null
        ? `Cette séance est déjà annulée — ${data.montant} € ont été remboursés.`
        : 'Cette séance est déjà annulée.';
      return;
    }

    messageEl.textContent = `Séance de ${data.prestation} le ${data.date_seance} à ${data.heure_seance} (${data.prix} €).`;
    refundAmountEl.textContent = `${data.montant} € (${data.pct}%)`;
    detailsEl.hidden = false;
  }

  confirmBtn.addEventListener('click', async () => {
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Annulation…';

    const { data, error } = await supabaseClient.functions.invoke('cancel-reservation', {
      body: { token, action: 'confirm' },
    });

    if (error || !data?.ok) {
      alert("Une erreur est survenue. Merci de réessayer, ou de contacter directement Marie-Laurence.");
      confirmBtn.disabled = false;
      confirmBtn.textContent = "Confirmer l'annulation";
      return;
    }

    detailsEl.hidden = true;
    messageEl.textContent = `Votre séance a été annulée. Remboursement de ${data.montant} € (${data.pct}%) en cours.`;
  });

  loadPreview();
});
