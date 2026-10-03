#!/usr/bin/env node
/**
 * Builds the All Time list (src/data/catalog.json): about 100 of the most popular songs of all time per language.
 *
 * The songs come from public all-time charts, gathered into scripts/alltime/<lang>.txt by
 * scripts/alltime/make-lists.mjs (`npm run alltime:lists`). Each is then found on Apple and verified exactly like your
 * playlists (lib/resolve-list.mjs): title and artist must both match. Songs Apple has no preview for, or that can't be
 * verified, are skipped, and the next song down the list takes their place.
 *
 *   node scripts/build-alltime.mjs              all languages
 *   node scripts/build-alltime.mjs --limit=20   only the first 20 rows per language (quick test; writes nothing)
 */
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createItunes } from './lib/itunes.mjs';
import { createAliasBook } from './lib/playlist-match.mjs';
import { learnFrom, readSongList, reportLines, resolveList, uniqueMatches } from './lib/resolve-list.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIST_DIR = path.join(ROOT, 'scripts', 'alltime');
const CACHE_FILE = path.join(ROOT, 'scripts', '.cache', 'itunes-cache.json');
const REPORT_FILE = path.join(ROOT, 'scripts', '.cache', 'alltime-report.txt');
const OUT_FILE = path.join(ROOT, 'src', 'data', 'catalog.json');
const PLAYLISTS_FILE = path.join(ROOT, 'src', 'data', 'playlists.json');
/** Songs kept per language. */
const PER_LANGUAGE = 100;
const LANG_ORDER = ['en', 'zh', 'ja'];
const READINGS = JSON.parse(await readFile(path.join(LIST_DIR, 'readings.json'), 'utf8'));

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);
const limit = args.limit ? Number(args.limit) : Infinity;

// Artist spellings already known (the previous catalogue, your playlists) help verify romanised names.
const aliases = createAliasBook();
if (existsSync(OUT_FILE)) learnFrom(aliases, JSON.parse(await readFile(OUT_FILE, 'utf8')));
if (existsSync(PLAYLISTS_FILE)) learnFrom(aliases, JSON.parse(await readFile(PLAYLISTS_FILE, 'utf8')).lists.flatMap((l) => l.entries.map((e) => e.song)));

const itunes = await createItunes({ cacheFile: CACHE_FILE, gapMs: 1300 });
const catalog = [];
const report = [];

for (const lang of LANG_ORDER) {
  const { meta, songs } = await readSongList(path.join(LIST_DIR, `${lang}.txt`));
  if (meta.lang !== lang) throw new Error(`scripts/alltime/${lang}.txt: its "# lang:" line says ${meta.lang}`);
  const { S, resolved, pending } = await resolveList({ songs: songs.slice(0, limit), lang, itunes, aliases, name: meta.name });
  const { kept, repeats } = uniqueMatches(S, resolved);
  // A song Apple only has as an edit, dub or other cut is skipped: the All Time list should play the original.
  const original = kept.filter(({ hit }) => !hit.otherVersion);
  const chosen = original.slice(0, PER_LANGUAGE).map(({ s, hit }) => {
    // Romaji for kanji titles that Apple's English-language stores don't romanise (scripts/alltime/readings.json).
    const extra = READINGS[`${s.title}|${s.artists[0]}`];
    if (!extra) return hit.song;
    const titleAlt = [...new Set([...hit.song.titleAlt, ...extra])];
    return { ...hit.song, titleAlt, subtitle: hit.song.subtitle ?? extra[0] };
  });
  catalog.push(...chosen);
  const heading = `## ${meta.name}: ${chosen.length} songs kept (of ${original.length} verified originals, ${kept.length - original.length} skipped as edits, from ${S.length} rows)`;
  report.push(...reportLines({ heading, S, resolved, pending, repeats }));
  console.log(`\n${meta.name}: kept ${chosen.length} (verified ${kept.length} of ${S.length})`);
}

await itunes.saveCache();
await writeFile(REPORT_FILE, report.join('\n') + '\n');
if (limit === Infinity) {
  await writeFile(OUT_FILE, JSON.stringify(catalog) + '\n');
  console.log(`\nWrote ${path.relative(ROOT, OUT_FILE)} (${catalog.length} songs). Run \`npm run playlists\` next so your playlists link to it.`);
} else {
  console.log('\n(--limit run: catalog.json left untouched)');
}
console.log(`Report: ${path.relative(ROOT, REPORT_FILE)}`);
