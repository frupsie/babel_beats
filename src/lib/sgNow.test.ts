import { describe, expect, it } from 'vitest';
import type { Song } from '../types';
import { ageInDays, bracketed, buildSgEntries, buildSgPool, guessLang, type FeedItem, type LookupTrack } from './sgNow';

function song(over: Partial<Song> & Pick<Song, 'id' | 'lang' | 'title' | 'artist'>): Song {
  return {
    titleAlt: [],
    artistAlt: [],
    year: 2015,
    album: '',
    previewUrl: 'https://example.test/x.m4a',
    artworkUrl: '',
    trackViewUrl: '',
    country: 'us',
    ...over,
  };
}

const item = (id: string, name: string, artistName: string): FeedItem => ({ id, name, artistName, releaseDate: '2026-05-01' });
const withPreview = (id: string): [string, LookupTrack] => [
  id,
  { trackId: id, previewUrl: `https://audio.test/${id}.m4a`, artworkUrl100: 'https://img.test/a/100x100bb.jpg', collectionName: 'Album', trackViewUrl: `https://music.test/${id}` },
];
const tracks = (...ids: string[]) => new Map<string, LookupTrack>(ids.map(withPreview));

describe('guessLang', () => {
  it('reads the script', () => {
    expect(guessLang('Nicole Kidman ADÉLA')).toBe('en');
    expect(guessLang('甲乙丙丁Strangers Jess Lee')).toBe('zh');
    expect(guessLang('うっせぇわ Ado')).toBe('ja');
  });

  it('calls kanji-plus-kana Japanese, not Chinese', () => {
    expect(guessLang('君の名は')).toBe('ja');
  });
});

describe('bracketed', () => {
  it('pulls out the other-language title Apple puts in brackets', () => {
    expect(bracketed('Jumping Machine (跳楼机)')).toEqual(['跳楼机']);
    expect(bracketed('她 (《早春晴朗》电视剧栾念人物曲&片头曲)')).toEqual(['《早春晴朗》电视剧栾念人物曲&片头曲']);
  });

  it('returns nothing for a plain title', () => {
    expect(bracketed('Yellow')).toEqual([]);
  });
});

describe('buildSgEntries', () => {
  it('keeps each song’s real chart position when a neighbour has no preview', () => {
    const entries = buildSgEntries([item('1', 'A', 'X'), item('2', 'B', 'Y'), item('3', 'C', 'Z')], tracks('1', '3'), []);
    expect(entries.map((e) => e.rank)).toEqual([1, 3]);
  });

  it('builds a complete, chart-flagged song from the feed plus the lookup', () => {
    const [entry] = buildSgEntries([item('7', 'Nicole Kidman', 'ADÉLA')], tracks('7'), []);
    expect(entry?.song).toMatchObject({
      id: '7',
      lang: 'en',
      title: 'Nicole Kidman',
      artist: 'ADÉLA',
      country: 'sg',
      fromChart: true,
      previewUrl: 'https://audio.test/7.m4a',
      artworkUrl: 'https://img.test/a/600x600bb.jpg',
      year: 2026,
    });
    expect(entry?.catalogId).toBeUndefined();
  });

  it('gives Chinese titles their bracketed alternative spelling', () => {
    const [entry] = buildSgEntries([item('9', 'Jumping Machine (跳楼机)', 'LBI')], tracks('9'), []);
    expect(entry?.song.titleAlt).toContain('跳楼机');
    expect(entry?.song.lang).toBe('zh');
  });

  it('recognises a song that is already in the catalogue, whatever decoration Apple adds', () => {
    const closer = song({ id: 'c1', lang: 'en', title: 'Closer', artist: 'The Chainsmokers' });
    const [entry] = buildSgEntries([item('99', 'Closer (feat. Halsey)', 'The Chainsmokers & Halsey')], tracks('99'), [closer]);
    expect(entry?.catalogId).toBe('c1');
  });

  it('recognises a catalogue song by id alone', () => {
    const s = song({ id: '42', lang: 'en', title: 'Something Else Entirely', artist: 'Someone' });
    const [entry] = buildSgEntries([item('42', 'Renamed Track', 'Unknown')], tracks('42'), [s]);
    expect(entry?.catalogId).toBe('42');
  });

  it('matches a Mandarin catalogue song that Singapore shows with an English title', () => {
    const sunny = song({
      id: 'z1',
      lang: 'zh',
      title: '晴天',
      artist: '周杰倫',
      titleAlt: ['Sunny Day', 'qing tian'],
      artistAlt: ['Jay Chou'],
    });
    const [entry] = buildSgEntries([item('5', 'Sunny Day', 'Jay Chou')], tracks('5'), [sunny]);
    expect(entry?.catalogId).toBe('z1');
  });

  it('does not confuse two different songs that share a title', () => {
    const hello = song({ id: 'h1', lang: 'en', title: 'Hello', artist: 'Adele' });
    const [entry] = buildSgEntries([item('8', 'Hello', 'Lionel Richie')], tracks('8'), [hello]);
    expect(entry?.catalogId).toBeUndefined();
  });

  it('keeps only the higher-ranked of two versions of the same catalogue song', () => {
    const closer = song({ id: 'c1', lang: 'en', title: 'Closer', artist: 'The Chainsmokers' });
    const entries = buildSgEntries(
      [item('11', 'Closer', 'The Chainsmokers'), item('12', 'Closer (Live)', 'The Chainsmokers')],
      tracks('11', '12'),
      [closer],
    );
    expect(entries.map((e) => e.rank)).toEqual([1]);
  });
});

