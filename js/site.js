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

});
