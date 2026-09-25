import { describe, expect, it } from 'vitest';
import { DEFAULT_AUDIO, clampVolume, gainFor, iconFor, isSilent, snapVolume, toggleMute, withVolume } from './volume';

describe('gainFor', () => {
  it('keeps the original loudness at the default level', () => {
    expect(gainFor(DEFAULT_AUDIO)).toBe(1);
  });

  it('is silent when muted, whatever the slider says', () => {
    expect(gainFor({ volume: 80, muted: true })).toBe(0);
  });

  it('is silent at zero', () => {
    expect(gainFor({ volume: 0, muted: false })).toBe(0);
  });

  it('follows a squared curve so the quiet half stays usable', () => {
    expect(gainFor({ volume: 50, muted: false })).toBeCloseTo(0.25);
    expect(gainFor({ volume: 25, muted: false })).toBeCloseTo(0.0625);
  });

  it('never leaves the 0–1 range, even for junk input', () => {
    expect(gainFor({ volume: 250, muted: false })).toBe(1);
    expect(gainFor({ volume: -40, muted: false })).toBe(0);
    expect(gainFor({ volume: Number.NaN, muted: false })).toBe(1);
  });

  it('rises steadily with the slider', () => {
    let last = -1;
    for (let v = 0; v <= 100; v++) {
      const g = gainFor({ volume: v, muted: false });
      expect(g).toBeGreaterThan(last);
      last = g;
    }
  });
});

describe('clampVolume', () => {
  it('rounds and limits to whole numbers between 0 and 100', () => {
    expect(clampVolume(49.6)).toBe(50);
    expect(clampVolume(101)).toBe(100);
    expect(clampVolume(-3)).toBe(0);
  });
});

describe('snapVolume', () => {
  it('lands on the round number when the pointer is a hair either side of it', () => {
    expect(snapVolume(19)).toBe(20);
    expect(snapVolume(20)).toBe(20);
    expect(snapVolume(21)).toBe(20);
    expect(snapVolume(22)).toBe(20);
  });

  it('moves on to the next step once past the halfway point', () => {
    expect(snapVolume(23)).toBe(25);
    expect(snapVolume(17)).toBe(15);
  });

  it('keeps both ends of the slider reachable', () => {
    expect(snapVolume(0)).toBe(0);
    expect(snapVolume(2)).toBe(0);
    expect(snapVolume(98)).toBe(100);
    expect(snapVolume(100)).toBe(100);
  });

  it('reaches every multiple of five, so no round number is ever skipped', () => {
    const reached = new Set<number>();
    // Simulate a drag that passes every raw position from 0 to 100.
    for (let raw = 0; raw <= 100; raw++) reached.add(snapVolume(raw));
    for (let v = 0; v <= 100; v += 5) expect(reached.has(v)).toBe(true);
  });

  it('never snaps outside 0–100', () => {
    expect(snapVolume(400)).toBe(100);
    expect(snapVolume(-30)).toBe(0);
  });
});

describe('withVolume', () => {
  it('un-mutes when the slider is dragged up', () => {
    expect(withVolume({ volume: 70, muted: true }, 30)).toEqual({ volume: 30, muted: false });
  });

  it('keeps the mute switch when dragged down to zero', () => {
    expect(withVolume({ volume: 70, muted: true }, 0)).toEqual({ volume: 0, muted: true });
    expect(withVolume({ volume: 70, muted: false }, 0)).toEqual({ volume: 0, muted: false });
  });
});

describe('toggleMute', () => {
  it('mutes while remembering the level', () => {
    expect(toggleMute({ volume: 70, muted: false })).toEqual({ volume: 70, muted: true });
  });

  it('un-mutes back to the remembered level', () => {
    const muted = toggleMute({ volume: 70, muted: false });
    expect(toggleMute(muted)).toEqual({ volume: 70, muted: false });
  });

  it('does not un-mute into silence when the slider sits at zero', () => {
    const next = toggleMute({ volume: 0, muted: false });
    expect(next.muted).toBe(false);
    expect(next.volume).toBeGreaterThan(0);
    expect(isSilent(next)).toBe(false);
  });
});

describe('iconFor', () => {
  it('picks the icon that matches what you would hear', () => {
    expect(iconFor({ volume: 90, muted: false })).toBe('high');
    expect(iconFor({ volume: 20, muted: false })).toBe('low');
    expect(iconFor({ volume: 90, muted: true })).toBe('muted');
    expect(iconFor({ volume: 0, muted: false })).toBe('muted');
  });
});
