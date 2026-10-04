/* =========================================================
   SO-BIOSE — reservation.js
   Page reservation.html : tunnel de réservation à 3 formats —
   suivi individuel, atelier privé à domicile, séance de groupe
   ouverte — connecté à Supabase.

   - Individuel / groupe privé : une demande "en_attente" est créée,
     la sophrologue la valide depuis admin.html (déclenche l'email
     avec le lien de paiement).
   - Groupe ouvert : la place est directement confirmée (jauge
     vérifiée en base, voir schema.sql) et le paiement Stripe se
     lance immédiatement après l'insertion, sans validation manuelle.
   ========================================================= */
document.addEventListener('DOMContentLoaded', () => {

  const widget = document.getElementById('booking-widget');
  if (!widget) return;

  const BASE_SLOTS = ['09:00', '10:00', '11:00', '14:00', '15:30', '17:00'];

  const SUPABASE_READY = typeof SUPABASE_URL !== 'undefined'
    && !SUPABASE_URL.includes('VOTRE-PROJET');

  const statusNote = document.getElementById('booking-status-note');
  if (statusNote && !SUPABASE_READY) {
    statusNote.textContent = 'Mode démonstration — créneaux fictifs. Renseignez js/config.js pour activer les vraies réservations.';
  }

  const state = { format: null, service: null, price: null, lieu: null, participants: 6, atelier: null };

  const panels = widget.querySelectorAll('.booking-panel');
  const steps = widget.querySelectorAll('.bstep');
  const STEP_ORDER = ['format', 'details', 'planning', 'contact', 'recap'];

  function goToPanel(name) {
    panels.forEach(p => p.classList.toggle('is-active', p.dataset.panel === name));
    const idx = STEP_ORDER.indexOf(name);
    steps.forEach(s => {
      const stepIdx = STEP_ORDER.indexOf(s.dataset.step);
      s.classList.toggle('is-active', stepIdx === idx);
      s.classList.toggle('is-done', stepIdx < idx);
    });
    widget.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  widget.querySelectorAll('[data-back]').forEach(btn => {
    btn.addEventListener('click', () => goToPanel(btn.dataset.back));
  });

  /* ---- PANEL: FORMAT ---- */
  const formatOptions = document.querySelectorAll('#format-options .option-card');
  const detailsContent = document.getElementById('details-content');
  const toPlanning = document.getElementById('to-planning');

  function selectFormat(format) {
    const card = Array.from(formatOptions).find(c => c.dataset.format === format);
    if (!card) return;
    formatOptions.forEach(c => c.classList.remove('is-selected'));
    card.classList.add('is-selected');
    state.format = format;
    renderDetailsPanel();
    goToPanel('details');
  }

  formatOptions.forEach(card => card.addEventListener('click', () => selectFormat(card.dataset.format)));

  /* ---- PANEL: DETAILS (contenu selon le format) ---- */
  function renderDetailsPanel() {
    toPlanning.disabled = true;

    if (state.format === 'individuel') {
      detailsContent.innerHTML = `
        <h3>Quelle prestation souhaitez-vous réserver ?</h3>
        <div class="option-grid" id="prestation-options">
          <button type="button" class="option-card" data-service="Séance découverte" data-price="55">
            <span class="oc-name">Séance découverte</span><span class="oc-price">55&nbsp;€</span><span class="oc-duration">1h</span>
          </button>
          <button type="button" class="option-card" data-service="Séance individuelle" data-price="50">
            <span class="oc-name">Séance individuelle</span><span class="oc-price">50&nbsp;€</span><span class="oc-duration">50 min</span>
          </button>
          <button type="button" class="option-card" data-service="Forfait 5 séances" data-price="225">
            <span class="oc-name">Forfait 5 séances</span><span class="oc-price">225&nbsp;€</span><span class="oc-duration">45&nbsp;€ / séance</span>
          </button>
          <button type="button" class="option-card" data-service="Forfait 10 séances" data-price="420">
            <span class="oc-name">Forfait 10 séances</span><span class="oc-price">420&nbsp;€</span><span class="oc-duration">42&nbsp;€ / séance</span>
          </button>
          <button type="button" class="option-card" data-service="Séance duo" data-price="65">
            <span class="oc-name">Séance duo</span><span class="oc-price">65&nbsp;€</span><span class="oc-duration">1h</span>
          </button>
        </div>
      `;
      state.lieu = 'Visio';
      detailsContent.querySelectorAll('.option-card').forEach(card => {
        card.addEventListener('click', () => selectPrestation(card.dataset.service));
      });
      if (state.service) selectPrestation(state.service);

    } else if (state.format === 'groupe-prive') {
      detailsContent.innerHTML = `
        <h3>Votre atelier privé à domicile</h3>
        <p class="booking-hint">Minimum 6 personnes. Le tarif (par personne ou au forfait) est fixé
        avec vous par Marie-Laurence à la confirmation.</p>
        <label class="details-field" for="d-participants">Nombre de participants
          <input type="number" id="d-participants" min="6" step="1" value="${state.participants || 6}">
        </label>
      `;
      state.lieu = "Chez l'organisateur (groupe)";
      const input = document.getElementById('d-participants');
      const validate = () => {
        const n = parseInt(input.value, 10);
        state.participants = n;
        toPlanning.disabled = !(n >= 6);
      };
      input.addEventListener('input', validate);
      validate();

    } else if (state.format === 'groupe-ouvert') {
      detailsContent.innerHTML = `
        <h3>Choisissez une séance</h3>
        <p class="booking-hint">Places limitées, disponibilité mise à jour en direct.</p>
        <div class="option-grid" id="atelier-options"><p class="booking-hint">Chargement des séances…</p></div>
      `;
      loadAteliersOuverts();
    }
  }

  function selectPrestation(serviceName) {
    const card = detailsContent.querySelector(`[data-service="${CSS.escape(serviceName)}"]`);
    if (!card) return;
    detailsContent.querySelectorAll('.option-card').forEach(c => c.classList.remove('is-selected'));
    card.classList.add('is-selected');
    state.service = card.dataset.service;
    state.price = parseInt(card.dataset.price, 10);
    toPlanning.disabled = false;
  }

  async function loadAteliersOuverts() {
    const grid = document.getElementById('atelier-options');
    const { data, error } = await supabaseClient
      .from('ateliers_disponibles')
      .select('*')
      .order('date_seance', { ascending: true });

    if (error) {
      grid.innerHTML = '<p class="booking-hint">Impossible de charger les séances pour le moment. Contactez directement Marie-Laurence.</p>';
      console.error(error);
      return;
    }

    if (!data || data.length === 0) {
      grid.innerHTML = '<p class="booking-hint">Aucune séance de groupe ouverte n\'est programmée pour le moment.</p>';
      return;
    }

    grid.innerHTML = '';
    data.forEach(a => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'option-card';
      card.innerHTML = `
        <span class="oc-name">${a.titre}</span>
        <span class="oc-price">${a.prix_place}&nbsp;€</span>
        <span class="oc-duration">${formatDateISO(a.date_seance)} à ${a.heure_seance} — ${a.lieu} — ${a.places_restantes} place${a.places_restantes > 1 ? 's' : ''} restante${a.places_restantes > 1 ? 's' : ''}</span>
      `;
      card.addEventListener('click', () => {
        grid.querySelectorAll('.option-card').forEach(c => c.classList.remove('is-selected'));
        card.classList.add('is-selected');
        state.atelier = a;
        toPlanning.disabled = false;
      });
      grid.appendChild(card);
    });
  }

  toPlanning.addEventListener('click', () => {
    if (state.format === 'groupe-ouvert') {
      renderRecap();
      goToPanel('contact');
    } else {
      goToPanel('planning');
      loadAvailability();
    }
  });

  /* ---- PANEL: PLANNING (calendrier + créneaux — individuel / groupe privé) ---- */
  const calendarEl = document.getElementById('calendar');
  const weekdaysEl = document.getElementById('calendar-weekdays');
  const monthLabelEl = document.getElementById('cal-month-label');
  const prevMonthBtn = document.getElementById('cal-prev');
  const nextMonthBtn = document.getElementById('cal-next');
  const slotsEl = document.getElementById('slots');
  const toContact = document.getElementById('to-contact');

  const WEEKDAY_LABELS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
  const MONTH_LABELS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  const MAX_MONTHS_AHEAD = 3;

  function toISODate(date) { return date.toISOString().slice(0, 10); }
  function formatDate(date) { return date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }); }
  function formatDateISO(iso) { return new Date(iso + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }); }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const minSelectable = new Date(today);
  minSelectable.setDate(minSelectable.getDate() + 1);

  let viewYear = today.getFullYear();
  let viewMonth = today.getMonth();

  if (weekdaysEl) weekdaysEl.innerHTML = WEEKDAY_LABELS.map(l => `<span>${l}</span>`).join('');

  function monthsFromToday(y, m) { return (y - today.getFullYear()) * 12 + (m - today.getMonth()); }

  function updateNavState() {
    if (prevMonthBtn) prevMonthBtn.disabled = monthsFromToday(viewYear, viewMonth) <= 0;
    if (nextMonthBtn) nextMonthBtn.disabled = monthsFromToday(viewYear, viewMonth) >= MAX_MONTHS_AHEAD;
    if (monthLabelEl) monthLabelEl.textContent = `${MONTH_LABELS[viewMonth]} ${viewYear}`;
  }

  let takenByDate = new Map();

  async function loadAvailability() {
    updateNavState();
    calendarEl.innerHTML = '<p class="booking-hint">Chargement des disponibilités…</p>';

    const from = toISODate(new Date(viewYear, viewMonth, 1));
    const to = toISODate(new Date(viewYear, viewMonth + 1, 0));

    const { data, error } = await supabaseClient
      .from('creneaux_pris')
      .select('date_seance, heure_seance')
      .gte('date_seance', from)
      .lte('date_seance', to);

    if (error) {
      calendarEl.innerHTML = '<p class="booking-hint">Impossible de charger les disponibilités pour le moment. Contactez directement Marie-Laurence par téléphone ou email.</p>';
      console.error(error);
      return;
    }

    takenByDate = new Map();
    (data || []).forEach(row => {
      if (!takenByDate.has(row.date_seance)) takenByDate.set(row.date_seance, new Set());
      takenByDate.get(row.date_seance).add(row.heure_seance);
    });

    renderCalendar();
  }

  function renderCalendar() {
    calendarEl.innerHTML = '';
    const closed = new Set(window.CLOSED_DATES || []);

    const firstOfMonth = new Date(viewYear, viewMonth, 1);
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const leadingBlanks = (firstOfMonth.getDay() + 6) % 7;

    for (let i = 0; i < leadingBlanks; i++) {
      const blank = document.createElement('span');
      blank.className = 'cal-day is-empty';
      blank.setAttribute('aria-hidden', 'true');
      calendarEl.appendChild(blank);
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(viewYear, viewMonth, d);
      const iso = toISODate(date);
      const taken = takenByDate.get(iso) || new Set();
      const isFull = BASE_SLOTS.every(s => taken.has(s));
      const disabled = date < minSelectable || date.getDay() === 0 || closed.has(iso) || isFull;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cal-day' + (disabled ? ' is-disabled' : '');
      btn.disabled = disabled;
      btn.textContent = String(d);
      if (!disabled) btn.addEventListener('click', () => selectDay(date, iso, btn));
      calendarEl.appendChild(btn);
    }
  }

  function changeMonth(delta) {
    viewMonth += delta;
    if (viewMonth < 0) { viewMonth = 11; viewYear -= 1; }
    if (viewMonth > 11) { viewMonth = 0; viewYear += 1; }
    slotsEl.innerHTML = '';
    toContact.disabled = true;
    loadAvailability();
  }

  if (prevMonthBtn) prevMonthBtn.addEventListener('click', () => changeMonth(-1));
  if (nextMonthBtn) nextMonthBtn.addEventListener('click', () => changeMonth(1));

  function selectDay(date, iso, btn) {
    calendarEl.querySelectorAll('.cal-day').forEach(b => b.classList.remove('is-selected'));
    btn.classList.add('is-selected');
    state.date = date;
    state.dateISO = iso;
    state.time = null;
    toContact.disabled = true;
    renderSlots(iso);
  }

  function renderSlots(iso) {
    slotsEl.innerHTML = '';
    const taken = takenByDate.get(iso) || new Set();
    BASE_SLOTS.filter(s => !taken.has(s)).forEach(time => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'slot-btn';
      btn.textContent = time;
      btn.addEventListener('click', () => {
        slotsEl.querySelectorAll('.slot-btn').forEach(b => b.classList.remove('is-selected'));
        btn.classList.add('is-selected');
        state.time = time;
        toContact.disabled = false;
      });
      slotsEl.appendChild(btn);
    });
  }

  toContact.addEventListener('click', () => { renderRecap(); goToPanel('contact'); });

  /* ---- PANEL: CONTACT ---- */
  const form = document.getElementById('booking-form');
  const contactBack = document.getElementById('contact-back');
  contactBack.addEventListener('click', () => goToPanel(state.format === 'groupe-ouvert' ? 'details' : 'planning'));

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!form.checkValidity()) { form.reportValidity(); return; }

    state.prenom = form.prenom.value.trim();
    state.nom = form.nom.value.trim();
    state.email = form.email.value.trim();
    state.tel = form.tel.value.trim();
    state.message = form.message.value.trim();

    renderRecap();
    goToPanel('recap');
  });

  /* ---- PANEL: RECAP + confirmation ---- */
  const recapList = document.getElementById('recap-list');
  const recapNote = document.getElementById('recap-note');
  const recapError = document.getElementById('recap-error');
  const recapView = document.getElementById('recap-view');
  const successView = document.getElementById('success-view');
  const successText = document.getElementById('success-text');
  const confirmBtn = document.getElementById('confirm-booking');
  const restartBtn = document.getElementById('restart-booking');

  function confirmLabel() {
    return state.format === 'groupe-ouvert' ? `Payer ma place (${state.atelier.prix_place} €)` : 'Confirmer la demande';
  }

  function renderRecap() {
    recapError.hidden = true;

    if (state.format === 'individuel') {
      recapList.innerHTML = `
        <dt>Prestation</dt><dd>${state.service}</dd>
        <dt>Lieu</dt><dd>${state.lieu}</dd>
        <dt>Date</dt><dd>${formatDate(state.date)}</dd>
        <dt>Heure</dt><dd>${state.time}</dd>
        <dt>Tarif indicatif</dt><dd>${state.price} €</dd>
        <dt>Contact</dt><dd>${state.prenom || ''} ${state.nom || ''} — ${state.email || ''}</dd>
      `;
      recapNote.textContent = 'Marie-Laurence confirme personnellement chaque demande sous 24h — un email avec le lien de paiement vous sera alors envoyé.';
    } else if (state.format === 'groupe-prive') {
      recapList.innerHTML = `
        <dt>Format</dt><dd>Atelier privé à domicile</dd>
        <dt>Lieu</dt><dd>${state.lieu}</dd>
        <dt>Date</dt><dd>${formatDate(state.date)}</dd>
        <dt>Heure</dt><dd>${state.time}</dd>
        <dt>Participants</dt><dd>${state.participants}</dd>
        <dt>Tarif</dt><dd>Fixé à la confirmation</dd>
        <dt>Contact</dt><dd>${state.prenom || ''} ${state.nom || ''} — ${state.email || ''}</dd>
      `;
      recapNote.textContent = 'Marie-Laurence confirme personnellement chaque demande sous 24h et fixe le tarif à ce moment — un email avec le lien de paiement vous sera alors envoyé.';
    } else if (state.format === 'groupe-ouvert') {
      recapList.innerHTML = `
        <dt>Séance</dt><dd>${state.atelier.titre}</dd>
        <dt>Lieu</dt><dd>${state.atelier.lieu}</dd>
        <dt>Date</dt><dd>${formatDateISO(state.atelier.date_seance)}</dd>
        <dt>Heure</dt><dd>${state.atelier.heure_seance}</dd>
        <dt>Prix</dt><dd>${state.atelier.prix_place} €</dd>
        <dt>Contact</dt><dd>${state.prenom || ''} ${state.nom || ''} — ${state.email || ''}</dd>
      `;
      recapNote.textContent = 'Le paiement est immédiat et sécurise votre place — vous recevrez ensuite un email de confirmation.';
    }

    confirmBtn.textContent = confirmLabel();
  }

  confirmBtn.addEventListener('click', async () => {
    confirmBtn.disabled = true;
    confirmBtn.textContent = '…';
    recapError.hidden = true;

    if (state.format === 'groupe-ouvert') {
      // Insertion + création de la session Stripe faites ensemble côté
      // serveur (le prix et l'horaire viennent de la base, jamais du
      // client) — voir supabase/functions/create-atelier-reservation.
      const { data: sessionData, error: sessionError } = await supabaseClient.functions.invoke('create-atelier-reservation', {
        body: {
          atelier_session_id: state.atelier.id,
          prenom: state.prenom, nom: state.nom, email: state.email,
          telephone: state.tel, message: state.message || null,
        },
      });

      if (sessionError || !sessionData || !sessionData.ok || !sessionData.url) {
        alert("Cette séance est peut-être complète, ou une erreur est survenue. Merci de choisir à nouveau une séance, ou de contacter directement Marie-Laurence.");
        confirmBtn.disabled = false;
        confirmBtn.textContent = confirmLabel();
        goToPanel('details');
        loadAteliersOuverts();
        return;
      }

      window.location.href = sessionData.url;
      return;
    }

    const payload = {
      prenom: state.prenom, nom: state.nom, email: state.email,
      telephone: state.tel, message: state.message || null,
    };

    if (state.format === 'individuel') {
      Object.assign(payload, {
        prestation: state.service, prix: state.price, lieu: state.lieu,
        date_seance: state.dateISO, heure_seance: state.time,
        statut: 'en_attente', nombre_participants: 1,
      });
    } else if (state.format === 'groupe-prive') {
      Object.assign(payload, {
        prestation: 'Atelier privé à domicile', prix: 0, lieu: state.lieu,
        date_seance: state.dateISO, heure_seance: state.time,
        statut: 'en_attente', nombre_participants: state.participants,
      });
    }

    const { error } = await supabaseClient.from('reservations').insert(payload);

    if (error) {
      confirmBtn.disabled = false;
      confirmBtn.textContent = confirmLabel();
      if (error.code === '23505') {
        alert("Ce créneau vient d'être réservé par quelqu'un d'autre. Merci d'en choisir un autre.");
        goToPanel('planning');
        loadAvailability();
      } else {
        console.error(error);
        recapError.textContent = "Une erreur est survenue lors de l'envoi de votre demande. Merci de réessayer ou de contacter directement Marie-Laurence.";
        recapError.hidden = false;
      }
      return;
    }

    successText.textContent = 'Merci ! Votre créneau est réservé le temps que Marie-Laurence valide '
      + 'votre demande. Vous recevrez un email sous 24h — s\'il est confirmé, il contiendra un lien '
      + 'de paiement sécurisé à régler pour finaliser votre réservation.';
    recapView.hidden = true;
    successView.hidden = false;
  });

  restartBtn.addEventListener('click', () => {
    form.reset();
    Object.assign(state, { format: null, service: null, price: null, lieu: null, participants: 6, atelier: null, date: null, dateISO: null, time: null });
    formatOptions.forEach(c => c.classList.remove('is-selected'));
    detailsContent.innerHTML = '';
    recapView.hidden = false;
    successView.hidden = true;
    goToPanel('format');
    viewYear = today.getFullYear();
    viewMonth = today.getMonth();
  });

  /* ---- Pré-sélection via l'URL (liens depuis offres.html) ---- */
  const params = new URLSearchParams(window.location.search);
  const presetFormat = params.get('format');
  const presetService = params.get('service');
  if (presetFormat && ['individuel', 'groupe-prive', 'groupe-ouvert'].includes(presetFormat)) {
    if (presetService) state.service = presetService;
    selectFormat(presetFormat);
  }

});
