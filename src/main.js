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
import { createFurniture } from './engine/furniture.js';
import { createWeather } from './engine/weather.js';
import { buildRoadGraph, createTraffic, createParked } from './life/traffic.js';
import { createTransit } from './life/transit.js';
import { createPeople, createCritters } from './life/people.js';
import { createFlyCam } from './engine/flycam.js';
import { createWorld } from './game/world.js';
import { Player, createInput } from './game/player.js';
import { MOUNTS } from './game/avatar.js';
import { ChaseCam } from './game/chasecam.js';
import { buildPlaces } from './game/places.js';
import { createHud } from './ui/hud.js';
import { createBigMap } from './ui/bigmap.js';
import { createMenu } from './ui/menu.js';
import { createGameHud } from './ui/gamehud.js';
import { buildStreetGraph } from './game/route.js';
import { Race, buildRaceTrack } from './game/race.js';
import { Mission } from './game/missions.js';
import { Tour } from './game/tour.js';
import { project, unproject } from './city/region.js';
import { START, RACES, MISSIONS, SIGHTS } from './city/sf.js';
import { createLandmarks } from './landmarks/index.js';

const DATA = '/data/sf';
const $ = s => document.querySelector(s);
const params = new URLSearchParams(location.search);
const step = (label, pct) => { $('#loader-step').textContent = label; $('#loader-fill').style.width = pct + '%'; return new Promise(r => requestAnimationFrame(() => setTimeout(r, 0))); };

