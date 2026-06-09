// Plays "Kwerzo!" in the voice of an excited young girl with a British accent
// using the Web Speech API — no audio files or API keys needed.

let voiceCache = null;

function pickBritishFemaleVoice() {
  if (voiceCache) return voiceCache;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;

  // Priority list — first match wins
  const preferred = [
    // iOS / macOS named voices
    v => v.name === 'Serena',          // iOS British female
    v => v.name === 'Kate',            // macOS British female
    v => v.name === 'Martha',          // macOS British female
    // Chrome / Android
    v => v.name === 'Google UK English Female',
    // Any en-GB female by convention (voices with 'female' in name)
    v => v.lang === 'en-GB' && /female|woman|girl/i.test(v.name),
    // Any en-GB voice at all
    v => v.lang === 'en-GB',
    // Fallback: any English female
    v => /en[-_]/i.test(v.lang) && /female|woman|girl/i.test(v.name),
    // Last resort: first available
    () => true,
  ];

  for (const test of preferred) {
    const match = voices.find(test);
    if (match) { voiceCache = match; return match; }
  }
  return null;
}

export function playKwerzoSound() {
  if (!window.speechSynthesis) return;

  // Cancel any speech already in progress
  window.speechSynthesis.cancel();

  const utter = new SpeechSynthesisUtterance('Kwerzo!');
  utter.pitch  = 1.85;   // high pitch → young/excited sound
  utter.rate   = 1.15;   // slightly fast → energetic
  utter.volume = 1.0;

  const voice = pickBritishFemaleVoice();
  if (voice) utter.voice = voice;
  else utter.lang = 'en-GB';  // hint to browser even without a specific voice

  window.speechSynthesis.speak(utter);
}

// Pre-warm: voices list may be empty until the browser loads them async.
// Call this once early so pickBritishFemaleVoice has voices ready by game time.
export function prewarmVoices() {
  if (!window.speechSynthesis) return;
  const load = () => { voiceCache = null; pickBritishFemaleVoice(); };
  window.speechSynthesis.onvoiceschanged = load;
  // Also call immediately in case voices are already loaded
  load();
}
