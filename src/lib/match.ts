import type { Song } from '../types';
import { compact, hasHan, stripDecor, titleKey } from './text';

export interface IndexedSong {
  song: Song;
  titles: string[];
  artists: string[];
}

/** Pre-computes the folded strings that searching compares against. */
export function indexSongs(songs: readonly Song[]): IndexedSong[] {
  return songs.map((song) => ({
    song,
    titles: [song.title, ...song.titleAlt].map(titleKey),
    artists: [song.artist, ...song.artistAlt].map(compact),
  }));
}

function scoreToken(entry: IndexedSong, token: string): number {
  let best = 0;
  for (const t of entry.titles) {
    if (t === token) best = Math.max(best, 100);
    else if (t.startsWith(token)) best = Math.max(best, 80);
    else if (t.includes(token)) best = Math.max(best, 50);
  }
  for (const a of entry.artists) {
    if (a === token) best = Math.max(best, 60);
    else if (a.startsWith(token)) best = Math.max(best, 45);
    else if (a.includes(token)) best = Math.max(best, 30);
  }
  return best;
}

const KANA = /[぀-ヿ]/;

/**
 * Autocomplete search. Every word of the query must match a title or artist spelling
 * (native script, romaji, pinyin, English gloss...), so "jay chou qing", "晴天" and "sunny day" all find 晴天.
 */
export function searchSongs(index: readonly IndexedSong[], query: string, limit = 8): Song[] {
  const tokens = query
    .normalize('NFKC')
    .toLowerCase()
    .split(/\s+/)
    .map(compact)
    .filter(Boolean);
  if (tokens.length === 0) return [];
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
    if (total > 0) scored.push({ song: entry.song, score: total });
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
