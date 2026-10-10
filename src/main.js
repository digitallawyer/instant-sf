import * as THREE from 'three';
import './engine/fog.js';
import { shared } from './engine/fog.js';
import { createRenderer } from './engine/renderer.js';
import { createSky } from './engine/sky.js';
import { loadHeightField, paintLanduse, createTerrain, createBackdrop } from './engine/terrain.js';
import { createBuildings } from './engine/buildings.js';
import { createRoads } from './engine/roads.js';
import { createWater } from './engine/water.js';
import { createTrees } from './engine/trees.js';
import { createFlyCam } from './engine/flycam.js';
import { project, unproject } from './city/region.js';

const DATA = '/data/sf';
const $ = s => document.querySelector(s);
const step = (label, pct) => { $('#loader-step').textContent = label; $('#loader-fill').style.width = pct + '%'; return new Promise(r => requestAnimationFrame(() => setTimeout(r, 0))); };

const at = (lat, lon, y = 0) => { const [x, z] = project(lat, lon); return new THREE.Vector3(x, y, z); };
// Viewpoints: [camera lat, lon, height] -> [target lat, lon, height]
const VIEWS = {
  Digit1: { name: 'Embarcadero from the Bay', cam: [37.7992, -122.3855, 140], look: [37.7915, -122.4005, 40] },
  Digit2: { name: 'Lombard Street', cam: [37.8016, -122.4168, 70], look: [37.8021, -122.4190, 40] },
  Digit3: { name: 'Golden Gate', cam: [37.8045, -122.4655, 120], look: [37.8199, -122.4783, 60] },
  Digit4: { name: 'Alamo Square', cam: [37.7747, -122.4357, 55], look: [37.7790, -122.4180, 40] },
  Digit5: { name: 'Telegraph Hill', cam: [37.7985, -122.4010, 160], look: [37.8024, -122.4058, 70] },
  Digit6: { name: 'Powell Street', cam: [37.7853, -122.4079, 1.8], look: [37.7905, -122.4089, 12], snap: true },
  Digit8: { name: 'Painted Ladies', cam: [37.7764, -122.4340, 1.8], look: [37.7762, -122.4326, 8], snap: true },
  Digit9: { name: 'Chinatown, Grant Ave', cam: [37.7925, -122.4058, 1.8], look: [37.7960, -122.4064, 10], snap: true },
  Digit7: { name: 'Nob Hill down California', cam: [37.7916, -122.4128, 100], look: [37.7930, -122.3960, 60] },
};

