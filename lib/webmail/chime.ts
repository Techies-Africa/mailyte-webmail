/**
 * The new-mail chime: two short notes, made with Web Audio so there is no
 * sound file to ship or license.
 *
 * Why not rely on the notification's own sound: whether a browser
 * notification makes any sound is the operating system's call (on a Mac,
 * "Play sound for notifications" per browser, off for many people), and a
 * toast has none at all. This plays the same way everywhere.
 *
 * Browsers only let a page make sound once the person has interacted with it
 * (clicked, typed). Before that, playChime() reports false and the caller
 * leaves the notification's own sound on instead.
 */

const NOTES_HZ = [880, 1318.5]; // A5 then E6: a rising "ding-ding"
const NOTE_GAP_S = 0.14;
const NOTE_LENGTH_S = 0.45;
const PEAK_GAIN = 0.18;

/** resume() waits forever when the browser will not allow sound; never wait that long. */
const RESUME_TIMEOUT_MS = 300;

let context: AudioContext | null = null;
let suspendTimer: number | undefined;

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    context ??= new Ctor();
  } catch {
    return null;
  }
  return context;
}

/** Play the chime. Resolves true when it actually played. */
export async function playChime(): Promise<boolean> {
  const ctx = audio();
  if (!ctx) return false;
  if (ctx.state !== 'running') {
    await Promise.race([
      ctx.resume().catch(() => undefined),
      new Promise((resolve) => window.setTimeout(resolve, RESUME_TIMEOUT_MS)),
    ]);
  }
  if (ctx.state !== 'running') return false;

  const now = ctx.currentTime;
  NOTES_HZ.forEach((hz, i) => {
    const start = now + i * NOTE_GAP_S;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = hz;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(PEAK_GAIN, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + NOTE_LENGTH_S);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + NOTE_LENGTH_S + 0.05);
  });

  // Let the audio device sleep between chimes rather than holding it open
  // for as long as the tab lives. Resuming later is allowed: the page has
  // already been interacted with, which is what the browser checks.
  window.clearTimeout(suspendTimer);
  suspendTimer = window.setTimeout(() => void ctx.suspend().catch(() => undefined), 1_500);
  return true;
}
