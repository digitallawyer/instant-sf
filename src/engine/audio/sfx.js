// One-shot sounds. Every one-shot builds a tiny node graph on demand inside a "voice"; when all of the
// voice's sources have ended, every node in it is disconnected (no leaks). A global voice cap and
// per-sound cooldowns stop spammy callers from piling up nodes.
import { clamp, fin, rand, rr } from './dsp.js';

// ---- voice tracking -----------------------------------------------------------------------------
export function createVoices(ctx, max = 40) {
  let active = 0;
  function begin(lead = 0.006) {
    if (active >= max) return null;
    active++;
    const nodes = [], srcs = [];
    let ended = 0, closed = false;
    const finish = () => {
      if (closed) return;
      closed = true;
      for (const n of nodes) { try { n.disconnect(); } catch { /* already gone */ } }
      nodes.length = 0;
      active--;
    };
    const track = s => {
      nodes.push(s); srcs.push(s);
      s.onended = () => { if (++ended >= srcs.length) finish(); };
      return s;
    };
    // a voice that (by mistake) created no source must not leak its slot
    Promise.resolve().then(() => { if (!srcs.length) finish(); });
    const v = {
      t: ctx.currentTime + lead,
      osc(type, f, t0, t1) {
        const o = ctx.createOscillator();
        o.type = type; o.frequency.value = f;
        o.start(t0); o.stop(Math.max(t0 + 0.01, t1));
        return track(o);
      },
      noise(buf, t0, t1, rate = 1) {
        const s = ctx.createBufferSource();
        s.buffer = buf; s.loop = true; s.playbackRate.value = rate;
        s.start(t0, rand() * (buf.duration - 0.1)); s.stop(Math.max(t0 + 0.01, t1));
        return track(s);
      },
      /** keeps the voice alive (e.g. for a feedback-delay tail) until t1 */
      hold(node, t1) {
        const c = ctx.createConstantSource();
        c.offset.value = 0; c.start(v.t); c.stop(t1); c.connect(node);
        return track(c);
      },
      filter(type, f, Q = 0.707) {
        const b = ctx.createBiquadFilter();
        b.type = type; b.frequency.value = f; b.Q.value = Q;
        nodes.push(b); return b;
      },
      gain(g = 0) { const n = ctx.createGain(); n.gain.value = g; nodes.push(n); return n; },
      pan(p = 0) { const n = ctx.createStereoPanner(); n.pan.value = clamp(p, -1, 1); nodes.push(n); return n; },
      delay(max, t) { const d = ctx.createDelay(max); d.delayTime.value = t; nodes.push(d); return d; },
    };
    return v;
  }
  return { begin, get active() { return active; } };
}

// ---- envelope helpers ---------------------------------------------------------------------------
/** percussive: linear attack to peak, exponential decay with time-constant tau */
export function perc(p, t, peak, att, tau) {
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + att);
  p.setTargetAtTime(0, t + att, tau);
}
/** sustained: attack, hold, linear release */
export function note(p, t, peak, att, hold, rel) {
  p.setValueAtTime(0, t);
  p.linearRampToValueAtTime(peak, t + att);
  p.setValueAtTime(peak, t + att + hold);
  p.linearRampToValueAtTime(0, t + att + hold + rel);
}
/** smooth bell-shaped curve that is exactly 0 at both ends (for setValueCurveAtTime) */
function bellCurve(n, width, scale, base = 0) {
  const c = new Float32Array(n), edge = Math.exp(-Math.pow(0.5 / width, 2));
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1) - 0.5;
    c[i] = base + scale * Math.max(0, (Math.exp(-Math.pow(x / width, 2)) - edge) / (1 - edge));
  }
  return c;
}

// ---- the sounds ---------------------------------------------------------------------------------
/**
 * @param io { sfx, amb, move, verb: GainNode inputs; white, pink: AudioBuffers }
 * @param V  per-sound level table (see SFX_LEVELS in ../audio.js)
 */