describe('buildSgPool', () => {
  const closer = song({ id: 'c1', lang: 'en', title: 'Closer', artist: 'The Chainsmokers' });
  const entries = buildSgEntries(
    [item('99', 'Closer', 'The Chainsmokers'), item('7', 'Nicole Kidman', 'ADÉLA')],
    tracks('99', '7'),
    [closer],
  );

  it('uses the catalogue’s own song object, so guesses compare by one id', () => {
    const { pool } = buildSgPool({ entries }, [closer]);
    expect(pool[0]).toBe(closer);
  });

  it('lists only chart-only songs as extras (the guess box needs them, the catalogue already has the rest)', () => {
    const { pool, extra } = buildSgPool({ entries }, [closer]);
    expect(pool).toHaveLength(2);
    expect(extra.map((s) => s.id)).toEqual(['7']);
  });

  it('records each song’s chart position by id', () => {
    const { rank } = buildSgPool({ entries }, [closer]);
    expect(rank.get('c1')).toBe(1);
    expect(rank.get('7')).toBe(2);
  });

  it('falls back to the snapshot’s own copy if the catalogue no longer has the song', () => {
    const { pool, extra } = buildSgPool({ entries }, []);
    expect(pool.map((s) => s.id)).toEqual(['99', '7']);
    expect(extra).toHaveLength(2);
  });

  it('copes with a missing snapshot', () => {
    expect(buildSgPool(null, [closer])).toEqual({ pool: [], extra: [], rank: new Map() });
  });
});

describe('ageInDays', () => {
  const now = Date.parse('2026-09-21T12:00:00Z');

  it('measures days since the snapshot was downloaded', () => {
    expect(ageInDays('2026-09-14T12:00:00Z', now)).toBeCloseTo(7);
    expect(ageInDays('2026-09-21T00:00:00Z', now)).toBeCloseTo(0.5);
  });

  it('treats a missing or unreadable date as infinitely old, and never returns a negative age', () => {
    expect(ageInDays(undefined, now)).toBe(Infinity);
    expect(ageInDays('not a date', now)).toBe(Infinity);
    expect(ageInDays('2026-12-01T00:00:00Z', now)).toBe(0);
  });
});
