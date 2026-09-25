// The "Singapore now" list: this week's Apple Music Singapore top 100.
// Pure helpers shared by the app and scripts/snapshot-sg.mjs (Node runs this file directly, so keep it to
// erasable TypeScript: no enums or namespaces).
import type { LangCode, Song } from '../types';
import { buildListPool, matchesSong, type ListEntry, type ListPool } from './lists.ts';

/** The fields we read from one item of Apple's chart feed. */
export interface FeedItem {
  id: string;
  name: string;
  artistName: string;
  releaseDate?: string;
  artworkUrl100?: string;
  url?: string;
}

/** The fields we read from an iTunes lookup result (this is where the preview URL lives). */
export interface LookupTrack {
  trackId: number | string;
  previewUrl?: string;
  artworkUrl100?: string;
  trackViewUrl?: string;
  collectionName?: string;
  releaseDate?: string;
}

/** One chart position (see ListEntry). */
export type SgEntry = ListEntry;

export interface SgSnapshot {
  source: string;
  feedUrl: string;
  /** When Apple last updated the chart (ISO). */
  chartUpdated: string;
  /** When we downloaded it (ISO). */
  fetchedAt: string;
  entries: SgEntry[];
}

const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
const HAN = /\p{Script=Han}/u;

/** Best guess at a chart song's language from its script. It cannot tell Korean or Malay from English. */
export function guessLang(text: string): LangCode {
  if (KANA.test(text)) return 'ja';
  if (HAN.test(text)) return 'zh';
  return 'en';
}

/** Text inside brackets: "Jumping Machine (跳楼机)" gives ["跳楼机"]. Apple often puts the other-language title there. */
export function bracketed(title: string): string[] {
  const out: string[] = [];
  for (const m of title.matchAll(/[(（[【]([^()（）[\]【】]+)[)）\]】]/g)) {
    const inner = m[1]?.trim();
    if (inner) out.push(inner);
  }
  return out;
}

function releaseYear(date?: string): number {
  const y = Number(date?.slice(0, 4));
  return Number.isFinite(y) && y > 1900 ? y : new Date().getFullYear();
}

/** Is this chart item the same recording as a curated catalogue song? Same title spelling and a matching artist. */
function sameSong(item: FeedItem, c: Song): boolean {
  return matchesSong({ id: String(item.id), titles: [item.name], artists: [item.artistName] }, c);
}

/**
 * Turns the chart feed plus the lookup results into playable entries. Songs with no preview are dropped, but
 * every entry keeps its real chart position. A song that is already in the curated catalogue is flagged so the
 * game can use the catalogue's own copy (that keeps "is this guess right?" a simple id comparison).
 */
export function buildSgEntries(
  items: readonly FeedItem[],
  tracks: ReadonlyMap<string, LookupTrack>,
  catalog: readonly Song[],
): SgEntry[] {
  const entries: SgEntry[] = [];
  const seen = new Set<string>();
  items.forEach((item, i) => {
    const id = String(item.id);
    const track = tracks.get(id);
    if (!track?.previewUrl) return;

    const match = catalog.find((c) => sameSong(item, c));
    const key = match ? `catalog:${match.id}` : `chart:${id}`;
    if (seen.has(key)) return; // two versions of one song: keep the higher-ranked one
    seen.add(key);

    const art = track.artworkUrl100 ?? item.artworkUrl100 ?? '';
    const song: Song = {
      id,
      lang: guessLang(`${item.name} ${item.artistName}`),
      title: item.name,
      titleAlt: [...new Set(bracketed(item.name))],
      artist: item.artistName,
      artistAlt: [],
      year: releaseYear(track.releaseDate ?? item.releaseDate),
      album: track.collectionName ?? '',
      previewUrl: track.previewUrl,
      artworkUrl: art.replace('/100x100bb.', '/600x600bb.'),
      trackViewUrl: track.trackViewUrl ?? item.url ?? '',
      country: 'sg',
      fromChart: true,
    };
    entries.push(match ? { rank: i + 1, catalogId: match.id, song } : { rank: i + 1, song });
  });
  return entries;
}

export type SgPool = ListPool;

/** The playable pool for Singapore mode. `pool` is what a round draws from; `rank` is each song's chart position. */
export function buildSgPool(snapshot: Pick<SgSnapshot, 'entries'> | null, catalog: readonly Song[]): SgPool {
  return buildListPool(snapshot?.entries ?? [], catalog);
}

/** Whole and fractional days since `fetchedAt`; Infinity when the date is missing or unreadable. */
export function ageInDays(fetchedAt: string | undefined, now: number = Date.now()): number {
  const t = fetchedAt ? Date.parse(fetchedAt) : Number.NaN;
  return Number.isFinite(t) ? Math.max(0, (now - t) / 86_400_000) : Number.POSITIVE_INFINITY;
}
