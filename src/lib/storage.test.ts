import { afterEach, describe, expect, it, vi } from 'vitest';
import { claimPartyResult, emptyStats, loadSettings, recordResult } from './storage';

describe('claimPartyResult', () => {
  afterEach(() => vi.unstubAllGlobals());

  const fakeSession = () => {
    const data = new Map<string, string>();
    vi.stubGlobal('sessionStorage', { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) });
  };

  it('lets each round count once, even when the same finished round comes back', () => {
    fakeSession();
    expect(claimPartyResult('ABCD:1:1000')).toBe(true);
    expect(claimPartyResult('ABCD:1:1000')).toBe(false); // a reload or reconnect shows the same finished round
    expect(claimPartyResult('ABCD:2:5000')).toBe(true); // the next round is a new result
    expect(claimPartyResult('ABCD:1:9000')).toBe(true); // round 1 of a second game in the same room
  });

  it('still counts a round when storage is blocked', () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    expect(claimPartyResult('ABCD:1:1000')).toBe(true);
  });
});

describe('loadSettings', () => {
  const withSaved = (value: unknown) =>
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify(value), setItem: () => {} });
  afterEach(() => vi.unstubAllGlobals());

  it('turns the retired Expert level into Hard', () => {
    withSaved({ difficulty: 'expert' });
    expect(loadSettings().difficulty).toBe('hard');
  });

  it('keeps a current difficulty and falls back to medium for nonsense', () => {
    for (const difficulty of ['easy', 'hard', 'impossible']) {
      withSaved({ difficulty });
      expect(loadSettings().difficulty).toBe(difficulty);
    }
    withSaved({ difficulty: 'nightmare' });
    expect(loadSettings().difficulty).toBe('medium');
  });
});

describe('recordResult', () => {
  it('counts a curated song toward its language, the totals and the streak', () => {
    const s = recordResult(emptyStats(), 'ja', true);
    expect(s).toMatchObject({ played: 1, won: 1, streak: 1, best: 1 });
    expect(s.byLang.ja).toEqual({ played: 1, won: 1 });
    expect(s.byLang.en).toEqual({ played: 0, won: 0 });
  });

  it('counts a chart song (no language) toward the totals and streak only', () => {
    const s = recordResult(emptyStats(), null, true);
    expect(s).toMatchObject({ played: 1, won: 1, streak: 1, best: 1 });
    expect(s.byLang).toEqual(emptyStats().byLang);
  });

  it('a loss resets the streak but keeps the best', () => {
    let s = recordResult(emptyStats(), null, true);
    s = recordResult(s, 'en', true);
    s = recordResult(s, null, false);
    expect(s).toMatchObject({ played: 3, won: 2, streak: 0, best: 2 });
    expect(s.byLang.en).toEqual({ played: 1, won: 1 });
  });
});
