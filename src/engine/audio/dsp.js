// Low-level helpers for the procedural audio engine: maths, seeded RNG, safe AudioParam gliding,
// and generation of the noise / impulse-response / texture buffers. Pure Web Audio, no files.

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
/** Finite + clamped number (anything non-numeric / NaN / Infinity falls back to `d`). */
export const fin = (v, lo, hi, d = lo) => clamp(num(v, d), lo, hi);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

// ---- seeded RNG (mulberry32) so offline test renders are reproducible ------------------------
let seed = 0x5f3759df;
export function reseed(s) { seed = s >>> 0; }
export function rand() {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export const rr = (a, b) => a + (b - a) * rand();
export const pick = arr => arr[Math.floor(rand() * arr.length) % arr.length];

// ---- AudioParam gliding -----------------------------------------------------------------------
// setTargetAtTime every frame is the idiomatic way to drive continuous layers, but we skip the call
// when the target hasn't meaningfully changed so the automation timeline stays short.
const lastTarget = new WeakMap();
export function glide(param, value, time, tc) {
  if (!Number.isFinite(value) || !Number.isFinite(time)) return;
  const prev = lastTarget.get(param);
  if (prev !== undefined && Math.abs(prev - value) <= 1e-6 + Math.abs(value) * 2e-3) return;
  lastTarget.set(param, value);
  param.setTargetAtTime(value, time, Math.max(0.001, tc));
}
/** Immediate set (used at build time); also primes the glide cache. */
export function setNow(param, value) {
  if (!Number.isFinite(value)) return;
  param.value = value;
  lastTarget.set(param, value);
}

// ---- noise buffers ----------------------------------------------------------------------------
function fillWhite(a) { for (let i = 0; i < a.length; i++) a[i] = rand() * 2 - 1; }
function fillPink(a) { // Paul Kellet's refined pink filter
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < a.length; i++) {
    const w = rand() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
    a[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
    b6 = w * 0.115926;
  }
}
function fillBrown(a) {
  let last = 0;
  for (let i = 0; i < a.length; i++) {
    last = (last + 0.02 * (rand() * 2 - 1)) / 1.02;
    a[i] = last;
  }
}
function normalizeRms(a, target) {
  let mean = 0;
  for (let i = 0; i < a.length; i++) mean += a[i];
  mean /= a.length;
  let s = 0;
  for (let i = 0; i < a.length; i++) { a[i] -= mean; s += a[i] * a[i]; }
  const rms = Math.sqrt(s / a.length) || 1;
  const k = target / rms;
  for (let i = 0; i < a.length; i++) a[i] *= k;
}

/**
 * Seamlessly looping noise buffer. Generates n + crossfade samples and equal-power folds the tail
 * into the head, so buf[n-1] -> buf[0] is continuous (no click at the loop point).
 * All noise buffers are normalised to RMS 0.25 so layer gains are comparable.
 */
export function makeNoise(ctx, kind, seconds, channels = 1) {
  const sr = ctx.sampleRate, n = Math.floor(sr * seconds), xf = Math.floor(sr * 0.06);
  const buf = ctx.createBuffer(channels, n, sr);
  const fill = kind === 'pink' ? fillPink : kind === 'brown' ? fillBrown : fillWhite;
  for (let ch = 0; ch < channels; ch++) {
    const tmp = new Float32Array(n + xf);
    fill(tmp);
    for (let i = 0; i < xf; i++) {
      const w = (i / xf) * Math.PI * 0.5;
      tmp[i] = tmp[i] * Math.sin(w) + tmp[n + i] * Math.cos(w);
    }
    const out = tmp.subarray(0, n);
    normalizeRms(out, 0.25);
    buf.copyToChannel(out, ch);
  }
  return buf;
}

/**
 * Procedural reverb impulse response: a few sparse early reflections, then exponentially decaying
 * noise that is progressively low-passed (air/absorption makes the tail darker). Stereo-decorrelated.
 */
export function makeImpulse(ctx, seconds = 3.4, t60 = 2.9, predelay = 0.018) {
  const sr = ctx.sampleRate, n = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(2, n, sr);
  const pre = Math.floor(predelay * sr), fadeIn = Math.floor(0.004 * sr);
  for (let ch = 0; ch < 2; ch++) {
    const a = new Float32Array(n);
    let y = 0;
    for (let i = pre; i < n; i++) {
      const t = (i - pre) / sr, p = (i - pre) / (n - pre);
      const alpha = lerp(0.75, 0.06, Math.sqrt(p)); // one-pole LP coefficient: bright -> dark
      y += alpha * ((rand() * 2 - 1) - y);
      const comp = 1 / Math.sqrt(alpha / (2 - alpha)); // keep RMS constant despite filtering
      let env = Math.exp(-6.9 * t / t60);
      if (i - pre < fadeIn) env *= (i - pre) / fadeIn;
      if (i > n - sr * 0.05) env *= (n - i) / (sr * 0.05); // fade the very end
      a[i] = y * comp * env * 0.4;
    }
    // early reflections (building facades)
    for (let k = 0; k < 9; k++) {
      const d = Math.floor(sr * (predelay + rr(0.006, 0.09)));
      if (d < n) a[d] += (rand() < 0.5 ? -1 : 1) * rr(0.25, 0.7) * (1 - k / 12);
    }
    buf.copyToChannel(a, ch);
  }
  return buf;
}

/** Cricket chorus loop: several insects, each chirping pulse-trains of a ~4.5 kHz tone. */
export function makeCricketLoop(ctx, seconds = 6) {
  const sr = ctx.sampleRate, n = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(2, n, sr);
  const L = new Float32Array(n), R = new Float32Array(n);
  const crickets = 4;
  for (let c = 0; c < crickets; c++) {
    const f = rr(4100, 4900), period = rr(0.45, 0.9), pulses = 2 + Math.floor(rand() * 3);
    const pan = rr(-0.8, 0.8), amp = rr(0.35, 1), gl = Math.sqrt(0.5 * (1 - pan)), gr = Math.sqrt(0.5 * (1 + pan));
    // period must divide the loop for seamless looping
    const groups = Math.max(1, Math.round(seconds / period)), per = seconds / groups;
    const off = rand() * per;
    for (let g = 0; g < groups; g++) {
      if (rand() < 0.12) continue; // occasional missed chirp
      for (let p = 0; p < pulses; p++) {
        const t0 = (off + g * per + p * 0.032) % seconds;
        const len = Math.floor(0.018 * sr), i0 = Math.floor(t0 * sr);
        for (let j = 0; j < len; j++) {
          const i = (i0 + j) % n;
          const e = Math.sin(Math.PI * j / len);
          const s = Math.sin(2 * Math.PI * f * j / sr) * e * e * amp;
          L[i] += s * gl; R[i] += s * gr;
        }
      }
    }
  }
  buf.copyToChannel(L, 0); buf.copyToChannel(R, 1);
  return buf;
}

/** Rain droplets loop: many tiny resonant 'plinks' at random pitches/positions. */
export function makeDropLoop(ctx, seconds = 4, perSecond = 45) {
  const sr = ctx.sampleRate, n = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(2, n, sr);
  const L = new Float32Array(n), R = new Float32Array(n);
  const count = Math.floor(seconds * perSecond);
  for (let k = 0; k < count; k++) {
    const i0 = Math.floor(rand() * n), f = rr(1400, 5200), tau = rr(0.003, 0.012), amp = Math.pow(rand(), 2) * 0.9 + 0.05;
    const pan = rr(-1, 1), gl = Math.sqrt(0.5 * (1 - pan)), gr = Math.sqrt(0.5 * (1 + pan));
    const len = Math.floor(tau * 6 * sr), rise = f * rr(0.1, 0.5); // drop pitch rises slightly (bubble)
    let ph = 0;
    for (let j = 0; j < len; j++) {
      const t = j / sr;
      ph += 2 * Math.PI * (f + rise * t / (tau * 6)) / sr;
      const s = Math.sin(ph) * Math.exp(-t / tau) * amp * Math.min(1, j / 8);
      const i = (i0 + j) % n;
      L[i] += s * gl; R[i] += s * gr;
    }
  }
  buf.copyToChannel(L, 0); buf.copyToChannel(R, 1);
  return buf;
}

/** Asphalt grit loop for skate wheels: noise with a rough, randomly-stepped amplitude + sparse pebble ticks. */
export function makeGritLoop(ctx, seconds = 3) {
  const sr = ctx.sampleRate, n = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(1, n, sr);
  const a = new Float32Array(n);
  let env = 0.5, target = 0.5, segLeft = 0;
  for (let i = 0; i < n; i++) {
    if (--segLeft <= 0) { segLeft = Math.floor(sr * rr(0.003, 0.014)); target = 0.25 + Math.pow(rand(), 1.5) * 0.9; }
    env += (target - env) * 0.02;
    a[i] = (rand() * 2 - 1) * env;
  }
  const ticks = Math.floor(seconds * 22);
  for (let k = 0; k < ticks; k++) {
    const i0 = Math.floor(rand() * n), amp = rr(0.6, 2.2) * (rand() < 0.5 ? -1 : 1), len = Math.floor(sr * 0.0025);
    for (let j = 0; j < len; j++) a[(i0 + j) % n] += amp * Math.exp(-j / (len / 4)) * (rand() * 2 - 1);
  }
  // fade the loop seam over 10 ms
  const xf = Math.floor(sr * 0.01);
  for (let i = 0; i < xf; i++) { const w = i / xf; a[i] = a[i] * w + a[n - xf + i] * (1 - w); }
  normalizeRms(a, 0.25);
  buf.copyToChannel(a, 0);
  return buf;
}

/** Soft-clip transfer curve: linear below 0.7, smooth tanh knee into ~0.95 at full scale. */
export function makeSoftClipCurve(size = 4096) {
  const c = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const x = (i / (size - 1)) * 2 - 1, ax = Math.abs(x);
    c[i] = ax < 0.7 ? x : Math.sign(x) * (0.7 + 0.28 * Math.tanh((ax - 0.7) / 0.28));
  }
  return c;
}
