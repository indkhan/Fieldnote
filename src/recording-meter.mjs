const FLOOR_DB = -50;
const CEILING_DB = -6;
const SPEECH_LEVEL = 0.01;
const NOISE_MARGIN = 3;
const NOISE_WINDOW = 30;
const HOLD_MS = 600;
const SOUND_LEVEL = 0.0005;
const NO_SOUND_MS = 8000;

/** Speech peaks are small on a linear scale, so bars follow loudness in decibels. Returns 0 to 1. */
export function barHeight(level) {
  if (!(level > 0)) return 0;
  const position = (20 * Math.log10(level) - FLOOR_DB) / (CEILING_DB - FLOOR_DB);
  return Math.min(1, Math.max(0, position));
}

/** Turns level readings into 'speaking', 'waiting', or 'no-sound' for the recording panel. */
export function createVoiceActivity() {
  let recent = [], speakingUntil = 0, lastSound = null;
  return {
    reset() { recent = []; speakingUntil = 0; lastSound = null; },
    update(level, now) {
      if (lastSound === null || level >= SOUND_LEVEL) lastSound = now;
      // A loud, steady room raises the floor, so only sound well above it counts as a voice.
      const noiseFloor = recent.length ? Math.min(...recent) : 0;
      recent.push(level);
      if (recent.length > NOISE_WINDOW) recent.shift();
      if (level >= Math.max(SPEECH_LEVEL, noiseFloor * NOISE_MARGIN)) speakingUntil = now + HOLD_MS;
      if (now < speakingUntil) return 'speaking';
      return now - lastSound >= NO_SOUND_MS ? 'no-sound' : 'waiting';
    },
  };
}
