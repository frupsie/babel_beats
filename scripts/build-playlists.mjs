#!/usr/bin/env node
/**
 * Turns your Spotify playlists (scripts/playlists/*.txt) into playable songs: src/data/playlists.json.
 *
 * Each line of a playlist file is "title|artists", exactly as Spotify shows it. For every song we:
 *   1. search Apple's *native* store (Taiwan / Hong Kong for Chinese, Japan for Japanese) for "title artist";
 *   2. look the top hits up in *other* stores (Singapore, US), which spell titles and artists in English or romaji;
 *   3. accept a hit only if its title AND its artist match what Spotify shows, in any of those spellings. That is what
 *      lets a romanised Spotify entry ("Kenshi Yonezu - Lemon") verify a native-script Apple listing (米津玄師 - Lemon)
 *      without ever accepting a different song that merely shares a title (see lib/playlist-match.mjs).
 * Songs still unmatched get further tries: the Hong Kong store (Chinese), then a search using the song's second artist.
 * Songs Apple has no preview for are dropped and listed in scripts/.cache/playlists-report.txt.
 *
 *   node scripts/build-playlists.mjs              all playlists
 *   node scripts/build-playlists.mjs --limit=60   only the first 60 songs of each (quick test)
 *
 * A playlist file needs a "# lang: zh" (or ja) header line; see scripts/playlists/chinese.txt.
 */
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { matchesSong } from '../src/lib/lists.ts';
import { compact, titleKey } from '../src/lib/text.ts';
import { createItunes } from './lib/itunes.mjs';
import {
  artistFit,
  artistKeysOf,
  buildSong,
  createAliasBook,
  learnAliases,
  prepare,
  releaseKind,
  titleMatches,
  wanted,
} from './lib/playlist-match.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLAYLIST_DIR = path.join(ROOT, 'scripts', 'playlists');
const CACHE_FILE = path.join(ROOT, 'scripts', '.cache', 'itunes-cache.json');
const REPORT_FILE = path.join(ROOT, 'scripts', '.cache', 'playlists-report.txt');
const CATALOG_FILE = path.join(ROOT, 'src', 'data', 'catalog.json');
const OUT_FILE = path.join(ROOT, 'src', 'data', 'playlists.json');

/** `native` stores are searched; `alt` stores are only used to look candidates up by id. (Apple's China/Korea stores return nothing.) */
const LANGS = {
  zh: { native: ['tw', 'hk'], alt: ['sg', 'us'] },
  ja: { native: ['jp'], alt: ['us', 'sg'] },
};

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);
const limit = args.limit ? Number(args.limit) : Infinity;

