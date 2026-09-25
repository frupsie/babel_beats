/** Player volume: a 0–100 slider position plus a mute switch. Pure functions so the rules are easy to test. */
export interface AudioPrefs {
  /** Slider position, 0–100. */
  volume: number;
  muted: boolean;
}

/** Full level, i.e. the same loudness the game had before it had a volume control. */
export const DEFAULT_AUDIO: AudioPrefs = { volume: 100, muted: false };

/** Where un-muting lands when the slider had been dragged all the way to zero. */
const RESTORE_VOLUME = 60;

export function clampVolume(n: number): number {
  return Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : DEFAULT_AUDIO.volume;
}

/**
 * Positions a mouse or finger lands on while dragging the slider. The slider is only ~90px of thumb
 * travel for 101 values, so at 1% steps some values (20% included) can't be reached by dragging at all.
 * Snapping to 5% makes every round number easy to hit; the keyboard still moves in 1% steps.
 */
export const DRAG_STEP = 5;

export function snapVolume(volume: number, step: number = DRAG_STEP): number {
  return clampVolume(Math.round(volume / step) * step);
}

export function isSilent(prefs: AudioPrefs): boolean {
  return prefs.muted || clampVolume(prefs.volume) === 0;
}

/**
 * Slider position → linear gain for the audio graph. Squaring roughly follows how loudness is
 * perceived, so the quiet half of the slider stays useful instead of everything happening near the top.
 */
export function gainFor(prefs: AudioPrefs): number {
  if (prefs.muted) return 0;
  const v = clampVolume(prefs.volume) / 100;
  return v * v;
}

/** The player moved the slider. Dragging up from a muted state means "I want to hear it". */
export function withVolume(prefs: AudioPrefs, volume: number): AudioPrefs {
  const v = clampVolume(volume);
  return { volume: v, muted: v === 0 ? prefs.muted : false };
}

export function toggleMute(prefs: AudioPrefs): AudioPrefs {
  if (!isSilent(prefs)) return { ...prefs, muted: true };
  const v = clampVolume(prefs.volume);
  return { volume: v === 0 ? RESTORE_VOLUME : v, muted: false };
}

export type VolumeIcon = 'muted' | 'low' | 'high';

export function iconFor(prefs: AudioPrefs): VolumeIcon {
  if (isSilent(prefs)) return 'muted';
  return clampVolume(prefs.volume) < 40 ? 'low' : 'high';
}
