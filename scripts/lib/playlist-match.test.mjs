import { describe, expect, it } from 'vitest';
import {
  artistKeysOf,
  artistFit,
  artistMatches,
  buildSong,
  createAliasBook,
  learnAliases,
  prepare,
  releaseKind,
  titleMatches,
  wanted,
} from './playlist-match.mjs';

const zh = (title, ...artists) => prepare({ title, artists }, 'zh');
const ja = (title, ...artists) => prepare({ title, artists }, 'ja');

const track = (over = {}) => ({
  trackId: 535824738,
  trackName: '晴天',
  artistName: '周杰倫',
  collectionName: '葉惠美',
  releaseDate: '2003-07-31T07:00:00Z',
  previewUrl: 'https://audio.test/p.m4a',
  artworkUrl100: 'https://img.test/a/100x100bb.jpg',
  trackViewUrl: 'https://music.test/x',
  ...over,
});

describe('prepare', () => {
  it('accepts a title in both Simplified and Traditional Chinese', () => {
    const s = zh('后来的我们', 'Mayday');
    expect(titleMatches(s, ['後來的我們'])).toBe(true);
    expect(titleMatches(s, ['后来的我们'])).toBe(true);
  });

  it('ignores Apple-style decoration in the title', () => {
    const s = zh('心跳的證明 - 電影《一吻定情》心動版主題曲', '刘人语');
    expect(titleMatches(s, ['心跳的證明'])).toBe(true);
  });

  it('does not accept a different title', () => {
    expect(titleMatches(zh('晴天', 'Jay Chou'), ['七里香'])).toBe(false);
  });

  it('folds Apple’s title too: its 説 and 裡 are the row’s 說 and 里', () => {
    // U+8AAC (説) is a variant of U+8AAA (說); Apple's Taiwan store spells Jay Chou's title with the first.
    expect(titleMatches(zh('說了再見', 'Jay Chou'), ['説了再見'])).toBe(true);
    expect(titleMatches(zh('我的歌声里 (You Exist In My Song)', 'Wanting'), ['我的歌聲裡'])).toBe(true);
  });

  it('accepts a second title that Apple puts in brackets', () => {
    expect(titleMatches(zh('Follow', '梨冻紧'), ['羅生門(Follow)'])).toBe(true);
    expect(titleMatches(zh('Follow', '梨冻紧'), ['羅生門'])).toBe(false);
  });
});

describe('wanted', () => {
  const row = zh('晴天', 'Jay Chou');

  it('needs a preview', () => {
    expect(wanted(track({ previewUrl: undefined }), row)).toBe(false);
    expect(wanted(track(), row)).toBe(true);
  });

  it('rejects live, remix and karaoke re-cuts the row does not ask for', () => {
    expect(wanted(track({ trackName: '晴天 (Live)' }), row)).toBe(false);
    expect(wanted(track({ collectionName: 'Karaoke Hits' }), row)).toBe(false);
  });

  it('keeps a live version when the row itself is the live version', () => {
    expect(wanted(track({ trackName: '晴天 (Live)' }), zh('晴天 - Live', 'Jay Chou'))).toBe(true);
  });

  it('rejects DJ, mix, live-chorus and lyrical re-cuts', () => {
    for (const trackName of ['晴天 (DJ版)', '晴天 (DJ名龍版)', '晴天 (DJ墨韓Mix版)', '晴天 (現場合唱版)', '晴天 (抒情版)']) {
      expect(wanted(track({ trackName }), row)).toBe(false);
    }
  });

  it('rejects speed, style and TV-size re-cuts', () => {
    for (const trackName of ['晴天 (降速版)', '晴天 (1.13x)', '晴天 (電音版)', '晴天 (卡點節奏版)', '晴天 (3D環繞版)', '晴天 (Piano Ver.)', '晴天 (TV Size)']) {
      expect(wanted(track({ trackName }), row)).toBe(false);
    }
  });

  it('rejects DJ cuts however the DJ is named, and unplugged, instrumental and English-language versions', () => {
    for (const trackName of ['半空 (DJYAHA版)', '霧裡 (不插電版)', 'Always and Forever (Off Vocal)', 'シャル・ウィ・ダンス? (オフボーカル)']) {
      expect(wanted(track({ trackName }), row)).toBe(false);
    }
    expect(wanted(track({ collectionName: '君の名は。English edition - EP' }), row)).toBe(false);
    expect(wanted(track({ collectionName: 'ReoNa ONE-MAN Concert 2023' }), row)).toBe(false);
  });

  it('does not mistake ordinary titles for re-cuts', () => {
    for (const trackName of ['現在', 'Mixed Feelings', '加速度', '小提琴手的夢', 'Pianola', 'Tourist', 'Adjust']) {
      expect(wanted(track({ trackName }), row)).toBe(true);
    }
  });

  it('prefers the release named after the song: its single, then its EP or album, then any other', () => {
    const kind = (trackName, collectionName) => releaseKind({ trackName, collectionName });
    expect(kind('シャル・ウィ・ダンス?', 'シャル・ウィ・ダンス? - Single')).toBe(0);
    expect(kind('心跳的證明 (電影《一吻定情》心動版主題曲)', '心跳的證明 (電影《一吻定情》心動版主題曲) - Single')).toBe(0);
    expect(kind('メフィスト', 'メフィスト - EP')).toBe(1);
    expect(kind('初恋', '初恋')).toBe(1);
    expect(kind('メフィスト', '悪')).toBe(2);
    expect(kind('如果这就是爱情', '被傷過的心還可以愛誰 - Single')).toBe(2);
  });
});

