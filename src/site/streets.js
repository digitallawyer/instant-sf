// Streets & squares A–Z, from data/sf/index.json (built from the game's map.json by tools/build-index.mjs).
import { t } from './i18n.js';
import { esc, loadIndex, fold, debounce } from './util.js';

const $ = s => document.querySelector(s);
const elAz = $('#az'), elLetters = $('#letters'), elCount = $('#count'), elQ = $('#q');
const LETTERS = '#ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const fmt = n => n.toLocaleString('en-US');
const km = m => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 10) * 10} m`);
const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
const letterOf = name => { const c = fold(name).charAt(0).toUpperCase(); return c >= 'A' && c <= 'Z' ? c : '#'; };

const state = { q: '', kind: '' };
let entries = [];

function build(idx) {
  const hood = h => idx.hoods[h] || '';
  const out = [
    ...idx.streets.map(([n, len, h]) => ({ n, kind: 'street', len, hood: hood(h) })),
    ...idx.squares.map(([n, type, h]) => ({ n, kind: 'square', type, hood: hood(h) })),
  ];
  for (const e of out) { e.key = fold(e.n); e.letter = letterOf(e.n); e.hay = fold(`${e.n} ${e.hood}`); }
  return out.sort((a, b) => collator.compare(a.n, b.n));
}

function render() {
  const terms = fold(state.q).split(/\s+/).filter(Boolean);
  const rows = entries.filter(e => (!state.kind || e.kind === state.kind) && terms.every(w => e.hay.includes(w)));
  const groups = new Map(LETTERS.map(l => [l, []]));
  for (const e of rows) groups.get(e.letter).push(e);

  elCount.textContent = t('streets.count', { n: fmt(rows.length) });
  elLetters.innerHTML = LETTERS.map(l => (groups.get(l).length
    ? `<a href="#letter-${l === '#' ? 'num' : l}" aria-label="${l === '#' ? '0–9' : l}">${l}</a>`
    : `<span aria-hidden="true">${l}</span>`)).join('');

  if (!rows.length) { elAz.innerHTML = `<div class="status">${esc(t('ui.none'))}</div>`; return; }
  elAz.innerHTML = LETTERS.filter(l => groups.get(l).length).map(l => `
    <section class="az-group" id="letter-${l === '#' ? 'num' : l}" aria-labelledby="h-${l === '#' ? 'num' : l}">
      <h2 id="h-${l === '#' ? 'num' : l}">${l === '#' ? '0–9' : l}</h2>
      <ul class="az-list">${groups.get(l).map(e => {
        const href = e.kind === 'street' ? `/play/?street=${encodeURIComponent(e.n)}` : `/play/?place=${encodeURIComponent(e.n)}`;
        const meta = e.kind === 'street' ? [e.hood, e.len > 0 ? km(e.len) : ''].filter(Boolean).join(' · ') : e.hood;
        const badge = e.kind === 'square' ? `<span class="badge">${esc(t(e.type === 'park' ? 'streets.park' : 'streets.square'))}</span>` : '';
        return `<li><a href="${href}"><span><span class="nm">${esc(e.n)}</span>${badge}</span><span class="meta">${esc(meta)}</span></a></li>`;
      }).join('')}</ul>
    </section>`).join('');
}

function setKind(k) {
  state.kind = k;
  document.querySelectorAll('#kinds .chip').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.kind === k)));
  render();
}

async function init() {
  let idx;
  try { idx = await loadIndex(); } catch {
    elAz.innerHTML = `<div class="status">${esc(t('ui.error'))}</div>`;
    return;
  }
  entries = build(idx);
  const counts = { '': entries.length, street: 0, square: 0 };
  for (const e of entries) counts[e.kind]++;
  document.querySelectorAll('#kinds [data-count]').forEach(s => { s.textContent = fmt(counts[s.dataset.count]); });
  render();
  if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
}

// keep anchored letter headings clear of the sticky toolbar
const toolbar = document.querySelector('.toolbar');
const syncToolbar = () => document.documentElement.style.setProperty('--toolbar-h', `${getComputedStyle(toolbar).position === 'sticky' ? toolbar.offsetHeight : 0}px`);
addEventListener('resize', debounce(syncToolbar, 100));
syncToolbar();

document.querySelectorAll('#kinds .chip').forEach(b => b.addEventListener('click', () => setKind(b.dataset.kind)));
elQ.addEventListener('input', debounce(() => { state.q = elQ.value.trim(); render(); }));
document.addEventListener('langchange', () => { if (entries.length) render(); });

init();
