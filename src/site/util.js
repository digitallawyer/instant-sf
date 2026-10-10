// Small helpers shared by the website's page scripts.

export const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Loads the game's map once per page (it is large; the browser caches it for the game too). */
let mapPromise = null;
export function loadMap() {
  mapPromise ??= fetch('/data/sf/map.json').then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });
  return mapPromise;
}

/** Neighbourhood lookup from the map's "hood" points (plazas and squares in that list are skipped). */
export function hoodFinder(map, maxDist = 1400) {
  const hoods = (map.pois || []).filter(p => p.k === 'hood' && !/plaza|square|piazza|court|park|street/i.test(p.n));
  return (x, z) => {
    let best = null, bd = maxDist * maxDist;
    for (const h of hoods) { const d = (h.x - x) ** 2 + (h.z - z) ** 2; if (d < bd) { bd = d; best = h.n; } }
    return best;
  };
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
