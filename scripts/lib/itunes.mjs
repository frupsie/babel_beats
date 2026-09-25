// A polite, cached client for Apple's iTunes Search and Lookup APIs, shared by the catalogue and playlist builders.
// Apple documents roughly 20 calls a minute; we pace at about one call per second and a half, cache every answer on
// disk (so re-runs cost nothing), and back off for 30 s if Apple starts refusing.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

/** Recordings we never want: karaoke, covers, live takes, remixes, instrumentals... */
export const UNWANTED =
  /\b(live|remix|acoustic|demo|sped up|slowed|reverb|instrumental|karaoke|cover|tribute|lullaby|8-bit|piano version|made famous|originally performed)\b|ライブ|カラオケ|オルゴール|伴奏|翻唱|演奏/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const pick = (r) => ({
  trackId: r.trackId,
  trackName: r.trackName,
  artistName: r.artistName,
  collectionName: r.collectionName ?? '',
  releaseDate: r.releaseDate,
  previewUrl: r.previewUrl,
  artworkUrl100: r.artworkUrl100,
  trackViewUrl: r.trackViewUrl,
});

export async function createItunes({ cacheFile, gapMs = 1800, refresh = false }) {
  await mkdir(path.dirname(cacheFile), { recursive: true });
  const cache = !refresh && existsSync(cacheFile) ? JSON.parse(await readFile(cacheFile, 'utf8')) : {};
  let dirty = 0;
  let gap = gapMs;
  let lastCall = 0;

  async function saveCache() {
    await writeFile(cacheFile, JSON.stringify(cache));
    dirty = 0;
  }

  async function getJson(url, label) {
    for (let attempt = 1; attempt <= 6; attempt++) {
      await sleep(Math.max(0, lastCall + gap - Date.now()));
      lastCall = Date.now();
      let res;
      try {
        res = await fetch(url);
      } catch (err) {
        console.warn(`  network error (${err.message}), retry ${attempt}`);
        await sleep(5000);
        continue;
      }
      if (res.ok) return res.json();
      if (res.status === 403 || res.status === 429 || res.status >= 500) {
        gap = Math.min(gap * 1.5, 6000);
        console.warn(`  HTTP ${res.status}, backing off 30s (gap now ${Math.round(gap)}ms)`);
        await sleep(30_000);
        continue;
      }
      throw new Error(`iTunes request failed: HTTP ${res.status} for ${label}`);
    }
    throw new Error(`iTunes request kept failing for ${label}`);
  }

  /** Up to 25 songs matching `term` in one storefront. */
  async function search(term, country) {
    const key = `${country}|${term}`;
    if (cache[key]) return cache[key];
    const params = new URLSearchParams({ term, country, media: 'music', entity: 'song', limit: '25' });
    const json = await getJson(`https://itunes.apple.com/search?${params}`, `${term} (${country})`);
    cache[key] = json.results.map(pick);
    if (++dirty >= 10) await saveCache();
    return cache[key];
  }

  /**
   * Looks tracks up by id in one storefront (100 per call). Returns a Map of the ones that exist there; a track
   * missing from a storefront is remembered too, so it is never asked for again.
   */
  async function lookupMany(ids, country) {
    const result = new Map();
    const todo = [];
    for (const id of new Set(ids.map(String))) {
      const hit = cache[`lookup|${country}|${id}`];
      if (hit === undefined) todo.push(id);
      else if (hit) result.set(id, hit);
    }
    for (let i = 0; i < todo.length; i += 100) {
      const batch = todo.slice(i, i + 100);
      const json = await getJson(
        `https://itunes.apple.com/lookup?id=${batch.join(',')}&country=${country}&entity=song`,
        `lookup of ${batch.length} ids (${country})`,
      );
      const found = new Map((json.results ?? []).filter((r) => r.trackId).map((r) => [String(r.trackId), pick(r)]));
      for (const id of batch) {
        const t = found.get(id) ?? 0;
        cache[`lookup|${country}|${id}`] = t;
        if (t) result.set(id, t);
      }
      dirty += 1;
    }
    if (dirty >= 10) await saveCache();
    return result;
  }

  return { search, lookupMany, saveCache };
}
