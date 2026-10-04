import type { Song } from '../types.ts';
import { compact, hasHan, stripDecor, titleKey } from './text.ts';

export interface IndexedSong {
  song: Song;
  titles: string[];
  /** Each spelling of the artist credit as a whole ("Mark Ronson, Bruno Mars"). */
  artists: string[];
  /** The artist named first in each spelling: the song's main artist. */
  lead: string[];
  /** Every other artist on the song: the rest of the credit, and names in a "(feat. X)" in the title. */
  featured: string[];
}

// What separates the artists on a song: "A, B", "A & B", "A feat. B", "A with B", "A and B" (and the full-width and
// Japanese/Chinese punctuation versions of those).
const CREDIT_SEPARATOR = /\s*(?:[,;&、，；＆×]|\bfeat\.?|\bft\.?|\bfeaturing\b|\bwith\b|\band\b)\s*/i;
// A title's "(feat. X)", "[ft. X]" or "(with X)".
const TITLE_FEATURE = /[([（［]\s*(?:feat\.?|ft\.?|featuring|with)\s+([^)\]）］]+)[)\]）］]/gi;

/** The artists named in one credit: "Metro Boomin, The Weeknd & 21 Savage" is three. */
export function creditsOf(credit: string): string[] {
  return credit.split(CREDIT_SEPARATOR).map((name) => name.trim()).filter(Boolean);
}

/** The artists a title names as featured: "Starboy (feat. Daft Punk)" gives Daft Punk. */
export function featuredInTitle(title: string): string[] {
  return [...title.matchAll(TITLE_FEATURE)].flatMap((m) => creditsOf(m[1]!));
}

/** Pre-computes the folded strings that searching compares against. */
export function indexSongs(songs: readonly Song[]): IndexedSong[] {
  return songs.map((song) => {
    const spellings = [song.artist, ...song.artistAlt];
    const lead = new Set<string>();
    const featured = new Set<string>();
    for (const spelling of spellings) {
      const [first, ...rest] = creditsOf(spelling);
      lead.add(compact(first ?? spelling));
      for (const name of rest) featured.add(compact(name));
    }
    for (const title of [song.title, ...song.titleAlt]) for (const name of featuredInTitle(title)) featured.add(compact(name));
    lead.delete('');
    featured.delete('');
    for (const name of lead) featured.delete(name); // the main artist wins when a name is both
    return {
      song,
      titles: [song.title, ...song.titleAlt].map(titleKey),
      artists: spellings.map(compact),
      lead: [...lead],
      featured: [...featured],
    };
  });
}

function scoreToken(entry: IndexedSong, token: string): number {
  let best = 0;
  for (const t of entry.titles) {
    if (t === token) best = Math.max(best, 100);
    else if (t.startsWith(token)) best = Math.max(best, 80);
    else if (t.includes(token)) best = Math.max(best, 50);
  }
  for (const a of entry.artists) {
    // A whole artist name outranks a title that merely starts with it: typing "Ado" should list Ado's songs, not "Adore You".
    if (a === token) best = Math.max(best, 90);
    else if (a.startsWith(token)) best = Math.max(best, 45);
    else if (a.includes(token)) best = Math.max(best, 30);
  }
  // The main artist of a song with several, typed in full, ranks like a solo artist; a featured artist just below.
  for (const a of entry.lead) if (a === token) best = Math.max(best, 90);
  for (const a of entry.featured) {
    if (a === token) best = Math.max(best, 85);
    else if (a.startsWith(token)) best = Math.max(best, 40);
    else if (a.includes(token)) best = Math.max(best, 25);
  }
  return best;
}

/** Extra rank when the whole query is exactly one artist's name ("bruno mars"), which no single word of it could show. */
function phraseBonus(entry: IndexedSong, phrase: string): number {
  if (entry.lead.includes(phrase) || entry.artists.includes(phrase)) return 100;
  if (entry.featured.includes(phrase)) return 90;
  return 0;
}

/** How many suggestions the guess box lists at most: enough for every song of any one artist, with room to spare. */
export const MAX_SUGGESTIONS = 100;

const KANA = /[぀-ヿ]/;

/**
 * Autocomplete search. Every word of the query must match a title or artist spelling
 * (native script, romaji, pinyin, English gloss...), so "jay chou qing", "晴天" and "sunny day" all find 晴天.
 */
export function searchSongs(index: readonly IndexedSong[], query: string, limit = MAX_SUGGESTIONS): Song[] {
  const tokens = query
    .normalize('NFKC')
    .toLowerCase()
    .split(/\s+/)
    .map(compact)
    .filter(Boolean);
  if (tokens.length === 0) return [];
  const phrase = tokens.join('');
  // One CJK character is already a meaningful query; one Latin letter is not.
  const minLength = hasHan(query) || KANA.test(query) ? 1 : 2;
  if (tokens.join('').length < minLength) return [];

  const scored: Array<{ song: Song; score: number }> = [];
  for (const entry of index) {
    let total = 0;
    for (const token of tokens) {
      const score = scoreToken(entry, token);
      if (score === 0) {
        total = 0;
        break;
      }
      total += score;
    }
    if (total > 0) scored.push({ song: entry.song, score: tokens.length > 1 ? total + phraseBonus(entry, phrase) : total });
  }
  scored.sort((a, b) => b.score - a.score || a.song.title.localeCompare(b.song.title));
  return scored.slice(0, limit).map((x) => x.song);
}

/** True when the typed text is exactly the song's title (or one of its alternate spellings). */
export function isCorrectTitle(input: string, song: Song): boolean {
  const typed = compact(stripDecor(input));
  if (!typed) return false;
  return [song.title, ...song.titleAlt].some((t) => titleKey(t) === typed);
}
