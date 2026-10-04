/* =========================================================
   SOBIOSE — payer.js
   Page payer.html : crée une session Stripe Checkout à la volée
   pour la réservation désignée par le token présent dans l'URL,
   puis redirige vers le paiement sécurisé.
   ========================================================= */
document.addEventListener('DOMContentLoaded', async () => {
  const messageEl = document.getElementById('payer-message');
  const token = new URLSearchParams(window.location.search).get('token');

  if (!token) {
    messageEl.textContent = 'Lien de paiement invalide.';
    return;
  }

  const { data, error } = await supabaseClient.functions.invoke('create-checkout-session', {
    body: { token },
  });

  if (error || !data?.ok) {
    messageEl.textContent = "Impossible de préparer le paiement pour le moment. Merci de réessayer, ou de contacter directement Marie-Laurence.";
    return;
  }

  if (data.alreadyPaid) {
    messageEl.textContent = 'Cette séance est déjà payée — aucune action nécessaire.';
    return;
  }

  messageEl.textContent = 'Redirection vers le paiement sécurisé…';
  window.location.href = data.url;
});
