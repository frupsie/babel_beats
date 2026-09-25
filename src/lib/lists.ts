// Helpers shared by every "list of songs" the game can play besides the curated catalogue: this week's Singapore
// chart and your own playlists. Pure functions; scripts/*.mjs run this file directly under Node, so keep it to
// erasable TypeScript (no enums or namespaces).
import type { LangCode, Song } from '../types';
import { compact, titleKey } from './text.ts';

/** One position in a list. `song` is always complete; `catalogId` marks it as a song already in the curated catalogue. */
export interface ListEntry {
  rank: number;
  catalogId?: string;
  song: Song;
}

/** One of your Spotify playlists, resolved to songs Apple can preview. */
export interface PlaylistInfo {
  id: string;
  name: string;
  lang: LangCode;
  url: string;
  /** Date the playlist page was read, YYYY-MM-DD. */
  readAt: string;
  /** Songs the playlist had when it was read (after removing duplicates and re-cuts). */
  total: number;
  entries: ListEntry[];
}

export interface PlaylistsFile {
  lists: PlaylistInfo[];
}

export interface ListPool {
  /** Everything playable from the list. Catalogue songs are the catalogue's own objects, so guessing them works by id. */
  pool: Song[];
  /** Songs that are not in the catalogue. The guess box has to be able to find these too. */
  extra: Song[];
  /** Position in the list by song id. */
  rank: Map<string, number>;
}

/** A candidate recording described by every spelling we know for its title and artist. */
export interface Candidate {
  id?: string;
  titles: readonly string[];
  artists: readonly string[];
}

/**
 * Is this candidate the same recording as a curated catalogue song? Same id, or a matching title spelling
 * together with a matching artist spelling. Very short artist names must match exactly: "EN" should not match "Ken".
 */
export function matchesSong(candidate: Candidate, c: Song): boolean {
  if (candidate.id !== undefined && String(candidate.id) === c.id) return true;
  const keys = new Set(candidate.titles.map(titleKey));
  if (![c.title, ...c.titleAlt].some((t) => keys.has(titleKey(t)))) return false;
  const theirs = candidate.artists.map(compact).filter((f) => f.length >= 2);
  const ours = [c.artist, ...c.artistAlt].map(compact).filter((f) => f.length >= 2);
  return theirs.some((a) => ours.some((f) => a === f || (a.length >= 3 && f.length >= 3 && (a.includes(f) || f.includes(a)))));
}

export function buildListPool(entries: readonly ListEntry[], catalog: readonly Song[]): ListPool {
  const byId = new Map(catalog.map((s) => [s.id, s] as const));
  const pool: Song[] = [];
  const extra: Song[] = [];
  const rank = new Map<string, number>();
  for (const entry of entries) {
    const own = entry.catalogId ? byId.get(entry.catalogId) : undefined;
    const song = own ?? entry.song;
    if (rank.has(song.id)) continue;
    rank.set(song.id, entry.rank);
    pool.push(song);
    if (!own) extra.push(song);
  }
  return { pool, extra, rank };
}
