// Shared chrome for the companion website: header + nav + language switcher, footer, scroll reveals, hero slideshow.
// Each page has <body data-page="..."> with empty <header id="site-header"> and <footer id="site-footer"> placeholders.
import { LANGS, getLang, storeLang, applyLang, t } from './i18n.js';

const page = document.body.dataset.page || '';
const NAV = [
  { id: 'home', href: '/', key: 'nav.home' },
  { id: 'game', href: '/game/', key: 'nav.game' },
  { id: 'sights', href: '/sights/', key: 'nav.sights' },
  { id: 'eat', href: '/eat/', key: 'nav.eat' },
  { id: 'streets', href: '/streets/', key: 'nav.streets' },
];
const cur = id => (id === page ? ' aria-current="page"' : '');
const navLinks = () => NAV.map(n => `<a href="${n.href}"${cur(n.id)} data-i18n="${n.key}">${t(n.key)}</a>`).join('');
const langOptions = () => LANGS.map(l => `<option value="${l.id}" lang="${l.id}">${l.label} · ${l.name}</option>`).join('');

function renderHeader() {
  const el = document.getElementById('site-header');
  if (!el) return;
  el.classList.add('site-header');
  document.body.insertAdjacentHTML('afterbegin', `<a class="skip" href="#main" data-i18n="nav.skip">${t('nav.skip')}</a>`);
  el.innerHTML = `
    <div class="wrap">
      <a class="brand" href="/" aria-label="Instant San Francisco, home">Instant <em>San Francisco</em></a>
      <nav class="nav" data-i18n-label="nav.main" aria-label="Main">${navLinks()}</nav>
      <div class="header-tools">
        <div class="lang-wrap">
          <label class="sr-only" for="lang-select" data-i18n="nav.language">Language</label>
          <select id="lang-select" class="lang">${langOptions()}</select>
        </div>
        <a class="btn btn-primary btn-sm" href="/play/" data-i18n="nav.play">Play</a>
        <button class="menu-toggle" type="button" aria-expanded="false" aria-controls="mobile-menu" data-i18n-label="nav.menu" aria-label="Menu"><span></span></button>
      </div>
    </div>`;
  el.insertAdjacentHTML('afterend', `
    <div class="mobile-menu" id="mobile-menu">
      <nav aria-label="Main">${navLinks()}</nav>
      <div class="lang-row">
        <label for="lang-select-m" data-i18n="nav.language">Language</label>
        <select id="lang-select-m" class="lang">${langOptions()}</select>
      </div>
    </div>`);

  const toggle = el.querySelector('.menu-toggle');
  const setOpen = open => {
    document.body.classList.toggle('menu-open', open);
    toggle.setAttribute('aria-expanded', String(open));
  };
  toggle.addEventListener('click', () => setOpen(!document.body.classList.contains('menu-open')));
  addEventListener('keydown', e => {
    if (e.key === 'Escape' && document.body.classList.contains('menu-open')) { setOpen(false); toggle.focus(); }
  });
  document.querySelectorAll('#mobile-menu a').forEach(a => a.addEventListener('click', () => setOpen(false)));
  matchMedia('(min-width: 961px)').addEventListener('change', e => { if (e.matches) setOpen(false); });

  // header turns solid once you scroll past the top of a full-bleed hero
  const onScroll = () => el.classList.toggle('solid', scrollY > 40);
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

function renderFooter() {
  const el = document.getElementById('site-footer');
  if (!el) return;
  el.classList.add('site-footer');
  const year = new Date().getFullYear();
  el.innerHTML = `
    <div class="wrap">
      <div class="foot-top">
        <div>
          <div class="foot-brand">Instant <em>San Francisco</em></div>
          <p class="muted" data-i18n="footer.tagline">${t('footer.tagline')}</p>
          <div class="btn-row" style="margin-top:22px">
            <a class="btn btn-primary btn-sm" href="/play/" data-i18n="btn.play">${t('btn.play')}</a>
          </div>
        </div>
        <div class="foot-col">
          <h2 data-i18n="nav.explore">${t('nav.explore')}</h2>
          <ul>${NAV.slice(1).map(n => `<li><a href="${n.href}" data-i18n="${n.key}">${t(n.key)}</a></li>`).join('')}</ul>
        </div>
        <div class="foot-col">
          <h2>Info</h2>
          <ul>
            <li><a href="/privacy/" data-i18n="footer.privacy">${t('footer.privacy')}</a></li>
            <li><a href="/terms/" data-i18n="footer.terms">${t('footer.terms')}</a></li>
            <li><a href="https://www.openstreetmap.org/fixthemap" rel="noopener">Fix the map on OSM</a></li>
          </ul>
        </div>
      </div>
      <div class="foot-bottom">
        <p><span data-i18n="footer.data">${t('footer.data')}</span>
          <a href="https://www.openstreetmap.org/copyright" rel="noopener">openstreetmap.org/copyright</a>.
          <span data-i18n="footer.notaffiliated">${t('footer.notaffiliated')}</span></p>
        <p>
          <a class="made" href="https://claude.ai" rel="noopener">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1.5l2.2 7.1 7.3-.9-6 4.3 3.1 6.7L12 14.2 5.4 18.7l3.1-6.7-6-4.3 7.3.9z"/></svg>
            <span data-i18n="footer.made">${t('footer.made')}</span>
          </a> · © ${year}
        </p>
      </div>
    </div>`;
}

function wireLang() {
  const selects = document.querySelectorAll('.lang');
  const set = l => {
    storeLang(l);
    applyLang(l);
    selects.forEach(s => { s.value = l; });
  };
  selects.forEach(s => s.addEventListener('change', () => set(s.value)));
  set(getLang());
}

function reveals() {
  const els = document.querySelectorAll('.reveal');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce || !('IntersectionObserver' in window)) { els.forEach(e => e.classList.add('in')); return; }
  const io = new IntersectionObserver(entries => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
  els.forEach(e => io.observe(e));
}
export const observeReveals = reveals;

// Crossfading slideshow of in-game screenshots. Pauses on request, when hidden, and never runs with reduced motion.
function slideshow() {
  const root = document.querySelector('.hero-slides');
  if (!root) return;
  const slides = [...root.querySelectorAll('figure')];
  const cap = document.querySelector('.hero-caption .cap');
  const dots = document.querySelector('.slide-dots');
  const pause = document.querySelector('.slide-pause');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let i = 0, timer = null, playing = !reduce;

  if (dots) {
    dots.innerHTML = slides.map((s, k) => `<button type="button" aria-label="${s.dataset.caption}"${k === 0 ? ' aria-current="true"' : ''}></button>`).join('');
    dots.querySelectorAll('button').forEach((b, k) => b.addEventListener('click', () => { show(k); restart(); }));
  }
  function show(k) {
    slides[i].classList.remove('on');
    i = (k + slides.length) % slides.length;
    const s = slides[i];
    const img = s.querySelector('img');
    if (img.loading === 'lazy') img.loading = 'eager';
    s.classList.add('on');
    if (cap) cap.innerHTML = `<b>${s.dataset.caption}</b> · <span data-i18n="hero.caption">${t('hero.caption')}</span>`;
    dots?.querySelectorAll('button').forEach((b, n) => (n === i ? b.setAttribute('aria-current', 'true') : b.removeAttribute('aria-current')));
  }
  function restart() {
    clearInterval(timer);
    if (playing) timer = setInterval(() => show(i + 1), 6500);
  }
  function syncPause() {
    if (!pause) return;
    pause.setAttribute('aria-label', t(playing ? 'btn.pause' : 'btn.resume'));
    pause.setAttribute('aria-pressed', String(!playing));
    pause.innerHTML = playing
      ? '<svg viewBox="0 0 12 12" aria-hidden="true"><rect x="2" y="1" width="3" height="10"/><rect x="7" y="1" width="3" height="10"/></svg>'
      : '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 1l9 5-9 5z"/></svg>';
  }
  pause?.addEventListener('click', () => { playing = !playing; root.classList.toggle('paused', !playing); syncPause(); restart(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) clearInterval(timer); else restart(); });
  document.addEventListener('langchange', () => { show(i); syncPause(); });
  show(0); syncPause(); restart();
}

// keep sight counts in sync with the game's list without loading it on pages that don't show one
if (document.querySelector('[data-sight-count]')) {
  import('../city/sf.js').then(({ SIGHTS }) => document.querySelectorAll('[data-sight-count]').forEach(el => { el.textContent = SIGHTS.length; })).catch(() => {});
}

renderHeader();
renderFooter();
wireLang();
reveals();
slideshow();
