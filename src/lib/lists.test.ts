import { describe, expect, it } from 'vitest';
import type { Song } from '../types';
import { buildListPool, matchesSong, type ListEntry } from './lists';

function song(over: Partial<Song> & Pick<Song, 'id' | 'lang' | 'title' | 'artist'>): Song {
  return {
    titleAlt: [],
    artistAlt: [],
    year: 2015,
    album: '',
    previewUrl: '',
    artworkUrl: '',
    trackViewUrl: '',
    country: 'tw',
    ...over,
  };
}

const sunny = song({
  id: 'c1',
  lang: 'zh',
  title: '晴天',
  artist: '周杰倫',
  titleAlt: ['Sunny Day', 'qing tian'],
  artistAlt: ['Jay Chou', 'zhou jie lun', '周杰伦'],
});
const lemon = song({ id: 'c2', lang: 'ja', title: 'Lemon', artist: '米津玄師', artistAlt: ['Kenshi Yonezu'] });
const en = song({ id: 'c3', lang: 'ja', title: 'Tune', artist: 'EN' });

describe('matchesSong', () => {
  it('matches by id alone', () => {
    expect(matchesSong({ id: 'c1', titles: ['whatever'], artists: ['nobody'] }, sunny)).toBe(true);
  });

  it('matches a title spelling together with an artist spelling, in any script', () => {
    expect(matchesSong({ titles: ['晴天'], artists: ['Jay Chou'] }, sunny)).toBe(true);
    expect(matchesSong({ titles: ['Sunny Day (Live)'], artists: ['周杰伦'] }, sunny)).toBe(true);
    expect(matchesSong({ titles: ['Lemon'], artists: ['Kenshi Yonezu', 'Someone Else'] }, lemon)).toBe(true);
  });

  it('needs the artist as well as the title', () => {
    expect(matchesSong({ titles: ['Lemon'], artists: ['Kenji Someone'] }, lemon)).toBe(false);
    expect(matchesSong({ titles: ['晴天'], artists: ['Some Cover Singer'] }, sunny)).toBe(false);
  });

  it('needs the title as well as the artist', () => {
    expect(matchesSong({ titles: ['Flamingo'], artists: ['Kenshi Yonezu'] }, lemon)).toBe(false);
  });

  it('requires very short artist names to match exactly, so "EN" is not "Ken"', () => {
    expect(matchesSong({ titles: ['Tune'], artists: ['Kenji'] }, en)).toBe(false);
    expect(matchesSong({ titles: ['Tune'], artists: ['en'] }, en)).toBe(true);
  });

  it('lets longer artist names contain each other', () => {
    expect(matchesSong({ titles: ['Lemon'], artists: ['Kenshi Yonezu & Friends'] }, lemon)).toBe(true);
  });
});

describe('buildListPool', () => {
  const entry = (rank: number, s: Song, catalogId?: string): ListEntry => ({ rank, song: s, ...(catalogId ? { catalogId } : {}) });
  const own = song({ id: 'p1', lang: 'ja', title: 'Only In My Playlist', artist: 'Someone' });
  const dupe = { ...own };

  it('uses the catalogue’s own song for catalogue matches and keeps the rest as extras', () => {
    const copy = song({ id: 'x9', lang: 'zh', title: '晴天', artist: 'Jay Chou' });
    const { pool, extra } = buildListPool([entry(1, copy, 'c1'), entry(2, own)], [sunny]);
    expect(pool[0]).toBe(sunny);
    expect(pool[1]).toBe(own);
    expect(extra).toEqual([own]);
  });

  it('keeps one copy when the same song appears in more than one list', () => {
    const { pool, rank } = buildListPool([entry(3, own), entry(9, dupe)], []);
    expect(pool).toHaveLength(1);
    expect(rank.get('p1')).toBe(3);
  });

  it('falls back to the entry’s own song if the catalogue no longer has it', () => {
    const copy = song({ id: 'x9', lang: 'zh', title: '晴天', artist: 'Jay Chou' });
    const { pool, extra } = buildListPool([entry(1, copy, 'gone')], [sunny]);
    expect(pool).toEqual([copy]);
    expect(extra).toEqual([copy]);
  });

  it('handles an empty list', () => {
    expect(buildListPool([], [sunny])).toEqual({ pool: [], extra: [], rank: new Map() });
  });
});
