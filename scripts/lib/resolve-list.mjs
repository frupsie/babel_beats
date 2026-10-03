// Finds a list of songs ("title|artists" rows) on Apple, verifying each match (see playlist-match.mjs). Shared by
// scripts/build-playlists.mjs (your Spotify playlists) and scripts/build-alltime.mjs (the All Time list).
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { compact, titleKey } from '../../src/lib/text.ts';
import {
  artistFit,
  artistKeysOf,
  buildSong,
  featuredArtists,
  isOtherVersionTrack,
  learnAliases,
  prepare,
  releaseKind,
  titleMatches,
  wanted,
} from './playlist-match.mjs';

/** `native` stores are searched; `alt` stores are only used to look candidates up by id. (Apple's China/Korea stores return nothing.) */
export const LANGS = {
  en: { native: ['us'], alt: [] },
  zh: { native: ['tw', 'hk'], alt: ['sg', 'us'] },
  ja: { native: ['jp'], alt: ['us', 'sg'] },
};

/**
 * Reads a list file: one song per line as "title|artists" (artists comma-separated), plus "# lang: xx" and optional
 * "# name: …" header lines. A Spotify playlist's header line also gives its name and link.
 */
export async function readSongList(file) {
  const meta = { id: path.basename(file, '.txt'), name: path.basename(file, '.txt'), url: '', lang: null, readAt: '', total: 0 };
  const songs = [];
  for (const line of (await readFile(file, 'utf8')).split(/\r?\n/)) {
    if (line.startsWith('#')) {
      meta.lang = line.match(/^#\s*lang:\s*(\w+)/)?.[1] ?? meta.lang;
      meta.name = line.match(/^#\s*name:\s*(.+)$/)?.[1].trim() ?? meta.name;
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

/**
 * Searches Apple for every row and keeps only verified matches. Returns the prepared rows, the match for each (or null)
 * and the indexes still unmatched.
 */
export async function resolveList({ songs, lang, itunes, aliases, name, log = console.log }) {
  const cfg = LANGS[lang];
  if (!cfg) throw new Error(`${name}: unknown language "${lang}" (expected one of ${Object.keys(LANGS).join(', ')})`);
  const S = songs.map((raw) => prepare(raw, lang));
  const resolved = new Array(S.length).fill(null);
  let pending = S.map((_, i) => i);

  // The main search first; every later one only covers the songs still unmatched, so it stays cheap. The last one asks
  // "artist title" (not "title artist") for songs still unmatched or found only as an edit or other cut: for a famous
  // song, covers and karaoke can crowd the original out of the first search's results.
  const attempts = [
    ...cfg.native.map((store) => ({ store, artist: 0 })),
    { store: cfg.native[0], artist: 1 },
    { store: cfg.native[0], artist: 0, reversed: true },
  ];

  for (const attempt of attempts) {
    // Songs found only as an edit get another chance, and keep their old match unless the new search does better.
    const redo = attempt.reversed ? S.map((_, i) => i).filter((i) => resolved[i]?.otherVersion) : [];
    const earlier = new Map(redo.map((i) => [i, resolved[i]]));
    for (const i of redo) resolved[i] = null;
    const todo = [...pending, ...redo].filter((i) => S[i].artists.length > attempt.artist);
    log(`\n== ${name}: ${todo.length} songs to search in "${attempt.store}" using artist #${attempt.artist + 1}${attempt.reversed ? ' (artist first)' : ''}`);

    // 1. search (sequential, throttled, cached)
    const candidates = new Map();
    let n = 0;
    for (const i of todo) {
      const s = S[i];
      const artist = s.artists[attempt.artist];
      const results = await itunes.search((attempt.reversed ? `${artist} ${s.base}` : `${s.base} ${artist}`).trim(), attempt.store);
      candidates.set(i, results.filter((r) => wanted(r, s)).slice(0, 8));
      if (++n % 50 === 0) log(`  searched ${n}/${todo.length}`);
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
        // Artists named in a "(feat. X)" credit count as credited on the track.
        const artists = [r.artistName, ...alts.map((t) => t.artistName), ...titles.flatMap(featuredArtists)];
        if (!titleMatches(s, titles)) continue;
        const fit = artistFit(s, artists, aliases);
        if (fit.covered > 0) accepted.push({ r, alts, artists, fit });
      }
      if (accepted.length === 0) return null;
      // The track crediting the most of the row's artists wins, then the plain song over an edit or other cut of it, then
      // the one with the fewest other artists (the solo cut for a solo row), then the earliest release (the original
      // recording), then the single over an EP or album of that day.
      const other = (x) => Number(isOtherVersionTrack(x.r, s.title));
      accepted.sort(
        (a, b) =>
          b.fit.covered - a.fit.covered ||
          other(a) - other(b) ||
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
        otherVersion: isOtherVersionTrack(r, s.title),
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
    for (const [i, before] of earlier) if (!resolved[i] || resolved[i].otherVersion) resolved[i] = before;
    pending = pending.filter((i) => !resolved[i]);
    await itunes.saveCache();
    log(`  resolved so far: ${S.length - pending.length}/${S.length}`);
  }
  return { S, resolved, pending };
}

/** The matched songs in list order, each once: a song listed twice (or under two titles) keeps its first position. */
export function uniqueMatches(S, resolved) {
  const kept = [];
  const firstRow = new Map();
  const repeats = [];
  S.forEach((s, i) => {
    const hit = resolved[i];
    if (!hit) return;
    const earlier = firstRow.get(hit.song.id) ?? firstRow.get(hit.songKey);
    if (earlier !== undefined) return repeats.push(`  ${i + 1}. ${s.title} — ${s.artists.join(', ')}  (same song as ${earlier + 1})`);
    firstRow.set(hit.song.id, i);
    firstRow.set(hit.songKey, i);
    kept.push({ i, s, hit });
  });
  return { kept, repeats };
}

/** The report lines for one list: what wasn't found, repeats, partial matches, and a sample to eyeball. */
export function reportLines({ heading, S, resolved, pending, repeats }) {
  return [
    heading,
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
    'Accepted although Apple only has an edit or other cut of the song (check these are right):',
    ...S.map((s, i) => [s, resolved[i]])
      .filter(([, hit]) => hit?.otherVersion)
      .map(([s, hit]) => `  ${s.title} — ${s.artists.join(', ')}  =>  ${hit.apple} [${hit.store}]`),
    '',
    'Sample of accepted matches, to eyeball for wrong songs (list => Apple):',
    ...S.map((s, i) => [s, resolved[i], i])
      .filter(([, hit, i]) => hit && i % 9 === 0)
      .map(([s, hit]) => `  ${s.title} — ${s.artists.join(', ')}  =>  ${hit.apple} [${hit.store}]`),
    '',
  ];
}

/** Seeds the alias book with artist spellings from songs already known (e.g. the catalogue). */
export function learnFrom(aliases, songs) {
  for (const c of songs) aliases.learn(artistKeysOf([c.artist, ...c.artistAlt], c.lang === 'zh'));
}
