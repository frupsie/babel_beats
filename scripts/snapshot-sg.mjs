#!/usr/bin/env node
/**
 * Snapshots Apple Music Singapore's current top-100 songs into src/data/sg-now.json, for the game's
 * "Singapore now" list.
 *
 *   node scripts/snapshot-sg.mjs               always refresh
 *   node scripts/snapshot-sg.mjs --if-stale    refresh only when the snapshot is 7+ days old (npm runs this
 *                                              before `dev` and `build`, which is what makes the list weekly)
 *   node scripts/snapshot-sg.mjs --max-age=3   change that threshold, in days
 *
 * Why a script and not a fetch in the browser: Apple's chart feed sends no CORS header, so a web page can't
 * read it. If the download fails (after a couple of retries) the existing snapshot is kept, and with --if-stale
 * this script never fails the build. On GitHub, .github/workflows/refresh-sg-chart.yml runs it daily and commits
 * the new snapshot, so a deployed site refreshes itself.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ageInDays, buildSgEntries } from '../src/lib/sgNow.ts';
import { stripDecor, titleKey, hasHan } from '../src/lib/text.ts';
import { plainPinyin, tonedPinyin, uniq, variants } from './lib/han.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_FILE = path.join(ROOT, 'src', 'data', 'sg-now.json');
const CATALOG_FILE = path.join(ROOT, 'src', 'data', 'catalog.json');
// (rss.applemarketingtools.com redirects here; going straight to the new host saves a hop.)
// SG_FEED_URL overrides it, which is handy for testing what happens when the download fails.
const FEED_URL = process.env.SG_FEED_URL ?? 'https://rss.marketingtools.apple.com/api/v2/sg/music/most-played/100/songs.json';
const SOURCE = 'Apple Music Singapore · most played songs';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);
const ifStale = Boolean(args['if-stale']);
const maxAgeDays = Number(args['max-age'] ?? 7);

const existing = await readFile(OUT_FILE, 'utf8').then(JSON.parse, () => null);

if (ifStale && existing) {
  const age = ageInDays(existing.fetchedAt);
  if (age < maxAgeDays) {
    console.log(`Singapore snapshot is ${age.toFixed(1)} days old (limit ${maxAgeDays}); keeping it.`);
    process.exit(0);
  }
}

async function getJsonOnce(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status} from ${new URL(url).host}`), { status: res.status });
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Apple's chart server sometimes answers 504 or drops the connection; those are worth a couple more tries. */
async function getJson(url, { timeoutMs = 15_000, waits = [5_000, 20_000] } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await getJsonOnce(url, timeoutMs);
    } catch (err) {
      const retryable = !err.status || err.status === 429 || err.status >= 500;
      if (!retryable || attempt >= waits.length) throw err;
      console.warn(`  ${err.message}${err.cause?.code ? ` (${err.cause.code})` : ''}; retrying in ${waits[attempt] / 1000}s`);
      await new Promise((r) => setTimeout(r, waits[attempt]));
    }
  }
}

/** Chinese titles get pinyin and Simplified/Traditional spellings so they can be typed without a Chinese keyboard. */
function enrich(song) {
  const fragments = [stripDecor(song.title), ...song.titleAlt].filter(hasHan);
  if (fragments.length > 0) {
    const extra = fragments.flatMap((f) => [plainPinyin(f), ...variants(f).slice(1)]);
    song.titleAlt = uniq([...song.titleAlt, ...extra]).filter((x) => titleKey(x) !== titleKey(song.title));
    const toned = tonedPinyin(fragments[0]);
    if (toned) song.subtitle = toned;
  }
  if (hasHan(song.artist)) {
    song.artistAlt = uniq([plainPinyin(song.artist), ...variants(song.artist).slice(1)]);
  }
}

try {
  const feed = (await getJson(FEED_URL)).feed;
  const items = feed?.results ?? [];
  if (items.length < 50) throw new Error(`the chart feed returned only ${items.length} songs`);

  // One lookup for all 100 ids gives us each song's preview URL, artwork and store link.
  const lookup = await getJson(`https://itunes.apple.com/lookup?id=${items.map((x) => x.id).join(',')}&country=sg&entity=song`);
  const tracks = new Map((lookup.results ?? []).map((r) => [String(r.trackId), r]));

  const catalog = JSON.parse(await readFile(CATALOG_FILE, 'utf8'));
  const entries = buildSgEntries(items, tracks, catalog);
  if (entries.length < 50) throw new Error(`only ${entries.length} songs had a usable preview`);
  for (const entry of entries) enrich(entry.song);

  const updated = new Date(feed.updated);
  const snapshot = {
    source: SOURCE,
    feedUrl: FEED_URL,
    chartUpdated: (Number.isNaN(updated.getTime()) ? new Date() : updated).toISOString(),
    fetchedAt: new Date().toISOString(),
    entries,
  };
  await mkdir(path.dirname(OUT_FILE), { recursive: true });
  await writeFile(OUT_FILE, JSON.stringify(snapshot) + '\n');

  const inCatalog = entries.filter((e) => e.catalogId).length;
  const byLang = {};
  for (const e of entries) if (!e.catalogId) byLang[e.song.lang] = (byLang[e.song.lang] ?? 0) + 1;
  console.log(
    `Singapore snapshot saved: ${entries.length}/${items.length} songs playable (${inCatalog} already in the catalogue, ` +
      `${entries.length - inCatalog} new: ${Object.entries(byLang).map(([l, n]) => `${l} ${n}`).join(', ')}). ` +
      `Chart updated ${snapshot.chartUpdated}.`,
  );
} catch (err) {
  // Node's own network errors are just "fetch failed"; the real reason (ECONNREFUSED, ENOTFOUND...) is in `cause`.
  console.warn(`Singapore snapshot not updated: ${err.message}${err.cause?.code ? ` (${err.cause.code})` : ''}`);
  if (!existing) {
    // The app imports this file, so make sure one exists; "Singapore now" then shows as unavailable.
    const never = new Date(0).toISOString();
    await mkdir(path.dirname(OUT_FILE), { recursive: true });
    await writeFile(OUT_FILE, JSON.stringify({ source: SOURCE, feedUrl: FEED_URL, chartUpdated: never, fetchedAt: never, entries: [] }) + '\n');
    console.warn('Wrote an empty snapshot so the app still builds.');
  }
  process.exit(ifStale ? 0 : 1);
}
