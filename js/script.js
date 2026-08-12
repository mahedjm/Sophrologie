/* =========================================================
   AU FIL DE SOI — script.js
   ========================================================= */
document.addEventListener('DOMContentLoaded', () => {

  /* ---------- Header scroll state ---------- */
  const header = document.getElementById('site-header');
  const onScroll = () => header.classList.toggle('is-scrolled', window.scrollY > 12);
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  /* ---------- Mobile nav ---------- */
  const navToggle = document.getElementById('nav-toggle');
  const mainNav = document.getElementById('main-nav');
  navToggle.addEventListener('click', () => {
    const open = mainNav.classList.toggle('is-open');
    navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  mainNav.querySelectorAll('a').forEach(a => a.addEventListener('click', () => {
    mainNav.classList.remove('is-open');
    navToggle.setAttribute('aria-expanded', 'false');
  }));

  /* ---------- Scroll reveal ---------- */
  const revealEls = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.01, rootMargin: '0px 0px 200px 0px' });
    revealEls.forEach(el => io.observe(el));
  } else {
    revealEls.forEach(el => el.classList.add('is-visible'));
  }

  /* =========================================================
     MODULE DE RÉSERVATION — connecté à Supabase
     -----------------------------------------------------------
     Tunnel complet (prestation -> créneau -> coordonnées ->
     confirmation). Les créneaux libres sont calculés à partir des
     réservations réelles en base (vue `creneaux_pris`), et chaque
     nouvelle demande est insérée avec le statut "en_attente" :
     la sophrologue la valide ou la refuse depuis admin.html, ce
     qui déclenche automatiquement l'email au client (voir les
     Edge Functions dans /supabase/functions).

     Personnalisation :
     - BASE_SLOTS ci-dessous définit les horaires proposés chaque
       jour ouvré — à adapter aux vrais horaires de la cliente.
     - CLOSED_DATES (dans js/config.js) permet de bloquer
       manuellement des jours (vacances, absences) sans base de
       données supplémentaire.
     ========================================================= */

  const widget = document.getElementById('booking-widget');
  if (!widget) return;

  const BASE_SLOTS = ['09:00', '10:00', '11:00', '14:00', '15:30', '17:00'];

  // Tant que js/config.js contient encore les valeurs par défaut, on ne peut
  // pas interroger Supabase : on bascule sur des créneaux de démonstration
  // pour ne pas bloquer les tests, avec un message clair sur la page.
  const SUPABASE_READY = typeof SUPABASE_URL !== 'undefined'
    && !SUPABASE_URL.includes('VOTRE-PROJET');

  const statusNote = document.getElementById('booking-status-note');
  if (statusNote && !SUPABASE_READY) {
    statusNote.textContent = 'Mode démonstration — créneaux fictifs. Renseignez js/config.js pour activer les vraies réservations.';
  }

  const state = { service: null, price: null, lieu: null, date: null, time: null };

  const panels = widget.querySelectorAll('.booking-panel');
  const steps = widget.querySelectorAll('.bstep');

  function goToStep(n) {
    panels.forEach(p => p.classList.toggle('is-active', p.dataset.panel === String(n)));
    steps.forEach(s => {
      const stepNum = parseInt(s.dataset.step, 10);
      s.classList.toggle('is-active', stepNum === n);
      s.classList.toggle('is-done', stepNum < n);
    });
    widget.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  widget.querySelectorAll('[data-back]').forEach(btn => {
    btn.addEventListener('click', () => goToStep(parseInt(btn.dataset.back, 10)));
  });

  /* ---- STEP 1 : Prestation + lieu ---- */
  const prestationOptions = document.querySelectorAll('#prestation-options .option-card');
  const toStep2 = document.getElementById('to-step-2');
  const lieuNote = document.getElementById('lieu-note');
  const GROUPE_LIEU = "Chez l'organisateur (groupe)";
  const VISIO_LIEU = 'Visio';

  function selectPrestation(serviceName) {
    const card = Array.from(prestationOptions).find(c => c.dataset.service === serviceName);
    if (!card) return;
    prestationOptions.forEach(c => c.classList.remove('is-selected'));
    card.classList.add('is-selected');
    state.service = card.dataset.service;
    state.price = parseInt(card.dataset.price, 10);
    toStep2.disabled = false;

    const isGroupe = state.service === 'Séance de groupe';
    state.lieu = isGroupe ? GROUPE_LIEU : VISIO_LIEU;
    lieuNote.classList.add('is-visible');
    lieuNote.textContent = isGroupe
      ? "Séance organisée chez vous ou chez l'un des participants (minimum 3 personnes, zone Marmande et environs)."
      : 'Séance en visio — le lien de connexion vous sera envoyé par email.';
  }

  prestationOptions.forEach(card => {
    card.addEventListener('click', () => selectPrestation(card.dataset.service));
  });

  // Boutons "Choisir" de la section Tarifs : pré-sélectionnent la même
  // prestation ici, en plus du lien d'ancre qui amène jusqu'à cette section.
  document.querySelectorAll('[data-select-service]').forEach(link => {
    link.addEventListener('click', () => selectPrestation(link.dataset.selectService));
  });

  toStep2.addEventListener('click', () => goToStep(2));

  /* ---- STEP 2 : Calendrier + créneaux (Supabase) ---- */
  const calendarEl = document.getElementById('calendar');
  const weekdaysEl = document.getElementById('calendar-weekdays');
  const monthLabelEl = document.getElementById('cal-month-label');
  const prevMonthBtn = document.getElementById('cal-prev');
  const nextMonthBtn = document.getElementById('cal-next');
  const slotsEl = document.getElementById('slots');
  const toStep3 = document.getElementById('to-step-3');

  const WEEKDAY_LABELS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
  const MONTH_LABELS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  const MAX_MONTHS_AHEAD = 3; // limite raisonnable de navigation dans le futur

  function toISODate(date) {
    return date.toISOString().slice(0, 10); // 'YYYY-MM-DD'
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const minSelectable = new Date(today);
  minSelectable.setDate(minSelectable.getDate() + 1); // pas de réservation le jour même

  let viewYear = today.getFullYear();
  let viewMonth = today.getMonth(); // 0-11

  if (weekdaysEl) weekdaysEl.innerHTML = WEEKDAY_LABELS.map(l => `<span>${l}</span>`).join('');

  function monthsFromToday(y, m) {
    return (y - today.getFullYear()) * 12 + (m - today.getMonth());
  }

  function updateNavState() {
    if (prevMonthBtn) prevMonthBtn.disabled = monthsFromToday(viewYear, viewMonth) <= 0;
    if (nextMonthBtn) nextMonthBtn.disabled = monthsFromToday(viewYear, viewMonth) >= MAX_MONTHS_AHEAD;
    if (monthLabelEl) monthLabelEl.textContent = `${MONTH_LABELS[viewMonth]} ${viewYear}`;
  }

  // takenByDate: Map<'YYYY-MM-DD', Set<'HH:MM'>> construite depuis Supabase, pour le mois affiché
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
    const leadingBlanks = (firstOfMonth.getDay() + 6) % 7; // grille alignée lundi -> dimanche

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
    toStep3.disabled = true;
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
    toStep3.disabled = true;
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
        toStep3.disabled = false;
      });
      slotsEl.appendChild(btn);
    });
  }

  loadAvailability();
  toStep3.addEventListener('click', () => goToStep(3));

  /* ---- STEP 3 : Coordonnées ---- */
  const form = document.getElementById('booking-form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!form.checkValidity()) { form.reportValidity(); return; }

    state.prenom = form.prenom.value.trim();
    state.nom = form.nom.value.trim();
    state.email = form.email.value.trim();
    state.tel = form.tel.value.trim();
    state.message = form.message.value.trim();

    renderRecap();
    goToStep(4);
  });

  /* ---- STEP 4 : Récapitulatif + confirmation ---- */
  const recapList = document.getElementById('recap-list');
  const recapView = document.getElementById('recap-view');
  const successView = document.getElementById('success-view');
  const confirmBtn = document.getElementById('confirm-booking');
  const restartBtn = document.getElementById('restart-booking');

  function formatDate(date) {
    return date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  }

  function formatPrice() {
    return state.service === 'Séance de groupe' ? 'Sur devis' : `${state.price} €`;
  }

  function renderRecap() {
    recapList.innerHTML = `
      <dt>Prestation</dt><dd>${state.service}</dd>
      <dt>Lieu</dt><dd>${state.lieu}</dd>
      <dt>Date</dt><dd>${formatDate(state.date)}</dd>
      <dt>Heure</dt><dd>${state.time}</dd>
      <dt>Tarif indicatif</dt><dd>${formatPrice()}</dd>
      <dt>Contact</dt><dd>${state.prenom} ${state.nom} — ${state.email}</dd>
    `;
  }

  confirmBtn.addEventListener('click', async () => {
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Envoi…';

    const { error } = await supabaseClient.from('reservations').insert({
      prestation: state.service,
      prix: state.price,
      lieu: state.lieu,
      date_seance: state.dateISO,
      heure_seance: state.time,
      prenom: state.prenom,
      nom: state.nom,
      email: state.email,
      telephone: state.tel,
      message: state.message || null,
    });

    confirmBtn.disabled = false;
    confirmBtn.textContent = 'Confirmer la demande';

    if (error) {
      if (error.code === '23505') {
        // Quelqu'un d'autre vient de prendre ce créneau entre-temps.
        alert("Ce créneau vient d'être réservé par quelqu'un d'autre. Merci d'en choisir un autre.");
        goToStep(2);
        loadAvailability();
      } else {
        console.error(error);
        alert("Une erreur est survenue lors de l'envoi de votre demande. Merci de réessayer ou de contacter directement Marie-Laurence.");
      }
      return;
    }

    recapView.hidden = true;
    successView.hidden = false;
  });

  restartBtn.addEventListener('click', () => {
    form.reset();
    state.service = state.price = state.date = state.dateISO = state.time = null;
    state.lieu = null;
    prestationOptions.forEach(c => c.classList.remove('is-selected'));
    lieuNote.classList.remove('is-visible');
    lieuNote.textContent = '';
    toStep2.disabled = true;
    toStep3.disabled = true;
    recapView.hidden = false;
    successView.hidden = true;
    goToStep(1);
    viewYear = today.getFullYear();
    viewMonth = today.getMonth();
    loadAvailability();
  });

});
