#!/usr/bin/env node
/**
 * Builds the All Time source lists (scripts/alltime/<lang>.txt) from public all-time charts:
 *   English   Spotify's all-time most-streamed songs (kworb.net/spotify/songs.html), alternating with Billboard's
 *             Greatest of All Time Hot 100 (billboard.com/charts/greatest-hot-100-singles/).
 *   Mandarin  all-time totals on Spotify's Taiwan daily chart (kworb.net/spotify/country/tw_daily_totals.html).
 *   Japanese  all-time totals on Spotify's Japan daily chart (kworb.net/spotify/country/jp_daily_totals.html),
 *             alternating with Japan's all-time best-selling singles, physical (Oricon) and digital
 *             (en.wikipedia.org/wiki/List_of_best-selling_singles_in_Japan).
 * Songs in another language, noise tracks, alternate versions and repeats are left out (see EXCLUDE below).
 * Then `npm run alltime` finds them on Apple and writes src/data/catalog.json.
 *
 *   node scripts/alltime/make-lists.mjs            downloads the charts (cached for a day in scripts/.cache/charts)
 */
import { existsSync, statSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compact, stripDecor, titleKey } from '../../src/lib/text.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const CACHE = path.join(ROOT, 'scripts', '.cache', 'charts');
/** Rows written per language. More than the 100 kept, because some aren't on Apple or can't be verified. */
const CANDIDATES = 140;

const SOURCES = {
  spotifyAll: 'https://kworb.net/spotify/songs.html',
  tw: 'https://kworb.net/spotify/country/tw_daily_totals.html',
  jp: 'https://kworb.net/spotify/country/jp_daily_totals.html',
  billboard: 'https://www.billboard.com/charts/greatest-hot-100-singles/',
  wikiJapan:
    'https://en.wikipedia.org/w/api.php?action=parse&page=List_of_best-selling_singles_in_Japan&prop=text&format=json&formatversion=2',
};

/** Left out on purpose, by "artist — title" (case-insensitive) or by artist alone. */
const EXCLUDE = {
  en: {
    reason: 'not sung in English, a noise track, or a remix of a song already listed',
    songs: [
      'Don Omar — Danza Kuduro',
      'J Balvin — LA CANCIÓN',
      'Danny Ocean — Me Rehúso',
      'Bad Bunny — DÁKITI',
      'Manuel Turizo — La Bachata',
      'Bad Bunny — Tití Me Preguntó',
      'Bad Bunny — Me Porto Bonito',
      'Dream Supplier — Clean Baby Sleep White Noise (Loopable)',
      'The Weeknd — Save Your Tears (Remix)',
      'Los del Rio — Macarena (Bayside Boys Mix)',
      'Luis Fonsi & Daddy Yankee Featuring Justin Bieber — Despacito',
    ],
    artists: ['Bad Bunny', 'Karol G', 'Peso Pluma', 'Feid', 'Rauw Alejandro', 'Ozuna', 'Daddy Yankee', 'J Balvin', 'Myke Towers', 'Quevedo'],
  },
  zh: {
    reason: 'sung in Taiwanese Hokkien rather than Mandarin, a Japanese song, an alternate version, or a repeat',
    songs: [
      'EggPlantEgg — 浪流連',
      'EggPlantEgg — 閣愛妳一擺',
      'EggPlantEgg — 浪子回頭',
      'EggPlantEgg — 愛情你比我想的閣較偉大 -《當男人戀愛時》電影主題曲',
      'EggPlantEgg — 愛情你比我想的閣較偉大 (《當男人戀愛時》電影主題曲)',
      '黃奇斌 — 若無你我欲去佗位',
      '邱軍 — 運轉人生 - 影集《華麗計程車行》插曲',
      'Vicky Chen — 炙愛 - 女聲版',
      '承桓 — 总会有人 (男版)',
      'A-Lin — 摯友',
      'EN — 嚣张',
    ],
    artists: ['YOASOBI', 'Aimer', 'Ado', 'Kenshi Yonezu', 'King Gnu', 'Fujii Kaze'],
  },
  ja: {
    reason: 'a Korean, Western or other non-Japanese act, a repeat under another title, or a listing without a real artist',
    songs: ['King Gnu — Hakujitsu', 'Mrs. GREEN APPLE — 私は最強', 'Unknown Artist — 打上花火', 'O-Zone — Dragostea din tei', 'KARA — Mister'],
    artists: [
      'BTS', 'Jimin', 'Jung Kook', 'Jin', 'V', 'SUGA', 'RM', 'j-hope', 'ILLIT', 'NewJeans', 'LE SSERAFIM', 'ROSÉ', 'HUNTR/X',
      'Ed Sheeran', 'The Kid LAROI', 'TWICE', 'SEVENTEEN', 'aespa', 'IVE', 'Stray Kids', 'BLACKPINK', 'Taylor Swift',
      'Justin Bieber', 'Ariana Grande', 'Bruno Mars', 'Billie Eilish', 'Olivia Rodrigo', 'Sabrina Carpenter', 'Harry Styles',
      'Dua Lipa', 'The Weeknd', 'Maroon 5', 'Charlie Puth', 'Lady Gaga', 'Unknown Artist', 'ENHYPEN', 'TXT', 'ZEROBASEONE',
      'KATSEYE', 'Jennie', 'Lisa', 'JENNIE', 'LISA', 'Mariah Carey', 'Wham!',
    ],
  },
};

