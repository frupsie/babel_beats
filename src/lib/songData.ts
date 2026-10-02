// The browser's copy of the song lists, built once from the bundled data files.
import catalogJson from '../data/catalog.json';
import playlistsJson from '../data/playlists.json';
import sgSnapshotJson from '../data/sg-now.json';
import type { Song } from '../types';
import type { PlaylistsFile } from './lists';
import { indexSongs } from './match';
import { buildPools } from './pools';
import type { SgSnapshot } from './sgNow';

export const SG_SNAPSHOT = sgSnapshotJson as unknown as SgSnapshot;
export const POOLS = buildPools(catalogJson as unknown as Song[], playlistsJson as unknown as PlaylistsFile, SG_SNAPSHOT);

/** The guess box searches every song that can be the answer. */
export const INDEX = indexSongs(POOLS.all);

const byId = new Map(POOLS.all.map((s) => [s.id, s] as const));
/** Looks a song up by its iTunes id, in any list. */
export const songById = (id: string): Song | undefined => byId.get(id);
