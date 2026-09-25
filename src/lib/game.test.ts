import { describe, expect, it } from 'vitest';
import type { Song } from '../types';
import { LANG_CODES } from '../data/languages';
import {
  DIFFICULTIES,
  applyGuess,
  currentClip,
  eraOf,
  inEra,
  ladderFor,
  newRound,
  pickFromList,
  pickSong,
  poolFor,
  skipGain,
} from './game';

function song(id: string, lang: Song['lang'], year = 2005): Song {
  return {
    id,
    lang,
    title: `T${id}`,
    titleAlt: [],
    artist: `A${id}`,
    artistAlt: [],
    year,
    album: '',
    previewUrl: '',
    artworkUrl: '',
    trackViewUrl: '',
    country: 'us',
  };
}

describe('eras', () => {
  it('draws the decade boundaries in the right place', () => {
    expect(eraOf(1999)).toBe('classic');
    expect(eraOf(2000)).toBe('2000s');
    expect(eraOf(2009)).toBe('2000s');
    expect(eraOf(2010)).toBe('2010s');
    expect(eraOf(2019)).toBe('2010s');
    expect(eraOf(2020)).toBe('2020s');
  });

  it('"any" accepts every year', () => {
    expect(inEra('any', 1961)).toBe(true);
    expect(inEra('2010s', 2009)).toBe(false);
  });
});

describe('difficulty ladders', () => {
  it('give six strictly increasing clip lengths', () => {
    for (const d of DIFFICULTIES) {
      expect(d.ladder).toHaveLength(6);
      d.ladder.forEach((n, i) => {
        if (i > 0) expect(n).toBeGreaterThan(d.ladder[i - 1]!);
      });
    }
  });

  it('impossible starts at a tenth of a second', () => {
    expect(ladderFor('impossible')[0]).toBe(0.1);
  });
});

describe('a round', () => {
  const target = song('1', 'en');
  const wrong = { kind: 'wrong', song: song('2', 'en'), text: 'x' } as const;

  it('unlocks a longer clip after every miss', () => {
    let round = newRound(target, ladderFor('hard'));
    expect(currentClip(round)).toBe(1);
    round = applyGuess(round, wrong);
    expect(currentClip(round)).toBe(2);
    round = applyGuess(round, { kind: 'skip' });
    expect(currentClip(round)).toBe(3);
    expect(round.status).toBe('playing');
  });

  it('is won by a correct guess on any attempt', () => {
    let round = newRound(target, ladderFor('hard'));
    round = applyGuess(round, wrong);
    round = applyGuess(round, { kind: 'right', text: 'T1' });
    expect(round.status).toBe('won');
    expect(round.guesses).toHaveLength(2);
  });

  it('is lost after six misses, mixing skips and wrong guesses', () => {
    let round = newRound(target, ladderFor('medium'));
    for (let i = 0; i < 5; i++) round = applyGuess(round, i % 2 ? wrong : { kind: 'skip' });
    expect(round.status).toBe('playing');
    round = applyGuess(round, { kind: 'skip' });
    expect(round.status).toBe('lost');
  });

  it('ignores guesses once it is over', () => {
    const won = applyGuess(newRound(target, ladderFor('easy')), { kind: 'right', text: '' });
    expect(applyGuess(won, wrong)).toBe(won);
  });

  it('reports how much a skip would unlock, and nothing on the last try', () => {
    let round = newRound(target, [1, 2.5, 4]);
    expect(skipGain(round)).toBe(1.5);
    round = applyGuess(applyGuess(round, { kind: 'skip' }), { kind: 'skip' });
    expect(skipGain(round)).toBeNull();
  });
});

describe('pickFromList', () => {
  const list = ['a', 'b', 'c', 'd'].map((id) => song(id, 'en'));

  it('returns null for an empty list', () => {
    expect(pickFromList([], new Set())).toBeNull();
  });

  it('picks uniformly from the whole list, with no language balancing', () => {
    const mixed = [song('e1', 'en'), song('e2', 'en'), song('e3', 'en'), song('z1', 'zh')];
    // One Mandarin song out of four is picked a quarter of the time, not half.
    const picks = [0, 0.26, 0.51, 0.76].map((r) => pickFromList(mixed, new Set(), () => r)!.id);
    expect(picks).toEqual(['e1', 'e2', 'e3', 'z1']);
  });

  it('skips songs already played', () => {
    const played = new Set(['a', 'b', 'c']);
    for (let i = 0; i < 6; i++) expect(pickFromList(list, played, () => i / 6)!.id).toBe('d');
  });

  it('starts over once every song has been played', () => {
    const played = new Set(['a', 'b', 'c', 'd', 'other']);
    const pick = pickFromList(list, played, () => 0);
    expect(pick?.id).toBe('a');
    expect(played.has('a')).toBe(false);
    expect(played.has('other')).toBe(true); // ids from outside this list are left alone
  });
});

describe('newRound', () => {
  it('remembers which list the song came from', () => {
    const s = song('1', 'en');
    expect(newRound(s, [1, 2]).pool).toBe('mix');
    expect(newRound(s, [1, 2], 'sg-now').pool).toBe('sg-now');
  });
});

describe('pickSong', () => {
  const catalog = [
    ...['e1', 'e2', 'e3', 'e4', 'e5', 'e6'].map((id) => song(id, 'en')),
    song('j1', 'ja'),
    song('j2', 'ja', 2021),
    song('z1', 'zh', 1985),
  ];
  const all = { langs: [...LANG_CODES], era: 'any' } as const;

  it('filters by language and era', () => {
    expect(poolFor(catalog, { langs: ['ja'], era: 'any' }).map((s) => s.id)).toEqual(['j1', 'j2']);
    expect(poolFor(catalog, { langs: ['ja', 'zh'], era: '2020s' }).map((s) => s.id)).toEqual(['j2']);
    expect(poolFor(catalog, { langs: ['en'], era: 'classic' })).toEqual([]);
  });

  it('returns null when nothing matches', () => {
    expect(pickSong(catalog, { langs: ['en'], era: 'classic' }, new Set())).toBeNull();
  });

  it('picks the language first, so a big list does not drown a small one', () => {
    // rand() < 1/3 selects the first language group (en), the middle third ja, the top third zh.
    expect(pickSong(catalog, all, new Set(), () => 0.1)!.lang).toBe('en');
    expect(pickSong(catalog, all, new Set(), () => 0.5)!.lang).toBe('ja');
    expect(pickSong(catalog, all, new Set(), () => 0.9)!.lang).toBe('zh');
  });

  it('avoids songs already played until a language runs dry', () => {
    const played = new Set(['j1']);
    for (let i = 0; i < 10; i++) {
      expect(pickSong(catalog, { langs: ['ja'], era: 'any' }, played, () => i / 10)!.id).toBe('j2');
    }
  });

  it('resets a language when every one of its songs has been played', () => {
    const played = new Set(['j1', 'j2']);
    const pick = pickSong(catalog, { langs: ['ja'], era: 'any' }, played, () => 0);
    expect(pick).not.toBeNull();
    expect(played.has('j1')).toBe(false);
    expect(played.has('j2')).toBe(false);
  });

  it('skips languages that are fully played while others still have fresh songs', () => {
    const played = new Set(['z1']);
    const langs = new Set<string>();
    for (let i = 0; i < 20; i++) langs.add(pickSong(catalog, all, played, () => i / 20)!.lang);
    expect(langs.has('zh')).toBe(false);
    expect(langs.has('en')).toBe(true);
    expect(langs.has('ja')).toBe(true);
  });
});
