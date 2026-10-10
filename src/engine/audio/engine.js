// The audio engine proper. Builds the whole graph on any BaseAudioContext (real-time or offline), so
// the same code can be rendered through an OfflineAudioContext for level checks.
//
// Graph:  layers / one-shots -> {sfx, movement, ambience, music} buses -> master -> compressor
//         -> soft-clip waveshaper -> destination.   Reverb: send gain -> convolver(procedural IR) -> master.
//
// Continuous layers are persistent nodes whose gains/frequencies are glided every frame. Rhythmic
// textures (freewheel ticks, footsteps, board knocks, joint clacks, flipper slaps, swim strokes) are
// persistent noise sources through a "gate" gain whose envelope is pulsed with automation events
// scheduled a little ahead of time - so even 60 ticks/s never creates a node.
import {
  clamp, fin, glide, makeCricketLoop, makeDropLoop, makeGritLoop, makeImpulse, makeNoise,
  makeSoftClipCurve, rand, rr, smoothstep,
} from './dsp.js';
import { createSfx } from './sfx.js';
import { createMusic } from './music.js';

const MOUNTS = new Set(['bike', 'walk', 'skate', 'sealion']);
const SURFACES = new Set(['ground', 'deck', 'pier', 'water']);
const LOOK = 0.12; // seconds of look-ahead for pulse scheduling

// Internal calibration of each continuous layer (raw gain at "full" drive). Tuned with the offline
// level check (tools/audio-check.mjs) - change the user-facing bus levels in ../audio.js instead.
export const K = {
  wind: 0.45, howl: 0.5, fogWind: 0.9,
  tyre: 1.0, whine: 0.5, spray: 0.9, brake: 0.9, grit: 0.55, rumble: 0.6,
  tick: 2.2, clack: 1.3, thump: 0.3, plank: 1.6, steps: 0.4, slap: 0.7, swim: 0.6, wake: 0.4,
  traffic: 0.4, wash: 0.15, surf: 0.5, lap: 1.6, foam: 0.35,
  rainHiss: 0.1, rainBody: 0.18, drops: 0.35, crickets: 0.07,
};

