#!/usr/bin/env node
/**
 * Builds src/data/catalog.json from the hand-curated lists in scripts/seeds/<lang>.json.
 *
 * For every seed song it queries the iTunes Search API, keeps the original recording that has a
 * 30-second preview, and writes the playable metadata (preview URL, artwork, storefront) the app needs.
 * Songs that cannot be resolved are dropped and listed in scripts/.cache/last-report.txt.
 *
 * Seed format (short keys keep the lists readable):
 *   t   title as displayed          a   artist as displayed         y   original release year
 *   ta  extra title spellings: English gloss / romaji (first entries are shown as the subtitle)
 *   tm  extra title spellings used only for matching (e.g. how Apple spells it); never displayed
 *   aa  extra artist spellings, e.g. the English name
 *
 * Usage:
 *   node scripts/build-catalog.mjs                 all languages
 *   node scripts/build-catalog.mjs --lang=ja,zh    only these languages (others kept as they are)
 *   node scripts/build-catalog.mjs --limit=5       first 5 seeds per language (quick test)
 *   node scripts/build-catalog.mjs --refresh       ignore the local search cache
 *
 * Adding a language: create scripts/seeds/<code>.json, add it to LANGS below and to
 * src/data/languages.ts, then run this script.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compact, titleKey } from '../src/lib/text.ts';
import { plainPinyin, tonedPinyin, uniq, variants } from './lib/han.mjs';
import { UNWANTED, createItunes } from './lib/itunes.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEED_DIR = path.join(ROOT, 'scripts', 'seeds');
const CACHE_DIR = path.join(ROOT, 'scripts', '.cache');
const CACHE_FILE = path.join(CACHE_DIR, 'itunes-cache.json');
const REPORT_FILE = path.join(CACHE_DIR, 'last-report.txt');
const OUT_FILE = path.join(ROOT, 'src', 'data', 'catalog.json');

/** Storefronts are tried in order. (The China and Korea storefronts return nothing from the Search API.) */
const LANGS = {
  en: { storefronts: ['us'] },
  ja: { storefronts: ['jp'] },
  zh: { storefronts: ['tw', 'hk', 'sg'] },
};

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);
const only = typeof args.lang === 'string' ? args.lang.split(',') : Object.keys(LANGS);
const limit = args.limit ? Number(args.limit) : Infinity;

// ---------------------------------------------------------------- iTunes search (cached, throttled; see lib/itunes.mjs)
const { search, saveCache } = await createItunes({ cacheFile: CACHE_FILE, refresh: Boolean(args.refresh) });

// ---------------------------------------------------------------- matching
function pickMatch(seed, results, lang) {
  const isZh = lang === 'zh';
  const titleForms = new Set(
    [seed.t, ...(seed.ta ?? []), ...(seed.tm ?? [])].flatMap((x) => variants(x, isZh)).map(titleKey),
  );
  const artistForms = uniq([seed.a, ...(seed.aa ?? [])].flatMap((x) => variants(x, isZh)).map(compact));

  const good = results.filter((r) => {
    if (!r.previewUrl || !r.trackName) return false;
    if (UNWANTED.test(r.trackName) && !UNWANTED.test(seed.t)) return false;
    if (UNWANTED.test(r.collectionName) && !UNWANTED.test(seed.t)) return false;
    if (!titleForms.has(titleKey(r.trackName))) return false;
    const na = compact(r.artistName);
    return na.length >= 2 && artistForms.some((f) => na.includes(f) || (f.length >= 2 && f.includes(na)));
  });
  // Earliest release date = the original recording rather than a later compilation or remaster.
  good.sort((a, b) => a.releaseDate.localeCompare(b.releaseDate));
  return good[0];
}

