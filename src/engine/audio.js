// Instant San Francisco - procedural sound. Everything is synthesised with the Web Audio API
// (no audio files, no libraries). See src/engine/audio/ for the engine, layers and one-shots.
//
//   const audio = createAudio();
//   addEventListener('pointerdown', () => audio.unlock());   // and keydown; cheap + idempotent
//   loop: audio.update(dt, { speed, mount, air, surface, height, grade, fog, night, wet, nearWater, traffic, braking });
//   events: audio.jump(); audio.land(0.6); audio.bell(); ...
//
// Every method is a safe no-op before unlock() (or if Web Audio is unavailable).
import { buildEngine } from './audio/engine.js';

// ---- master volume constants (linear gain) ---------------------------------------------------
export const AUDIO_LEVELS = {
  master: 0.8,     // overall
  sfx: 0.8,        // one-shots: game feedback, bell, horn, bark, jumps/landings
  movement: 0.75,  // player layers: tyres, wheels, footsteps, swimming
  ambience: 0.7,   // wind, traffic, bay, rain, birds, crickets, foghorn
  music: 0.15,     // generative music bed (when enabled)
  reverb: 0.5,     // reverb return
};

// ---- per-sound levels for one-shots -----------------------------------------------------------
export const SFX_LEVELS = {
  ui: 0.35, pickup: 0.7, countdown: 0.6, finish: 0.55, fail: 0.45,
  bell: 0.65, horn: 0.3, bark: 0.45, foghorn: 0.32,
  jump: 0.8, land: 0.75, bump: 0.6,
  birds: 0.12, gulls: 0.12, siren: 0.18, grunt: 0.12,
};

/** Build the engine on an existing (real-time or Offline) AudioContext - used by the test harness. */
export function createAudioEngine(ctx, opts) {
  return buildEngine(ctx, AUDIO_LEVELS, SFX_LEVELS, opts);
}

export function createAudio({ muted: startMuted = false, music: startMusic = false, pauseWhenHidden = true } = {}) {
  let ctx = null, eng = null, failed = false;
  let muted = !!startMuted, musicOn = !!startMusic, hidden = false, suspendTimer = 0;

  const live = () => !!eng && !muted && !hidden && ctx.state === 'running';
  const resume = () => (ctx && ctx.state !== 'running' && ctx.state !== 'closed' ? ctx.resume().catch(() => {}) : Promise.resolve());
  const scheduleSuspend = () => {
    clearTimeout(suspendTimer);
    suspendTimer = setTimeout(() => { if (ctx && (muted || hidden) && ctx.state === 'running') ctx.suspend().catch(() => {}); }, 300);
  };
  const onVisibility = () => {
    hidden = document.visibilityState === 'hidden';
    if (!eng) return;
    if (hidden) { eng.setMuted(true); scheduleSuspend(); }
    else if (!muted) { clearTimeout(suspendTimer); resume().then(() => eng.setMuted(false)); }
  };

  const api = {
    /** Call from a user gesture (pointerdown/keydown/touchend). Creates or resumes the AudioContext. */
    unlock() {
      if (failed) return Promise.resolve(false);
      try {
        if (!ctx) {
          const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
          if (!AC) { failed = true; return Promise.resolve(false); }
          ctx = new AC({ latencyHint: 'interactive' });
          eng = createAudioEngine(ctx);
          eng.setMuted(muted);
          if (musicOn) eng.setMusic(true);
          if (pauseWhenHidden && typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', onVisibility);
            hidden = document.visibilityState === 'hidden';
          }
        }
        if (muted || hidden) { scheduleSuspend(); return Promise.resolve(true); }
        return resume().then(() => ctx.state === 'running');
      } catch (e) {
        console.warn('[audio] Web Audio unavailable:', e);
        failed = true; ctx = null; eng = null;
        return Promise.resolve(false);
      }
    },
    setMuted(m) {
      muted = !!m;
      if (!eng) return;
      if (muted) { eng.setMuted(true); scheduleSuspend(); }
      else if (!hidden) { clearTimeout(suspendTimer); resume().then(() => { if (!muted) eng.setMuted(false); }); }
    },
    get muted() { return muted; },
    /** Optional gentle generative music bed (off by default). */
    setMusic(on) { musicOn = !!on; if (eng) eng.setMusic(musicOn); },
    get music() { return musicOn; },
    /** Every frame. See README block at the top of this file for the fields of `s`. */
    update(dt, s) { if (live()) eng.update(dt, s); },

    jump() { if (live()) eng.jump(); },
    land(impact = 0.5) { if (live()) eng.land(impact); },
    bump(impact = 0.5) { if (live()) eng.bump(impact); },
    bell() { if (live()) eng.bell(); },
    horn() { if (live()) eng.horn(); },
    bark() { if (live()) eng.bark(); },
    foghorn() { if (live()) eng.foghorn(); },
    pickup() { if (live()) eng.pickup(); },
    countdown(n) { if (live()) eng.countdown(n); },
    finish() { if (live()) eng.finish(); },
    fail() { if (live()) eng.fail(); },
    ui() { if (live()) eng.ui(); },

    /** Dev/diagnostics: active voices, context state, compressor gain reduction. */
    debug() { return eng ? { state: ctx.state, ...eng.debug() } : { state: failed ? 'unavailable' : 'locked' }; },
    get context() { return ctx; },
    /** Dev only (audio-test.html): the underlying engine, incl. ambient one-shot triggers in _amb. */
    get _engine() { return eng; },
    /** Tear down completely (e.g. on hot-reload). */
    dispose() {
      clearTimeout(suspendTimer);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
      if (ctx && ctx.state !== 'closed') ctx.close().catch(() => {});
      ctx = null; eng = null;
    },
  };
  return api;
}
