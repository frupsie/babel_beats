// The decisions behind scripts/build-playlists.mjs: is this Apple hit really the song on the Spotify row, and what
// should the finished song look like? Kept apart from the script so it can be unit-tested.
import { compact, hasHan, stripDecor, titleKey } from '../../src/lib/text.ts';
import { bracketed } from '../../src/lib/sgNow.ts';
import { plainPinyin, tonedPinyin, uniq, variants } from './han.mjs';
import { UNWANTED } from './itunes.mjs';

const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
export const isNativeScript = (s) => KANA.test(s) || hasHan(s);

/**
 * The compact spellings of one name: as written, and (for a name of Latin words) with its words sorted, so that
 * "Ronghao Li" and "Li Ronghao", which Spotify and Apple write in different orders, share a key.
 */
function nameKeys(name) {
  const words = name.split(/\s+/).map(compact).filter(Boolean);
  const keys = [compact(name)];
  if (words.length >= 2 && words.every((w) => /^[a-z0-9]+$/.test(w))) keys.push([...words].sort().join(''));
  return keys;
}

const CJK = '\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}';
const CREDIT_WORD = new RegExp(`[${CJK}]+|[^${CJK}\\s&,、/+]+`, 'gu');

/** The words of one name, compacted: "Aioz 劉思達" gives aioz and 劉思達; "Corki刘宗鑫" gives corki and 刘宗鑫. */
const creditWords = (name) => new Set((name.match(CREDIT_WORD) ?? []).map(compact).filter(Boolean));

/** One artist, as matching sees them: every spelling as compact keys (2+ characters), and the words of each spelling. */
const artistProfile = (name, isZh) => ({
  keys: artistKeysOf([name], isZh).filter((k) => k.length >= 2),
  words: variants(name, isZh).map(creditWords),
});

/** Everything about one Spotify row that matching needs, computed once. */
export function prepare(raw, lang) {
  const isZh = lang === 'zh';
  const base = stripDecor(raw.title);
  const credits = raw.artists.map((name) => artistProfile(name, isZh));
  return {
    ...raw,
    lang,
    base,
    forms: new Set([raw.title, base].flatMap((t) => variants(t, isZh)).map(titleKey)),
    credits,
    artistKeys: credits.flatMap((c) => c.keys),
  };
}

/**
 * Marks of a recording that is not the original besides those `UNWANTED` knows: DJ and club mixes, live and concert
 * takes, lyrical and unplugged versions, piano and violin takes, speed changes, TV-size edits, English-language
 * editions. Narrow on purpose (加速版, not 加速), so ordinary titles are not caught.
 */
const RECUT = new RegExp(
  [
    String.raw`\bdj`,
    String.raw`\b(?:mix|piano|nightcore|off ?vocal|tv ?size|anime size|concert|tour|lo-?fi|8d)\b`,
    String.raw`\benglish (?:edition|ver(?:sion|\.)?)`,
    String.raw`\b\d(?:\.\d+)?x\b`,
    '混音|串燒|串烧|現場|现场|演唱[會会]|抒情版|合唱版|不插[電电]|純音樂|纯音乐|鋼琴版|钢琴版|吉他版|小提琴版',
    '降速版|加速版|變速版|变速版|電音版|电音版|卡點節奏|卡点节奏|環繞版|环绕版|健康版|概念版',
    '英語版|英文版|オフボーカル|コンサート|ツアー',
  ].join('|'),
  'i',
);
const isRecut = (text) => UNWANTED.test(text) || RECUT.test(text);

/** An Apple result we would accept as the song: has a preview, and isn't a live/remix/karaoke/DJ re-cut the row doesn't ask for. */
export const wanted = (r, s) =>
  Boolean(r.previewUrl && r.trackName) &&
  !(isRecut(r.trackName) && !isRecut(s.title)) &&
  !(isRecut(r.collectionName) && !isRecut(s.title));

const RELEASE_SUFFIX = /\s-\s(Single|EP|シングル)$/i;

/**
 * Among releases of one recording that came out the same day, the one named after the song is the original: its single
 * (0), then its EP or self-titled album (1). Any other release, such as a compilation, comes last (2).
 */
export function releaseKind(r) {
  const named = titleKey(r.collectionName.replace(RELEASE_SUFFIX, '')) === titleKey(r.trackName);
  if (!named) return 2;
  return /^(?:single|シングル)$/i.test(RELEASE_SUFFIX.exec(r.collectionName)?.[1] ?? '') ? 0 : 1;
}

/**
 * Is one of Apple's titles the row's title? Apple's text is folded to Simplified/Traditional too (its 説 and 裡 are
 * not always the row's 說 and 里), and a second title in brackets counts: Apple's "羅生門(Follow)" is Spotify's "Follow".
 */
export const titleMatches = (s, titles) =>
  titles.some((t) => [t, ...bracketed(t)].some((part) => variants(part, s.lang === 'zh').some((v) => s.forms.has(titleKey(v)))));

/**
 * Artist aliases ("Jay Chou" = "周杰倫" = "zhou jie lun"), as groups of spellings known to be one person.
 * Seeded from the curated catalogue and extended by every song that matches, so one confirmed song teaches the rest.
 */
export function createAliasBook() {
  const parent = new Map();
  const root = (key) => {
    let r = key;
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r);
    return r;
  };
  return {
    root,
    learn(keys) {
      const known = [...new Set(keys)].filter((k) => k.length >= 2);
      for (const k of known) if (!parent.has(k)) parent.set(k, k);
      for (const k of known.slice(1)) parent.set(root(k), root(known[0]));
    },
  };
}

