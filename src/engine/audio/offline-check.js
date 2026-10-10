// Dev-only: renders every one-shot and a set of continuous-layer scenarios through an
// OfflineAudioContext (the full mix bus incl. compressor + soft clip) and reports peak / RMS levels,
// NaN/Inf samples and leaked voices. Used by audio-test.html and tools/audio-check.mjs.
// Not imported by the game.
import { createAudioEngine } from '../audio.js';
import { reseed } from './dsp.js';
export { K } from './engine.js'; // layer calibration table (tweakable from tests)

const SR = 48000;
const db = x => (x > 0 ? 20 * Math.log10(x) : -Infinity);
const BASE = { speed: 0, mount: 'walk', air: false, surface: 'ground', height: 5, grade: 0, fog: 0, night: 0, wet: 0, nearWater: 0, traffic: 0, braking: false };

const TAIL = 14; // silent tail rendered after the measured window so every voice can finish before we count leaks

export async function render(seconds, { state, shot, music = false, measureFrom = 0, stateAt } = {}) {
  const ctx = new OfflineAudioContext(2, Math.ceil(SR * (seconds + TAIL)), SR);
  reseed(1234);
  const eng = createAudioEngine(ctx);
  const dt = 1 / 60;
  const st = { ...BASE, ...(state || {}) };
  eng.update(dt, st);
  if (music) eng.setMusic(true);
  if (state || music) { // drive update() at 60 Hz of audio time
    for (let i = 1; i * dt < seconds - 0.02; i++) {
      const t = i * dt;
      ctx.suspend(t).then(() => { eng.update(dt, stateAt ? { ...st, ...stateAt(t) } : st); ctx.resume(); });
    }
    // then stop everything: music off, player idle, no ambience -> no new voices during the tail
    ctx.suspend(Math.ceil(seconds * 60) / 60).then(() => { eng.setMusic(false); eng.update(dt, { ...BASE, height: 0 }); ctx.resume(); });
  }
  if (shot) shot(eng);
  const buf = await ctx.startRendering();
  await new Promise(r => setTimeout(r, 50)); // let pending 'ended' events fire
  const a = buf.getChannelData(0), b = buf.getChannelData(1);
  const i0 = Math.floor(measureFrom * SR), i1 = Math.floor(seconds * SR);
  let peak = 0, sum = 0, bad = 0, over = 0, win = 0, winMax = 0;
  const W = Math.floor(0.1 * SR), ring = new Float64Array(W);
  for (let i = 0; i < i1; i++) {
    const x = a[i], y = b[i];
    if (!Number.isFinite(x) || !Number.isFinite(y)) { bad++; continue; }
    const p = Math.max(Math.abs(x), Math.abs(y));
    const e = (x * x + y * y) / 2;
    win += e - ring[i % W]; ring[i % W] = e;
    if (i >= i0) {
      if (p > peak) peak = p;
      if (p > 0.7) over++;
      sum += e;
      if (win > winMax) winMax = win;
    }
  }
  for (let i = i1; i < a.length; i++) if (!Number.isFinite(a[i]) || !Number.isFinite(b[i])) bad++;
  const n = Math.max(1, i1 - i0);
  return {
    peakDb: db(peak), rmsDb: db(Math.sqrt(sum / n)), maxRms100Db: db(Math.sqrt(Math.max(0, winMax) / W)),
    nan: bad, softClipped: over, voicesLeft: eng.debug().voices, fired: eng.debug().fired,
  };
}

export const SHOTS = [
  ['ui', 1, e => e.ui()],
  ['pickup', 2, e => e.pickup()],
  ['countdown(3)', 1, e => e.countdown(3)],
  ['countdown(0)=GO', 1.5, e => e.countdown(0)],
  ['finish', 3, e => e.finish()],
  ['fail', 2, e => e.fail()],
  ['bell', 3, e => e.bell()],
  ['horn', 2, e => e.horn()],
  ['bark', 3, e => e.bark()],
  ['foghorn', 9, e => e.foghorn()],
  ['jump walk', 1, e => e.jump()],
  ['jump skate', 1, e => e.jump(), { mount: 'skate' }],
  ['jump bike', 1, e => e.jump(), { mount: 'bike' }],
  ['jump water', 1.5, e => e.jump(), { surface: 'water', mount: 'sealion' }],
  ['land(1) walk', 1, e => e.land(1)],
  ['land(1) skate', 1, e => e.land(1), { mount: 'skate' }],
  ['land(1) bike', 1, e => e.land(1), { mount: 'bike' }],
  ['land(1) sealion', 1, e => e.land(1), { mount: 'sealion' }],
  ['land(1) pier', 1, e => e.land(1), { surface: 'pier' }],
  ['land(1) water', 1.5, e => e.land(1), { surface: 'water' }],
  ['land(0.2) skate', 1, e => e.land(0.2), { mount: 'skate' }],
  ['bump(1) bike', 1, e => e.bump(1), { mount: 'bike' }],
  ['bump(0.4) skate', 1, e => e.bump(0.4), { mount: 'skate' }],
  ['amb: birds', 2, e => e._amb.birds(1)],
  ['amb: gulls', 3, e => e._amb.gulls(1)],
  ['amb: siren', 11, e => e._amb.siren(1)],
  ['amb: grunt', 1, e => e._amb.grunt(1)],
  ['amb: foghorn far', 9, e => e._amb.foghornFar()],
  ['amb: horn far', 2, e => e._amb.hornFar()],
  ['amb: bark far', 3, e => e._amb.barkFar()],
  ['garbage args land(NaN) bump("x") countdown()', 1.5, e => { e.land(NaN); e.bump('x'); e.countdown(); }],
];