async function boot() {
  await step('Starting the engine', 5);
  const R = createRenderer($('#view'));
  const { scene, camera, csm, composer, renderer } = R;
  const sky = createSky(renderer, scene);

  await step('Downloading San Francisco', 12);
  const [hf, bf, map] = await Promise.all([
    loadHeightField(DATA, 'terrain'),
    loadHeightField(DATA, 'backdrop'),
    fetch(`${DATA}/map.json`).then(r => r.json()),
  ]);

  await step('Shaping the hills', 30);
  const masks = paintLanduse(map, hf);
  window.__masks = masks;
  scene.add(createTerrain(hf, masks, csm));
  scene.add(createBackdrop(bf, hf));
  scene.add(createWater(map, hf, csm));

  await step('Raising 40,000 buildings', 48);
  const buildings = createBuildings(map, csm);
  scene.add(buildings);

  await step('Paving the streets', 70);
  scene.add(createRoads(map, hf, csm));

  await step('Planting trees', 85);
  const trees = createTrees(map, hf, csm);
  scene.add(trees);

  await step('Rolling in the fog', 95);
  const fly = createFlyCam(camera, renderer.domElement, hf);
  const go = code => {
    const v = VIEWS[code];
    const c = at(v.cam[0], v.cam[1]);
    if (v.snap) { // put street-level cameras on the nearest street
      let best = Infinity, bx = c.x, bz = c.z;
      for (const r of map.roads) { if (r.k > 7) continue; for (let i = 0; i < r.p.length; i += 2) { const d = (r.p[i] - c.x) ** 2 + (r.p[i + 1] - c.z) ** 2; if (d < best) { best = d; bx = r.p[i]; bz = r.p[i + 1]; } } }
      c.x = bx; c.z = bz;
    }
    c.y = hf.at(c.x, c.z) + v.cam[2];
    const l = at(v.look[0], v.look[1]); l.y = hf.at(l.x, l.z) + v.look[2];
    fly.set(c, l);
    return v.name;
  };
  go('Digit1');
  sky.setHour(+new URLSearchParams(location.search).get('t') || 17.4);

  // dev HUD
  const hud = $('#hud');
  hud.innerHTML = `<div class="panel dev-stats" id="stats"></div>
    <div class="panel dev-help">
      <div><kbd>drag</kbd> look &nbsp;<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move &nbsp;<kbd>Q</kbd><kbd>E</kbd> down/up &nbsp;<kbd>⇧</kbd> fast &nbsp;<kbd>wheel</kbd> speed</div>
      <div><kbd>1</kbd>–<kbd>9</kbd> viewpoints &nbsp;<kbd>[</kbd><kbd>]</kbd> time of day &nbsp;<kbd>T</kbd> play time &nbsp;<kbd>F</kbd> fog &nbsp;<kbd>R</kbd> rain</div>
    </div>`;
  let timeFlow = false, viewName = VIEWS.Digit1.name;
  addEventListener('keydown', e => {
    if (VIEWS[e.code]) viewName = go(e.code);
    if (e.code === 'BracketRight') sky.setHour(sky.state.hour + 0.25);
    if (e.code === 'BracketLeft') sky.setHour(sky.state.hour - 0.25);
    if (e.code === 'KeyT') timeFlow = !timeFlow;
    if (e.code === 'KeyF') { const L = [0, 0.3, 0.6, 0.9]; sky.setKarl(L[(L.indexOf(sky.state.karl) + 1) % L.length]); }
    if (e.code === 'KeyH') sky.setHour(+prompt('hour (0-24)', sky.state.hour.toFixed(2)) || sky.state.hour);
    if (e.code === 'KeyR') shared.uWet.value = shared.uWet.value > 0.5 ? 0 : 1;
  });

  const stats = $('#stats');
  const clock = new THREE.Timer();
  renderer.info.autoReset = false;
  let frames = 0, acc = 0, fps = 0;
  window.__sf = { scene, camera, sky, hf, map, renderer, csm, R };

  function frame() {
    clock.update();
    const dt = Math.min(0.05, clock.getDelta());
    renderer.info.reset();
    shared.uTime.value += dt;
    if (timeFlow) sky.setHour(sky.state.hour + dt * 0.25);
    fly.update(dt);
    sky.follow(camera);
    trees.userData.update(camera.position);
    // sun -> CSM lights
    csm.lightDirection.copy(shared.uSunDir.value).negate();
    for (const l of csm.lights) { l.color.copy(sky.state.sunColor); l.intensity = sky.state.sunIntensity; }
    csm.update();
    composer.render(dt);

    frames++; acc += dt;
    if (acc > 0.5) {
      fps = frames / acc; frames = 0; acc = 0;
      const { lat, lon } = unproject(camera.position.x, camera.position.z);
      const info = renderer.info.render;
      const h = sky.state.hour, hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
      stats.innerHTML = `<b>${fps.toFixed(0)} fps</b> · ${(info.triangles / 1e6).toFixed(2)}M tris · ${info.calls} calls<br>
        ${viewName} · ${lat.toFixed(5)}, ${lon.toFixed(5)} · ${camera.position.y.toFixed(0)} m<br>
        ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} · fog ${sky.state.karl} · speed ${fly.speed.toFixed(0)} m/s · trees ${trees.userData.count}`;
    }
    requestAnimationFrame(frame);
  }
  await step('Ready', 100);
  $('#loader').classList.add('done');
  frame();
}

boot().catch(err => {
  console.error(err);
  $('#loader-step').textContent = 'Something went wrong: ' + err.message;
});
