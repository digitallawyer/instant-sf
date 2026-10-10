// Eat & drink: every food / cafe / bar point in the game's map (via data/sf/index.json), searchable and filterable.
import { t } from './i18n.js';
import { esc, loadIndex, fold, debounce } from './util.js';

const KINDS = ['food', 'cafe', 'bar'];
const PAGE = 120;
const $ = s => document.querySelector(s);
const elList = $('#places'), elCount = $('#count'), elMore = $('#more'), elQ = $('#q'), elHood = $('#hood');
const fmt = n => n.toLocaleString('en-US');

// "coffee_shop;bubble_tea" -> "Coffee shop, Bubble tea"
const cuisine = cu => (cu ? cu.split(';').map(c => c.trim().replace(/_/g, ' ')).filter(Boolean).map(c => c[0].toUpperCase() + c.slice(1)).join(', ') : '');
const kindLabel = k => t(`eat.k.${k}`);

const params = new URLSearchParams(location.search);
const state = { q: params.get('q') || '', kind: KINDS.includes(params.get('kind')) ? params.get('kind') : '', hood: params.get('hood') || '', limit: PAGE };
let places = [];

function syncUrl() {
  const p = new URLSearchParams();
  if (state.q) p.set('q', state.q);
  if (state.kind) p.set('kind', state.kind);
  if (state.hood) p.set('hood', state.hood);
  const qs = p.toString();
  history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
}

function filtered() {
  const terms = fold(state.q).split(/\s+/).filter(Boolean);
  return places.filter(p => (!state.kind || p.k === state.kind) && (!state.hood || p.hood === state.hood) && terms.every(w => p.hay.includes(w)));
}

function render() {
  const rows = filtered();
  const shown = rows.slice(0, state.limit);
  elCount.textContent = rows.length === places.length
    ? t('eat.count', { n: fmt(rows.length) })
    : t('eat.of', { n: fmt(rows.length), total: fmt(places.length) });
  if (!rows.length) {
    elList.innerHTML = `<div class="status">${esc(t('ui.none'))}</div>`;
  } else {
    elList.innerHTML = `<ul class="places" role="list" style="list-style:none;margin:0;padding:0">${shown.map(p => `
      <li style="display:contents"><a class="place" href="/play/?place=${encodeURIComponent(p.n)}&amp;x=${p.x}&amp;z=${p.z}">
        <span class="kind ${p.k}">${esc(kindLabel(p.k))}</span>
        <span class="nm">${esc(p.n)}</span>
        <span class="meta">${esc([p.cuisine, p.hood].filter(Boolean).join(' · ') || ' ')}</span>
        <span class="go" aria-hidden="true">→</span>
        <span class="sr-only">, ${esc(t('btn.ride'))}</span>
      </a></li>`).join('')}</ul>`;
  }
  elMore.hidden = rows.length <= state.limit;
}

function setKind(k) {
  state.kind = k; state.limit = PAGE;
  document.querySelectorAll('#kinds .chip').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.kind === k)));
  syncUrl(); render();
}

async function init() {
  let idx;
  try { idx = await loadIndex(); } catch {
    elList.innerHTML = `<div class="status">${esc(t('ui.error'))}</div>`;
    return;
  }
  places = idx.places
    .map(([n, k, x, z, cu, h]) => {
      const c = cuisine(cu), hood = idx.hoods[h] || '';
      return { n, k, x, z, cuisine: c, hood, key: fold(n), hay: fold([n, c, hood, k === 'food' ? 'restaurant' : k].join(' ')) };
    })
    .sort((a, b) => a.key.localeCompare(b.key));

  // counts on the chips
  const counts = { '': places.length };
  for (const p of places) counts[p.k] = (counts[p.k] || 0) + 1;
  document.querySelectorAll('#kinds [data-count]').forEach(s => { s.textContent = fmt(counts[s.dataset.count] || 0); });

  // neighbourhood options, biggest first
  const byHood = {};
  for (const p of places) if (p.hood) byHood[p.hood] = (byHood[p.hood] || 0) + 1;
  elHood.insertAdjacentHTML('beforeend', Object.entries(byHood).sort((a, b) => a[0].localeCompare(b[0]))
    .map(([h, n]) => `<option value="${esc(h)}">${esc(h)} (${n})</option>`).join(''));
  if (state.hood && byHood[state.hood]) elHood.value = state.hood; else state.hood = '';

  elQ.value = state.q;
  setKind(state.kind);
}

document.querySelectorAll('#kinds .chip').forEach(b => b.addEventListener('click', () => setKind(b.dataset.kind)));
elQ.addEventListener('input', debounce(() => { state.q = elQ.value.trim(); state.limit = PAGE; syncUrl(); render(); }));
elHood.addEventListener('change', () => { state.hood = elHood.value; state.limit = PAGE; syncUrl(); render(); });
elMore.addEventListener('click', () => {
  const first = state.limit;
  state.limit += PAGE * 2; render();
  elList.querySelectorAll('.place')[first]?.focus();
});
document.addEventListener('langchange', () => { if (places.length) render(); });

init();