// ---------------------------------------------------------------- downloading (cached for a day)
async function fetchText(name, url) {
  await mkdir(CACHE, { recursive: true });
  const file = path.join(CACHE, `${name}.html`);
  if (existsSync(file) && Date.now() - statSync(file).mtimeMs < 24 * 3600e3) return readFile(file, 'utf8');
  const res = await fetch(url, { headers: { 'User-Agent': 'babel-beats (all-time list builder)' } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const text = await res.text();
  await writeFile(file, text);
  return text;
}

// ---------------------------------------------------------------- parsing
const decode = (s) =>
  s
    .replace(/<sup[\s\S]*?<\/sup>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#160;|&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();

function tableRows(html) {
  const body = html.slice(html.indexOf('<tbody>'), html.indexOf('</tbody>'));
  return body.split('<tr>').slice(1).map((row) => row.split(/<td[^>]*>/).slice(1).map((c) => c.replace(/<\/td>[\s\S]*/, '')));
}

/** kworb.net/spotify/songs.html: "Artist - Title" | total streams | daily. */
function parseSpotifyAll(html) {
  return tableRows(html).map((cells) => {
    const text = decode(cells[0]);
    const at = text.indexOf(' - ');
    return { artist: text.slice(0, at), title: text.slice(at + 3) };
  });
}

/** kworb country totals: artist and track links in the first cell. */
function parseCountryTotals(html) {
  return tableRows(html).map((cells) => {
    const links = [...cells[0].matchAll(/<a [^>]*>([\s\S]*?)<\/a>/g)].map((m) => decode(m[1]));
    const title = links[links.length - 1];
    const text = decode(cells[0]);
    return { artist: text.slice(0, text.lastIndexOf(` - ${title}`)), title };
  });
}

function parseBillboard(html) {
  return html
    .split('o-chart-results-list-row-container')
    .slice(1)
    .map((row) => {
      const title = decode((row.match(/<h3 id="title-of-a-story"[^>]*>([\s\S]*?)<\/h3>/) || [])[1] || '');
      const after = row.slice(row.indexOf('title-of-a-story'));
      const artist = decode((after.match(/<span class="\s*c-label[^"]*a-no-trucate[^"]*"[^>]*>([\s\S]*?)<\/span>/) || [])[1] || '');
      return { artist, title };
    })
    .filter((r) => r.title && r.artist);
}

/** Japan's best-selling singles: the physical table, then the digital "over N million copies" tables, by sales. */
function parseWikiJapan(json) {
  const html = JSON.parse(json).parse.text;
  const tables = html.split('<table').slice(1);
  const rows = (t) => t.split('<tr').slice(1).map((r) => [...r.matchAll(/<t[dh][^>]*>([\s\S]*?)(?=<t[dh]|<\/tr>)/g)].map((m) => decode(m[1])));
  const unquote = (s) => s.replace(/^"|"$/g, '');
  const num = (s) => Number(String(s).replace(/[^\d]/g, '')) || 0;
  const under = (i) => {
    const before = html.slice(0, html.indexOf(tables[i]));
    const heads = before.match(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/g) ?? [];
    return decode(heads[heads.length - 1] ?? '');
  };
  const out = [];
  tables.forEach((t, i) => {
    const section = under(i);
    if (/physical sales/i.test(section)) {
      for (const r of rows(t)) if (/^\d+$/.test(r[0])) out.push({ title: unquote(r[1]), artist: r[2], sales: num(r[5]) });
    } else if (/^Over \d+ million copies/i.test(section)) {
      for (const r of rows(t)) if (/^\d{4}$/.test(r[0])) out.push({ title: unquote(r[1]), artist: r[2], sales: num(r[r.length - 1]) || num(r[r.length - 2]) });
    }
  });
  return out.sort((a, b) => b.sales - a.sales);
}

// ---------------------------------------------------------------- language filters and merging
const HAN = /\p{Script=Han}/u;
const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
const HANGUL = /\p{Script=Hangul}/u;

function excluded(lang, r) {
  const ex = EXCLUDE[lang];
  const key = `${r.artist} — ${r.title}`.toLowerCase();
  return ex.songs.some((s) => s.toLowerCase() === key) || ex.artists.some((a) => a.toLowerCase() === r.artist.toLowerCase());
}

const KEEP = {
  en: (r) => !HAN.test(r.title + r.artist) && !KANA.test(r.title + r.artist) && !HANGUL.test(r.title + r.artist),
  // Taiwan's chart: Mandarin songs carry Chinese characters in the title or artist (no kana, no hangul).
  zh: (r) => HAN.test(r.title + r.artist) && !KANA.test(r.title + r.artist) && !HANGUL.test(r.title + r.artist),
  // Japan's chart: everything except Korean and Western acts, which EXCLUDE names.
  ja: (r) => !HANGUL.test(r.title + r.artist),
};

/** Billboard credits "A Featuring B" and "A & B"; the list format separates artists with commas. */
const splitCredit = (artist) =>
  artist
    .replace(/\s+(?:featuring|feat\.?|with)\s+/gi, ', ')
    .replace(/\s+x\s+/g, ', ') // lower-case only: "Lil Nas X" is a name
    .replace(/\s+&\s+/g, ', ')
    .split(',')
    .map((a) => a.trim())
    .filter(Boolean);

/** Alternates between sources (a, b, a, b...), skipping repeats, until `n` songs. */
function interleave(sources, n) {
  const out = [];
  const seen = new Set();
  const key = (r) => `${titleKey(stripDecor(r.title))}|${compact(splitCredit(r.artist)[0] ?? '')}`;
  for (let i = 0; out.length < n && sources.some((s) => i < s.length); i++) {
    for (const s of sources) {
      const r = s[i];
      if (!r || out.length >= n) continue;
      const k = key(r);
      // The same title by the same lead artist from another source is the same song.
      const titleOnly = titleKey(stripDecor(r.title));
      if (seen.has(k) || out.some((o) => titleKey(stripDecor(o.title)) === titleOnly && artistOverlap(o, r))) continue;
      seen.add(k);
      out.push(r);
    }
  }
  return out;
}

function artistOverlap(a, b) {
  const words = (s) => new Set(splitCredit(s).flatMap((x) => x.toLowerCase().split(/\s+/)).filter((w) => w.length > 2 && w !== 'the'));
  const wa = words(a.artist);
  return [...words(b.artist)].some((w) => wa.has(w));
}

function writeList(lang, name, sourcesNote, rows) {
  const today = new Date().toISOString().slice(0, 10);
  const lines = [
    `# name: ${name}`,
    `# lang: ${lang}`,
    `# Built by scripts/alltime/make-lists.mjs on ${today} from: ${sourcesNote}`,
    `# Left out: ${EXCLUDE[lang].reason}. Order: as merged from the sources (best first).`,
    '# One song per line: title|artists',
    ...rows.map((r) => `${r.title.replace(/\|/g, '/')}|${splitCredit(r.artist).join(', ')}`),
  ];
  return writeFile(path.join(HERE, `${lang}.txt`), lines.join('\n') + '\n');
}

// ---------------------------------------------------------------- main
const [spotifyAllHtml, twHtml, jpHtml, billboardHtml, wikiJson] = await Promise.all([
  fetchText('spotify-all', SOURCES.spotifyAll),
  fetchText('spotify-tw', SOURCES.tw),
  fetchText('spotify-jp', SOURCES.jp),
  fetchText('billboard-goat', SOURCES.billboard),
  fetchText('wiki-japan-singles', SOURCES.wikiJapan),
]);

const pick = (lang, rows) => rows.filter((r) => r.title && r.artist && KEEP[lang](r) && !excluded(lang, r));

const en = interleave([pick('en', parseSpotifyAll(spotifyAllHtml)), pick('en', parseBillboard(billboardHtml))], CANDIDATES);
const zh = interleave([pick('zh', parseCountryTotals(twHtml))], CANDIDATES);
const ja = interleave([pick('ja', parseCountryTotals(jpHtml)), pick('ja', parseWikiJapan(wikiJson))], CANDIDATES);

await writeList('en', 'All Time (English)', "Spotify's all-time most-streamed songs (kworb.net) alternating with Billboard's Greatest of All Time Hot 100", en);
await writeList('zh', 'All Time (Mandarin)', "all-time stream totals on Spotify's Taiwan daily chart (kworb.net)", zh);
await writeList('ja', 'All Time (Japanese)', "all-time stream totals on Spotify's Japan daily chart (kworb.net) alternating with Japan's all-time best-selling singles (Oricon, via Wikipedia)", ja);
console.log(`Wrote scripts/alltime/en.txt (${en.length}), zh.txt (${zh.length}), ja.txt (${ja.length})`);
