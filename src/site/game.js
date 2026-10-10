// Game page: race, mission and tour lists rendered from the game's own data (src/city/sf.js),
// each with a deep link that starts it in the game (/play/?race=, ?mission=, ?tour).
import { RACES, RIVALS, MISSIONS, TOUR, SIGHTS } from '../city/sf.js';
import { t } from './i18n.js';
import { esc, revealAll } from './util.js';

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen'];
const word = n => WORDS[n] || String(n);
const mmss = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const clock = h => {
  const hh = Math.floor(h), mm = Math.round((h - hh) * 60);
  const h12 = ((hh + 11) % 12) + 1;
  return `${h12}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'am' : 'pm'}`;
};
const play = (href, label) => `<a class="btn btn-primary btn-sm" href="${href}"><span data-i18n="btn.playone">${esc(t('btn.playone'))}</span> <span class="arrow" aria-hidden="true">→</span><span class="sr-only">: ${esc(label)}</span></a>`;

const rivals = RIVALS.map(r => r.name);
document.querySelectorAll('[data-rivals]').forEach(el => {
  el.textContent = `${word(rivals.length)} rivals (${rivals.slice(0, -1).join(', ')} and ${rivals.at(-1)})`;
});
document.querySelectorAll('[data-tour-count]').forEach(el => { el.textContent = word(TOUR.length); });

const raceList = document.getElementById('race-list');
if (raceList) {
  raceList.innerHTML = RACES.map((r, i) => `
    <li class="run reveal">
      <span class="idx">${String(i + 1).padStart(2, '0')}</span>
      <div class="txt">
        <h3 class="h3">${esc(r.name)}</h3>
        <p>${esc(r.blurb)}</p>
        <p class="meta">${r.laps > 1 ? `${r.laps} laps` : 'Point to point'} · ${r.way.length} checkpoints · vs ${esc(rivals.join(', '))}</p>
      </div>
      ${play(`/play/?race=${encodeURIComponent(r.id)}`, r.name)}
    </li>`).join('');
}

const missionList = document.getElementById('mission-list');
if (missionList) {
  missionList.innerHTML = MISSIONS.map(m => `
    <li class="run reveal">
      <span class="idx ico" aria-hidden="true">${esc(m.icon || '•')}</span>
      <div class="txt">
        <h3 class="h3">${esc(m.name)}</h3>
        <p>${esc(m.blurb)}</p>
        <p class="meta">Time limit ${mmss(m.limit)}</p>
      </div>
      ${play(`/play/?mission=${encodeURIComponent(m.id)}`, m.name)}
    </li>`).join('');
}

const tourList = document.getElementById('tour-list');
if (tourList) {
  tourList.innerHTML = TOUR.map(stop => {
    const s = SIGHTS.find(x => x.id === stop.sight);
    if (!s) return '';
    const mood = stop.karl > 0.4 ? ' · fog' : stop.hour >= 19 ? ' · night' : stop.hour >= 17.5 ? ' · golden hour' : '';
    return `<li class="reveal"><a href="/sights/#${encodeURIComponent(s.id)}"><span class="time">${clock(stop.hour)}${mood}</span><span class="nm">${esc(s.name)}</span></a></li>`;
  }).join('');
}

revealAll(document);
