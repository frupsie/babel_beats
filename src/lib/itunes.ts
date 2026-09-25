import type { Song } from '../types';

interface ItunesLookupResult {
  trackId?: number;
  previewUrl?: string;
  artworkUrl100?: string;
}

export interface ResolvedTrack {
  previewUrl: string;
  artworkUrl: string;
}

/**
 * Asks iTunes for a fresh preview URL right before playing. If that fails for any reason we fall
 * back to the URL baked into the catalog, so the game still works when the lookup is slow or blocked.
 * Rethrows only when the caller aborted.
 */
export async function resolveTrack(song: Song, signal?: AbortSignal): Promise<ResolvedTrack> {
  const fallback: ResolvedTrack = { previewUrl: song.previewUrl, artworkUrl: song.artworkUrl };
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), 4000);
  const onAbort = () => timeout.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    const url = `https://itunes.apple.com/lookup?id=${encodeURIComponent(song.id)}&country=${song.country}&entity=song`;
    const res = await fetch(url, { signal: timeout.signal });
    if (!res.ok) return fallback;
    const json = (await res.json()) as { results?: ItunesLookupResult[] };
    const hit = json.results?.find((r) => String(r.trackId) === song.id && r.previewUrl);
    if (!hit?.previewUrl) return fallback;
    return {
      previewUrl: hit.previewUrl,
      artworkUrl: hit.artworkUrl100?.replace('/100x100bb.', '/600x600bb.') ?? song.artworkUrl,
    };
  } catch (err) {
    if (signal?.aborted) throw err;
    return fallback;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}
