/* =========================================================
   SOBIOSE — admin.js
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
    loadAteliers();
    loadDevis();
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

  const PAIEMENT_LABELS = {
    non_requis: 'Confirmé',
    en_attente_paiement: 'En attente de paiement',
    paye: 'Payé',
    rembourse: 'Remboursé',
    rembourse_partiel: 'Remboursé (50%)',
  };

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
      const priceLabel = document.createElement('label');
      priceLabel.className = 'req-price';
      priceLabel.innerHTML = `Prix (€) <input type="number" min="0" step="0.5" value="${r.prix}">`;
      main.appendChild(priceLabel);
      const priceInput = priceLabel.querySelector('input');

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

      confirmBtn.addEventListener('click', () => decide(r.id, 'confirme', card, confirmBtn, refuseBtn, priceInput));
      refuseBtn.addEventListener('click', () => decide(r.id, 'refuse', card, confirmBtn, refuseBtn, priceInput));

      actions.appendChild(confirmBtn);
      actions.appendChild(refuseBtn);
      card.appendChild(actions);
    } else {
      const status = document.createElement('span');
      status.className = 'req-status';
      status.textContent = PAIEMENT_LABELS[r.paiement_statut] || 'Confirmé';
      card.appendChild(status);

      if (r.paiement_statut !== 'paye') {
        const releaseBtn = document.createElement('button');
        releaseBtn.type = 'button';
        releaseBtn.className = 'btn btn-ghost btn-small';
        releaseBtn.textContent = 'Libérer le créneau';
        releaseBtn.addEventListener('click', () => releaseSlot(r.id, card, releaseBtn));
        card.appendChild(releaseBtn);
      }
    }

    return card;
  }

  async function decide(id, statut, card, btnA, btnB, priceInput) {
    btnA.disabled = true;
    btnB.disabled = true;
    btnA.textContent = '…';

    const body = { id, statut };
    if (statut === 'confirme' && priceInput) {
      const prix = parseFloat(priceInput.value);
      if (!isNaN(prix)) body.prix = prix;
    }

    const { error } = await supabaseClient.functions.invoke('send-status-email', { body });

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

  // Pour les rendez-vous confirmés mais jamais payés (client qui abandonne le
  // paiement) : libère manuellement le créneau, faute de purge automatique.
  async function releaseSlot(id, card, btn) {
    btn.disabled = true;
    btn.textContent = '…';

    const { error } = await supabaseClient.from('reservations').update({ statut: 'annule' }).eq('id', id);

    if (error) {
      alert("Une erreur est survenue lors de la libération du créneau.");
      btn.disabled = false;
      btn.textContent = 'Libérer le créneau';
      return;
    }

    card.remove();
    loadRequests();
  }

  /* ---------- Séances de groupe ouvertes ---------- */
  const atelierForm = document.getElementById('atelier-form');
  const atelierError = document.getElementById('atelier-error');
  const ateliersList = document.getElementById('ateliers-list');
  const ateliersEmpty = document.getElementById('ateliers-empty');

  async function loadAteliers() {
    ateliersList.innerHTML = '';
    const today = new Date().toISOString().slice(0, 10);

    const { data, error } = await supabaseClient
      .from('ateliers_sessions')
      .select('*, reservations(nombre_participants, statut)')
      .eq('statut', 'ouvert')
      .gte('date_seance', today)
      .order('date_seance', { ascending: true });

    if (error) {
      ateliersList.innerHTML = `<p class="admin-error">Erreur de chargement : ${error.message}</p>`;
      return;
    }

    ateliersEmpty.hidden = data.length > 0;
    data.forEach(s => ateliersList.appendChild(renderAtelierCard(s)));
  }

  function renderAtelierCard(s) {
    const reserved = (s.reservations || [])
      .filter(r => ['en_attente', 'confirme'].includes(r.statut))
      .reduce((sum, r) => sum + r.nombre_participants, 0);

    const card = document.createElement('article');
    card.className = 'req-card atelier-card';

    const main = document.createElement('div');
    main.className = 'req-main';
    main.innerHTML = `
      <strong>${s.titre}</strong>
      <span>${s.lieu} — ${formatDate(s.date_seance)} à ${s.heure_seance} — ${s.prix_place} € / place</span>
      <span class="req-meta">${reserved} / ${s.capacite_max} places réservées</span>
    `;
    card.appendChild(main);

    const status = document.createElement('span');
    status.className = 'req-status' + (reserved >= s.capacite_max ? ' is-complet' : '');
    status.textContent = reserved >= s.capacite_max ? 'Complet' : 'Ouvert';
    card.appendChild(status);

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn btn-ghost btn-small';
    cancelBtn.textContent = 'Annuler la séance';
    cancelBtn.addEventListener('click', async () => {
      cancelBtn.disabled = true;
      const { error } = await supabaseClient.from('ateliers_sessions').update({ statut: 'annule' }).eq('id', s.id);
      if (error) {
        alert("Une erreur est survenue lors de l'annulation.");
        cancelBtn.disabled = false;
        return;
      }
      card.remove();
      loadAteliers();
    });
    card.appendChild(cancelBtn);

    return card;
  }

  atelierForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    atelierError.hidden = true;

    const { error } = await supabaseClient.from('ateliers_sessions').insert({
      titre: document.getElementById('a-titre').value.trim(),
      lieu: document.getElementById('a-lieu').value.trim(),
      date_seance: document.getElementById('a-date').value,
      heure_seance: document.getElementById('a-heure').value,
      capacite_max: parseInt(document.getElementById('a-capacite').value, 10),
      prix_place: parseFloat(document.getElementById('a-prix').value),
    });

    if (error) {
      atelierError.textContent = "Impossible de créer la séance : " + error.message;
      atelierError.hidden = false;
      return;
    }

    atelierForm.reset();
    document.getElementById('a-capacite').value = 10;
    document.getElementById('a-prix').value = 20;
    loadAteliers();
  });

  /* ---------- Demandes de devis ---------- */
  const devisList = document.getElementById('devis-list');
  const devisEmpty = document.getElementById('devis-empty');

  const TYPE_STRUCTURE_LABELS = {
    mairie: 'Mairie', ccas: 'CCAS', association: 'Association',
    entreprise: 'Entreprise', sante: 'Structure de santé', autre: 'Autre',
  };

  async function loadDevis() {
    devisList.innerHTML = '';

    const { data, error } = await supabaseClient
      .from('demandes_devis')
      .select('*')
      .eq('statut', 'nouvelle')
      .order('created_at', { ascending: true });

    if (error) {
      devisList.innerHTML = `<p class="admin-error">Erreur de chargement : ${error.message}</p>`;
      return;
    }

    devisEmpty.hidden = data.length > 0;
    data.forEach(d => devisList.appendChild(renderDevisCard(d)));
  }

  function renderDevisCard(d) {
    const card = document.createElement('article');
    card.className = 'req-card';

    const main = document.createElement('div');
    main.className = 'req-main';
    main.innerHTML = `
      <strong>${d.nom_structure} — ${TYPE_STRUCTURE_LABELS[d.type_structure] || d.type_structure}</strong>
      <span>${d.contact_prenom} ${d.contact_nom}${d.nombre_personnes ? ' — ' + d.nombre_personnes + ' personnes' : ''}</span>
      <span class="req-meta">${d.email} · ${d.telephone}${d.message ? ' · « ' + d.message + ' »' : ''}</span>
    `;
    card.appendChild(main);

    const treatedBtn = document.createElement('button');
    treatedBtn.type = 'button';
    treatedBtn.className = 'btn btn-primary btn-small';
    treatedBtn.textContent = 'Marquer traitée';
    treatedBtn.addEventListener('click', async () => {
      treatedBtn.disabled = true;
      const { error } = await supabaseClient.from('demandes_devis').update({ statut: 'traitee' }).eq('id', d.id);
      if (error) {
        alert("Une erreur est survenue.");
        treatedBtn.disabled = false;
        return;
      }
      card.remove();
      loadDevis();
    });
    card.appendChild(treatedBtn);

    return card;
  }

});