export function createSfx(ctx, io, V) {
  const voices = createVoices(ctx, 40);
  const lastFired = new Map();
  const ready = (name, sec) => {
    const now = ctx.currentTime, last = lastFired.get(name);
    if (last !== undefined && now - last < sec && now >= last) return false;
    lastFired.set(name, now);
    return true;
  };
  /** out-gain helper: node -> gain(level) -> bus, plus optional reverb send */
  const send = (v, node, bus, level, wet = 0) => {
    const g = v.gain(level); node.connect(g); g.connect(bus);
    if (wet > 0) { const w = v.gain(level * wet); node.connect(w); w.connect(io.verbFor.get(bus)); }
    return g;
  };

  // short filtered-noise burst
  function burst(v, t, { f = 1000, q = 1, type = 'bandpass', peak = 1, att = 0.001, tau = 0.01, dur, buf } = {}) {
    const src = v.noise(buf || io.white, t, t + (dur || att + tau * 7));
    const fl = v.filter(type, f, q), g = v.gain();
    perc(g.gain, t, peak, att, tau);
    src.connect(fl).connect(g);
    return g;
  }
  // pitched thump (sine with downward pitch sweep)
  function thump(v, t, { f0 = 100, f1 = 50, peak = 1, tau = 0.05, sweep = 0.06 } = {}) {
    const o = v.osc('sine', f0, t, t + tau * 7 + 0.01);
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + sweep);
    const g = v.gain();
    perc(g.gain, t, peak, 0.002, tau);
    o.connect(g);
    return g;
  }

  // ---------------- UI / game feedback ----------------
  function ui() {
    if (!ready('ui', 0.03)) return;
    const v = voices.begin(); if (!v) return;
    const t = v.t, out = v.gain(1);
    const o = v.osc('sine', 1850, t, t + 0.09), g = v.gain();
    perc(g.gain, t, 0.6, 0.002, 0.012); o.connect(g).connect(out);
    burst(v, t, { f: 4500, q: 1.2, peak: 0.7, att: 0.0005, tau: 0.003 }).connect(out);
    send(v, out, io.sfx, V.ui);
  }

  function pickup() {
    if (!ready('pickup', 0.05)) return;
    const v = voices.begin(); if (!v) return;
    const t = v.t, out = v.gain(1);
    [1318.5, 1661.2, 1975.5, 2637.0].forEach((f, i) => {
      const t0 = t + i * 0.055;
      const o = v.osc('sine', f, t0, t0 + 0.55), o2 = v.osc('sine', f * 2.004, t0, t0 + 0.3);
      const g = v.gain(), g2 = v.gain();
      perc(g.gain, t0, 0.35, 0.003, 0.09); perc(g2.gain, t0, 0.07, 0.002, 0.04);
      const p = v.pan(-0.35 + i * 0.23);
      o.connect(g).connect(p); o2.connect(g2).connect(p); p.connect(out);
    });
    burst(v, t + 0.05, { type: 'highpass', f: 7000, q: 0.7, peak: 0.08, att: 0.02, tau: 0.08 }).connect(out);
    send(v, out, io.sfx, V.pickup, 0.35);
  }

  function countdown(n) {
    const go = !(fin(n, -1e9, 1e9, 0) > 0);
    if (!ready('countdown', 0.12)) return;
    const v = voices.begin(); if (!v) return;
    const t = v.t, out = v.gain(1);
    const f = go ? 1318.5 : 659.25, dur = go ? 0.6 : 0.17;
    const o1 = v.osc('triangle', f, t, t + dur + 0.05), o2 = v.osc('sine', f * 2, t, t + dur + 0.05);
    const g = v.gain(), g2 = v.gain(0.12);
    if (go) { // GO: brighter, slight upward lift, longer tail
      o1.frequency.setValueAtTime(f * 0.97, t); o1.frequency.linearRampToValueAtTime(f, t + 0.03);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.75, t + 0.006);
      g.gain.setValueAtTime(0.75, t + 0.2); g.gain.linearRampToValueAtTime(0, t + dur);
      g2.gain.value = 0.22;
    } else note(g.gain, t, 0.6, 0.004, dur - 0.035, 0.03);
    o1.connect(g); o2.connect(g2).connect(g); g.connect(out);
    send(v, out, io.sfx, V.countdown, go ? 0.2 : 0.08);
  }

  function finish() {
    if (!ready('finish', 0.5)) return;
    const v = voices.begin(); if (!v) return;
    const t = v.t, out = v.gain(1);
    const brass = (t0, f, hold, amp) => {
      const a = v.osc('sawtooth', f, t0, t0 + hold + 0.4), b = v.osc('sawtooth', f, t0, t0 + hold + 0.4);
      a.detune.value = -7; b.detune.value = 7;
      const lp = v.filter('lowpass', 500, 1.5);
      lp.frequency.setValueAtTime(500, t0);
      lp.frequency.linearRampToValueAtTime(3200, t0 + 0.04);
      lp.frequency.setTargetAtTime(1400, t0 + 0.05, 0.15);
      const g = v.gain();
      note(g.gain, t0, amp, 0.02, hold, 0.28);
      a.connect(lp); b.connect(lp); lp.connect(g).connect(out);
    };
    [392.0, 523.25, 659.25, 783.99].forEach((f, i) => brass(t + i * 0.1, f, 0.08, 0.3));
    [523.25, 659.25, 783.99, 1046.5].forEach(f => brass(t + 0.42, f, 0.9, 0.17));
    [2093, 2637, 3136].forEach((f, i) => {
      const t0 = t + 0.42 + i * 0.07, o = v.osc('sine', f, t0, t0 + 0.6), g = v.gain();
      perc(g.gain, t0, 0.12, 0.003, 0.12); o.connect(g).connect(out);
    });
    send(v, out, io.sfx, V.finish, 0.3);
  }

  function fail() {
    if (!ready('fail', 0.4)) return;
    const v = voices.begin(); if (!v) return;
    const t = v.t, out = v.gain(1);
    const wah = (t0, f0, f1, dur, vib) => {
      const a = v.osc('triangle', f0, t0, t0 + dur + 0.05), b = v.osc('square', f0, t0, t0 + dur + 0.05);
      a.frequency.setValueAtTime(f0, t0); b.frequency.setValueAtTime(f0, t0);
      if (f1 !== f0) {
        a.frequency.setValueAtTime(f0, t0 + dur * 0.35); a.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
        b.frequency.setValueAtTime(f0, t0 + dur * 0.35); b.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
      }
      if (vib) {
        const l = v.osc('sine', 6, t0, t0 + dur), lg = v.gain(vib);
        l.connect(lg); lg.connect(a.frequency); lg.connect(b.frequency);
      }
      const bg = v.gain(0.15); b.connect(bg);
      const lp = v.filter('lowpass', 350, 3);
      lp.frequency.setValueAtTime(350, t0);
      lp.frequency.linearRampToValueAtTime(1300, t0 + 0.08);
      lp.frequency.linearRampToValueAtTime(380, t0 + dur);
      const g = v.gain();
      note(g.gain, t0, 0.5, 0.02, dur - 0.1, 0.08);
      a.connect(lp); bg.connect(lp); lp.connect(g).connect(out);
    };
    wah(t, 392, 392, 0.24, 0);
    wah(t + 0.27, 370, 293.7, 0.62, 7);
    send(v, out, io.sfx, V.fail, 0.15);
  }

  // ---------------- city / SF sounds ----------------
  const BELL = [ // ratio, amplitude, decay time-constant (s)
    [0.5, 0.18, 0.9], [1, 1, 0.55], [1.183, 0.45, 0.4], [1.506, 0.3, 0.3],
    [2.0, 0.4, 0.25], [2.514, 0.22, 0.15], [3.01, 0.12, 0.1], [4.17, 0.08, 0.07],
  ];
  function bell() {
    if (!ready('bell', 0.35)) return;
    const v = voices.begin(); if (!v) return;
    const t = v.t, out = v.gain(1), f0 = 1210 * rr(0.985, 1.015);
    const strike = (t0, f, amp) => {
      for (const [r, a, tau] of BELL) {
        const o = v.osc('sine', f * r, t0, t0 + tau * 7), g = v.gain();
        perc(g.gain, t0, a * amp * 0.22, 0.0015, tau);
        o.connect(g).connect(out);
      }
      burst(v, t0, { f: 3600, q: 1.5, peak: 0.25 * amp, att: 0.0005, tau: 0.004 }).connect(out);
    };
    strike(t, f0, 1);
    strike(t + 0.19, f0 * 0.994, 0.85); // "ding-ding"
    send(v, out, io.sfx, V.bell, 0.3);
  }

  function horn({ distant = false, level = 1 } = {}) {
    if (!ready(distant ? 'hornD' : 'horn', 0.25)) return;
    const v = voices.begin(); if (!v) return;
    const t = v.t, k = rr(0.93, 1.07), single = rand() < 0.5;
    const end = t + (single ? 0.55 : 0.65);
    const a = v.osc('square', 415 * k, t, end), b = v.osc('square', 521 * k, t, end);
    const hp = v.filter('highpass', 220, 0.7), lp = v.filter('lowpass', distant ? 1300 : 2600, 0.9);
    const g = v.gain();
    if (single) note(g.gain, t, 0.3, 0.012, 0.42, 0.05);
    else {
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.3, t + 0.012);
      g.gain.setValueAtTime(0.3, t + 0.13); g.gain.linearRampToValueAtTime(0, t + 0.16);
      g.gain.setValueAtTime(0, t + 0.24); g.gain.linearRampToValueAtTime(0.3, t + 0.252);
      g.gain.setValueAtTime(0.3, t + 0.58); g.gain.linearRampToValueAtTime(0, t + 0.62);
    }
    a.connect(hp); b.connect(hp); hp.connect(lp).connect(g);
    const p = v.pan(rr(-0.6, 0.6)); g.connect(p);
    send(v, p, distant ? io.amb : io.sfx, V.horn * level * (distant ? 0.45 : 1), distant ? 1.2 : 0.5);
  }

  function bark({ distant = false, level = 1 } = {}) {
    if (!ready(distant ? 'barkD' : 'bark', 0.3)) return;
    const v = voices.begin(); if (!v) return;
    const t = v.t, count = 2 + Math.floor(rand() * 3);
    const mix = v.gain(1);
    let tt = t;
    for (let k = 0; k < count; k++) {
      const dur = rr(0.14, 0.22), f = rr(190, 260) * (distant ? 0.95 : 1);
      const s = v.osc('sawtooth', f, tt, tt + dur + 0.02), sub = v.osc('sawtooth', f / 2, tt, tt + dur + 0.02);
      for (const [o, r] of [[s, 1], [sub, 0.5]]) {
        o.frequency.setValueAtTime(f * 0.8 * r, tt);
        o.frequency.linearRampToValueAtTime(f * 1.35 * r, tt + 0.035);
        o.frequency.linearRampToValueAtTime(f * 0.92 * r, tt + dur);
      }
      const subG = v.gain(0.55); sub.connect(subG);
      const breath = burst(v, tt, { f: 1600, q: 0.7, peak: 0.35, att: 0.01, tau: dur * 0.4, dur: dur + 0.02 });
      const env = v.gain();
      env.gain.setValueAtTime(0, tt);
      env.gain.linearRampToValueAtTime(1, tt + 0.012);
      env.gain.setTargetAtTime(0.6, tt + 0.03, 0.05);
      env.gain.linearRampToValueAtTime(0, tt + dur);
      s.connect(env); subG.connect(env); breath.connect(env); env.connect(mix);
      tt += dur + rr(0.1, 0.16);
    }
    // formant bank (shared by all barks in the burst) + growl AM
    const f1 = v.filter('bandpass', 650, 2.5), f2 = v.filter('bandpass', 1150, 3), body = v.filter('lowpass', 420, 0.7);
    const g1 = v.gain(1.6), g2 = v.gain(1.0), gb = v.gain(0.45), rough = v.gain(0.7);
    mix.connect(f1).connect(g1).connect(rough);
    mix.connect(f2).connect(g2).connect(rough);
    mix.connect(body).connect(gb).connect(rough);
    const lfo = v.osc('sine', 42, t, tt), lg = v.gain(0.3); lfo.connect(lg).connect(rough.gain);
    let out = rough;
    if (distant) { const lp = v.filter('lowpass', 1500, 0.7); rough.connect(lp); out = lp; }
    const p = v.pan(distant ? rr(-0.7, 0.7) : rr(-0.15, 0.15)); out.connect(p);
    send(v, p, distant ? io.amb : io.sfx, V.bark * level * (distant ? 0.35 : 1), distant ? 1.4 : 0.25);
  }

  function foghorn({ distant = true, level = 1 } = {}) {
    if (!ready('foghorn', 3)) return;
    const v = voices.begin(); if (!v) return;
    const t = v.t, f1 = 176, f2 = 132, tHi = 1.5, tLo = 2.1, end = t + tHi + tLo;
    const parts = [['sawtooth', 1, 0.5], ['square', 1.003, 0.22], ['sine', 0.5, 0.5]];
    const sum = v.gain(1);
    for (const [type, r, a] of parts) {
      const o = v.osc(type, f1 * r, t, end + 0.05), g = v.gain(a);
      const fr = o.frequency;
      fr.setValueAtTime(f1 * r, t);
      fr.setValueAtTime(f1 * r, t + tHi - 0.05);
      fr.exponentialRampToValueAtTime(f2 * r, t + tHi + 0.04);
      fr.setValueAtTime(f2 * r, end - 0.45);
      fr.exponentialRampToValueAtTime(f2 * r * 0.86, end); // the diaphone's falling "grunt"
      o.connect(g).connect(sum);
    }
    const lp = v.filter('lowpass', distant ? 520 : 760, 1.1), env = v.gain();
    const e = env.gain;
    e.setValueAtTime(0, t); e.linearRampToValueAtTime(1, t + 0.18);
    e.setValueAtTime(1, t + tHi - 0.06); e.linearRampToValueAtTime(0.55, t + tHi);
    e.linearRampToValueAtTime(1, t + tHi + 0.09); e.setValueAtTime(0.95, end - 0.5);
    e.linearRampToValueAtTime(0, end);
    sum.connect(lp).connect(env);
    // echo off the headlands: feedback delay through a darkening low-pass
    const d = v.delay(2, 0.85), fb = v.gain(0.33), dl = v.filter('lowpass', 380, 0.7), echo = v.gain(0.55);
    env.connect(d); d.connect(dl).connect(fb).connect(d); dl.connect(echo);
    v.hold(echo, end + 4);
    const lvl = V.foghorn * level * (distant ? 0.7 : 1);
    send(v, env, io.amb, lvl * (distant ? 0.35 : 0.6), distant ? 2.2 : 1.4);
    send(v, echo, io.amb, lvl * 0.3, 1.5);
  }

  // ---------------- movement one-shots ----------------
  function whoosh(v, t, out, amp) {
    const src = v.noise(io.pink, t, t + 0.45), bp = v.filter('bandpass', 350, 0.9), g = v.gain();
    bp.frequency.setValueAtTime(350, t); bp.frequency.exponentialRampToValueAtTime(1300, t + 0.25);
    note(g.gain, t, amp, 0.08, 0.05, 0.22);
    src.connect(bp).connect(g).connect(out);
  }
  function rattle(v, t, out, amp, n = 4) {
    const src = v.noise(io.white, t, t + 0.03 * n + 0.08), bp = v.filter('bandpass', 2800, 2), g = v.gain();
    let tt = t;
    for (let i = 0; i < n; i++) {
      const a = amp * rr(0.5, 1);
      g.gain.setValueAtTime(0, tt); g.gain.linearRampToValueAtTime(a, tt + 0.0008);
      g.gain.setTargetAtTime(0, tt + 0.0008, 0.004);
      tt += rr(0.014, 0.03);
    }
    src.connect(bp).connect(g).connect(out);
  }
  function splashInto(v, t, out, amount) {
    const src = v.noise(io.white, t, t + 0.9), bp = v.filter('bandpass', 1800, 0.8), g = v.gain();
    bp.frequency.setValueAtTime(1900, t); bp.frequency.exponentialRampToValueAtTime(500, t + 0.4);
    perc(g.gain, t, 0.9 * amount, 0.004, 0.06 + 0.1 * amount);
    src.connect(bp).connect(g).connect(out);
    burst(v, t, { type: 'lowpass', f: 380, q: 0.7, peak: 1.2 * amount, att: 0.005, tau: 0.08, buf: io.pink }).connect(out);
    const bubbles = 2 + Math.floor(amount * 4);
    for (let i = 0; i < bubbles; i++) {
      const t0 = t + rr(0.04, 0.35), f = rr(500, 1300), o = v.osc('sine', f, t0, t0 + 0.08), bg = v.gain();
      o.frequency.setValueAtTime(f, t0); o.frequency.exponentialRampToValueAtTime(f * 1.7, t0 + 0.04);
      perc(bg.gain, t0, 0.18 * amount, 0.002, 0.015);
      o.connect(bg).connect(out);
    }
  }
  function wood(v, t, out, amp) {
    burst(v, t, { f: 210, q: 10, peak: 7 * amp, att: 0.001, tau: 0.03, dur: 0.25 }).connect(out);
    burst(v, t, { f: 470, q: 9, peak: 4 * amp, att: 0.001, tau: 0.02, dur: 0.2 }).connect(out);
  }

  function jump(mount, surface) {
    if (!ready('jump', 0.12)) return;
    const v = voices.begin(); if (!v) return;
    const t = v.t, out = v.gain(1);
    if (surface === 'water') splashInto(v, t, out, 0.45);
    else if (mount === 'skate') { // ollie pop: tail snap + wood knock
      burst(v, t, { f: 1900, q: 2, peak: 2.2, att: 0.0008, tau: 0.012 }).connect(out);
      const o = v.osc('sine', 520, t, t + 0.16), g = v.gain();
      o.frequency.setValueAtTime(520, t); o.frequency.exponentialRampToValueAtTime(330, t + 0.05);
      perc(g.gain, t, 0.5, 0.001, 0.025); o.connect(g).connect(out);
      thump(v, t, { f0: 130, f1: 80, peak: 0.5, tau: 0.03 }).connect(out);
    } else if (mount === 'bike') rattle(v, t, out, 1.4, 4);
    else if (mount === 'sealion') burst(v, t, { f: 1300, q: 0.9, peak: 1.4, att: 0.002, tau: 0.03 }).connect(out);
    else burst(v, t, { type: 'lowpass', f: 700, q: 0.7, peak: 1.2, att: 0.004, tau: 0.03, buf: io.pink }).connect(out);
    whoosh(v, t + 0.02, out, 0.35);
    send(v, out, io.sfx, V.jump);
  }

  function land(impact, mount, surface) {
    const imp = fin(impact, 0, 1, 0.5);
    if (imp < 0.03 || !ready('land', 0.08)) return;
    const v = voices.begin(); if (!v) return;
    const t = v.t, out = v.gain(1), a = Math.pow(imp, 0.7);
    if (surface === 'water') splashInto(v, t, out, 0.4 + 0.6 * imp);
    else {
      thump(v, t, { f0: 95, f1: 42, peak: 0.9 * a, tau: 0.06 + 0.1 * imp, sweep: 0.08 }).connect(out);
      burst(v, t, { type: 'lowpass', f: 500 + 1500 * imp, q: 0.7, peak: 0.9 * a, att: 0.002, tau: 0.04, buf: io.pink }).connect(out);
      if (mount === 'skate') {
        burst(v, t, { f: 1200, q: 1.5, peak: 1.6 * a, att: 0.0008, tau: 0.01 }).connect(out);
        burst(v, t + 0.028, { f: 1100, q: 1.5, peak: 1.2 * a, att: 0.0008, tau: 0.01 }).connect(out);
        burst(v, t, { f: 700, q: 1, peak: 0.9 * a, att: 0.001, tau: 0.035 }).connect(out);
      } else if (mount === 'bike') {
        thump(v, t, { f0: 170, f1: 120, peak: 0.4 * a, tau: 0.04 }).connect(out);
        rattle(v, t + 0.01, out, 0.7 * a, 3 + Math.floor(imp * 4));
      } else if (mount === 'sealion') {
        burst(v, t, { f: 1300, q: 0.9, peak: 1.8 * a, att: 0.002, tau: 0.04 }).connect(out);
      } else {
        burst(v, t + 0.04, { type: 'lowpass', f: 800, q: 0.7, peak: 0.6 * a, att: 0.003, tau: 0.03, buf: io.pink }).connect(out);
      }
      if (surface === 'pier') wood(v, t, out, a);
    }
    send(v, out, io.sfx, V.land, imp > 0.6 ? 0.12 : 0);
  }

  function bump(impact, mount, surface) {
    const imp = fin(impact, 0, 1, 0.5);
    if (imp < 0.03 || !ready('bump', 0.07)) return;
    const v = voices.begin(); if (!v) return;
    const t = v.t, out = v.gain(1), a = Math.pow(imp, 0.7);
    if (surface === 'water') splashInto(v, t, out, 0.25 + 0.4 * imp);
    else {
      thump(v, t, { f0: 80, f1: 50, peak: 0.7 * a, tau: 0.04 }).connect(out);
      burst(v, t, { type: 'lowpass', f: 900, q: 0.7, peak: 0.7 * a, att: 0.001, tau: 0.03, buf: io.pink }).connect(out);
      burst(v, t, { f: 2000, q: 1.2, peak: 0.8 * a, att: 0.0005, tau: 0.006 }).connect(out);
      if (mount === 'bike') rattle(v, t + 0.008, out, 0.5 * a, 3);
      else if (mount === 'skate') burst(v, t + 0.03, { f: 1200, q: 1.5, peak: 1.1 * a, att: 0.0008, tau: 0.01 }).connect(out);
      if (surface === 'pier') wood(v, t, out, 0.6 * a);
    }
    send(v, out, io.sfx, V.bump);
  }

  // ---------------- ambient one-shots (fired by the engine's random scheduler) ----------------
  function birds(level = 1) {
    if (level < 0.02) return;
    const v = voices.begin(); if (!v) return;
    const t = v.t, species = Math.floor(rand() * 3), base = rr(2600, 4300);
    const o = v.osc('sine', base, t, t + 1.6), g = v.gain();
    let tt = t;
    if (species === 2) { // trill
      const dur = rr(0.35, 0.7), m = v.osc('sine', rr(26, 40), t, t + dur + 0.1), mg = v.gain(base * 0.08);
      m.connect(mg).connect(o.frequency);
      note(g.gain, t, 0.5, 0.03, dur - 0.1, 0.07);
    } else {
      const count = 2 + Math.floor(rand() * 4), gap = rr(0.09, 0.17);
      for (let k = 0; k < count && tt < t + 1.3; k++) {
        const fA = species === 0 ? base * 0.8 : base * 1.3, fB = species === 0 ? base * 1.25 : base * 0.75;
        const d = species === 0 ? 0.05 : 0.11;
        o.frequency.setValueAtTime(fA, tt); o.frequency.exponentialRampToValueAtTime(fB, tt + d);
        perc(g.gain, tt, rr(0.35, 0.6), species === 0 ? 0.004 : 0.01, species === 0 ? 0.022 : 0.04);
        tt += gap * rr(0.8, 1.2);
      }
    }
    const hp = v.filter('highpass', 1500, 0.7), p = v.pan(rr(-0.9, 0.9));
    o.connect(g).connect(hp).connect(p);
    send(v, p, io.amb, V.birds * level, 0.3);
  }

  function gulls(level = 1) {
    if (level < 0.02) return;
    const v = voices.begin(); if (!v) return;
    const t = v.t, calls = 2 + Math.floor(rand() * 3), f = rr(1300, 1700);
    const end = t + calls * 0.45 + 0.2;
    const a = v.osc('triangle', f, t, end), b = v.osc('sawtooth', f, t, end), bg = v.gain(0.25);
    const l = v.osc('sine', 22, t, end), lg = v.gain(40);
    l.connect(lg); lg.connect(a.frequency); lg.connect(b.frequency);
    const g = v.gain();
    for (let k = 0; k < calls; k++) {
      const t0 = t + k * rr(0.38, 0.48), dur = rr(0.26, 0.38);
      for (const o of [a, b]) {
        o.frequency.setValueAtTime(f * 0.85, t0);
        o.frequency.linearRampToValueAtTime(f * 1.15, t0 + 0.07);
        o.frequency.linearRampToValueAtTime(f * 0.75, t0 + dur);
      }
      note(g.gain, t0, k === 0 ? 0.5 : rr(0.3, 0.45), 0.03, dur - 0.1, 0.07);
    }
    const bp = v.filter('bandpass', 1700, 1.2), lp = v.filter('lowpass', 3500, 0.7), p = v.pan(rr(-0.9, 0.9));
    a.connect(bp); b.connect(bg).connect(bp); bp.connect(lp).connect(g).connect(p);
    send(v, p, io.amb, V.gulls * level, 0.5);
  }

  function siren(level = 1) {
    const v = voices.begin(); if (!v) return;
    const t = v.t, dur = rr(7, 10), yelp = rand() < 0.35, N = 96;
    const o = v.osc('triangle', 950, t, t + dur), lfo = v.osc('sine', yelp ? 3.2 : 0.17, t, t + dur), lg = v.gain(yelp ? 280 : 330);
    lfo.connect(lg).connect(o.frequency);
    const det = new Float32Array(N), s = rand() < 0.5 ? 1 : -1;
    for (let i = 0; i < N; i++) det[i] = -95 * Math.tanh((i / (N - 1) - 0.5) * 5); // doppler shift through the pass
    o.detune.setValueCurveAtTime(det, t, dur);
    const lp = v.filter('lowpass', 900, 0.7);
    lp.frequency.setValueCurveAtTime(bellCurve(N, 0.28, 1700, 800), t, dur);
    const g = v.gain();
    g.gain.setValueCurveAtTime(bellCurve(N, 0.3, 0.3), t, dur);
    const p = v.pan(-0.8 * s);
    p.pan.setValueAtTime(-0.8 * s, t); p.pan.linearRampToValueAtTime(0.8 * s, t + dur);
    o.connect(lp).connect(g).connect(p);
    send(v, p, io.amb, V.siren * level, 1.0);
  }

  function grunt(level = 1) {
    const v = voices.begin(); if (!v) return;
    const t = v.t, f = rr(85, 120), dur = rr(0.25, 0.45);
    const o = v.osc('sawtooth', f, t, t + dur + 0.05);
    o.frequency.setValueAtTime(f * 1.1, t); o.frequency.linearRampToValueAtTime(f * 0.85, t + dur);
    const am = v.gain(0.6), l = v.osc('sine', 27, t, t + dur + 0.05), lg = v.gain(0.4);
    l.connect(lg).connect(am.gain);
    const lp = v.filter('lowpass', 600, 0.7), bp = v.filter('bandpass', 380, 3), bpg = v.gain(1.5), env = v.gain();
    note(env.gain, t, 1, 0.04, dur - 0.12, 0.08);
    o.connect(am); am.connect(lp).connect(env); am.connect(bp).connect(bpg).connect(env);
    send(v, env, io.move, V.grunt * level, 0.1);
  }

  return {
    ui, pickup, countdown, finish, fail, bell, horn, bark, foghorn, jump, land, bump,
    birds, gulls, siren, grunt,
    get active() { return voices.active; },
  };
}