// ---------------------------------------------------------------- build
function buildEntry(seed, lang, hit, country) {
  const isZh = lang === 'zh';
  const titleAlt = uniq([
    ...(seed.ta ?? []),
    ...(seed.tm ?? []),
    ...(isZh ? [plainPinyin(seed.t), ...variants(seed.t, true).slice(1)] : []),
  ]).filter((x) => titleKey(x) !== titleKey(seed.t));
  const artistAlt = uniq([
    ...(seed.aa ?? []),
    ...(isZh ? [plainPinyin(seed.a), ...variants(seed.a, true).slice(1)] : []),
  ]).filter((x) => compact(x) !== compact(seed.a));

  const gloss = (seed.ta ?? []).slice(0, 2);
  const subtitleParts = isZh ? [tonedPinyin(seed.t), ...gloss.slice(0, 1)] : gloss;

  return {
    id: String(hit.trackId),
    lang,
    title: seed.t,
    titleAlt,
    subtitle: uniq(subtitleParts).join(' · ') || undefined,
    artist: seed.a,
    artistAlt,
    artistEn: (seed.aa ?? [])[0],
    // Trust the curated original-release year: iTunes dates are often re-issue or compilation dates.
    year: seed.y,
    album: hit.collectionName,
    previewUrl: hit.previewUrl,
    artworkUrl: hit.artworkUrl100.replace('/100x100bb.', '/600x600bb.'),
    trackViewUrl: hit.trackViewUrl,
    country,
  };
}

const report = [];
const catalogByLang = {};
if (existsSync(OUT_FILE)) {
  for (const s of JSON.parse(await readFile(OUT_FILE, 'utf8'))) (catalogByLang[s.lang] ??= []).push(s);
}

for (const lang of only) {
  const cfg = LANGS[lang];
  if (!cfg) throw new Error(`Unknown language "${lang}". Known: ${Object.keys(LANGS).join(', ')}`);
  const seeds = JSON.parse(await readFile(path.join(SEED_DIR, `${lang}.json`), 'utf8')).slice(0, limit);
  console.log(`\n== ${lang}: ${seeds.length} seeds, storefronts ${cfg.storefronts.join('>')}`);

  const built = [];
  const seenIds = new Set();
  for (const [i, seed] of seeds.entries()) {
    const term = `${seed.t} ${seed.a}`;
    let hit;
    let country;
    let lastResults = [];
    for (const sf of cfg.storefronts) {
      lastResults = await search(term, sf);
      hit = pickMatch(seed, lastResults, lang);
      if (hit) {
        country = sf;
        break;
      }
    }
    const tag = `[${lang} ${String(i + 1).padStart(3)}/${seeds.length}]`;
    if (!hit) {
      console.log(`${tag} ✗ ${seed.t} — ${seed.a}`);
      report.push(
        `${lang}  MISSING  ${seed.t} — ${seed.a} (${seed.y})\n      nearest: ${lastResults.slice(0, 3).map((r) => `${r.trackName} / ${r.artistName}`).join(' | ') || 'no results'}`,
      );
      continue;
    }
    if (seenIds.has(String(hit.trackId))) {
      report.push(`${lang}  DUPLICATE ${seed.t} — ${seed.a} resolved to an already-used track`);
      continue;
    }
    seenIds.add(String(hit.trackId));
    const entry = buildEntry(seed, lang, hit, country);
    const itunesYear = Number(hit.releaseDate.slice(0, 4));
    if (itunesYear <= seed.y - 2) report.push(`${lang}  YEAR?    ${seed.t}: seed says ${seed.y} but iTunes has it in ${itunesYear}; worth a look`);
    built.push(entry);
    console.log(`${tag} ✓ ${seed.t} — ${seed.a} (${entry.year}) [${country}]`);
  }

  catalogByLang[lang] = built.sort((a, b) => a.year - b.year || a.title.localeCompare(b.title));
  await saveCache();
  await writeFile(OUT_FILE, JSON.stringify(Object.values(catalogByLang).flat()) + '\n');
  console.log(`   -> ${built.length}/${seeds.length} resolved; catalog.json updated`);
}

await saveCache();
const era = (y) => (y < 2000 ? 'classic' : y < 2010 ? '2000s' : y < 2020 ? '2010s' : '2020s');
const summary = Object.entries(catalogByLang).map(([lang, songs]) => {
  const byEra = {};
  for (const s of songs) byEra[era(s.year)] = (byEra[era(s.year)] ?? 0) + 1;
  return `${lang}: ${songs.length} songs ${JSON.stringify(byEra)}`;
});
await writeFile(REPORT_FILE, [...summary, '', ...report].join('\n') + '\n');
console.log(`\n${summary.join('\n')}\nReport (${report.length} notes): ${path.relative(ROOT, REPORT_FILE)}`);