// ---------------------------------------------------------------- reading the playlist files
async function readPlaylist(file) {
  const meta = { id: path.basename(file, '.txt'), name: path.basename(file, '.txt'), url: '', lang: null, readAt: '', total: 0 };
  const songs = [];
  for (const line of (await readFile(file, 'utf8')).split(/\r?\n/)) {
    if (line.startsWith('#')) {
      meta.lang = line.match(/^#\s*lang:\s*(\w+)/)?.[1] ?? meta.lang;
      const named = line.match(/^#\s*Spotify playlist "([^"]+)"[^:]*:\s*(https?:\/\/\S+)/);
      if (named) [meta.name, meta.url] = [named[1], named[2]];
      meta.readAt = line.match(/on (\d{4}-\d{2}-\d{2})\./)?.[1] ?? meta.readAt;
      continue;
    }
    if (!line.trim()) continue;
    const [title, artists = ''] = line.split('|');
    songs.push({ title: title.trim(), artists: artists.split(',').map((a) => a.trim()).filter(Boolean) });
  }
  meta.total = songs.length;
  return { meta, songs };
}

// ---------------------------------------------------------------- main
const catalog = JSON.parse(await readFile(CATALOG_FILE, 'utf8'));
const aliases = createAliasBook();
for (const c of catalog) aliases.learn(artistKeysOf([c.artist, ...c.artistAlt], c.lang === 'zh'));
const itunes = await createItunes({ cacheFile: CACHE_FILE, gapMs: 1300 });
const files = (await readdir(PLAYLIST_DIR)).filter((f) => f.endsWith('.txt')).sort();
const lists = [];
const report = [];

for (const file of files) {
  const { meta, songs } = await readPlaylist(path.join(PLAYLIST_DIR, file));
  const cfg = LANGS[meta.lang];
  if (!cfg) throw new Error(`${file}: add a "# lang: zh" or "# lang: ja" header line`);

  const S = songs.slice(0, limit).map((raw) => prepare(raw, meta.lang));
  const resolved = new Array(S.length).fill(null);
  let pending = S.map((_, i) => i);

  // The main search first; every later one only covers the songs still unmatched, so it stays cheap.
  const attempts = [
    ...cfg.native.map((store) => ({ store, artist: 0 })),
    { store: cfg.native[0], artist: 1 },
  ];

  for (const attempt of attempts) {
    const todo = pending.filter((i) => S[i].artists.length > attempt.artist);
    console.log(`\n== ${meta.name}: ${todo.length} songs to search in "${attempt.store}" using artist #${attempt.artist + 1}`);

    // 1. search (sequential, throttled, cached)
    const candidates = new Map();
    let n = 0;
    for (const i of todo) {
      const s = S[i];
      const results = await itunes.search(`${s.base} ${s.artists[attempt.artist]}`.trim(), attempt.store);
      candidates.set(i, results.filter((r) => wanted(r, s)).slice(0, 8));
      if (++n % 50 === 0) console.log(`  searched ${n}/${todo.length}`);
    }

    // 2. one bulk lookup of every candidate in the English-spelling stores
    const ids = [...candidates.values()].flat().map((r) => r.trackId);
    const altMaps = [];
    for (const store of cfg.alt) altMaps.push(await itunes.lookupMany(ids, store));

    // 3. accept only hits whose title and artist both match. Each verified song teaches artist aliases, so we go round
    //    again until nothing new is accepted: "晴天 Jay Chou" may only verify after another Jay Chou song is confirmed.
    //    Songs whose best hit matches the artist only partially ("Aioz" inside "Aioz & 劉思達") wait for a last round.
    const tryAccept = (i, allowPartial) => {
      const s = S[i];
      const accepted = [];
      for (const r of candidates.get(i)) {
        const alts = altMaps.map((m) => m.get(String(r.trackId))).filter(Boolean);
        const titles = [r.trackName, ...alts.map((t) => t.trackName)];
        const artists = [r.artistName, ...alts.map((t) => t.artistName)];
        if (!titleMatches(s, titles)) continue;
        const fit = artistFit(s, artists, aliases);
        if (fit.covered > 0) accepted.push({ r, alts, artists, fit });
      }
      if (accepted.length === 0) return null;
      // The track crediting the most of the row's artists wins, then the one with the fewest others (the solo cut for a
      // solo row), then the earliest release (the original recording), then the single over an EP or album of that day.
      accepted.sort(
        (a, b) =>
          b.fit.covered - a.fit.covered ||
          a.fit.extra - b.fit.extra ||
          a.r.releaseDate.slice(0, 10).localeCompare(b.r.releaseDate.slice(0, 10)) ||
          releaseKind(a.r) - releaseKind(b.r),
      );
      const { r, alts, artists, fit } = accepted[0];
      if (fit.verified === 0 && !allowPartial) return null;
      if (fit.verified > 0) learnAliases(s, artists, aliases);
      return {
        song: buildSong(s, r, alts, attempt.store),
        apple: `${r.trackName} — ${r.artistName}`,
        // Two rows can be one song under two titles ("勇者" and "The Brave"), or resolve to its single and its album track.
        songKey: `${titleKey(r.trackName)}|${compact(r.artistName)}`,
        store: attempt.store,
        partial: fit.verified === 0,
      };
    };
    for (const allowPartial of [false, true]) {
      for (let again = true; again; ) {
        again = false;
        for (const i of todo) {
          if (resolved[i]) continue;
          const hit = tryAccept(i, allowPartial);
          if (hit) {
            resolved[i] = hit;
            again = true;
          }
        }
      }
    }
    pending = pending.filter((i) => !resolved[i]);
    await itunes.saveCache();
    console.log(`  resolved so far: ${S.length - pending.length}/${S.length}`);
  }

  // Songs that are already in the curated catalogue reuse its entry (curated pinyin, year, language). A song that is in
  // the playlist twice counts once, at its first position.
  const entries = [];
  const firstRow = new Map();
  const repeats = [];
  S.forEach((s, i) => {
    const hit = resolved[i];
    if (!hit) return;
    const earlier = firstRow.get(hit.song.id) ?? firstRow.get(hit.songKey);
    if (earlier !== undefined) return repeats.push(`  ${i + 1}. ${s.title} — ${s.artists.join(', ')}  (same song as ${earlier + 1})`);
    firstRow.set(hit.song.id, i);
    firstRow.set(hit.songKey, i);
    const match = catalog.find((c) =>
      matchesSong({ id: hit.song.id, titles: [s.title, hit.song.title, ...hit.song.titleAlt], artists: [...s.artists, ...hit.song.artistAlt] }, c),
    );
    entries.push(match ? { rank: i + 1, catalogId: match.id, song: hit.song } : { rank: i + 1, song: hit.song });
  });

  lists.push({ id: meta.id, name: meta.name, lang: meta.lang, url: meta.url, readAt: meta.readAt, total: meta.total, entries });

  const inCatalog = entries.filter((e) => e.catalogId).length;
  report.push(
    `## ${meta.name} (${meta.lang}): ${entries.length} of ${S.length} songs playable; ${inCatalog} already in the catalogue`,
    '',
    `Not found on Apple (first 120 of ${pending.length}):`,
    ...pending.slice(0, 120).map((i) => `  ${i + 1}. ${S[i].title} — ${S[i].artists.join(', ')}`),
    '',
    `Left out because the same song is already in the list under another title (${repeats.length}):`,
    ...repeats,
    '',
    'Accepted on a partial artist match (the artist is only part of Apple’s credit; worth a look):',
    ...S.map((s, i) => [s, resolved[i]])
      .filter(([, hit]) => hit?.partial)
      .map(([s, hit]) => `  ${s.title} — ${s.artists.join(', ')}  =>  ${hit.apple} [${hit.store}]`),
    '',
    'Sample of accepted matches, to eyeball for wrong songs (Spotify => Apple):',
    ...S.map((s, i) => [s, resolved[i], i])
      .filter(([, hit, i]) => hit && i % 9 === 0)
      .map(([s, hit]) => `  ${s.title} — ${s.artists.join(', ')}  =>  ${hit.apple} [${hit.store}]`),
    '',
  );
  console.log(`\n${meta.name}: ${entries.length}/${S.length} playable (${inCatalog} already in the catalogue)`);
}

await itunes.saveCache();
if (limit === Infinity) {
  await writeFile(OUT_FILE, JSON.stringify({ lists }) + '\n');
  console.log(`\nWrote ${path.relative(ROOT, OUT_FILE)}`);
} else {
  console.log('\n(--limit run: playlists.json left untouched)');
}
await writeFile(REPORT_FILE, report.join('\n') + '\n');
console.log(`Report: ${path.relative(ROOT, REPORT_FILE)}`);