const at = (lat, lon, y = 0) => { const [x, z] = project(lat, lon); return new THREE.Vector3(x, y, z); };
// Dev viewpoints for the fly camera: [camera lat, lon, height] -> [target lat, lon, height]
const VIEWS = {
  Digit1: { name: 'Embarcadero from the Bay', cam: [37.7992, -122.3855, 140], look: [37.7915, -122.4005, 40] },
  Digit2: { name: 'Lombard Street', cam: [37.8016, -122.4168, 70], look: [37.8021, -122.4190, 40] },
  Digit3: { name: 'Golden Gate', cam: [37.8045, -122.4655, 120], look: [37.8199, -122.4783, 60] },
  Digit4: { name: 'Alamo Square', cam: [37.7747, -122.4357, 55], look: [37.7790, -122.4180, 40] },
  Digit5: { name: 'Telegraph Hill', cam: [37.7985, -122.4010, 160], look: [37.8024, -122.4058, 70] },
  Digit6: { name: 'Powell Street', cam: [37.7853, -122.4079, 1.8], look: [37.7905, -122.4089, 12], snap: true },
  Digit7: { name: 'Nob Hill down California', cam: [37.7916, -122.4128, 100], look: [37.7930, -122.3960, 60] },
  Digit8: { name: 'Painted Ladies', cam: [37.7764, -122.4340, 1.8], look: [37.7762, -122.4326, 8], snap: true },
  Digit9: { name: 'Chinatown, Grant Ave', cam: [37.7925, -122.4058, 1.8], look: [37.7960, -122.4064, 10], snap: true },
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
  shared.uWorldRect.value.copy(masks.rect);
  scene.add(createTerrain(hf, masks, csm));
  scene.add(createBackdrop(bf, hf));
  scene.add(createWater(map, hf, csm));

  await step(`Raising ${map.buildings.length.toLocaleString('en-US')} buildings`, 48);
  const landmarks = createLandmarks({ hf, map, csm, project });
  scene.add(landmarks.group);
  if (landmarks.suppress.length) {
    map.buildings = map.buildings.filter(b => {
      let cx = 0, cz = 0; for (let i = 0; i < b.p.length; i += 2) { cx += b.p[i]; cz += b.p[i + 1]; }
      cx /= b.p.length / 2; cz /= b.p.length / 2;
      return !landmarks.suppress.some(s => (cx - s.x) ** 2 + (cz - s.z) ** 2 < s.r * s.r);
    });
  }
  scene.add(createBuildings(map, csm));

  await step('Paving the streets', 68);
  scene.add(createRoads(map, hf, csm));

  await step('Lighting the streets', 78);
  scene.add(createFurniture(map, hf, csm, masks.rect));

  await step('Planting trees', 84);
  const trees = createTrees(map, hf, csm);
  scene.add(trees);

  await step('Starting the traffic', 90);
  const graph = buildRoadGraph(map, hf);
  const traffic = createTraffic(map, hf, csm, graph);
  const parked = createParked(map, hf, csm, graph);
  const transit = createTransit(map, hf, csm);
  const people = createPeople(map, hf, csm, graph);
  const critters = createCritters(map, hf, csm);
  scene.add(traffic.group, parked.group, transit.group, people.group, critters.group);

  await step('Saddling up', 94);
  const world = createWorld(map, hf, landmarks.colliders || []);
  const places = buildPlaces(map);
  const input = createInput();
  const player = new Player(world, input);
  scene.add(player.object);
  player.obstacles = (x, z) => {
    const out = [];
    for (const c of traffic.cars) if (Math.abs(c.s.x - x) < 10 && Math.abs(c.s.z - z) < 10) out.push({ x: c.s.x, z: c.s.z, y: c.y, yaw: c.yaw, len: c.len - 0.3, w: 1.8 });
    for (const v of transit.vehicles) if (v !== player.riding && Math.abs(v.x - x) < 14 && Math.abs(v.z - z) < 14) out.push(v);
    for (const s of parked.nearby(x, z, 6)) out.push({ x: s.x, z: s.z, y: s.y, yaw: s.yaw, len: 4.4, w: 1.8 });
    return out;
  };
  const chase = new ChaseCam(camera, world);
  const fly = createFlyCam(camera, renderer.domElement, hf);
  fly.enabled = false;

  const weather = createWeather(scene, sky);
  if (params.get('w')) weather.set(params.get('w'), true);
  const [sx, sz] = project(START.lat, START.lon);
  player.place(sx, sz, START.heading);
  sky.setHour(+params.get('t') || 16.6);

  const hudRoot = $('#hud');
  const hud = createHud(hudRoot, { map, hf, world, places });
  const teleport = (x, z, place) => {
    let tx = x, tz = z, h = player.heading;
    const s = world.nearestStreet(x, z);
    if (s && Math.hypot(s.x - x, s.z - z) < 400) { tx = s.x; tz = s.z; h = s.heading; }
    player.place(tx, tz, h);
    chase.snap = true;
    hud.toast(place ? place.name : (world.streetAt(tx, tz) || 'Teleported'));
  };
  const bigmap = createBigMap(hudRoot, { map, hf, places, onTeleport: teleport });

  let audio = null; // procedural sound, wired in once available
  let mode = 'menu'; // menu | play | fly | tour
  let game = null;   // the running race / mission / tour, if any
  let streets = null, raceStreets = null;
  const getStreets = () => (streets ||= buildStreetGraph(map));
  const getRaceStreets = () => (raceStreets ||= buildStreetGraph(map, { maxK: 7 }));
  const ghud = createGameHud(hudRoot, {
    onAgain: () => { const g = game; endGame(); g && startGame(g.kind, g.def); },
    onNext: () => {
      const g = game; endGame();
      if (!g) return;
      const list = g.kind === 'race' ? RACES : MISSIONS;
      startGame(g.kind, list[(list.indexOf(g.def) + 1) % list.length]);
    },
    onMenu: () => { endGame(); setMode('menu'); },
  });
  function endGame() {
    if (game?.obj?.dispose) game.obj.dispose();
    game = null; ghud.clear(); player.frozen = false;
  }
  function startGame(kind, def) {
    endGame();
    if (kind === 'race') {
      const track = buildRaceTrack(def, getRaceStreets());
      if (!track) { hud.toast('Could not plan that route'); return; }
      game = { kind, def, obj: new Race({ def, track, scene, world, player, hud, audio }) };
      setMode('play');
    } else if (kind === 'mission') {
      game = { kind, def, obj: new Mission({ def, scene, world, player, streets: getStreets(), hud, audio, csm }) };
      setMode('play');
    } else if (kind === 'tour') {
      game = { kind, def, obj: new Tour({ camera, hf, sky, weather, interactive: def === 'interactive' }) };
      ghud.onTour(() => game?.obj.next(), () => { endGame(); setMode('menu'); });
      setMode('tour');
    }
    chase.snap = true;
  }
  const menu = createMenu(hudRoot, {
    onStart: st => {
      if (st.mode === 'race') startGame('race', RACES.find(r => r.id === st.race));
      else if (st.mode === 'missions') startGame('mission', MISSIONS.find(m => m.id === st.mission));
      else if (st.mode === 'tour') startGame('tour', st.tour);
      else { endGame(); setMode('play'); }
    },
    onMount: id => player.avatar.setMount(id),
    onColor: c => player.avatar.setColor(c),
  });
  // dev overlay (N toggles, ?dev shows it from the start)
  hudRoot.insertAdjacentHTML('beforeend', `<div class="panel dev-stats" id="stats" style="display:none"></div>`);
  const stats = $('#stats');
  if (params.has('dev')) stats.style.display = '';

  function setMode(m) {
    mode = m;
    if (m === 'menu') { menu.open(); hud.show(false); bigmap.close(); }
    if (m === 'play') { menu.close(); hud.show(true); chase.snap = true; renderer.domElement.focus(); }
    if (m === 'fly') { menu.close(); hud.show(false); fly.set(camera.position.clone(), chase.look.clone()); }
    if (m === 'tour') { menu.close(); hud.show(false); bigmap.close(); }
    fly.enabled = m === 'fly';
    input.enabled = m === 'play';
    if (m !== 'play') for (const k of ['up', 'down', 'left', 'right']) input[k] = false;
  }
  setMode(params.has('play') ? 'play' : 'menu');
  // deep links from the website: ?goto=<sight id>, ?street=<name>, ?place=<name>, ?tour, ?race=<id>, ?mission=<id>
  {
    const sight = params.get('goto') && SIGHTS.find(s => s.id === params.get('goto'));
    const named = params.get('street') || params.get('place');
    if (sight) { const [x, z] = project(sight.lat, sight.lon); setMode('play'); teleport(x, z, { name: sight.name }); }
    else if (params.get('x') && params.get('z')) { setMode('play'); teleport(+params.get('x'), +params.get('z'), named ? { name: named } : null); }
    else if (named) {
      const p = places.find(q => q.name.toLowerCase() === named.toLowerCase()) || places.find(q => q.name.toLowerCase().includes(named.toLowerCase()));
      if (p) { setMode('play'); teleport(p.x, p.z, p); }
    }
    if (params.has('tour')) startGame('tour', params.get('tour') === 'interactive' ? 'interactive' : 'auto');
    if (params.get('race')) { const r = RACES.find(x => x.id === params.get('race')); if (r) startGame('race', r); }
    if (params.get('mission')) { const m = MISSIONS.find(x => x.id === params.get('mission')); if (m) startGame('mission', m); }
  }

  addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    if (e.code === 'Enter' && mode === 'menu') menu.start();
    else if (e.code === 'Escape') {
      if (bigmap.isOpen) bigmap.close();
      else if (game) { endGame(); setMode('menu'); }
      else setMode(mode === 'menu' ? 'play' : 'menu');
    }
    else if (e.code === 'KeyM' && mode === 'play') { if (game) hud.toast(game.kind === 'mission' ? 'No map during a mission — follow the arrow' : 'No map during a race'); else bigmap.toggle(player); }
    else if (e.code === 'KeyF' && mode === 'play' && game?.kind === 'race') input.itemPressed = true;
    else if (e.code === 'KeyC' && mode === 'play') {
      const i = MOUNTS.findIndex(m => m.id === player.mount);
      const next = MOUNTS[(i + 1) % MOUNTS.length];
      player.avatar.setMount(next.id); menu.syncMount(next.id); hud.toast(next.name);
    }
    else if (e.code === 'KeyE' && mode === 'play') {
      if (player.riding) {
        const v = player.riding, sy = Math.sin(v.yaw), cy = Math.cos(v.yaw);
        player.riding = null;
        player.place(v.x + cy * (v.w / 2 + 1.6), v.z - sy * (v.w / 2 + 1.6), v.yaw);
      } else {
        const near = transit.nearest(player.pos.x, player.pos.z, 7, 'cablecar');
        if (near) { player.riding = near; hud.toast(`All aboard the ${near.name} line`); audio?.bell(); }
      }
    }
    else if (e.code === 'KeyV') setMode(mode === 'fly' ? 'play' : 'fly');
    else if (e.code === 'KeyN') stats.style.display = stats.style.display ? '' : 'none';
    else if (e.code === 'BracketRight') sky.setHour(sky.state.hour + 0.25);
    else if (e.code === 'BracketLeft') sky.setHour(sky.state.hour - 0.25);
    else if (e.code === 'KeyR' && !game) hud.toast('Weather: ' + weather.cycle());
    else if ((e.code === 'Space' || e.code === 'ArrowRight' || e.code === 'Enter') && mode === 'tour' && game?.obj.interactive) game.obj.next();
    else if (mode === 'fly' && VIEWS[e.code]) {
      const v = VIEWS[e.code];
      const c = at(v.cam[0], v.cam[1]);
      if (v.snap) { const s = world.nearestStreet(c.x, c.z); if (s) { c.x = s.x; c.z = s.z; } }
      c.y = hf.at(c.x, c.z) + v.cam[2];
      const l = at(v.look[0], v.look[1]); l.y = hf.at(l.x, l.z) + v.look[2];
      fly.set(c, l);
    }
  });
  hudRoot.addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    if (b.dataset.act === 'menu') setMode('menu');
    if (b.dataset.act === 'map') bigmap.toggle(player);
  });
  // drag to orbit the chase camera
  {
    let drag = null;
    renderer.domElement.addEventListener('pointerdown', e => { if (mode === 'play') drag = { x: e.clientX, y: e.clientY }; });
    addEventListener('pointerup', () => (drag = null));
    addEventListener('pointermove', e => {
      if (!drag) return;
      chase.yawOffset -= (e.clientX - drag.x) * 0.006; chase.pitchOffset += (e.clientY - drag.y) * 0.004;
      chase.pitchOffset = Math.max(-0.4, Math.min(1.5, chase.pitchOffset));
      drag = { x: e.clientX, y: e.clientY };
    });
  }

  const clock = new THREE.Timer();
  renderer.info.autoReset = false;
  let frames = 0, acc = 0, lastFov = camera.fov, menuOrbit = 0;
  window.__sf = { startGame, endGame, get game() { return game; }, fly, people, critters, transit, traffic, parked, weather, landmarks, scene, camera, sky, hf, map, renderer, csm, R, player, world, places, setMode, teleport, input,
    go: (lat, lon, heading) => { const [x, z] = project(lat, lon); player.place(x, z, heading ?? player.heading); chase.snap = true; } };

  function frame() {
    requestAnimationFrame(frame);
    clock.update();
    const dt = Math.min(0.05, clock.getDelta());
    renderer.info.reset();
    shared.uTime.value += dt;

    if (mode === 'play' && !bigmap.isOpen) {
      if (player.riding) {
        const v = player.riding, sy = Math.sin(v.yaw), cy = Math.cos(v.yaw), side = v.w / 2 + 0.3, along = v.len / 2 - 1.6;
        player.pos.set(v.x + sy * along + cy * side, v.y + 0.3, v.z + cy * along - sy * side);
        player.heading = v.yaw; player.speed = v.v; player.pitch = v.pitch;
        player.avatar.animate(dt, 0, 0, false, 0); player.sync();
        hud.hint(`Riding the ${v.name} line · <kbd>E</kbd> hop off`);
      } else {
        player.update(dt);
        const near = transit.nearest(player.pos.x, player.pos.z, 7, 'cablecar');
        hud.hint(near && Math.abs(player.speed) < 7 ? `<kbd>E</kbd> hop on the ${near.name} cable car` : '');
      }
      chase.update(dt, player); hud.update(dt, player);
      if (game?.kind === 'race') {
        const r = game.obj; r.update(dt, input); ghud.race(r);
        if (r.state === 'finished' && !game.shown) { game.shown = true; setTimeout(() => game?.obj === r && ghud.raceResult(r), 1200); }
      } else if (game?.kind === 'mission') {
        const m = game.obj; m.update(dt); ghud.mission(m);
        if (m.state !== 'running' && !game.shown) { game.shown = true; setTimeout(() => game?.obj === m && ghud.missionResult(m, m.ok), 900); }
      }
    }
    else if (mode === 'tour' && game?.kind === 'tour') {
      const t = game.obj; t.update(dt); ghud.tour(t.stop, t.interactive);
      if (t.done) { endGame(); setMode('menu'); }
    }
    else if (mode === 'menu') {
      // a slow cinematic orbit around the rider
      player.update(dt);
      menuOrbit += dt * 0.12;
      const p = player.pos, r = 7.5;
      camera.position.set(p.x + Math.sin(menuOrbit) * r, p.y + 2.6, p.z + Math.cos(menuOrbit) * r);
      camera.lookAt(p.x - Math.cos(menuOrbit) * 1.8, p.y + 1.2, p.z + Math.sin(menuOrbit) * 1.8);
    } else if (mode === 'fly') fly.update(dt);
    if (Math.abs(camera.fov - lastFov) > 0.8) { lastFov = camera.fov; csm.updateFrustums(); }

    weather.update(dt, camera);
    traffic.update(dt, mode === 'play' ? player.pos : camera.position, mode === 'play' ? player : null);
    transit.update(dt);
    people.update(dt, mode === 'play' ? player.pos : camera.position, mode === 'play' ? player : null);
    critters.update(dt);
    parked.update(camera.position);
    sky.follow(camera);
    trees.userData.update(camera.position);
    landmarks.update(dt, camera);
    csm.lightDirection.copy(shared.uSunDir.value).negate();
    for (const l of csm.lights) { l.color.copy(sky.state.sunColor); l.intensity = sky.state.sunIntensity; }
    csm.update();
    composer.render(dt);

    frames++; acc += dt;
    if (acc > 0.5 && stats.style.display === '') {
      const fps = frames / acc; frames = 0; acc = 0;
      const { lat, lon } = unproject(camera.position.x, camera.position.z);
      const info = renderer.info.render;
      const h = sky.state.hour, hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
      stats.innerHTML = `<b>${fps.toFixed(0)} fps</b> · ${(info.triangles / 1e6).toFixed(2)}M tris · ${info.calls} calls<br>
        ${lat.toFixed(5)}, ${lon.toFixed(5)} · ${camera.position.y.toFixed(0)} m · ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} · ${mode}`;
    } else if (acc > 0.5) { frames = 0; acc = 0; }
  }
  await step('Ready', 100);
  $('#loader').classList.add('done');
  frame();
}

boot().catch(err => {
  console.error(err);
  $('#loader-step').textContent = 'Something went wrong: ' + err.message;
});