describe('artistMatches', () => {
  it('matches an English name against Apple’s English spelling from another store', () => {
    expect(artistMatches(zh('晴天', 'Jay Chou'), ['周杰倫', 'Jay Chou'], createAliasBook())).toBe(true);
  });

  it('matches a pinyin name against a Chinese one', () => {
    expect(artistMatches(zh('好想愛這個世界啊', 'Hua Chen Yu'), ['華晨宇'], createAliasBook())).toBe(true);
  });

  it('matches Simplified against Traditional', () => {
    expect(artistMatches(zh('嘉宾', '张远'), ['張遠'], createAliasBook())).toBe(true);
  });

  it('cannot tell "Jay Chou" is 周杰倫 without an alias, and can once one is known', () => {
    const s = zh('晴天', 'Jay Chou');
    const book = createAliasBook();
    expect(artistMatches(s, ['周杰倫'], book)).toBe(false);
    book.learn(artistKeysOf(['周杰倫', 'Jay Chou'], true));
    expect(artistMatches(s, ['周杰倫'], book)).toBe(true);
  });

  it('does not confuse two different artists', () => {
    const book = createAliasBook();
    book.learn(artistKeysOf(['周杰倫', 'Jay Chou'], true));
    expect(artistMatches(zh('晴天', 'Jay Chou'), ['林俊傑'], book)).toBe(false);
  });

  it('makes very short names match exactly, so "EN" is not "Ken"', () => {
    expect(artistMatches(zh('间距', 'EN'), ['Ken Lim'], createAliasBook())).toBe(false);
    expect(artistMatches(zh('间距', 'EN'), ['EN'], createAliasBook())).toBe(true);
  });

  it('lets a longer name contain the other ("蔡恩雨 Priscilla Abby" is 蔡恩雨)', () => {
    expect(artistMatches(zh('夏天的风', '蔡恩雨 Priscilla Abby'), ['蔡恩雨'], createAliasBook())).toBe(true);
  });

  it('reads a name in the other word order as the same name ("Ronghao Li" is "Li Ronghao")', () => {
    expect(artistMatches(zh('模特', 'Ronghao Li'), ['李榮浩', 'Li Ronghao'], createAliasBook())).toBe(true);
    expect(artistMatches(zh('愛錯', 'Leehom Wang'), ['Wang Leehom'], createAliasBook())).toBe(true);
    expect(artistMatches(ja('Lemon', 'Kenshi Yonezu'), ['Yonezu Kenshi'], createAliasBook())).toBe(true);
  });

  it('still tells apart people whose names share a word', () => {
    expect(artistMatches(zh('模特', 'Ronghao Li'), ['Wang Ronghao'], createAliasBook())).toBe(false);
    expect(artistMatches(zh('模特', 'Ronghao Li'), ['Li Wei'], createAliasBook())).toBe(false);
  });

  it('does not find a short name inside a longer one ("Uru" is not in "Miyuki Tsurugi")', () => {
    const credit = ['剣 幸 & 諸星すみれ', 'Miyuki Tsurugi & Sumire Morohoshi'];
    expect(artistMatches(ja('プロローグ', 'Uru'), credit, createAliasBook())).toBe(false);
    expect(artistMatches(ja('プロローグ', 'Uru'), ['Uru'], createAliasBook())).toBe(true);
  });

  it('finds an artist named among others in one credit', () => {
    expect(artistMatches(zh('Follow', '梨冻紧'), ['梨凍緊 & Wiz_H張子豪'], createAliasBook())).toBe(true);
    expect(artistMatches(zh('有点想你', 'Aioz'), ['Aioz & 劉思达'], createAliasBook())).toBe(true);
    expect(artistMatches(zh('下坠', 'Corki刘宗鑫'), ['Corki'], createAliasBook())).toBe(true);
  });
});

