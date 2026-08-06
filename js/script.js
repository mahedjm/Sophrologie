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
    }, { threshold: 0.15 });
    revealEls.forEach(el => io.observe(el));
  } else {
    revealEls.forEach(el => el.classList.add('is-visible'));
  }

  /* =========================================================
     TARIFS — bascule Cabinet / Domicile
     Ajoute simplement 10€ aux montants affichés (hors visio).
     ========================================================= */
  const toggleBtns = document.querySelectorAll('.toggle-btn');
  const amounts = document.querySelectorAll('.price .amount');

  toggleBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      toggleBtns.forEach(b => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      const isDomicile = btn.dataset.lieu === 'domicile';

      amounts.forEach(el => {
        const base = parseInt(el.dataset.base, 10);
        const noDomicile = el.dataset.noDomicile === 'true';
        const value = (isDomicile && !noDomicile) ? base + 10 : base;
        el.textContent = value;
      });
    });
  });

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
  const NUM_DAYS = 21;

  const state = { service: null, price: null, lieu: 'Cabinet', date: null, time: null };

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

  function selectPrestation(serviceName) {
    const card = Array.from(prestationOptions).find(c => c.dataset.service === serviceName);
    if (!card) return;
    prestationOptions.forEach(c => c.classList.remove('is-selected'));
    card.classList.add('is-selected');
    state.service = card.dataset.service;
    state.price = parseInt(card.dataset.price, 10);
    toStep2.disabled = false;
  }

  prestationOptions.forEach(card => {
    card.addEventListener('click', () => selectPrestation(card.dataset.service));
  });

  // Boutons "Choisir" de la section Tarifs : pré-sélectionnent la même
  // prestation ici, en plus du lien d'ancre qui amène jusqu'à cette section.
  document.querySelectorAll('[data-select-service]').forEach(link => {
    link.addEventListener('click', () => selectPrestation(link.dataset.selectService));
  });

  widget.querySelectorAll('input[name="lieu"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      state.lieu = e.target.value;
      syncLieuUI();
    });
  });

  function syncLieuUI() {
    widget.querySelectorAll('.lieu-option').forEach(opt => {
      const input = opt.querySelector('input[name="lieu"]');
      opt.classList.toggle('is-checked', input.checked);
    });
  }
  syncLieuUI();

  toStep2.addEventListener('click', () => goToStep(2));

  /* ---- STEP 2 : Calendrier + créneaux (Supabase) ---- */
  const calendarEl = document.getElementById('calendar');
  const slotsEl = document.getElementById('slots');
  const toStep3 = document.getElementById('to-step-3');

  const DAY_LABELS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

  function toISODate(date) {
    return date.toISOString().slice(0, 10); // 'YYYY-MM-DD'
  }

  function buildCandidateDays(numDays) {
    const closed = new Set((window.CLOSED_DATES || []));
    const days = [];
    let d = new Date();
    while (days.length < numDays) {
      d.setDate(d.getDate() + 1);
      const day = new Date(d);
      const iso = toISODate(day);
      if (day.getDay() === 0) continue;   // dimanche fermé
      if (closed.has(iso)) continue;      // jour bloqué manuellement
      days.push({ date: day, iso });
    }
    return days;
  }

  // takenByDate: Map<'YYYY-MM-DD', Set<'HH:MM'>> construite depuis Supabase
  let takenByDate = new Map();
  let candidateDays = [];

  async function loadAvailability() {
    candidateDays = buildCandidateDays(NUM_DAYS);
    const from = candidateDays[0].iso;
    const to = candidateDays[candidateDays.length - 1].iso;

    calendarEl.innerHTML = '<p class="booking-hint">Chargement des disponibilités…</p>';

    const { data, error } = await supabaseClient
      .from('creneaux_pris')
      .select('date_seance, heure_seance')
      .gte('date_seance', from)
      .lte('date_seance', to);

    if (error) {
      calendarEl.innerHTML = '<p class="booking-hint">Impossible de charger les disponibilités pour le moment. Contactez directement Camille par téléphone ou email.</p>';
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
    candidateDays.forEach(day => {
      const taken = takenByDate.get(day.iso) || new Set();
      const isFull = BASE_SLOTS.every(s => taken.has(s));

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cal-day' + (isFull ? ' is-full' : '');
      btn.disabled = isFull;
      const label = DAY_LABELS[(day.date.getDay() + 6) % 7];
      btn.innerHTML = `<span>${label}</span>${day.date.getDate()}`;
      btn.addEventListener('click', () => selectDay(day, btn));
      calendarEl.appendChild(btn);
    });
  }

  function selectDay(day, btn) {
    calendarEl.querySelectorAll('.cal-day').forEach(b => b.classList.remove('is-selected'));
    btn.classList.add('is-selected');
    state.date = day.date;
    state.dateISO = day.iso;
    state.time = null;
    toStep3.disabled = true;
    renderSlots(day.iso);
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

  function renderRecap() {
    recapList.innerHTML = `
      <dt>Prestation</dt><dd>${state.service}</dd>
      <dt>Lieu</dt><dd>${state.lieu}</dd>
      <dt>Date</dt><dd>${formatDate(state.date)}</dd>
      <dt>Heure</dt><dd>${state.time}</dd>
      <dt>Tarif indicatif</dt><dd>${state.lieu === 'Domicile' ? state.price + 10 : state.price} €</dd>
      <dt>Contact</dt><dd>${state.prenom} ${state.nom} — ${state.email}</dd>
    `;
  }

  confirmBtn.addEventListener('click', async () => {
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Envoi…';

    const finalPrice = state.lieu === 'Domicile' ? state.price + 10 : state.price;

    const { error } = await supabaseClient.from('reservations').insert({
      prestation: state.service,
      prix: finalPrice,
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
        alert("Une erreur est survenue lors de l'envoi de votre demande. Merci de réessayer ou de contacter directement Camille.");
      }
      return;
    }

    recapView.hidden = true;
    successView.hidden = false;
  });

  restartBtn.addEventListener('click', () => {
    form.reset();
    state.service = state.price = state.date = state.dateISO = state.time = null;
    state.lieu = 'Cabinet';
    prestationOptions.forEach(c => c.classList.remove('is-selected'));
    widget.querySelector('input[name="lieu"][value="Cabinet"]').checked = true;
    syncLieuUI();
    toStep2.disabled = true;
    toStep3.disabled = true;
    recapView.hidden = false;
    successView.hidden = true;
    goToStep(1);
    loadAvailability();
  });

});
