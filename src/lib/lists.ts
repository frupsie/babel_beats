// Helpers shared by every "list of songs" the game can play besides the All Time catalogue: this week's Singapore
// chart and your own playlists. Pure functions; scripts/*.mjs run this file directly under Node, so keep it to
// erasable TypeScript (no enums or namespaces).
import type { LangCode, Song } from '../types.ts';
import { creditsOf } from './match.ts';
import { compact, titleKey } from './text.ts';

/** One position in a list. `song` is always complete; `catalogId` marks it as a song already in the All Time catalogue. */
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
 * Is this candidate the same recording as a All Time catalogue song? Same id, or a matching title spelling
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

/**
 * The catalogue's copy of a list entry's song, if it is in the catalogue. `catalogId` goes stale when the catalogue is
 * rebuilt and Apple hands a song a new track id (a saved chart or playlist then still names the old one), so an entry
 * whose id is gone is matched again by title and artist rather than showing up as a second copy of the same song.
 */
function catalogCopy(entry: ListEntry, byId: ReadonlyMap<string, Song>, catalog: readonly Song[]): Song | undefined {
  if (!entry.catalogId) return undefined;
  const own = byId.get(entry.catalogId);
  if (own) return own;
  const { song } = entry;
  const candidate = { titles: [song.title, ...song.titleAlt], artists: [song.artist, ...song.artistAlt] };
  return catalog.find((c) => matchesSong(candidate, c));
}

/**
 * The same catalogue with every artist added that a list credits on one of its songs and the catalogue's own credit
 * lacks: All Time has "Jay Chou" for a song that your playlist lists as "Jay Chou, Lara Liang". The song is the same
 * (same id); only its credit is fuller, so the guess box finds it by either artist and the answer card names both.
 */
export function withListCredits(catalog: readonly Song[], entries: readonly ListEntry[]): Song[] {
  const byId = new Map(catalog.map((s) => [s.id, s] as const));
  const added = new Map<string, Map<string, string>>(); // catalogue id -> folded name -> name as written
  for (const entry of entries) {
    const own = catalogCopy(entry, byId, catalog);
    if (!own) continue;
    const spellings = [own.artist, ...own.artistAlt];
    const known = new Set(spellings.flatMap(creditsOf).map(compact));
    const whole = spellings.map(compact);
    for (const name of creditsOf(entry.song.artist)) {
      const key = compact(name);
      // Already credited, in any spelling (or inside a longer credit that names it): nothing to add.
      if (!key || known.has(key) || whole.some((w) => w.includes(key))) continue;
      const names = added.get(own.id) ?? new Map<string, string>();
      names.set(key, name);
      added.set(own.id, names);
    }
  }
  if (added.size === 0) return [...catalog];
  return catalog.map((s) => {
    const names = added.get(s.id);
    return names ? { ...s, artist: [s.artist, ...names.values()].join(', ') } : s;
  });
}

export function buildListPool(entries: readonly ListEntry[], catalog: readonly Song[]): ListPool {
  const byId = new Map(catalog.map((s) => [s.id, s] as const));
  const pool: Song[] = [];
  const extra: Song[] = [];
  const rank = new Map<string, number>();
  for (const entry of entries) {
    const own = catalogCopy(entry, byId, catalog);
    const song = own ?? entry.song;
    if (rank.has(song.id)) continue;
    rank.set(song.id, entry.rank);
    pool.push(song);
    if (!own) extra.push(song);
  }
  return { pool, extra, rank };
}
