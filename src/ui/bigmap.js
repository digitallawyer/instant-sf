// The city map (M): pan and zoom the whole of the play area, search any sight or street, and click
// anywhere to teleport there.
import { buildMapIndex, drawFeatures, MAP_STYLE } from './mapdraw.js';
import { searchPlaces } from '../game/places.js';
import { landRaster } from './hud.js';

export function createBigMap(root, { map, hf, places, onTeleport }) {
  root.insertAdjacentHTML('beforeend', `
    <div class="bigmap">
      <canvas></canvas>
      <div class="bm-top panel">
        <div class="bm-title">San Francisco</div>
        <input class="bm-search" placeholder="Search a sight, street or neighbourhood" spellcheck="false" />
        <div class="bm-results"></div>
      </div>
      <div class="bm-hint panel">Click anywhere to go there · drag to pan · scroll to zoom · <kbd>M</kbd> close</div>
      <button class="bm-close hb">Close</button>
    </div>`);
  const el = root.querySelector('.bigmap');
  const cv = el.querySelector('canvas'), ctx = cv.getContext('2d');
  const input = el.querySelector('.bm-search'), results = el.querySelector('.bm-results');
  const index = buildMapIndex(map);
  const land = landRaster(hf);
  const landmarks = places.filter(p => p.kind === 'landmark');
  let cx = 0, cz = 0, mpp = 6, open = false, player = null, dpr = 1, drag = null, moved = false;

  function resize() { dpr = Math.min(2, devicePixelRatio || 1); cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; draw(); }
  const toWorld = (sx, sy) => ({ x: cx + (sx - innerWidth / 2) * mpp, z: cz + (sy - innerHeight / 2) * mpp });
  function draw() {
    if (!open) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = MAP_STYLE.water; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.save();
    ctx.translate(cv.width / 2, cv.height / 2);
    ctx.scale(dpr / mpp, dpr / mpp);
    ctx.translate(-cx, -cz);
    ctx.drawImage(land, hf.minX - hf.cell / 2, hf.minZ - hf.cell / 2, hf.nx * hf.cell, hf.nz * hf.cell);
    const a = toWorld(0, 0), b = toWorld(innerWidth, innerHeight);
    drawFeatures(ctx, index.query(a.x, a.z, b.x, b.z), mpp, { roadScale: mpp < 2 ? 1 : 0.8 });
    ctx.restore();
    // labels
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = '500 12px Inter, sans-serif'; ctx.textBaseline = 'middle';
    for (const l of landmarks) {
      const sx = (l.x - cx) / mpp + innerWidth / 2, sy = (l.z - cz) / mpp + innerHeight / 2;
      if (sx < -50 || sy < -20 || sx > innerWidth + 50 || sy > innerHeight + 20) continue;
      ctx.fillStyle = '#e5532d'; ctx.beginPath(); ctx.arc(sx, sy, 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(244,241,236,.92)'; ctx.fillText(l.name, sx + 8, sy);
    }
    if (player) {
      const sx = (player.pos.x - cx) / mpp + innerWidth / 2, sy = (player.pos.z - cz) / mpp + innerHeight / 2;
      ctx.save(); ctx.translate(sx, sy); ctx.rotate(-player.heading + Math.PI);
      ctx.fillStyle = '#fff'; ctx.strokeStyle = '#e5532d'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(0, -11); ctx.lineTo(8, 9); ctx.lineTo(0, 4); ctx.lineTo(-8, 9); ctx.closePath(); ctx.stroke(); ctx.fill();
      ctx.restore();
    }
  }
  cv.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, cx, cz }; moved = false; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
    cx = drag.cx - dx * mpp; cz = drag.cz - dy * mpp; draw();
  });
  cv.addEventListener('pointerup', e => {
    if (drag && !moved) { const w = toWorld(e.clientX, e.clientY); onTeleport(w.x, w.z); api.close(); }
    drag = null;
  });
  cv.addEventListener('wheel', e => {
    e.preventDefault();
    const before = toWorld(e.clientX, e.clientY);
    mpp = Math.max(0.5, Math.min(14, mpp * (e.deltaY > 0 ? 1.15 : 0.87)));
    const after = toWorld(e.clientX, e.clientY);
    cx += before.x - after.x; cz += before.z - after.z; draw();
  }, { passive: false });
  input.addEventListener('input', () => {
    const r = searchPlaces(places, input.value);
    results.innerHTML = r.map((p, i) => `<button class="bm-r" data-i="${i}"><span>${p.name}</span><em>${p.kind === 'landmark' ? 'sight' : p.kind}</em></button>`).join('');
    results._list = r;
  });
  input.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter' && results._list?.length) { const p = results._list[0]; onTeleport(p.x, p.z, p); api.close(); }
    if (e.key === 'Escape') api.close();
  });
  results.addEventListener('click', e => {
    const b = e.target.closest('.bm-r'); if (!b) return;
    const p = results._list[+b.dataset.i]; onTeleport(p.x, p.z, p); api.close();
  });
  el.querySelector('.bm-close').addEventListener('click', () => api.close());
  addEventListener('resize', resize);

  const api = {
    get isOpen() { return open; },
    open(pl) { player = pl; open = true; el.classList.add('on'); cx = pl.pos.x; cz = pl.pos.z; mpp = 3; resize(); setTimeout(() => input.focus(), 50); },
    close() { open = false; el.classList.remove('on'); input.value = ''; results.innerHTML = ''; input.blur(); },
    toggle(pl) { open ? api.close() : api.open(pl); },
  };
  return api;
}
