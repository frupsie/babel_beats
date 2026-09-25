import { describe, expect, it } from 'vitest';
import { emptyStats, recordResult } from './storage';

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