describe('artistFit', () => {
  const book = createAliasBook();

  it('counts the row’s artists found in the credit, and the people credited beyond them', () => {
    expect(artistFit(zh('模特', 'Li Ronghao'), ['李榮浩', 'Li Ronghao'], book)).toMatchObject({ verified: 1, partial: 0, covered: 1, extra: 0 });
    expect(artistFit(zh('有点想你', 'Aioz'), ['Aioz & 劉思达'], book)).toMatchObject({ verified: 1, covered: 1, extra: 1 });
    expect(artistFit(zh('有点想你', 'Aioz'), ['董唧唧'], book).covered).toBe(0);
  });

  it('reads a name that only holds the credit’s words as partial', () => {
    expect(artistFit(zh('夏天的风', '蔡恩雨 Priscilla Abby'), ['蔡恩雨'], book)).toMatchObject({ verified: 0, partial: 1 });
  });

  it('sees every artist of a group credit, so the full group beats one member alone', () => {
    const row = zh('潮汐', 'IN-K', '安苏羽', '傅梦彤');
    expect(artistFit(row, ['IN-K, 安蘇羽 & 傅夢彤', 'IN-K, Suyu An & Mengtong Fu'], book)).toMatchObject({ verified: 3, extra: 0 });
    expect(artistFit(row, ['傅夢彤'], book)).toMatchObject({ covered: 1, extra: 0 });
  });

  it('counts a duet as extra for a solo row, so the solo cut can be preferred', () => {
    const row = zh('雀跃', 'Ren Ran');
    expect(artistFit(row, ['任然', 'Renran'], book)).toMatchObject({ verified: 1, extra: 0 });
    expect(artistFit(row, ['任然 & 小來哥', 'Renran & 小来哥'], book)).toMatchObject({ verified: 1, extra: 1 });
  });

  it('reads a Chinese name without its surname as partial ("Wanting" is 曲婉婷)', () => {
    expect(artistFit(zh('我的歌声里', 'Wanting'), ['曲婉婷'], book)).toMatchObject({ verified: 0, partial: 1 });
    expect(artistFit(zh('我的歌声里', 'Wanting'), ['孫燕姿'], book).covered).toBe(0);
  });
});

describe('learnAliases', () => {
  it('learns from a solo credit', () => {
    const book = createAliasBook();
    learnAliases(zh('晴天', 'Jay Chou'), ['周杰倫', 'Jay Chou'], book);
    expect(artistMatches(zh('七里香', 'Jay Chou'), ['周杰倫'], book)).toBe(true);
  });

  it('learns nothing from a duet, which would merge two different people', () => {
    const book = createAliasBook();
    learnAliases(zh('Follow', '梨冻紧'), ['梨凍緊 & Wiz_H張子豪'], book);
    learnAliases(zh('Follow', '梨冻紧', 'Wiz_H張子豪'), ['梨凍緊'], book);
    expect(artistMatches(zh('其他', 'Wiz_H張子豪'), ['梨凍緊'], book)).toBe(false);
  });
});

