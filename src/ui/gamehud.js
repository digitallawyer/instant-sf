// Overlays for the game modes: race standings, items, countdown and results; mission timer,
// objective and guiding arrow; the tour's caption cards.
import { ITEMS } from '../game/race.js';

const fmt = t => { if (t == null) return '—'; const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s.toFixed(1).padStart(4, '0')}`; };
const ord = n => n + (n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th');

export function createGameHud(root, { onAgain, onMenu, onNext }) {
  root.insertAdjacentHTML('beforeend', `
    <div class="ghud">
      <div class="g-race panel"><div class="g-pos"></div><div class="g-meta"><div class="g-name"></div><div class="g-time"></div><div class="g-lap"></div></div></div>
      <div class="g-items"></div>
      <div class="g-count"></div>
      <div class="g-fog"></div>
      <div class="g-warn panel">Wrong way — back to the course</div>
      <div class="g-mission panel"><div class="gm-timer"></div><div class="gm-arrow">↑</div><div class="gm-obj"></div></div>
      <div class="g-result panel"><div class="gr-kicker"></div><h2 class="gr-title"></h2><div class="gr-body"></div>
        <div class="gr-actions"><button class="gr-again">Again</button><button class="gr-next">Next</button><button class="gr-menu">Menu</button></div></div>
      <div class="g-tour panel"><div class="gt-kicker">Tour</div><h3 class="gt-title"></h3><p class="gt-blurb"></p><div class="gt-actions"><button class="gt-next">Next stop</button><button class="gt-exit">Exit tour</button></div></div>
    </div>`);
  const el = root.querySelector('.ghud');
  const $ = s => el.querySelector(s);
  $('.gr-again').addEventListener('click', () => onAgain?.());
  $('.gr-menu').addEventListener('click', () => onMenu?.());
  $('.gr-next').addEventListener('click', () => onNext?.());
  const show = (s, on) => $(s).classList.toggle('on', !!on);
  let lastCount = null;
  return {
    el,
    clear() { for (const s of ['.g-race', '.g-items', '.g-count', '.g-fog', '.g-warn', '.g-mission', '.g-result', '.g-tour']) show(s, false); },
    race(race) {
      show('.g-race', true); show('.g-items', true);
      const me = race.racers[0];
      $('.g-pos').innerHTML = `${race.position}<small>/${race.racers.length}</small>`;
      $('.g-name').textContent = race.def.name;
      $('.g-time').textContent = fmt(Math.max(0, race.t));
      $('.g-lap').textContent = race.laps > 1 ? `Lap ${Math.min(race.laps, me.lap + 1)} of ${race.laps}` : `${Math.round(Math.min(100, Math.max(0, race.progressOf(me) / race.total * 100)))}%`;
      $('.g-items').innerHTML = [0, 1, 2].map(i => `<div class="gi${race.items[i] ? ' full' : ''}">${race.items[i] ? ITEMS[race.items[i]].icon : ''}</div>`).join('') + (race.items.length ? '<span>F use</span>' : '');
      const n = race.state === 'countdown' ? Math.ceil(-race.t) : race.t < 0.9 ? 0 : null;
      if (n !== lastCount) {
        lastCount = n;
        const c = $('.g-count');
        c.textContent = n === 0 ? 'Go' : n > 0 && n <= 3 ? String(n) : '';
        c.classList.remove('pop'); void c.offsetWidth; if (c.textContent) c.classList.add('pop');
        show('.g-count', !!c.textContent);
      }
      $('.g-fog').style.opacity = race.fogged > 0 ? Math.min(1, race.fogged) * 0.92 : 0;
      show('.g-warn', race.offCourse && race.state === 'racing');
    },
    raceResult(race) {
      const res = race.results();
      const me = res.find(r => r.you);
      $('.gr-kicker').textContent = race.def.name;
      $('.gr-title').textContent = me.place === 1 ? 'You won!' : `${ord(me.place)} place`;
      $('.gr-body').innerHTML = `<table>${res.map(r => `<tr class="${r.you ? 'you' : ''}"><td>${r.place}</td><td>${r.name}</td><td>${fmt(r.time)}</td></tr>`).join('')}</table>`;
      $('.gr-next').style.display = '';
      show('.g-result', true);
    },
    mission(m) {
      show('.g-mission', true);
      const left = Math.max(0, m.limit - m.t);
      const tm = $('.gm-timer');
      tm.textContent = fmt(left).replace(/\.\d$/, '');
      tm.classList.toggle('low', left < 15);
      $('.gm-obj').textContent = m.objective;
      $('.gm-arrow').style.transform = `rotate(${m.arrow}deg)`;
      $('.gm-arrow').style.opacity = m.arrow == null ? 0 : 1;
    },
    missionResult(m, ok) {
      $('.gr-kicker').textContent = m.def.name;
      $('.gr-title').textContent = ok ? 'Mission complete' : 'Out of time';
      $('.gr-body').innerHTML = `<p>${ok ? m.def.win : m.def.lose}</p>${ok ? `<p class="gr-time">${fmt(m.t)}</p>` : ''}`;
      $('.gr-next').style.display = ok ? '' : 'none';
      show('.g-result', true);
    },
    tour(stop, interactive) {
      show('.g-tour', !!stop);
      if (!stop) return;
      $('.gt-title').textContent = stop.name;
      $('.gt-blurb').textContent = stop.blurb;
      $('.gt-next').style.display = interactive ? '' : 'none';
    },
    onTour(next, exit) { $('.gt-next').onclick = next; $('.gt-exit').onclick = exit; },
  };
}
