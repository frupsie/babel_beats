// Where a round's clips start. Apple's 30-second previews are usually cut from the middle of a song, and some begin
// with a second or more of near-silence (a quiet bar, a breath, the tail of a fade). A 1.5 s clip of that is useless,
// so every clip in a round starts at the first moment the preview is properly audible.

/** Loudness is judged in 100 ms windows, stepped every 25 ms. */
const WINDOW_S = 0.1;
const STEP_S = 0.025;
/** "Properly audible": at least a quarter of the preview's typical loudness (about 12 dB down)... */
const SHARE_OF_TYPICAL = 0.25;
/** ...and staying there for 200 ms, so a lone click or breath doesn't count. */
const SUSTAIN_S = 0.2;
/** Never skip more than this; the rest of the preview is needed for the longer clips. */
const MAX_SKIP_S = 3;
/** Start a little before the sound arrives, so its attack isn't clipped. */
const PRE_ROLL_S = 0.05;

/** Root-mean-square level of one window, across every channel. */
function windowLevel(channels: readonly Float32Array[], from: number, to: number): number {
  let sum = 0;
  let n = 0;
  for (const data of channels) {
    for (let i = from; i < to && i < data.length; i++) sum += data[i]! * data[i]!;
    n += Math.max(0, Math.min(to, data.length) - from);
  }
  return n > 0 ? Math.sqrt(sum / n) : 0;
}

/**
 * Seconds into the preview where clips should start: 0 when it opens at full strength, later when it opens quietly.
 * `channels` is the decoded audio, one array per channel.
 */
export function clipStart(channels: readonly Float32Array[], sampleRate: number): number {
  const length = channels[0]?.length ?? 0;
  const win = Math.round(sampleRate * WINDOW_S);
  const step = Math.round(sampleRate * STEP_S);
  if (length < win || step < 1) return 0;

  const levels: number[] = [];
  for (let from = 0; from + win <= length; from += step) levels.push(windowLevel(channels, from, from + win));

  // "Typical loudness" is the median window, so a few very loud or very quiet moments don't skew it.
  const typical = [...levels].sort((a, b) => a - b)[Math.floor(levels.length / 2)]!;
  if (typical < 1e-4) return 0; // a silent file; nothing sensible to skip to

  const threshold = typical * SHARE_OF_TYPICAL;
  const sustain = Math.round(SUSTAIN_S / STEP_S);
  const lastStart = Math.min(levels.length - 1, Math.round(MAX_SKIP_S / STEP_S));

  for (let i = 0; i <= lastStart; i++) {
    let held = true;
    for (let j = i; j < Math.min(levels.length, i + sustain); j++) {
      if (levels[j]! < threshold) {
        held = false;
        break;
      }
    }
    if (held) return Math.max(0, (i * step) / sampleRate - PRE_ROLL_S);
  }

  // Quiet for the whole first 3 s: start at its loudest moment within them rather than skip further.
  let loudest = 0;
  for (let i = 1; i <= lastStart; i++) if (levels[i]! > levels[loudest]!) loudest = i;
  return Math.max(0, (loudest * step) / sampleRate - PRE_ROLL_S);
}
