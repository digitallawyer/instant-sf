// Small helpers shared by the website's page scripts.

export const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Loads the compact lookup built by tools/build-index.mjs (streets, squares, places; ~50 KB gzipped). */
let indexPromise = null;
export function loadIndex() {
  indexPromise ??= fetch('/data/sf/index.json').then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });
  return indexPromise;
}

/** Accent-insensitive lowercase for searching and sorting. */
export const fold = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function revealAll(root) {
  const els = root.querySelectorAll('.reveal:not(.in)');
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) { els.forEach(e => e.classList.add('in')); return; }
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -6% 0px' });
  els.forEach(e => io.observe(e));
}

export function debounce(fn, ms = 120) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
