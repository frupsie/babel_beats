import { describe, expect, it } from 'vitest';
import type { Song } from '../types';
import { indexSongs, isCorrectTitle, searchSongs } from './match';

function song(over: Partial<Song> & Pick<Song, 'id' | 'lang' | 'title' | 'artist'>): Song {
  return {
    titleAlt: [],
    artistAlt: [],
    year: 2000,
    album: '',
    previewUrl: '',
    artworkUrl: '',
    trackViewUrl: '',
    country: 'us',
    ...over,
  };
}

const sunny = song({
  id: '1',
  lang: 'zh',
  title: '晴天',
  artist: '周杰倫',
  titleAlt: ['Sunny Day', 'qing tian'],
  artistAlt: ['Jay Chou', 'zhou jie lun', '周杰伦'],
});
const lemon = song({ id: '2', lang: 'ja', title: 'Lemon', artist: '米津玄師', artistAlt: ['Kenshi Yonezu'] });
const kiseki = song({ id: '3', lang: 'ja', title: 'キセキ', artist: 'GReeeeN', titleAlt: ['Kiseki', 'Miracle'] });
const helloA = song({ id: '4', lang: 'en', title: 'Hello', artist: 'Adele' });
const helloB = song({ id: '5', lang: 'en', title: 'Hello', artist: 'Lionel Richie' });
const yellow = song({ id: '6', lang: 'en', title: 'Yellow', artist: 'Coldplay' });

const index = indexSongs([sunny, lemon, kiseki, helloA, helloB, yellow]);
const ids = (q: string) => searchSongs(index, q).map((s) => s.id);

describe('searchSongs', () => {
  it('finds by native title', () => {
    expect(ids('晴天')).toEqual(['1']);
    expect(ids('晴')).toEqual(['1']);
  });

  it('finds Chinese songs by pinyin and English gloss', () => {
    expect(ids('qing tian')).toEqual(['1']);
    expect(ids('qingtian')).toEqual(['1']);
    expect(ids('sunny')).toEqual(['1']);
  });

  it('finds by artist in any script', () => {
    expect(ids('jay chou')).toEqual(['1']);
    expect(ids('周杰伦')).toEqual(['1']); // Simplified spelling of the artist
    expect(ids('kenshi')).toEqual(['2']);
  });

  it('requires every word to match, across title and artist', () => {
    expect(ids('hello adele')).toEqual(['4']);
    expect(ids('hello richie')).toEqual(['5']);
    expect(ids('lemon adele')).toEqual([]);
  });

  it('matches katakana titles from hiragana or romaji', () => {
    expect(ids('きせき')).toEqual(['3']);
    expect(ids('miracle')).toEqual(['3']);
  });

  it('ranks exact and prefix title matches first', () => {
    expect(ids('yell')[0]).toBe('6');
  });

  it('ignores one-letter Latin queries but accepts one CJK character', () => {
    expect(ids('y')).toEqual([]);
    expect(ids('')).toEqual([]);
    expect(ids('米')).toEqual(['2']);
  });
});

describe('isCorrectTitle', () => {
  it('accepts the exact title, ignoring case, punctuation and decoration', () => {
    expect(isCorrectTitle('LEMON', lemon)).toBe(true);
    expect(isCorrectTitle('hello (live)', helloA)).toBe(true);
  });

  it('accepts alternate spellings of the same song', () => {
    expect(isCorrectTitle('Sunny Day', sunny)).toBe(true);
    expect(isCorrectTitle('qing tian', sunny)).toBe(true);
    expect(isCorrectTitle('きせき', kiseki)).toBe(true);
  });

  it('rejects other songs and empty input', () => {
    expect(isCorrectTitle('Yellow', helloA)).toBe(false);
    expect(isCorrectTitle('   ', helloA)).toBe(false);
    expect(isCorrectTitle('Adele', helloA)).toBe(false);
  });
});
