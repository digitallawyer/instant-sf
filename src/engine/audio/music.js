// Gentle generative music bed: slow detuned-triangle pad chords (Markov-chained progression in C
// major / F lydian colours), a soft sub bass and sparse pentatonic plucks, mostly through the reverb.
// Scheduled with a small look-ahead from update(); voices are one-shots that clean up after themselves.
import { createVoices, note, perc } from './sfx.js';
import { clamp, mtof, pick, rand, rr } from './dsp.js';

const CHORDS = {
  Fmaj7: { notes: [53, 57, 60, 64], bass: 41, next: ['Em7', 'Cmaj9', 'Am9', 'G6'] },
  Em7: { notes: [52, 55, 59, 62], bass: 40, next: ['Am9', 'Fmaj7', 'Dm9'] },
  Dm9: { notes: [50, 53, 57, 64], bass: 38, next: ['G6', 'Fmaj7', 'Cmaj9'] },
  Cmaj9: { notes: [48, 55, 59, 62, 64], bass: 36, next: ['Fmaj7', 'Am9', 'Dm9'] },
  Am9: { notes: [45, 52, 55, 59, 60], bass: 33, next: ['Fmaj7', 'Dm9', 'Em7'] },
  G6: { notes: [43, 50, 55, 59, 64], bass: 31, next: ['Cmaj9', 'Em7', 'Fmaj7'] },
};
const PENTA = [0, 2, 4, 7, 9]; // C major pentatonic

export function createMusic(ctx, bus, verb) {
  const voices = createVoices(ctx, 12);
  const CHORD_LEN = 9, CHORD_STEP = 8;
  let on = false, nextChord = 0, nextPluck = 0, chord = 'Fmaj7';
  let mood = { night: 0, fog: 0 };

  function playChord(t0, name) {
    const v = voices.begin(0); if (!v) return;
    const c = CHORDS[name], end = t0 + CHORD_LEN;
    const cutoff = clamp(650 + 550 * (1 - mood.night) - 250 * mood.fog, 300, 1400);
    const lp = v.filter('lowpass', cutoff * 0.6, 0.5);
    lp.frequency.setValueAtTime(cutoff * 0.6, t0);
    lp.frequency.linearRampToValueAtTime(cutoff, t0 + 3.5);
    lp.frequency.linearRampToValueAtTime(cutoff * 0.7, end);
    const env = v.gain();
    note(env.gain, t0, 0.11, 2.6, CHORD_LEN - 2.6 - 3.2, 3.2);
    for (const m of c.notes) {
      for (const d of [-7, 7]) {
        const o = v.osc('triangle', mtof(m), t0, end + 0.05);
        o.detune.value = d + rr(-2, 2);
        o.connect(lp);
      }
    }
    const sub = v.osc('sine', mtof(c.bass), t0, end + 0.05), sg = v.gain(1.4);
    sub.connect(sg).connect(lp);
    lp.connect(env);
    const dry = v.gain(0.55), wet = v.gain(0.7);
    env.connect(dry).connect(bus); env.connect(wet).connect(verb);
  }

  function pluck(t0) {
    const v = voices.begin(0); if (!v) return;
    const c = CHORDS[chord], oct = rand() < 0.6 ? 72 : 84;
    // favour pentatonic notes that are also chord tones
    let m = oct + pick(PENTA);
    for (let i = 0; i < 3; i++) { if (c.notes.some(n => (n - m) % 12 === 0)) break; m = oct + pick(PENTA); }
    const f = mtof(m), o = v.osc('sine', f, t0, t0 + 2.2), o2 = v.osc('sine', f * 2, t0, t0 + 0.8);
    const g = v.gain(), g2 = v.gain();
    perc(g.gain, t0, 0.07, 0.006, 0.4); perc(g2.gain, t0, 0.015, 0.004, 0.12);
    const p = v.pan(rr(-0.5, 0.5));
    o.connect(g).connect(p); o2.connect(g2).connect(p);
    const dry = v.gain(0.6), wet = v.gain(0.6 + 0.6 * mood.fog);
    p.connect(dry).connect(bus); p.connect(wet).connect(verb);
  }

  return {
    set(v, now) {
      if (v && !on) { nextChord = now + 0.1; nextPluck = now + rr(2, 4); }
      on = !!v;
    },
    get on() { return on; },
    update(now, night, fog) {
      if (!on) return;
      mood = { night, fog };
      if (nextChord < now - 1) nextChord = now + 0.05; // resync after a stall
      if (nextPluck < now - 1) nextPluck = now + 0.5;
      if (nextChord < now + 0.5) {
        playChord(Math.max(now + 0.02, nextChord), chord);
        chord = pick(CHORDS[chord].next);
        nextChord += CHORD_STEP;
      }
      if (nextPluck < now + 0.3) {
        pluck(Math.max(now + 0.02, nextPluck));
        const runs = rand() < 0.25; // occasional little two-note figures
        nextPluck += runs ? rr(0.25, 0.45) : rr(1.4, 3.8) * (1 + night * 0.8);
      }
    },
    get active() { return voices.active; },
  };
}