export function buildEngine(ctx, L, V, opts = {}) {
  const dest = opts.destination || ctx.destination;

  // ---------------- tiny graph helpers ----------------
  const G = (v = 0) => { const g = ctx.createGain(); g.gain.value = v; return g; };
  const F = (type, f, Q = 0.707, gainDb = 0) => {
    const b = ctx.createBiquadFilter();
    b.type = type; b.frequency.value = f; b.Q.value = Q; b.gain.value = gainDb;
    return b;
  };
  const loop = (buf, rate = 1) => {
    const s = ctx.createBufferSource();
    s.buffer = buf; s.loop = true; s.playbackRate.value = rate;
    s.start(ctx.currentTime, rand() * buf.duration * 0.9);
    return s;
  };
  const chain = (...n) => { for (let i = 0; i < n.length - 1; i++) n[i].connect(n[i + 1]); return n[n.length - 1]; };
  function makeGate() {
    const g = G(0);
    let last = -1;
    return {
      node: g,
      /** envelope pulse: smooth (click-free) attack to amp, exponential decay */
      hit(t, amp, att = 0.002, tau = 0.02) {
        if (!(amp > 0) || !Number.isFinite(t)) return;
        if (t < last + att) t = last + att; // keep events ordered
        last = t;
        g.gain.setTargetAtTime(clamp(amp, 0, 4), t, att / 3);
        g.gain.setTargetAtTime(0, t + att, tau);
      },
    };
  }
  /** schedule rhythmic events at `rate`/s a little ahead of time; fn(t) may return an interval multiplier */
  function runRhythm(r, now, rate, fn) {
    if (!(rate > 0.05)) { r.next = now + 0.05; return; }
    const iv = 1 / rate;
    if (r.next < now - 0.05) r.next = now + 0.01; // fell behind (stall / resume)
    if (r.next > now + iv + LOOK) r.next = now + iv; // rate went up a lot
    for (let guard = 0; r.next < now + LOOK && guard < 24; guard++) {
      const k = fn(r.next);
      r.next += iv * (k > 0 ? k : 1);
    }
  }

  // ---------------- mix bus ----------------
  const master = G(L.master);
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18; comp.knee.value = 12; comp.ratio.value = 3;
  comp.attack.value = 0.01; comp.release.value = 0.25;
  const clip = ctx.createWaveShaper();
  clip.curve = makeSoftClipCurve(); clip.oversample = 'none';
  chain(master, comp, clip, dest);
  const sfxBus = G(L.sfx), moveBus = G(L.movement), ambBus = G(L.ambience), musicBus = G(0);
  for (const b of [sfxBus, moveBus, ambBus, musicBus]) b.connect(master);
  const verbIn = G(1), verb = ctx.createConvolver(), verbOut = G(L.reverb);
  verb.buffer = makeImpulse(ctx);
  chain(verbIn, verb, verbOut, master);
  // per-bus reverb sends, so bus levels (and music on/off) also scale each bus's wet signal
  const sfxVerb = G(L.sfx), moveVerb = G(L.movement), ambVerb = G(L.ambience), musicVerb = G(0);
  for (const b of [sfxVerb, moveVerb, ambVerb, musicVerb]) b.connect(verbIn);

  // ---------------- shared buffers ----------------
  const whiteSt = makeNoise(ctx, 'white', 4, 2), pinkSt = makeNoise(ctx, 'pink', 4, 2), brownSt = makeNoise(ctx, 'brown', 5, 2);
  const whiteM = makeNoise(ctx, 'white', 3, 1), pinkM = makeNoise(ctx, 'pink', 3, 1);

  // ---------------- wind ----------------
  const wind = { bp: F('bandpass', 400, 0.6), g: G(0) };
  chain(loop(pinkSt), wind.bp, wind.g, ambBus);
  const howlSrc = loop(whiteSt), howl = { a: F('bandpass', 600, 9), b: F('bandpass', 960, 12), bg: G(0.6), g: G(0) };
  chain(howlSrc, howl.a, howl.g); chain(howlSrc, howl.b, howl.bg, howl.g); howl.g.connect(ambBus);
  const fogWind = { lp: F('lowpass', 160, 0.7), g: G(0) };
  chain(loop(brownSt), fogWind.lp, fogWind.g, ambBus);

  // ---------------- movement (player) layers ----------------
  const wM = loop(whiteM), pM = loop(pinkM);
  const tyre = { bp: F('bandpass', 200, 1.3), g: G(0) }; chain(pM, tyre.bp, tyre.g, moveBus);
  const whine = { bp: F('bandpass', 1500, 5), g: G(0) }; chain(wM, whine.bp, whine.g, moveBus);
  const spray = { bp: F('bandpass', 3500, 0.6), g: G(0) }; chain(wM, spray.bp, spray.g, moveBus);
  const brake = { bp: F('bandpass', 2800, 2.5), g: G(0) }; chain(wM, brake.bp, brake.g, moveBus);
  const gritSrc = loop(makeGritLoop(ctx));
  const grit = { hp: F('highpass', 90), lp: F('lowpass', 600, 0.8), g: G(0) }; chain(gritSrc, grit.hp, grit.lp, grit.g, moveBus);
  const rumble = { lp: F('lowpass', 130, 0.9), g: G(0) }; chain(pM, rumble.lp, rumble.g, moveBus);

  const tick = makeGate(), tickG = G(0); chain(wM, tick.node, F('highpass', 1800), F('bandpass', 3400, 3), tickG, moveBus);
  const clack = makeGate(), clackBP = F('bandpass', 1500, 1.5), clackG = G(0); chain(wM, clack.node, clackBP, clackG, moveBus);
  const thumpOsc = ctx.createOscillator(); thumpOsc.frequency.value = 90; thumpOsc.start();
  const thump = makeGate(), thumpG = G(0); chain(thumpOsc, thump.node, thumpG, moveBus);
  const plank = makeGate(), plankBP = F('bandpass', 260, 8), plankG = G(0); chain(wM, plank.node, plankBP, F('lowpass', 1400), plankG, moveBus);

  const step = makeGate(), stepLP = F('lowpass', 1100, 0.8), stepsOut = G(0);
  const stepSolid = G(1), stepHollow = G(0), stepWet = G(0);
  pM.connect(step.node);
  chain(step.node, stepLP, stepSolid, stepsOut);
  chain(step.node, F('bandpass', 190, 12), G(4), stepHollow, stepsOut);
  chain(step.node, F('highpass', 3000), G(1.5), stepWet, stepsOut);
  stepsOut.connect(moveBus);

  const slap = makeGate(), slapBP = F('bandpass', 1400, 0.9), slapG = G(0); chain(wM, slap.node, slapBP, slapG, moveBus);

  const swimG = G(0); swimG.connect(moveBus);
  const swoosh = makeGate(), swooshBP = F('bandpass', 600, 0.7); chain(pM, swoosh.node, swooshBP, swimG);
  const splash = makeGate(); chain(wM, splash.node, F('bandpass', 2200, 0.8), swimG);
  const wake = { lp: F('lowpass', 500, 0.7), g: G(0) }; chain(pM, wake.lp, wake.g, moveBus);

  // ---------------- city & nature ambience ----------------
  const traffic = { lp: F('lowpass', 220, 0.5), g: G(0) }; chain(loop(brownSt), traffic.lp, traffic.g, ambBus);
  chain(traffic.g, G(0.15), ambVerb);
  const wash = { bp: F('bandpass', 800, 0.5), g: G(0) }; chain(loop(pinkSt), wash.bp, wash.g, ambBus);
  chain(wash.g, G(0.3), ambVerb);
  const surf = { lp: F('lowpass', 900, 0.6), g: G(0) }; chain(loop(pinkSt), surf.lp, surf.g, ambBus);
  const lap = { bp: F('bandpass', 450, 1.5), g: G(0) }; chain(loop(whiteSt), lap.bp, lap.g, ambBus);
  const foam = { hp: F('highpass', 2500), g: G(0) }; chain(loop(whiteSt), foam.hp, F('lowpass', 9000), foam.g, ambBus);
  const rainHiss = G(0); chain(loop(whiteSt), F('highpass', 900), F('lowpass', 7500), rainHiss, ambBus);
  const rainBody = G(0); chain(loop(pinkSt), F('lowpass', 1200), rainBody, ambBus);
  const drops = G(0); chain(loop(makeDropLoop(ctx)), drops, ambBus);
  const crickets = G(0); chain(loop(makeCricketLoop(ctx)), crickets, ambBus);
  chain(crickets, G(0.4), ambVerb);

  // ---------------- one-shots & music ----------------
  const verbFor = new Map([[sfxBus, sfxVerb], [ambBus, ambVerb], [moveBus, moveVerb]]);
  const sfx = createSfx(ctx, { sfx: sfxBus, amb: ambBus, move: moveBus, verbFor, white: whiteM, pink: pinkM }, V);
  const music = createMusic(ctx, musicBus, musicVerb);

  // ---------------- state ----------------
  const st = { mount: 'walk', surface: 'ground', speed: 0, air: false };
  const ph = Array.from({ length: 12 }, () => rr(0, Math.PI * 2));
  const rh = { tick: { next: 0 }, clack: { next: 0 }, plank: { next: 0 }, step: { next: 0 }, slap: { next: 0 }, swim: { next: 0 } };
  const timers = { bird: rr(2, 6), gull: rr(3, 9), horn: rr(10, 30), siren: rr(40, 100), fog: rr(6, 10), grunt: rr(2, 5), bark: rr(30, 70) };
  let prevSpeed = 0, accS = 0, coastOn = 0, coastOff = 0, coasting = false, muted = false;

  const gustAt = t => clamp(0.5 + 0.28 * Math.sin(t * 0.21 + ph[0]) + 0.17 * Math.sin(t * 0.53 + ph[1]) + 0.08 * Math.sin(t * 1.37 + ph[2]), 0, 1);
  const waveAt = t => {
    const a = 0.5 + 0.5 * Math.sin(t * 2 * Math.PI / 8.3 + ph[3]), b = 0.5 + 0.5 * Math.sin(t * 2 * Math.PI / 11.9 + ph[4]);
    return 0.18 + 0.82 * (0.6 * a * a * a + 0.4 * b * b * b);
  };

  function update(dt, s) {
    s = s || {};
    dt = fin(dt, 0, 0.1, 1 / 60);
    const t = ctx.currentTime;
    const speedS = fin(s.speed, -100, 100, 0), speed = Math.abs(speedS);
    const mount = MOUNTS.has(s.mount) ? s.mount : 'walk';
    const surface = SURFACES.has(s.surface) ? s.surface : 'ground';
    const air = !!s.air, braking = !!s.braking;
    const height = fin(s.height, -50, 2000, 0), grade = fin(s.grade, -5, 5, 0);
    const fog = fin(s.fog, 0, 1, 0), night = fin(s.night, 0, 1, 0), wet = fin(s.wet, 0, 1, 0);
    const nearWater = fin(s.nearWater, 0, 1, 0), trafficAmt0 = fin(s.traffic, 0, 1, 0);
    st.mount = mount; st.surface = surface; st.speed = speed; st.air = air;

    const day = 1 - night, water = surface === 'water', grounded = !air && !water, moving = speed > 0.15;
    const sN = clamp(speed / 14, 0, 1.3), hN = smoothstep(8, 70, height), roll = clamp(speed / 10, 0, 1.4);
    const gust = gustAt(t);
    if (dt > 0) accS += (clamp((speedS - prevSpeed) / dt, -30, 30) - accS) * Math.min(1, dt * 5);
    prevSpeed = speedS;

    // ---- wind: speed rush + altitude howl + damp fog wind
    glide(wind.g.gain, K.wind * (0.06 + 0.5 * Math.pow(sN, 1.6) * (0.8 + 0.4 * gust) + 0.45 * hN * (0.4 + 0.8 * gust) + 0.06 * fog), t, 0.25);
    glide(wind.bp.frequency, 250 + 650 * sN + 450 * hN * gust, t, 0.3);
    glide(howl.g.gain, K.howl * Math.pow(hN, 1.5) * (0.3 + 0.7 * gust), t, 0.4);
    glide(howl.a.frequency, 430 + 380 * gust + 150 * Math.min(sN, 1), t, 0.5);
    glide(howl.b.frequency, (430 + 380 * gust) * 1.6, t, 0.5);
    glide(fogWind.g.gain, K.fogWind * fog * (0.4 + 0.6 * gust), t, 0.5);

    // ---- rolling: bike / skate continuous parts
    const bike = mount === 'bike' && grounded, skate = mount === 'skate' && grounded;
    const onWheels = (bike || skate) && moving;
    const tyreA = bike && moving ? Math.pow(roll, 1.2) * (surface === 'pier' ? 0.6 : 1) * (1 + 0.3 * wet) : 0;
    glide(tyre.g.gain, K.tyre * tyreA, t, 0.06);
    glide(tyre.bp.frequency, 90 + speed * 24, t, 0.08);
    glide(whine.g.gain, K.whine * tyreA * (surface === 'deck' ? 1.4 : 1), t, 0.06);
    glide(whine.bp.frequency, 700 + speed * 85, t, 0.08);
    glide(spray.g.gain, onWheels ? K.spray * wet * roll : 0, t, 0.1);
    const gritA = skate && moving ? Math.pow(roll, 0.9) * (surface === 'deck' ? 0.7 : surface === 'pier' ? 0.8 : 1) : 0;
    glide(grit.g.gain, K.grit * gritA, t, 0.06);
    glide(gritSrc.playbackRate, clamp(0.45 + speed * 0.11, 0.3, 2.5), t, 0.1);
    glide(grit.lp.frequency, 350 + speed * 110, t, 0.1);
    glide(rumble.g.gain, skate && moving ? K.rumble * roll * (surface === 'pier' ? 1.2 : 1) : 0, t, 0.06);
    const brakeA = braking && onWheels ? clamp(speed / 6, 0, 1) : 0;
    glide(brake.g.gain, K.brake * brakeA * (skate ? 0.5 : 0.35), t, 0.05);
    glide(brake.bp.frequency, skate ? 900 : 2800, t, 0.05);
    glide(brake.bp.Q, skate ? 0.7 : 2.5, t, 0.05);

    // ---- freewheel ratchet when coasting (explicit s.pedal / s.throttle wins over inference)
    const pedal = typeof s.pedal === 'boolean' ? s.pedal : typeof s.throttle === 'number' && Number.isFinite(s.throttle) ? s.throttle > 0.1 : null;
    const coastNow = pedal !== null ? !pedal : braking || grade < -0.015 || accS < -0.04;
    if (coastNow) { coastOn += dt; coastOff = 0; } else { coastOff += dt; coastOn = 0; }
    if (!coasting && coastOn > 0.3) coasting = true;
    if (coasting && coastOff > 0.2) coasting = false;
    const ticking = bike && speed > 1 && coasting;
    glide(tickG.gain, ticking ? K.tick : 0, t, 0.03);
    runRhythm(rh.tick, t, ticking ? clamp(speed * 6.5, 4, 65) : 0, tt => {
      if (rand() < 0.06) return 1; // random dropped tick
      tick.hit(tt, rr(0.5, 1), 0.0006, 0.0012);
      return rr(0.85, 1.15);
    });

    // ---- joint clacks (skate on sidewalk every ~1.5 m; deck seams; rare road cracks on bike)
    let spacing = 0, clackAmp = 0, wheelbase = 0.5;
    if (skate && moving) { spacing = surface === 'ground' ? 1.5 : surface === 'deck' ? 4 : 0; clackAmp = surface === 'ground' ? 1 : 0.8; }
    else if (bike && moving && surface !== 'pier') { spacing = surface === 'deck' ? 8 : 11; clackAmp = surface === 'deck' ? 0.6 : 0.3; wheelbase = 1.05; }
    glide(clackG.gain, spacing ? K.clack : 0, t, 0.03);
    glide(thumpG.gain, grounded ? K.thump : 0, t, 0.03);
    runRhythm(rh.clack, t, spacing && speed > 0.5 ? speed / spacing : 0, tt => {
      const a = clackAmp * rr(0.6, 1), gap = clamp(wheelbase / speed, 0.015, 0.5);
      clackBP.frequency.setValueAtTime(rr(1100, 1900), tt);
      clack.hit(tt, a, 0.0008, 0.012);
      clack.hit(tt + gap, a * 0.8, 0.0008, 0.012);
      thumpOsc.frequency.setValueAtTime(115, tt);
      thumpOsc.frequency.exponentialRampToValueAtTime(70, tt + 0.04);
      thump.hit(tt, a * 0.7, 0.002, 0.025);
      return rr(0.8, 1.2);
    });

    // ---- pier boards under wheels
    const planking = onWheels && surface === 'pier';
    glide(plankG.gain, planking ? K.plank : 0, t, 0.03);
    runRhythm(rh.plank, t, planking ? clamp(speed / 0.3, 1, 55) : 0, tt => {
      plankBP.frequency.setValueAtTime(rr(220, 320), tt);
      plank.hit(tt, rr(0.35, 1), 0.001, 0.015);
      return rr(0.8, 1.2);
    });

    // ---- footsteps
    const walking = mount === 'walk' && grounded && speed > 0.25, run = speed > 2.8;
    glide(stepsOut.gain, walking ? K.steps : 0, t, 0.04);
    glide(stepHollow.gain, surface === 'pier' ? 1 : 0, t, 0.05);
    glide(stepSolid.gain, surface === 'pier' ? 0.5 : 1, t, 0.05);
    glide(stepWet.gain, wet * (surface === 'pier' ? 0.5 : 1), t, 0.2);
    runRhythm(rh.step, t, walking ? clamp(1.2 + speed * 0.55, 1.4, 3.6) : 0, tt => {
      const base = surface === 'deck' ? 1700 : surface === 'pier' ? 800 : 1100;
      stepLP.frequency.setValueAtTime(base * rr(0.85, 1.15) * (run ? 1.3 : 1), tt);
      const a = (run ? 1 : 0.7) * rr(0.8, 1);
      step.hit(tt, a, 0.003, 0.018);
      step.hit(tt + (run ? 0.025 : 0.035), a * 0.45, 0.003, 0.014);
      thumpOsc.frequency.setValueAtTime(85, tt);
      thumpOsc.frequency.exponentialRampToValueAtTime(55, tt + 0.05);
      thump.hit(tt, a * (surface === 'pier' ? 0.5 : 0.8), 0.003, 0.03);
      return rr(0.93, 1.07);
    });

    // ---- sea lion galumphing on land
    const flopping = mount === 'sealion' && grounded && speed > 0.3;
    glide(slapG.gain, flopping ? K.slap : 0, t, 0.04);
    runRhythm(rh.slap, t, flopping ? clamp(0.8 + speed * 0.45, 0.8, 3.2) : 0, tt => {
      slapBP.frequency.setValueAtTime(rr(1000, 1700), tt);
      slap.hit(tt, rr(0.6, 1), 0.002, 0.03);
      thumpOsc.frequency.setValueAtTime(62, tt);
      thumpOsc.frequency.exponentialRampToValueAtTime(45, tt + 0.06);
      thump.hit(tt, 0.8, 0.003, 0.04);
      return rr(0.85, 1.15);
    });
    if (mount === 'sealion') {
      timers.grunt -= dt;
      if (timers.grunt <= 0) { timers.grunt = moving ? rr(3, 7) : rr(6, 14); if (!muted) sfx.grunt(water ? 0.6 : 1); }
    }

    // ---- swimming
    const swimming = water && !air;
    glide(swimG.gain, swimming ? K.swim : 0, t, 0.08);
    glide(wake.g.gain, swimming ? K.wake * Math.min(1, speed / 5) : 0, t, 0.15);
    runRhythm(rh.swim, t, swimming ? (speed > 0.2 ? clamp(0.35 + speed * 0.22, 0.35, 1.6) * (mount === 'sealion' ? 1.3 : 1) : 0.22) : 0, tt => {
      const a = speed > 0.2 ? rr(0.6, 1) : rr(0.2, 0.35);
      swooshBP.frequency.setValueAtTime(rr(450, 800), tt);
      swoosh.hit(tt, a, 0.12, 0.22);
      if (rand() < 0.6) splash.hit(tt + rr(0.1, 0.2), a * rr(0.3, 1) * Math.min(1, 0.3 + speed / 4), 0.004, 0.05);
      return rr(0.85, 1.15);
    });

    // ---- city
    const trafAmt = trafficAmt0 * (1 - 0.45 * night);
    glide(traffic.g.gain, K.traffic * trafAmt * (0.8 + 0.12 * Math.sin(t * 0.37 + ph[5]) + 0.08 * Math.sin(t * 0.91 + ph[6])), t, 0.4);
    glide(wash.g.gain, K.wash * trafAmt * (0.75 + 0.25 * Math.sin(t * 0.53 + ph[7])) * (1 - 0.3 * fog), t, 0.4);
    glide(wash.bp.frequency, 800 - 300 * fog, t, 0.5);

    // ---- bay
    const wv = waveAt(t), wvLate = waveAt(t - 0.9);
    const lapE = 0.15 + 0.85 * Math.pow(0.5 + 0.5 * Math.sin(t * 2 * Math.PI / 1.9 + ph[8]), 3) * (0.6 + 0.4 * Math.sin(t * 2 * Math.PI / 5.3 + ph[9]));
    glide(surf.g.gain, K.surf * Math.pow(nearWater, 1.3) * wv, t, 0.3);
    glide(lap.g.gain, K.lap * nearWater * nearWater * lapE * (surface === 'pier' || water ? 1.5 : 1), t, 0.12);
    glide(foam.g.gain, K.foam * Math.pow(nearWater, 1.5) * wvLate * wvLate, t, 0.3);

    // ---- rain & night
    glide(rainHiss.gain, K.rainHiss * Math.pow(wet, 1.2), t, 0.5);
    glide(rainBody.gain, K.rainBody * Math.pow(wet, 1.5), t, 0.5);
    glide(drops.gain, K.drops * Math.pow(wet, 0.7), t, 0.5);
    glide(crickets.gain, K.crickets * night * night * (1 - 0.7 * trafficAmt0) * (1 - hN) * (1 - wet) * (1 - 0.5 * fog), t, 1.0);

    // ---- sparse random events
    if (!muted) {
      timers.bird -= dt * day;
      if (timers.bird <= 0) {
        timers.bird = rr(2.5, 8);
        if (day > 0.35) sfx.birds(day * (1 - 0.5 * trafficAmt0) * (1 - hN) * (1 - wet) * (water ? 0.3 : 1));
      }
      timers.gull -= dt * nearWater * (0.3 + 0.7 * day);
      if (timers.gull <= 0) {
        timers.gull = rr(6, 16);
        if (nearWater > 0.3 && day > 0.3) sfx.gulls(nearWater * (0.5 + 0.5 * day) * (1 - 0.5 * wet));
      }
      timers.horn -= dt * trafficAmt0;
      if (timers.horn <= 0) { timers.horn = rr(14, 40); if (trafficAmt0 > 0.15) sfx.horn({ distant: true, level: 0.5 + 0.5 * trafficAmt0 }); }
      timers.siren -= dt * trafficAmt0;
      if (timers.siren <= 0) { timers.siren = rr(70, 160); if (trafficAmt0 > 0.3) sfx.siren(0.6 + 0.4 * trafficAmt0); }
      timers.bark -= dt * nearWater;
      if (timers.bark <= 0) { timers.bark = rr(45, 110); if (nearWater > 0.6) sfx.bark({ distant: true, level: nearWater }); }
      if (fog > 0.4) {
        timers.fog -= dt;
        if (timers.fog <= 0) { timers.fog = rr(27, 33); sfx.foghorn({ distant: true, level: 0.6 + 0.4 * fog }); }
      } else if (timers.fog < 6) timers.fog = rr(6, 10); // first horn a few seconds after the fog rolls in
    }

    music.update(t, night, fog);
  }

  return {
    update,
    setMuted(m) {
      muted = !!m;
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setTargetAtTime(muted ? 0 : L.master, ctx.currentTime, 0.05);
    },
    get muted() { return muted; },
    setMusic(on) {
      music.set(!!on, ctx.currentTime);
      for (const g of [musicBus.gain, musicVerb.gain]) {
        g.cancelScheduledValues(ctx.currentTime);
        g.setTargetAtTime(on ? L.music : 0, ctx.currentTime, on ? 1.5 : 0.8);
      }
    },
    jump: () => sfx.jump(st.mount, st.surface),
    land: impact => sfx.land(impact, st.mount, st.surface),
    bump: impact => sfx.bump(impact, st.mount, st.surface),
    bell: () => sfx.bell(),
    horn: () => sfx.horn({ distant: false }),
    bark: () => sfx.bark({ distant: false }),
    foghorn: () => sfx.foghorn({ distant: false }),
    pickup: () => sfx.pickup(),
    countdown: n => sfx.countdown(n),
    finish: () => sfx.finish(),
    fail: () => sfx.fail(),
    ui: () => sfx.ui(),
    // ambient one-shots (normally fired by the random scheduler) - exposed for testing
    _amb: { birds: l => sfx.birds(l), gulls: l => sfx.gulls(l), siren: l => sfx.siren(l), grunt: l => sfx.grunt(l), foghornFar: () => sfx.foghorn({ distant: true }), hornFar: () => sfx.horn({ distant: true }), barkFar: () => sfx.bark({ distant: true }) },
    debug: () => ({ voices: sfx.active, musicVoices: music.active, time: ctx.currentTime, compReduction: comp.reduction, coasting }),
    nodes: { master, comp, verbIn },
  };
}
