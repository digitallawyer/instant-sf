// The in-game overlay: minimap (rotating, vector), street + neighbourhood title, nearby sights,
// speed / elevation / grade, and toasts.
import { buildMapIndex, drawFeatures, MAP_STYLE } from './mapdraw.js';

const $ = (s, r = document) => r.querySelector(s);

export function landRaster(hf) {
  const c = document.createElement('canvas'); c.width = hf.nx; c.height = hf.nz;
  const g = c.getContext('2d'); const img = g.createImageData(hf.nx, hf.nz);
  const W = [0x16, 0x23, 0x2c], L = [0x2a, 0x2d, 0x31];
  for (let j = 0; j < hf.nz; j++) for (let i = 0; i < hf.nx; i++) {
    const h = hf.data[j * hf.nx + i] * hf.scale, k = (j * hf.nx + i) * 4, col = h > 0.3 ? L : W;
    img.data[k] = col[0]; img.data[k + 1] = col[1]; img.data[k + 2] = col[2]; img.data[k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

export function createHud(root, { map, hf, world, places }) {
  root.insertAdjacentHTML('beforeend', `
    <div class="hud-game">
      <div class="minimap-wrap panel"><canvas class="minimap"></canvas><div class="mm-north">N</div><div class="mm-me"></div></div>
      <div class="place-title"><div class="hood"></div><div class="street"></div></div>
      <div class="nearby panel"></div>
      <div class="gauges panel"><div class="g-speed"><b>0</b><span>mph</span></div><div class="g-row"><span class="g-elev"></span><span class="g-grade"></span></div></div>
      <div class="hud-buttons"><button class="hb" data-act="menu">Menu</button><button class="hb" data-act="map">Map <kbd>M</kbd></button></div>
      <div class="toast"></div>
    </div>`);
  const el = $('.hud-game', root);
  const mm = $('.minimap', el), mmCtx = mm.getContext('2d');
  const MM = 190, dpr = Math.min(2, devicePixelRatio || 1);
  mm.width = mm.height = MM * dpr; mm.style.width = mm.style.height = MM + 'px';
  const index = buildMapIndex(map);
  const land = landRaster(hf);
  const hoods = map.pois.filter(p => p.k === 'hood' && (p.pl === 'neighbourhood' || p.pl === 'suburb' || p.pl === 'quarter'));
  const sights = places.filter(p => p.kind === 'sight' || p.kind === 'landmark');

  let lastStreet = '', lastHood = '', nearbyT = 0, toastT = 0;
  const streetEl = $('.street', el), hoodEl = $('.hood', el), nearbyEl = $('.nearby', el), toastEl = $('.toast', el);

  function drawMinimap(px, pz, heading) {
    const g = mmCtx, scale = 1.35; // metres per css pixel
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = MAP_STYLE.water; g.fillRect(0, 0, mm.width, mm.height);
    g.save();
    g.translate(mm.width / 2, mm.height / 2 + 18 * dpr);
    g.scale(dpr / scale, dpr / scale);
    g.rotate(Math.PI + heading); // heading-up
    g.translate(-px, -pz);
    g.imageSmoothingEnabled = true;
    g.drawImage(land, hf.minX - hf.cell / 2, hf.minZ - hf.cell / 2, hf.nx * hf.cell, hf.nz * hf.cell);
    const R = MM * scale * 0.8;
    drawFeatures(g, index.query(px - R, pz - R, px + R, pz + R), scale / dpr * 1.5, { roadScale: 0.9 });
    g.restore();
  }

  const bearing = (dx, dz, heading) => { // degrees, 0 = straight ahead, positive to the right
    const a = Math.atan2(dx, dz) - heading;
    return ((-a * 180 / Math.PI) % 360 + 540) % 360 - 180;
  };
  const arrow = deg => `<i class="arr" style="transform:rotate(${deg.toFixed(0)}deg)">↑</i>`;

  return {
    el,
    toast(msg, ms = 2600) { toastEl.textContent = msg; toastEl.classList.add('on'); toastT = ms / 1000; },
    show(on) { el.style.display = on ? '' : 'none'; },
    update(dt, player) {
      const { x, z } = player.pos;
      drawMinimap(x, z, player.heading);
      const name = player.surface.kind === 'water' ? 'San Francisco Bay' : (world.streetAt(x, z) || player.surface.name && map.names[player.surface.name] || '');
      if (name !== lastStreet) { lastStreet = name; streetEl.textContent = name; streetEl.classList.remove('in'); void streetEl.offsetWidth; streetEl.classList.add('in'); }
      let best = null, bd = Infinity;
      for (const h of hoods) { const d = (h.x - x) ** 2 + (h.z - z) ** 2; if (d < bd) { bd = d; best = h; } }
      const hood = best && bd < 1500 ** 2 ? best.n : 'San Francisco';
      if (hood !== lastHood) { lastHood = hood; hoodEl.textContent = hood; }
      // gauges
      const mph = Math.abs(player.speed) * 2.237;
      $('.g-speed b', el).textContent = mph.toFixed(0);
      $('.g-elev', el).textContent = `${Math.round(player.pos.y * 3.281)} ft`;
      const grade = Math.tan(player.pitch) * 100;
      $('.g-grade', el).textContent = `${grade >= 0 ? '▲' : '▼'} ${Math.abs(grade).toFixed(0)}%`;
      $('.g-grade', el).classList.toggle('steep', Math.abs(grade) > 15);
      // nearby sights (refresh a few times a second)
      nearbyT -= dt;
      if (nearbyT <= 0) {
        nearbyT = 0.3;
        const list = sights.map(s => ({ s, d: Math.hypot(s.x - x, s.z - z) })).filter(o => o.d < 700).sort((a, b) => a.d - b.d).slice(0, 3);
        nearbyEl.innerHTML = list.map(({ s, d }) => `<div class="nb">${arrow(bearing(s.x - x, s.z - z, player.heading))}<span>${s.name}</span><em>${d < 1000 ? Math.round(d / 10) * 10 + ' m' : (d / 1000).toFixed(1) + ' km'}</em></div>`).join('');
        nearbyEl.style.display = list.length ? '' : 'none';
      }
      if (toastT > 0) { toastT -= dt; if (toastT <= 0) toastEl.classList.remove('on'); }
    },
  };
}
