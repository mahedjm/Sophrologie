/* =========================================================
   AU FIL DE SOI — admin.js
   Page privée : connexion + gestion des demandes de rendez-vous.
   ========================================================= */
document.addEventListener('DOMContentLoaded', () => {

  const loginView = document.getElementById('login-view');
  const dashboardView = document.getElementById('dashboard-view');
  const logoutBtn = document.getElementById('logout-btn');
  const loginForm = document.getElementById('login-form');
  const loginError = document.getElementById('login-error');

  const pendingList = document.getElementById('pending-list');
  const pendingEmpty = document.getElementById('pending-empty');
  const upcomingList = document.getElementById('upcoming-list');
  const upcomingEmpty = document.getElementById('upcoming-empty');

  function showDashboard() {
    loginView.hidden = true;
    dashboardView.hidden = false;
    logoutBtn.hidden = false;
    loadRequests();
  }

  function showLogin() {
    loginView.hidden = false;
    dashboardView.hidden = true;
    logoutBtn.hidden = true;
  }

  /* ---------- Auth ---------- */
  supabaseClient.auth.getSession().then(({ data }) => {
    if (data.session) showDashboard(); else showLogin();
  });

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.hidden = true;
    const email = document.getElementById('l-email').value.trim();
    const password = document.getElementById('l-password').value;

    const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) {
      loginError.textContent = 'Email ou mot de passe incorrect.';
      loginError.hidden = false;
      return;
    }
    showDashboard();
  });

  logoutBtn.addEventListener('click', async () => {
    await supabaseClient.auth.signOut();
    showLogin();
  });

  /* ---------- Chargement des demandes ---------- */
  function formatDate(iso) {
    return new Date(iso + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  }

  async function loadRequests() {
    pendingList.innerHTML = '';
    upcomingList.innerHTML = '';

    const { data: pending, error: pendingErr } = await supabaseClient
      .from('reservations')
      .select('*')
      .eq('statut', 'en_attente')
      .order('date_seance', { ascending: true });

    if (pendingErr) {
      pendingList.innerHTML = `<p class="admin-error">Erreur de chargement : ${pendingErr.message}</p>`;
    } else {
      pendingEmpty.hidden = pending.length > 0;
      pending.forEach(r => pendingList.appendChild(renderRequestCard(r, true)));
    }

    const today = new Date().toISOString().slice(0, 10);
    const { data: upcoming, error: upcomingErr } = await supabaseClient
      .from('reservations')
      .select('*')
      .eq('statut', 'confirme')
      .gte('date_seance', today)
      .order('date_seance', { ascending: true });

    if (!upcomingErr) {
      upcomingEmpty.hidden = upcoming.length > 0;
      upcoming.forEach(r => upcomingList.appendChild(renderRequestCard(r, false)));
    }
  }

  function renderRequestCard(r, withActions) {
    const card = document.createElement('article');
    card.className = 'req-card';

    const main = document.createElement('div');
    main.className = 'req-main';
    main.innerHTML = `
      <strong>${r.prenom} ${r.nom}</strong>
      <span>${r.prestation} — ${r.lieu} — ${formatDate(r.date_seance)} à ${r.heure_seance}</span>
      <span class="req-meta">${r.email} · ${r.telephone}${r.message ? ' · « ' + r.message + ' »' : ''}</span>
    `;
    card.appendChild(main);

    if (withActions) {
      const actions = document.createElement('div');
      actions.className = 'req-actions';

      const confirmBtn = document.createElement('button');
      confirmBtn.type = 'button';
      confirmBtn.className = 'btn btn-primary btn-small';
      confirmBtn.textContent = 'Confirmer';

      const refuseBtn = document.createElement('button');
      refuseBtn.type = 'button';
      refuseBtn.className = 'btn btn-ghost btn-small';
      refuseBtn.textContent = 'Refuser';

      confirmBtn.addEventListener('click', () => decide(r.id, 'confirme', card, confirmBtn, refuseBtn));
      refuseBtn.addEventListener('click', () => decide(r.id, 'refuse', card, confirmBtn, refuseBtn));

      actions.appendChild(confirmBtn);
      actions.appendChild(refuseBtn);
      card.appendChild(actions);
    } else {
      const status = document.createElement('span');
      status.className = 'req-status';
      status.textContent = 'Confirmé';
      card.appendChild(status);
    }

    return card;
  }

  async function decide(id, statut, card, btnA, btnB) {
    btnA.disabled = true;
    btnB.disabled = true;
    btnA.textContent = '…';

    const { error } = await supabaseClient.functions.invoke('send-status-email', {
      body: { id, statut },
    });

    if (error) {
      alert("Une erreur est survenue. Réessayez, ou vérifiez la configuration de la fonction send-status-email.");
      btnA.disabled = false;
      btnB.disabled = false;
      btnA.textContent = 'Confirmer';
      return;
    }

    card.remove();
    loadRequests();
  }

});
