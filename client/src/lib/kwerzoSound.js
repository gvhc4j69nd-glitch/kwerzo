/**
 * Sound utilities for Kwerzo.
 *
 * iOS/Safari block audio and TTS that aren't initiated from a user gesture.
 * The fix: call unlockAudio() inside any tap/click handler (we use the
 * "Your Turn" overlay dismiss). After that, speech synthesis and AudioContext
 * work freely — even from socket event callbacks.
 */

// ── AudioContext (bell, future sfx) ─────────────────────────────────────────

let audioCtx = null;

function getAudioCtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

// ── TTS voice selection ──────────────────────────────────────────────────────

let voiceCache = null;

function pickBritishFemaleVoice() {
  if (voiceCache) return voiceCache;
  const voices = window.speechSynthesis?.getVoices() ?? [];
  if (!voices.length) return null;

  const preferred = [
    v => v.name === 'Serena',                   // iOS British female
    v => v.name === 'Kate',                     // macOS British female
    v => v.name === 'Martha',                   // macOS British female
    v => v.name === 'Google UK English Female', // Chrome / Android
    v => v.lang === 'en-GB' && /female|woman|girl/i.test(v.name),
    v => v.lang === 'en-GB',
    v => /en[-_]/i.test(v.lang) && /female|woman|girl/i.test(v.name),
    () => true,
  ];

  for (const test of preferred) {
    const match = voices.find(test);
    if (match) { voiceCache = match; return match; }
  }
  return null;
}

// ── Unlock (call from a user-gesture handler) ───────────────────────────────

let ttsUnlocked = false;

export function unlockAudio() {
  // Unlock Web Audio API
  try {
    const ctx = getAudioCtx();
    if (ctx.state === 'suspended') ctx.resume();
  } catch (_) {}

  // Unlock TTS on iOS: speak a zero-length silent utterance so that subsequent
  // calls from non-gesture contexts (socket events) are allowed.
  if (!ttsUnlocked && window.speechSynthesis) {
    const silent = new SpeechSynthesisUtterance('');
    silent.volume = 0;
    window.speechSynthesis.speak(silent);
    ttsUnlocked = true;
  }
}

// ── Kwerzo! voice shout ─────────────────────────────────────────────────────

export function playKwerzoSound() {
  if (!window.speechSynthesis) return;

  window.speechSynthesis.cancel();

  const utter = new SpeechSynthesisUtterance('Kwerzo!');
  utter.pitch  = 1.9;   // high = young/excited
  utter.rate   = 1.1;
  utter.volume = 1.0;

  const voice = pickBritishFemaleVoice();
  if (voice) utter.voice = voice;
  else        utter.lang = 'en-GB';

  window.speechSynthesis.speak(utter);
}

// ── Notification bell ───────────────────────────────────────────────────────

export function playBellSound() {
  try {
    const ctx   = getAudioCtx();
    const now   = ctx.currentTime;

    // Two partials for a richer bell timbre
    [[880, 1.0], [1320, 0.4]].forEach(([freq, gain]) => {
      const osc = ctx.createOscillator();
      const env = ctx.createGain();

      osc.connect(env);
      env.connect(ctx.destination);

      osc.type      = 'sine';
      osc.frequency.setValueAtTime(freq, now);

      // Sharp attack, long exponential decay
      env.gain.setValueAtTime(0, now);
      env.gain.linearRampToValueAtTime(gain, now + 0.01);
      env.gain.exponentialRampToValueAtTime(0.001, now + 1.4);

      osc.start(now);
      osc.stop(now + 1.5);
    });
  } catch (_) {}
}

// ── Pre-warm voices ─────────────────────────────────────────────────────────

export function prewarmVoices() {
  if (!window.speechSynthesis) return;
  const load = () => { voiceCache = null; pickBritishFemaleVoice(); };
  window.speechSynthesis.onvoiceschanged = load;
  load();
}
