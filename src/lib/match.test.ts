import { describe, expect, it } from 'vitest';
import type { Song } from '../types';
import { MAX_SUGGESTIONS, creditsOf, featuredInTitle, indexSongs, isCorrectTitle, searchSongs } from './match';

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

describe('creditsOf and featuredInTitle', () => {
  it('splits a credit into its artists', () => {
    expect(creditsOf('Metro Boomin, The Weeknd & 21 Savage')).toEqual(['Metro Boomin', 'The Weeknd', '21 Savage']);
    expect(creditsOf('Chage and Aska')).toEqual(['Chage', 'Aska']);
    expect(creditsOf('Spontania feat.JUJU')).toEqual(['Spontania', 'JUJU']);
    expect(creditsOf('Paul McCartney And Michael Jackson')).toEqual(['Paul McCartney', 'Michael Jackson']);
  });

  it('keeps a single artist whole, including names that look like a credit', () => {
    expect(creditsOf('Lil Nas X')).toEqual(['Lil Nas X']);
    expect(creditsOf('HUNTR/X')).toEqual(['HUNTR/X']);
    expect(creditsOf('Taylor Swift')).toEqual(['Taylor Swift']);
  });

  it('reads the featured artists out of a title', () => {
    expect(featuredInTitle('Starboy (feat. Daft Punk)')).toEqual(['Daft Punk']);
    expect(featuredInTitle('Song [ft. A & B]')).toEqual(['A', 'B']);
    expect(featuredInTitle('Duet (with Ado)')).toEqual(['Ado']);
    expect(featuredInTitle('Stuck with U')).toEqual([]);
    expect(featuredInTitle('Live (Remastered)')).toEqual([]);
  });
});

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

  it('lists every song by an artist, not just the first few', () => {
    const songs = Array.from({ length: 21 }, (_, i) => song({ id: `y${i}`, lang: 'ja', title: `Song ${String.fromCharCode(97 + (i % 26))}${i}`, artist: 'Yorushika' }));
    const found = searchSongs(indexSongs([...songs, helloA]), 'yorushika');
    expect(found.map((s) => s.id).sort()).toEqual(songs.map((s) => s.id).sort());
  });

  it('puts an artist typed in full ahead of titles that only start with the same letters', () => {
    const adore = song({ id: 'a1', lang: 'en', title: 'Adore You', artist: 'Harry Styles' });
    const ado = song({ id: 'a2', lang: 'ja', title: 'Usseewa', artist: 'Ado' });
    expect(searchSongs(indexSongs([adore, ado]), 'ado').map((s) => s.id)).toEqual(['a2', 'a1']);
  });

  it('stops at MAX_SUGGESTIONS so a two-letter query cannot list the whole catalogue', () => {
    const many = Array.from({ length: MAX_SUGGESTIONS + 40 }, (_, i) => song({ id: `m${i}`, lang: 'en', title: `Love ${i}`, artist: 'Someone' }));
    expect(searchSongs(indexSongs(many), 'lo')).toHaveLength(MAX_SUGGESTIONS);
  });

  it('finds a song by an artist who is only featured on it', () => {
    const closer = song({ id: 'c1', lang: 'en', title: 'Closer', artist: 'The Chainsmokers, Halsey' });
    const other = song({ id: 'c2', lang: 'en', title: 'Bad at Love', artist: 'Halsey' });
    const lookalike = song({ id: 'c3', lang: 'en', title: 'Halsey Blues', artist: 'Someone Else' });
    const found = searchSongs(indexSongs([closer, other, lookalike]), 'halsey').map((s) => s.id);
    expect(found).toHaveLength(3);
    // the solo artist first, then the song she is featured on, both ahead of a title that merely starts the same way
    expect(found.slice(0, 2)).toEqual(['c2', 'c1']);
  });

  it('finds every artist of a song credited to several, however the credit is written', () => {
    const songs = [
      song({ id: 'm1', lang: 'en', title: 'Metro Song', artist: 'Metro Boomin, The Weeknd & 21 Savage' }),
      song({ id: 'm2', lang: 'ja', title: 'Kimi no Subete ni', artist: 'Spontania feat.JUJU' }),
      song({ id: 'm3', lang: 'ja', title: 'Say Yes', artist: 'Chage and Aska' }),
    ];
    const find = (q: string) => searchSongs(indexSongs(songs), q).map((s) => s.id);
    expect(find('21 savage')).toEqual(['m1']);
    expect(find('the weeknd')).toEqual(['m1']);
    expect(find('juju')).toEqual(['m2']);
    expect(find('aska')).toEqual(['m3']);
  });

  it('finds an artist named only in the title', () => {
    const starboy = song({ id: 's1', lang: 'en', title: 'Starboy (feat. Daft Punk)', artist: 'The Weeknd' });
    const other = song({ id: 's2', lang: 'en', title: 'Blinding Lights', artist: 'The Weeknd' });
    expect(searchSongs(indexSongs([starboy, other]), 'daft punk').map((s) => s.id)).toEqual(['s1']);
  });

  it('ranks a whole multi-word artist name first, whichever place in the credit it has', () => {
    const lead = song({ id: 'b1', lang: 'en', title: 'Locked Out of Heaven', artist: 'Bruno Mars' });
    const feat = song({ id: 'b2', lang: 'en', title: 'Uptown Funk', artist: 'Mark Ronson, Bruno Mars' });
    const noise = song({ id: 'b3', lang: 'en', title: 'Mars Needs Bruno', artist: 'Nobody' });
    expect(searchSongs(indexSongs([noise, feat, lead]), 'bruno mars').map((s) => s.id)).toEqual(['b1', 'b2', 'b3']);
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