export const SCENES = [
  ['idle (no inputs)', {}],
  ['city day, standing (traffic .6)', { traffic: 0.6 }],
  ['walk 1.4 m/s ground', { mount: 'walk', speed: 1.4, traffic: 0.3 }],
  ['walk 1.4 m/s pier, near water', { mount: 'walk', speed: 1.4, surface: 'pier', nearWater: 0.8 }],
  ['run 4 m/s wet .6', { mount: 'walk', speed: 4, wet: 0.6 }],
  ['bike 8 m/s pedalling', { mount: 'bike', speed: 8, pedal: true }],
  ['bike 8 m/s coasting (inferred)', { mount: 'bike', speed: 8, grade: -0.04 }],
  ['bike 8 m/s braking', { mount: 'bike', speed: 8, braking: true }],
  ['bike 13 m/s downhill', { mount: 'bike', speed: 13, grade: -0.1 }],
  ['skate 5 m/s sidewalk', { mount: 'skate', speed: 5 }],
  ['skate 5 m/s pier', { mount: 'skate', speed: 5, surface: 'pier', nearWater: 0.8 }],
  ['sealion 2 m/s land', { mount: 'sealion', speed: 2, nearWater: 0.8 }],
  ['sealion swim 3 m/s', { mount: 'sealion', speed: 3, surface: 'water', nearWater: 1 }],
  ['walk idle in water', { mount: 'walk', speed: 0, surface: 'water', nearWater: 1 }],
  ['Golden Gate deck 67 m, bike 10, fog .8', { mount: 'bike', speed: 10, surface: 'deck', height: 67, fog: 0.8, nearWater: 0.5, traffic: 0.5, pedal: true }],
  ['bay shore night', { nearWater: 1, night: 1, traffic: 0.2 }],
  ['rain downtown', { wet: 1, traffic: 0.7 }],
  ['night crickets, quiet', { night: 1 }],
  ['airborne skate 8 m/s', { mount: 'skate', speed: 8, air: true }],
  ['garbage inputs (NaN/Infinity/strings)', { speed: NaN, mount: 'car', surface: 42, height: Infinity, grade: NaN, fog: -3, night: 'x', wet: 7, nearWater: null, traffic: undefined, braking: 'yes' }],
];

export async function runOfflineReport(log = () => {}) {
  const rows = [];
  for (const [name, dur, fn, state] of SHOTS) {
    const r = await render(dur, { shot: fn, state: state ? { ...state, speed: 0 } : undefined });
    rows.push({ kind: 'shot', name, ...r }); log(name);
  }
  for (const [name, state] of SCENES) {
    const r = await render(7, { state, measureFrom: 1.5 });
    rows.push({ kind: 'layer', name, ...r }); log(name);
  }
  rows.push({ kind: 'layer', name: 'music bed (14 s)', ...(await render(14, { music: true, measureFrom: 3 })) });
  // worst case: everything maxed + every one-shot at once + music
  rows.push({
    kind: 'stress', name: 'EVERYTHING at once',
    ...(await render(6, {
      music: true, measureFrom: 0.5,
      state: { mount: 'bike', speed: 14, surface: 'deck', height: 70, fog: 1, night: 0.5, wet: 1, nearWater: 1, traffic: 1, braking: true, grade: -0.1 },
      shot: e => { for (const [, , fn] of SHOTS) fn(e); },
    })),
  });
  // continuous mount/surface switching sweep (checks for clicks/NaN from rapid automation)
  const mounts = ['bike', 'walk', 'skate', 'sealion'], surfs = ['ground', 'deck', 'pier', 'water'];
  rows.push({
    kind: 'stress', name: 'sweep all inputs 10 s',
    ...(await render(10, {
      state: {}, measureFrom: 0.5,
      stateAt: t => ({
        speed: 7 + 7 * Math.sin(t * 1.3), mount: mounts[Math.floor(t / 0.7) % 4], surface: surfs[Math.floor(t / 1.1) % 4],
        air: Math.sin(t * 3) > 0.8, height: 35 + 35 * Math.sin(t * 0.5), grade: 0.1 * Math.sin(t), fog: 0.5 + 0.5 * Math.sin(t * 0.7),
        night: 0.5 + 0.5 * Math.sin(t * 0.3), wet: 0.5 + 0.5 * Math.sin(t * 0.9), nearWater: 0.5 + 0.5 * Math.sin(t * 1.1),
        traffic: 0.5 + 0.5 * Math.sin(t * 0.4), braking: Math.sin(t * 2) > 0.5,
      }),
    })),
  });
  // long run: do the sparse random events (birds, gulls, horns, sirens, barks, auto-foghorn) actually fire?
  const long = await render(120, { state: { fog: 0.9, traffic: 0.8, nearWater: 1, night: 0.2 }, measureFrom: 1 });
  rows.push({ kind: 'events', name: '120 s fog .9/traffic .8/bay: ' + Object.entries(long.fired).filter(([k]) => k !== 'grunt').map(([k, v]) => `${k} ${v}`).join(' '), ...long });
  return rows;
}

export function formatReport(rows) {
  const f = x => (Number.isFinite(x) ? x.toFixed(1).padStart(6) : '  -inf');
  const lines = ['kind   | sound / scene                              |  peak |   RMS | max100ms | NaN | >0.7 | voices'];
  for (const r of rows) {
    lines.push(`${r.kind.padEnd(6)} | ${r.name.padEnd(42)} | ${f(r.peakDb)} | ${f(r.rmsDb)} | ${f(r.maxRms100Db)}   | ${String(r.nan).padStart(3)} | ${String(r.softClipped).padStart(4)} | ${r.voicesLeft}`);
  }
  return lines.join('\n');
}
