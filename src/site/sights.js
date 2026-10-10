// Sights page: renders straight from the game's own list (src/city/sf.js) so the two never drift apart.
import { SIGHTS } from '../city/sf.js';
import { t } from './i18n.js';
import { esc, revealAll } from './util.js';

const list = document.getElementById('sight-list');
const jump = document.getElementById('sight-jump');
const coord = (lat, lon) => `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(4)}° ${lon >= 0 ? 'E' : 'W'}`;

jump.innerHTML = SIGHTS.map(s => `<li><a href="#${esc(s.id)}">${esc(s.name)}</a></li>`).join('');

list.innerHTML = SIGHTS.map((s, i) => `
  <article class="sight reveal" id="${esc(s.id)}" aria-labelledby="h-${esc(s.id)}">
    <div class="m">
      <img src="/img/sights/${encodeURIComponent(s.id)}.jpg" alt="${esc(t('sights.alt', { name: s.name }))}" loading="${i < 2 ? 'eager' : 'lazy'}" width="800" height="500" />
      <span class="n">${String(i + 1).padStart(2, '0')}</span>
    </div>
    <h2 class="h3" id="h-${esc(s.id)}"><a href="#${esc(s.id)}">${esc(s.name)}</a></h2>
    <p class="coords">${coord(s.lat, s.lon)}</p>
    <p>${esc(s.blurb)}</p>
    <div class="actions">
      <a class="btn btn-primary btn-sm" href="/play/?goto=${encodeURIComponent(s.id)}"><span data-i18n="btn.goto">${esc(t('btn.goto'))}</span> <span class="arrow" aria-hidden="true">→</span></a>
      <a class="textlink" href="https://www.openstreetmap.org/?mlat=${s.lat}&amp;mlon=${s.lon}#map=17/${s.lat}/${s.lon}" rel="noopener" data-i18n="sights.map">${esc(t('sights.map'))}</a>
    </div>
  </article>`).join('');

// A sight added to the game before its screenshot exists gets a gradient placeholder instead of a broken image.
list.querySelectorAll('.m img').forEach(img => img.addEventListener('error', () => {
  const m = img.parentElement;
  m.classList.add('placeholder');
  m.style.background = 'radial-gradient(120% 90% at 50% 110%, #f1b27a 0%, #c98a6a 28%, #4b4f5c 62%, #15181d 100%)';
  img.remove();
}, { once: true }));

revealAll(list);

// the cards are rendered after load, so honour a #hash that points at one of them
if (location.hash) {
  const el = document.getElementById(decodeURIComponent(location.hash.slice(1)));
  if (el) { el.classList.add('in'); requestAnimationFrame(() => el.scrollIntoView()); }
}
