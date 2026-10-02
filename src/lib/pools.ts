// The song lists a round can draw from, built from the data files. Shared by the browser (src/lib/songData.ts) and the
// party server (server/party.ts), so both pick from exactly the same songs. Node runs this file directly, so keep it to
// erasable TypeScript and give relative imports their `.ts` extension.
import type { Pool, Settings, Song } from '../types.ts';
import { pickFromList, pickSong } from './game.ts';
import { buildListPool, type ListPool, type PlaylistInfo, type PlaylistsFile } from './lists.ts';
import { buildSgPool, type SgSnapshot } from './sgNow.ts';

export interface SongPools {
  /** The curated language catalogue ("My mix"). */
  catalog: readonly Song[];
  /** Your Spotify playlists, as resolved by scripts/build-playlists.mjs. */
  playlists: readonly PlaylistInfo[];
  mine: ListPool;
  /** This week's Singapore chart. */
  sg: ListPool;
  /** Every song that can be an answer, one per id (the catalogue's copy wins), for the guess box. */
  all: readonly Song[];
}

export function buildPools(catalog: readonly Song[], playlistsFile: PlaylistsFile, sgSnapshot: SgSnapshot | null): SongPools {
  const playlists = playlistsFile.lists;
  const mine = buildListPool(
    playlists.flatMap((l) => l.entries),
    catalog,
  );
  const sg = buildSgPool(sgSnapshot, catalog);
  const all = [...new Map([...sg.extra, ...mine.extra, ...catalog].map((s) => [s.id, s] as const)).values()];
  return { catalog, playlists, mine, sg, all };
}

/** The songs a round can draw from for each list. */
export function poolSongs(pools: SongPools, pool: Pool): readonly Song[] {
  return pool === 'mine' ? pools.mine.pool : pool === 'sg-now' ? pools.sg.pool : pools.catalog;
}

/**
 * The next song for these settings. The chart is one list and is drawn from as is; the mix and playlists are balanced
 * across the chosen languages and filtered by era. `played` is updated by the pickers when a list runs out.
 */
export function pickNext(
  pools: SongPools,
  settings: Pick<Settings, 'pool' | 'langs' | 'era'>,
  played: Set<string>,
  rand: () => number = Math.random,
): Song | null {
  return settings.pool === 'sg-now'
    ? pickFromList(pools.sg.pool, played, rand)
    : pickSong(poolSongs(pools, settings.pool), settings, played, rand);
}
