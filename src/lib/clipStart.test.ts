import { describe, expect, it } from 'vitest';
import { clipStart } from './clipStart';

const SR = 8000;

/** A mono test signal built from [seconds, amplitude] pieces of a 440 Hz tone (amplitude 0 is silence). */
function signal(...pieces: [number, number][]): Float32Array {
  const total = pieces.reduce((n, [s]) => n + Math.round(s * SR), 0);
  const out = new Float32Array(total);
  let i = 0;
  for (const [seconds, amp] of pieces) {
    for (const end = i + Math.round(seconds * SR); i < end; i++) out[i] = amp * Math.sin((2 * Math.PI * 440 * i) / SR);
  }
  return out;
}

describe('clipStart', () => {
  it('starts at 0 when the preview opens at full strength', () => {
    expect(clipStart([signal([30, 0.6])], SR)).toBe(0);
  });

  it('skips a near-silent opening (美波 – カワキヲアメク starts ~1.5 s of almost nothing)', () => {
    const start = clipStart([signal([1.5, 0.005], [28.5, 0.6])], SR);
    expect(start).toBeGreaterThan(1.35);
    expect(start).toBeLessThanOrEqual(1.5);
  });

  it('skips a soft opening that is far quieter than the rest', () => {
    const start = clipStart([signal([1, 0.06], [29, 0.7])], SR);
    expect(start).toBeGreaterThan(0.85);
    expect(start).toBeLessThanOrEqual(1);
  });

  it('keeps an opening that is only a little quieter than the rest', () => {
    expect(clipStart([signal([1, 0.35], [29, 0.7])], SR)).toBe(0);
  });

  it('is not fooled by a lone click in the silence', () => {
    const start = clipStart([signal([0.5, 0], [0.01, 0.9], [0.99, 0], [28.5, 0.6])], SR);
    expect(start).toBeGreaterThan(1.35);
  });

  it('never skips more than 3 s, even when the opening stays quiet longer', () => {
    const start = clipStart([signal([6, 0.01], [24, 0.6])], SR);
    expect(start).toBeLessThanOrEqual(3);
  });

  it('listens to every channel, so a sound in only one side still counts', () => {
    expect(clipStart([signal([30, 0]), signal([30, 0.6])], SR)).toBe(0);
  });

  it('leaves a silent or tiny file alone', () => {
    expect(clipStart([signal([30, 0])], SR)).toBe(0);
    expect(clipStart([new Float32Array(10)], SR)).toBe(0);
  });
});
