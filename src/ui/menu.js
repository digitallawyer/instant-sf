// The start screen: pick how you get around and in what colour, then ride.
import { MOUNTS, COLORS } from '../game/avatar.js';

export function createMenu(root, { onStart, onMount, onColor }) {
  root.insertAdjacentHTML('beforeend', `
    <div class="menu">
      <div class="menu-card panel">
        <div class="menu-kicker">A city you can ride through</div>
        <h1 class="menu-title">Instant <em>San Francisco</em></h1>
        <p class="menu-sub">Every building at its real height, every hill at its real grade. Bike, skate, walk or flop around as a sea lion.</p>
        <div class="menu-modes">
          <button class="mode on" data-mode="explore">Explore</button>
          <button class="mode" data-mode="race" disabled title="Coming soon">Race</button>
          <button class="mode" data-mode="missions" disabled title="Coming soon">Missions</button>
          <button class="mode" data-mode="tour" disabled title="Coming soon">Tour</button>
        </div>
        <div class="menu-label">Ride</div>
        <div class="menu-mounts">${MOUNTS.map((m, i) => `<button class="mount${i === 0 ? ' on' : ''}" data-id="${m.id}">${m.name}</button>`).join('')}</div>
        <div class="menu-label">Colour <span class="menu-colname">${COLORS[0].name}</span></div>
        <div class="menu-colors">${COLORS.map((c, i) => `<button class="sw${i === 0 ? ' on' : ''}" data-i="${i}" style="--c:#${c.c.toString(16).padStart(6, '0')}" title="${c.name}"></button>`).join('')}</div>
        <button class="menu-go">Ride <kbd>Enter</kbd></button>
        <div class="menu-keys"><kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd> ride · <kbd>Space</kbd> jump · <kbd>M</kbd> map · <kbd>C</kbd> change ride · <kbd>Esc</kbd> menu</div>
      </div>
      <div class="menu-credit">Map data © OpenStreetMap contributors · Elevation USGS 3DEP · built with three.js</div>
    </div>`);
  const el = root.querySelector('.menu');
  el.querySelectorAll('.mount').forEach(b => b.addEventListener('click', () => {
    el.querySelectorAll('.mount').forEach(x => x.classList.toggle('on', x === b));
    onMount(b.dataset.id);
  }));
  el.querySelectorAll('.sw').forEach(b => b.addEventListener('click', () => {
    el.querySelectorAll('.sw').forEach(x => x.classList.toggle('on', x === b));
    el.querySelector('.menu-colname').textContent = COLORS[+b.dataset.i].name;
    onColor(COLORS[+b.dataset.i].c);
  }));
  el.querySelector('.menu-go').addEventListener('click', () => onStart());
  return {
    el,
    get isOpen() { return el.classList.contains('on'); },
    open() { el.classList.add('on'); },
    close() { el.classList.remove('on'); },
    syncMount(id) { el.querySelectorAll('.mount').forEach(x => x.classList.toggle('on', x.dataset.id === id)); },
  };
}
