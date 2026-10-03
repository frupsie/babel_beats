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
 * (The search-and-verify steps live in lib/resolve-list.mjs, shared with build-alltime.mjs.)
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
import { createItunes } from './lib/itunes.mjs';
import { createAliasBook } from './lib/playlist-match.mjs';
import { learnFrom, readSongList, reportLines, resolveList, uniqueMatches } from './lib/resolve-list.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLAYLIST_DIR = path.join(ROOT, 'scripts', 'playlists');
const CACHE_FILE = path.join(ROOT, 'scripts', '.cache', 'itunes-cache.json');
const REPORT_FILE = path.join(ROOT, 'scripts', '.cache', 'playlists-report.txt');
const CATALOG_FILE = path.join(ROOT, 'src', 'data', 'catalog.json');
const OUT_FILE = path.join(ROOT, 'src', 'data', 'playlists.json');

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);
const limit = args.limit ? Number(args.limit) : Infinity;

const catalog = JSON.parse(await readFile(CATALOG_FILE, 'utf8'));
const aliases = createAliasBook();
learnFrom(aliases, catalog);
const itunes = await createItunes({ cacheFile: CACHE_FILE, gapMs: 1300 });
const files = (await readdir(PLAYLIST_DIR)).filter((f) => f.endsWith('.txt')).sort();
const lists = [];
const report = [];

for (const file of files) {
  const { meta, songs } = await readSongList(path.join(PLAYLIST_DIR, file));
  if (!meta.lang) throw new Error(`${file}: add a "# lang: zh" or "# lang: ja" header line`);
  const { S, resolved, pending } = await resolveList({ songs: songs.slice(0, limit), lang: meta.lang, itunes, aliases, name: meta.name });

  // Songs that are also in the All Time catalogue reuse its entry. A song that is in the playlist twice counts once.
  const { kept, repeats } = uniqueMatches(S, resolved);
  const entries = kept.map(({ i, s, hit }) => {
    const match = catalog.find((c) =>
      matchesSong({ id: hit.song.id, titles: [s.title, hit.song.title, ...hit.song.titleAlt], artists: [...s.artists, ...hit.song.artistAlt] }, c),
    );
    return match ? { rank: i + 1, catalogId: match.id, song: hit.song } : { rank: i + 1, song: hit.song };
  });
  lists.push({ id: meta.id, name: meta.name, lang: meta.lang, url: meta.url, readAt: meta.readAt, total: meta.total, entries });

  const inCatalog = entries.filter((e) => e.catalogId).length;
  const heading = `## ${meta.name} (${meta.lang}): ${entries.length} of ${S.length} songs playable; ${inCatalog} already in the catalogue`;
  report.push(...reportLines({ heading, S, resolved, pending, repeats }));
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