/** All the ways an artist name might be spelled: as given, Simplified/Traditional, pinyin, and words in another order. */
export function artistKeysOf(names, isZh) {
  const keys = new Set();
  for (const name of names) {
    for (const v of variants(name, isZh)) for (const k of nameKeys(v)) keys.add(k);
    if (hasHan(name)) keys.add(compact(plainPinyin(name)));
  }
  keys.delete('');
  return [...keys];
}

/** Is one set of words wholly inside the other? Needs 3+ characters, so a short name like "EN" is never found inside "EN Wang". */
function holdsAll(a, b) {
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  return small.size > 0 && [...small].join('').length >= 3 && [...small].every((w) => big.has(w));
}

const CREDIT_SEPARATOR = /\s*[&,、/+]\s*|\s+(?:x|×|and|with|feat\.?|ft\.?)\s+/i;

/** The people one credit names: "IN-K, 安蘇羽 & 傅夢彤" is three. */
const creditParts = (credit) => credit.split(CREDIT_SEPARATOR).map((part) => part.trim()).filter(Boolean);

/** A three-character Chinese name without its surname, as pinyin: 曲婉婷 gives "wanting", which is how Spotify may show her. */
function givenNamePinyin(name) {
  const han = name.replace(/\s+/g, '');
  return han.length === 3 && hasHan(han) ? compact(plainPinyin(han.slice(1))) : '';
}

/**
 * How the credit on an Apple track relates to the row's artists. Each of the row's artists is looked for among the people
 * the credit names, in every spelling Apple's stores use:
 *   verified  the same spelling in any script, or spellings already known to be one artist;
 *   partial   one name holds the other's whole words ("蔡恩雨 Priscilla Abby" and 蔡恩雨), or is a Chinese name minus its surname;
 *   extra     people credited on the track who are not among the row's artists.
 * Words, not letters: "Uru" is not found inside "Miyuki Tsurugi".
 */
export function artistFit(s, artists, book) {
  const isZh = s.lang === 'zh';
  const people = artists
    .flatMap((credit) => [credit, ...creditParts(credit)])
    .map((name) => ({ ...artistProfile(name, isZh), given: givenNamePinyin(name) }));
  let verified = 0;
  let partial = 0;
  for (const mine of s.credits) {
    if (people.some((p) => mine.keys.some((a) => p.keys.some((k) => a === k || book.root(a) === book.root(k))))) verified += 1;
    else if (
      people.some(
        (p) =>
          mine.words.some((words) => p.words.some((theirs) => holdsAll(words, theirs))) ||
          mine.keys.some((a) => a.length >= 5 && /^[a-z]+$/.test(a) && a === p.given),
      )
    )
      partial += 1;
  }
  const credited = Math.max(...artists.map((credit) => creditParts(credit).length));
  return { verified, partial, covered: verified + partial, extra: Math.max(0, credited - verified - partial) };
}

export const artistMatches = (s, artists, book) => artistFit(s, artists, book).covered > 0;

/**
 * Remember that these Apple spellings and the row's spellings are one artist. Only a solo credit on both sides teaches
 * anything: from a duet we could not tell which name belongs to whom, and would merge two people.
 */
export function learnAliases(s, artists, book) {
  if (s.artists.length !== 1 || artists.some((name) => CREDIT_SEPARATOR.test(name))) return;
  book.learn([...s.artistKeys, ...artistKeysOf(artists, s.lang === 'zh')]);
}

/** The finished song. `hit` is Apple's native-store result; `alts` are the same track as other stores spell it. */
export function buildSong(s, hit, alts, store) {
  const isZh = s.lang === 'zh';
  const altTitles = alts.map((t) => t.trackName);
  const altArtists = alts.map((t) => t.artistName);
  const allTitles = [hit.trackName, ...altTitles];

  const titleAlt = uniq([
    s.title,
    ...allTitles,
    ...bracketed(s.title),
    ...(isZh ? [plainPinyin(s.base), ...variants(s.base, true).slice(1)] : []),
  ]).filter((x) => titleKey(x) !== titleKey(s.base));

  // The line under the title: pinyin and English for Chinese, the "other script" title for Japanese.
  const otherScript = allTitles.map(stripDecor).find((t) => isNativeScript(t) !== isNativeScript(s.base));
  const latinAlt = allTitles.map(stripDecor).find((t) => !isNativeScript(t) && titleKey(t) !== titleKey(s.base));
  const subtitle = isZh ? uniq([tonedPinyin(s.base), latinAlt]).join(' · ') : otherScript;

  const artist = s.artists.join(', ');
  const artistAlt = uniq(
    [hit.artistName, ...altArtists, ...s.artists.flatMap((a) => [plainPinyin(a), ...variants(a, isZh).slice(1)])].filter(
      (a) => !s.artists.some((mine) => compact(mine) === compact(a)),
    ),
  );
  const artistEn = isNativeScript(s.artists[0] ?? '') ? altArtists.find((a) => !isNativeScript(a)) : undefined;

  return {
    id: String(hit.trackId),
    lang: s.lang,
    title: s.base,
    titleAlt,
    ...(subtitle ? { subtitle } : {}),
    artist,
    artistAlt,
    ...(artistEn ? { artistEn } : {}),
    year: Number(hit.releaseDate.slice(0, 4)),
    album: hit.collectionName,
    previewUrl: hit.previewUrl,
    artworkUrl: hit.artworkUrl100.replace('/100x100bb.', '/600x600bb.'),
    trackViewUrl: hit.trackViewUrl,
    country: store,
  };
}
