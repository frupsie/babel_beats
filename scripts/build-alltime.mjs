#!/usr/bin/env node
/**
 * Builds the All Time list (src/data/catalog.json): about 100 of the most popular songs of all time per language.
 *
 * The songs come from public all-time charts, gathered into scripts/alltime/<lang>.txt by
 * scripts/alltime/make-lists.mjs (`npm run alltime:lists`). Each is then found on Apple and verified exactly like your
 * playlists (lib/resolve-list.mjs): title and artist must both match. Songs Apple has no preview for, or that can't be
 * verified, are skipped, and the next song down the list takes their place.
 *
 * All-time totals favour recent music, so some eras end up thin (no pre-2000 Mandarin at all). After the top 100, each
 * language is topped up until every era has MIN_PER_ERA songs, from the rest of its all-time list and then from
 * scripts/alltime/extras-<lang>.txt (the best-known songs of each era, in the same "title|artists" format, optionally
 * "|year"). A song only joins when its era is still short, so eras that are already full are left alone.
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
import { eraOf } from '../src/lib/game.ts';
import { compact } from '../src/lib/text.ts';
import { learnFrom, readSongList, reportLines, resolveList, uniqueMatches } from './lib/resolve-list.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LIST_DIR = path.join(ROOT, 'scripts', 'alltime');
const CACHE_FILE = path.join(ROOT, 'scripts', '.cache', 'itunes-cache.json');
const REPORT_FILE = path.join(ROOT, 'scripts', '.cache', 'alltime-report.txt');
const OUT_FILE = path.join(ROOT, 'src', 'data', 'catalog.json');
const PLAYLISTS_FILE = path.join(ROOT, 'src', 'data', 'playlists.json');
/** Songs kept per language from the all-time list itself. */
const PER_LANGUAGE = 100;
/** Every era of every language is topped up to at least this many songs. */
const MIN_PER_ERA = 30;
const ERA_IDS = ['classic', '2000s', '2010s', '2020s'];
const LANG_ORDER = ['en', 'zh', 'ja'];
const READINGS = JSON.parse(await readFile(path.join(LIST_DIR, 'readings.json'), 'utf8'));
/** Release years Apple gets wrong (a compilation's date, say), by "title|first artist": the right year wins. */
const YEARS = JSON.parse(await readFile(path.join(LIST_DIR, 'years.json'), 'utf8'));

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

/** Romaji for kanji titles that Apple's English-language stores don't romanise (scripts/alltime/readings.json). */
function withReadings(row, song) {
  const extra = READINGS[`${row.title}|${row.artists[0]}`];
  if (!extra) return song;
  const titleAlt = [...new Set([...song.titleAlt, ...extra])];
  return { ...song, titleAlt, subtitle: song.subtitle ?? extra[0] };
}

/** The year to use: one given by hand wins over Apple's, which can be a later compilation's date. */
function withYear(row, song) {
  const year = YEARS[`${row.title}|${row.artists[0]}`] ?? row.year ?? song.year;
  return year === song.year ? song : { ...song, year };
}

/**
 * An extras row's credit comes from a chart ("Billboard: The Weeknd and Ariana Grande") while the preview is whatever
 * Apple has under that title ("Save Your Tears" by The Weeknd alone). Keep the first artist, and the others only when
 * Apple's own credit names them, so the card never names someone who isn't on the recording we play.
 */
function withAppleCredit(row, hit, song) {
  const appleArtist = compact(hit.apple.slice(hit.apple.lastIndexOf(' — ') + 3));
  const kept = row.artists.filter((name, i) => i === 0 || appleArtist.includes(compact(name)));
  return kept.length === row.artists.length ? song : { ...song, artist: kept.join(', ') };
}

const eraTally = (songs) => Object.fromEntries(ERA_IDS.map((era) => [era, songs.filter((s) => eraOf(s.year) === era).length]));
const tallyText = (t) => ERA_IDS.map((era) => `${era} ${t[era]}`).join(' · ');

for (const lang of LANG_ORDER) {
  const { meta, songs } = await readSongList(path.join(LIST_DIR, `${lang}.txt`));
  if (meta.lang !== lang) throw new Error(`scripts/alltime/${lang}.txt: its "# lang:" line says ${meta.lang}`);
  const { S, resolved, pending } = await resolveList({ songs: songs.slice(0, limit), lang, itunes, aliases, name: meta.name });
  const { kept, repeats } = uniqueMatches(S, resolved);
  // A song Apple only has as an edit, dub or other cut is skipped: the All Time list should play the original.
  const original = kept.filter(({ hit }) => !hit.otherVersion);
  const chosen = original.slice(0, PER_LANGUAGE).map(({ i, hit }) => withYear(songs[i], withReadings(songs[i], hit.song)));
  const taken = new Set(original.slice(0, PER_LANGUAGE).flatMap(({ hit }) => [hit.song.id, hit.songKey]));

  // Top up the eras that are still short: first from the rest of the all-time list, then from the extras file.
  const candidates = original.slice(PER_LANGUAGE).map(({ i, hit }) => ({ row: songs[i], hit, from: 'rest of the all-time list' }));
  const extrasFile = path.join(LIST_DIR, `extras-${lang}.txt`);
  const extraReport = [];
  if (existsSync(extrasFile)) {
    const extras = await readSongList(extrasFile);
    const x = await resolveList({ songs: extras.songs.slice(0, limit), lang, itunes, aliases, name: `${meta.name}, extras` });
    const xk = uniqueMatches(x.S, x.resolved);
    for (const { i, hit } of xk.kept) if (!hit.otherVersion) candidates.push({ row: extras.songs[i], hit, from: 'extras' });
    extraReport.push(...reportLines({ heading: `## ${meta.name}, extras: ${xk.kept.length} verified of ${x.S.length} rows`, S: x.S, resolved: x.resolved, pending: x.pending, repeats: xk.repeats }));
  }
  const before = eraTally(chosen);
  const added = [];
  const tally = { ...before };
  for (const { row, hit, from } of candidates) {
    if (taken.has(hit.song.id) || taken.has(hit.songKey)) continue;
    const credited = from === 'extras' ? withAppleCredit(row, hit, hit.song) : hit.song;
    const song = withYear(row, withReadings(row, credited));
    const era = eraOf(song.year);
    if (tally[era] >= MIN_PER_ERA) continue;
    tally[era] += 1;
    taken.add(song.id);
    taken.add(hit.songKey);
    chosen.push(song);
    added.push(`  + ${song.year} ${song.title} — ${song.artist}  (${era}, from the ${from})`);
  }

  catalog.push(...chosen);
  const short = ERA_IDS.filter((era) => tally[era] < MIN_PER_ERA);
  const heading = `## ${meta.name}: ${chosen.length} songs kept (of ${original.length} verified originals, ${kept.length - original.length} skipped as edits, from ${S.length} rows)`;
  report.push(...reportLines({ heading, S, resolved, pending, repeats }));
  report.push(`Top 100 by era: ${tallyText(before)}`, `Topped up to ${MIN_PER_ERA} per era with ${added.length} songs: ${tallyText(tally)}`, ...added, ...(short.length ? [`STILL SHORT: ${short.join(', ')}`] : []), '');
  report.push(...extraReport);
  console.log(`
${meta.name}: kept ${chosen.length} (top 100 by era: ${tallyText(before)})`);
  console.log(`  topped up with ${added.length}: ${tallyText(tally)}${short.length ? `   STILL SHORT: ${short.join(', ')}` : ''}`);
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
