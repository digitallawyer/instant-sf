// The start screen: pick a mode (explore, race, mission, tour), how you get around and in what colour.
import { MOUNTS, COLORS } from '../game/avatar.js';
import { RACES, MISSIONS } from '../city/sf.js';

const fmtLimit = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export function createMenu(root, { onStart, onMount, onColor }) {
  root.insertAdjacentHTML('beforeend', `
    <div class="menu">
      <div class="menu-card panel">
        <div class="menu-kicker">A city you can ride through</div>
        <h1 class="menu-title">Instant <em>San Francisco</em></h1>
        <p class="menu-sub">Every building at its real height, every hill at its real grade. Bike, skate, walk or flop around as a sea lion.</p>
        <div class="menu-modes">
          <button class="mode on" data-mode="explore">Explore</button>
          <button class="mode" data-mode="race">Race</button>
          <button class="mode" data-mode="missions">Missions</button>
          <button class="mode" data-mode="tour">Tour</button>
        </div>
        <div class="menu-panel on" data-panel="race-list"></div>
        <div class="menu-panel" data-panel="race"><div class="menu-list">${RACES.map((r, i) => `<button class="menu-item${i === 0 ? ' on' : ''}" data-race="${r.id}"><b>${r.name}<em>${r.laps > 1 ? r.laps + ' laps' : 'A → B'}</em></b>${r.blurb}</button>`).join('')}</div></div>
        <div class="menu-panel" data-panel="missions"><div class="menu-list">${MISSIONS.map((m, i) => `<button class="menu-item${i === 0 ? ' on' : ''}" data-mission="${m.id}"><b>${m.icon} ${m.name}<em>${fmtLimit(m.limit)}</em></b>${m.blurb}</button>`).join('')}</div></div>
        <div class="menu-panel" data-panel="tour"><div class="menu-list">
          <button class="menu-item on" data-tour="auto"><b>Sit back</b>The camera glides over the rooftops from the Golden Gate at dawn to the skyline at night, stopping at thirteen sights.</button>
          <button class="menu-item" data-tour="interactive"><b>At your own pace</b>The same tour, but you click on to the next stop when you're ready.</button>
        </div></div>
        <div class="menu-ride">
          <div class="menu-label">Ride</div>
          <div class="menu-mounts">${MOUNTS.map((m, i) => `<button class="mount${i === 0 ? ' on' : ''}" data-id="${m.id}">${m.name}</button>`).join('')}</div>
          <div class="menu-label">Colour <span class="menu-colname">${COLORS[0].name}</span></div>
          <div class="menu-colors">${COLORS.map((c, i) => `<button class="sw${i === 0 ? ' on' : ''}" data-i="${i}" style="--c:#${c.c.toString(16).padStart(6, '0')}" title="${c.name}"></button>`).join('')}</div>
        </div>
        <button class="menu-go">Ride <kbd>Enter</kbd></button>
        <div class="menu-keys"><kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd> ride · <kbd>Space</kbd> jump · <kbd>E</kbd> hop on a cable car · <kbd>M</kbd> map · <kbd>C</kbd> change ride · <kbd>R</kbd> weather · <kbd>Esc</kbd> menu</div>
      </div>
      <div class="menu-credit">Map data © OpenStreetMap contributors · Elevation USGS 3DEP · built with three.js</div>
    </div>`);
  const el = root.querySelector('.menu');
  const state = { mode: 'explore', race: RACES[0].id, mission: MISSIONS[0].id, tour: 'auto' };
  const go = el.querySelector('.menu-go');
  const label = () => { go.innerHTML = { explore: 'Ride', race: 'Start race', missions: 'Start mission', tour: 'Start the tour' }[state.mode] + ' <kbd>Enter</kbd>'; };
  el.querySelectorAll('.mode').forEach(b => b.addEventListener('click', () => {
    state.mode = b.dataset.mode;
    el.querySelectorAll('.mode').forEach(x => x.classList.toggle('on', x === b));
    el.querySelectorAll('.menu-panel').forEach(p => p.classList.toggle('on', p.dataset.panel === state.mode));
    el.querySelector('.menu-ride').style.display = state.mode === 'tour' ? 'none' : '';
    el.querySelector('.menu-sub').style.display = state.mode === 'explore' ? '' : 'none';
    label();
  }));
  const pick = (attr, key) => el.querySelectorAll(`[data-${attr}]`).forEach(b => b.addEventListener('click', () => {
    el.querySelectorAll(`[data-${attr}]`).forEach(x => x.classList.toggle('on', x === b));
    state[key] = b.dataset[attr];
  }));
  pick('race', 'race'); pick('mission', 'mission'); pick('tour', 'tour');
  el.querySelectorAll('.mount').forEach(b => b.addEventListener('click', () => {
    el.querySelectorAll('.mount').forEach(x => x.classList.toggle('on', x === b));
    onMount(b.dataset.id);
  }));
  el.querySelectorAll('.sw').forEach(b => b.addEventListener('click', () => {
    el.querySelectorAll('.sw').forEach(x => x.classList.toggle('on', x === b));
    el.querySelector('.menu-colname').textContent = COLORS[+b.dataset.i].name;
    onColor(COLORS[+b.dataset.i].c);
  }));
  go.addEventListener('click', () => onStart({ ...state }));
  return {
    el, state,
    get isOpen() { return el.classList.contains('on'); },
    open() { el.classList.add('on'); },
    close() { el.classList.remove('on'); },
    start() { onStart({ ...state }); },
    syncMount(id) { el.querySelectorAll('.mount').forEach(x => x.classList.toggle('on', x.dataset.id === id)); },
  };
}
