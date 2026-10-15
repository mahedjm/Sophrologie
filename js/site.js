/* =========================================================
   SOBIOSE — site.js
   Comportements communs à toutes les pages (header, nav mobile,
   animations au scroll). Ne dépend pas de Supabase — chargé partout.
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

  /* ---------- Bio : repliée par défaut sur mobile ---------- */
  if (window.matchMedia('(max-width: 620px)').matches) {
    document.querySelectorAll('.about-more[open]').forEach(d => d.removeAttribute('open'));
  }

  /* ---------- Avis : défilement carte par carte ---------- */
  document.querySelectorAll('.testi-carousel').forEach(carousel => {
    const track = carousel.querySelector('.testi-track');
    const dotsEl = carousel.querySelector('.testi-dots');
    const cards = Array.from(track.children);
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const stepWidth = () => cards[0].offsetWidth + parseFloat(getComputedStyle(track).columnGap || 0);
    const pageCount = () => Math.max(1, Math.round((track.scrollWidth - track.clientWidth) / stepWidth()) + 1);
    const current = () => Math.round(track.scrollLeft / stepWidth());

    function buildDots() {
      const n = pageCount();
      dotsEl.innerHTML = '';
      dotsEl.hidden = n < 2;
      for (let i = 0; i < n; i++) {
        const b = document.createElement('button');
        b.type = 'button';
        b.tabIndex = -1;
        b.addEventListener('click', () => { goTo(i); pause(); });
        dotsEl.appendChild(b);
      }
      updateDots();
    }
    function updateDots() {
      const i = current();
      dotsEl.querySelectorAll('button').forEach((b, k) => b.classList.toggle('is-active', k === i));
    }
    function goTo(i) { track.scrollTo({ left: i * stepWidth() }); }

    // Défilement automatique, mis en pause dès que la personne interagit
    let timer = null, paused = false;
    function start() {
      if (reduceMotion || paused || pageCount() < 2) return;
      clearInterval(timer);
      timer = setInterval(() => goTo((current() + 1) % pageCount()), 6000);
    }
    function pause() { paused = true; clearInterval(timer); }
    ['pointerdown', 'wheel', 'keydown', 'focusin'].forEach(ev => track.addEventListener(ev, pause, { passive: true }));

    track.addEventListener('scroll', () => window.requestAnimationFrame(updateDots), { passive: true });
    window.addEventListener('resize', () => { buildDots(); start(); });
    buildDots();
    start();
  });

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

  /* ---------- Mesure d'audience : Google Tag Manager, après consentement ---------- */
  // Identifiant du conteneur (GTM-XXXXXXX). Vide = rien n'est chargé, aucun bandeau.
  const GTM_ID = '';
  const CONSENT_KEY = 'sobiose-consent';
  const CONSENT_TTL = 182 * 24 * 3600 * 1000; // choix conservé 6 mois (recommandation CNIL)

  function readConsent() {
    try {
      const c = JSON.parse(localStorage.getItem(CONSENT_KEY));
      return c && Date.now() - c.t < CONSENT_TTL ? c.v : null;
    } catch (e) { return null; }
  }

  function loadGTM() {
    window.dataLayer = window.dataLayer || [];
    function gtag() { window.dataLayer.push(arguments); }
    // Seule la mesure d'audience a été acceptée : aucune finalité publicitaire
    gtag('consent', 'default', { analytics_storage: 'granted', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
    window.dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' });
    const s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtm.js?id=' + GTM_ID;
    document.head.appendChild(s);
  }

  function askConsent() {
    if (document.querySelector('.consent')) return;
    const box = document.createElement('div');
    box.className = 'consent';
    box.setAttribute('role', 'region');
    box.setAttribute('aria-label', 'Cookies de mesure d\'audience');
    box.innerHTML = '<p>Puis-je mesurer la fréquentation du site avec Google Analytics ? Ces cookies ne sont déposés qu\'avec votre accord ; vous pourrez changer d\'avis via « Cookies » en bas de page.</p>'
      + '<div class="consent-actions"><button type="button" class="btn btn-outline btn-small" data-choice="denied">Refuser</button>'
      + '<button type="button" class="btn btn-outline btn-small" data-choice="granted">Accepter</button></div>';
    box.addEventListener('click', e => {
      const choice = e.target.dataset.choice;
      if (!choice) return;
      const previous = readConsent();
      try { localStorage.setItem(CONSENT_KEY, JSON.stringify({ v: choice, t: Date.now() })); } catch (err) { /* navigation privée : on redemandera */ }
      box.remove();
      if (choice === 'granted' && previous !== 'granted') loadGTM();
      if (choice === 'denied' && previous === 'granted') {
        // Retrait du consentement : on efface les cookies Analytics et on recharge sans GTM
        const domain = location.hostname.replace(/^www\./, '');
        document.cookie.split(';').map(c => c.split('=')[0].trim()).filter(n => n.startsWith('_ga')).forEach(n => {
          document.cookie = n + '=; Max-Age=0; path=/';
          document.cookie = n + '=; Max-Age=0; path=/; domain=.' + domain;
        });
        location.reload();
      }
    });
    document.body.prepend(box);
  }

  if (GTM_ID) {
    const choice = readConsent();
    if (choice === 'granted') loadGTM();
    if (choice === null) askConsent();
    // Lien permanent pour revenir sur son choix (exigence CNIL)
    const info = document.querySelector('.site-footer .footer-inner > div:last-child');
    if (info) {
      const p = document.createElement('p');
      p.innerHTML = '<button type="button" class="link-btn">Cookies</button>';
      p.firstChild.addEventListener('click', askConsent);
      info.appendChild(p);
    }
  }

});