describe('createAliasBook', () => {
  it('links spellings transitively', () => {
    const book = createAliasBook();
    book.learn(['jaychou', '周杰倫']);
    book.learn(['周杰倫', 'zhoujielun']);
    expect(book.root('jaychou')).toBe(book.root('zhoujielun'));
    expect(book.root('jaychou')).not.toBe(book.root('林俊傑'));
  });
});

describe('buildSong', () => {
  it('gives a Chinese song its pinyin, its English title and both scripts as alternatives', () => {
    const song = buildSong(zh('晴天', 'Jay Chou'), track(), [{ trackName: 'Sunny Day', artistName: 'Jay Chou' }], 'tw');
    expect(song).toMatchObject({
      id: '535824738',
      lang: 'zh',
      title: '晴天',
      artist: 'Jay Chou',
      subtitle: 'qíng tiān · Sunny Day',
      year: 2003,
      album: '葉惠美',
      country: 'tw',
      artworkUrl: 'https://img.test/a/600x600bb.jpg',
    });
    expect(song.titleAlt).toEqual(expect.arrayContaining(['Sunny Day', 'qing tian']));
    expect(song.artistAlt).toContain('周杰倫');
  });

  it('shows the English artist under a Chinese one when another store has it', () => {
    const song = buildSong(zh('晴天', '周杰倫'), track(), [{ trackName: 'Sunny Day', artistName: 'Jay Chou' }], 'tw');
    expect(song.artistEn).toBe('Jay Chou');
  });

  it('gives a romanised Japanese title its native spelling as the subtitle and an alternative', () => {
    const hit = track({ trackId: 1, trackName: '廻廻奇譚', artistName: 'Eve' });
    const song = buildSong(ja('Kaikai Kitan', 'Eve'), hit, [{ trackName: 'Kaikai Kitan', artistName: 'Eve' }], 'jp');
    expect(song.title).toBe('Kaikai Kitan');
    expect(song.subtitle).toBe('廻廻奇譚');
    expect(song.titleAlt).toContain('廻廻奇譚');
  });

  it('gives a native Japanese title its romaji as the subtitle', () => {
    const hit = track({ trackId: 2, trackName: '夜に駆ける', artistName: 'YOASOBI' });
    const song = buildSong(ja('夜に駆ける', 'YOASOBI'), hit, [{ trackName: 'Yoru ni Kakeru', artistName: 'YOASOBI' }], 'jp');
    expect(song.subtitle).toBe('Yoru ni Kakeru');
  });

  it('shows the title without version or feature notes', () => {
    // (Typing the full text still counts as correct: the app's matching ignores decoration, so it needs no alternative.)
    const s = zh('心跳的證明 - 電影《一吻定情》心動版主題曲', '刘人语');
    const song = buildSong(s, track({ trackName: '心跳的證明' }), [], 'tw');
    expect(song.title).toBe('心跳的證明');
  });

  it('keeps a bracketed second title findable, e.g. "Jumping Machine (跳楼机)"', () => {
    const song = buildSong(zh('Jumping Machine (跳楼机)', 'LBI'), track({ trackName: 'Jumping Machine (跳楼机)', artistName: 'LBI' }), [], 'tw');
    expect(song.title).toBe('Jumping Machine');
    expect(song.titleAlt).toContain('跳楼机');
  });

  it('leaves out the subtitle when there is nothing useful to show', () => {
    const song = buildSong(ja('Lemon', 'Kenshi Yonezu'), track({ trackName: 'Lemon', artistName: '米津玄師' }), [], 'jp');
    expect(song).not.toHaveProperty('subtitle');
    expect(song).not.toHaveProperty('artistEn');
  });
});
