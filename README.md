<<<<<<< HEAD
# Babel Beats

Guess the song from a split-second clip, in the languages **you** choose (English, Mandarin, Japanese out of the box).
Every wrong guess or skip unlocks a longer clip; you get six tries.

React + Vite + TypeScript. No backend: audio comes straight from Apple's iTunes Search API, which serves
30-second previews with open CORS headers, so the browser can cut sample-accurate clips (down to 0.1 s) itself.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (text folding, guess matching, round rules)
npm run build      # static site in dist/, deployable to any static host
```

## How it works

| Piece | Where |
| --- | --- |
| Song lists you curate, one file per language | `scripts/seeds/<lang>.json` |
| Script that resolves those lists against iTunes and writes the playable catalogue | `scripts/build-catalog.mjs` → `src/data/catalog.json` |
| Language registry (name, glyph, ink colour) | `src/data/languages.ts` |
| Round rules, difficulty ladders, era filter, song picking | `src/lib/game.ts` |
| Autocomplete and answer checking (native script, romaji, pinyin, English gloss) | `src/lib/match.ts`, `src/lib/text.ts` |
| Web Audio clip player | `src/lib/audio.ts` |
| "Singapore now" list: downloads Apple's chart and writes the snapshot | `scripts/snapshot-sg.mjs` → `src/data/sg-now.json` |
| "My playlists": your Spotify playlists as text, and the script that finds each song on Apple | `scripts/playlists/*.txt` → `scripts/build-playlists.mjs` → `src/data/playlists.json` |
| The rules for "is this Apple hit really that Spotify song?" (tested) | `scripts/lib/playlist-match.mjs` |
| Shared, rate-limited, cached Apple client and Chinese-text helpers | `scripts/lib/itunes.mjs`, `scripts/lib/han.mjs` |
| "Singapore now" logic shared by that script and the app | `src/lib/sgNow.ts` |

The catalogue is generated data, committed so the app works without running the script.
At play time the app asks iTunes for a fresh preview URL for the chosen song and falls back to the URL stored in the
catalogue if that lookup fails.

## Singapore now

The **Singapore now** tab plays this week's Apple Music Singapore top 100 instead of the language mix. Chart songs mix
languages and eras, so the language and era filters switch off, and the reveal card shows the song's chart position
(`SG #12`) instead of a language.

- **Weekly refresh:** `npm run dev` and `npm run build` first run `scripts/snapshot-sg.mjs --if-stale`, which downloads a
  fresh chart only when `src/data/sg-now.json` is 7+ days old (needs internet; if the download fails it keeps the old file
  and carries on). Force a refresh any time with `npm run snapshot:sg`. If a dev server runs for weeks, restart it or run
  that command; the game shows a note when the snapshot is over 10 days old.
- **Why a script, not a browser fetch:** Apple's chart feed sends no CORS header, so a web page can't read it. (Apple's
  lookup API, which supplies each song's preview URL, does allow browsers, and the game uses it at play time.)
- **Songs already in your catalogue** use the catalogue's own entry (curated pinyin, year, language), so they keep their
  language tag next to the chart position. **Chart-only songs** get a script-based language guess for fonts only
  (Simplified Chinese uses a Simplified font), no language tag, and pinyin plus Simplified/Traditional spellings for
  Chinese titles.
- **Stats:** chart rounds count toward played, win rate and streak, but not the per-language bars.
- **Known limits:** Apple's Singapore store lists some Mandarin songs under English titles (e.g. Jay Chou, Stefanie Sun),
  so those can only be found by the English title or artist. Songs without a preview are dropped (none were, the day this
  was built). The language hint is off in this mode because chart songs have no curated language.

## My playlists

The **My playlists** tab plays songs from your own Spotify playlists. The language stamps work as usual, so you can play
just the Chinese playlist, just the Japanese one, or both. English is greyed out because neither has English songs.

- **Where the songs come from:** `scripts/playlists/*.txt`, one song per line as `title|artists` (exactly as Spotify shows
  it), plus a `# lang: zh` or `# lang: ja` header line. Spotify no longer lets apps read playlists through its API, so these
  were read from the public playlist pages in a browser and saved as text. To add a playlist, paste its songs into a new
  `.txt` file in that format and run `npm run playlists`.
- **How each song is matched:** `npm run playlists` searches Apple's *native* store (Taiwan for Chinese, Japan for
  Japanese), then looks the top hits up in the Singapore and US stores, which spell titles and artists in English or
  romaji. A hit is accepted only if its **title and artist both match** what Spotify shows, in any of those spellings:
  Simplified/Traditional, pinyin, romaji, a name in either word order ("Ronghao Li" is "Li Ronghao"), a second title in
  brackets, or an artist alias learned from an earlier confirmed song. That is how "Kenshi Yonezu · Lemon" on Spotify
  verifies "米津玄師 · Lemon" on Apple without ever accepting a different song that just shares a title. Artists are compared
  as whole names, never as pieces of letters ("Uru" is not found inside "Miyuki Tsurugi"), and only a solo credit can teach
  an alias, so a duet never merges two people. Anything it can't verify is left out rather than guessed. Songs still
  unmatched after the first search get two more tries: the Hong Kong store (Chinese), then a search by the song's second
  artist. `--limit=60` does a quick test run.
- **Which version:** when Apple has several releases of a song, the one crediting the most of the row's artists (and no
  strangers, so the solo cut for a solo row) wins, then the earliest release, then the single over an EP or album. DJ, mix,
  live and concert, unplugged, piano, sped-up or slowed, TV-size and English-language versions are skipped unless the
  Spotify row is itself one of those.
- **Left out on purpose:** duplicates and re-cuts that Apple wouldn't have anyway (sped-up, DJ, Live, instrumental,
  female-voice covers). The playlist files say how many rows were set aside. A song that is in a playlist twice under two
  titles ("勇者" and "The Brave") counts once.
- **What it couldn't find:** `scripts/.cache/playlists-report.txt` lists every song it left out, the ones it accepted on only
  part of an artist name (worth a glance), and a sample of accepted matches to eyeball. Most misses are songs Apple doesn't
  carry in these stores, or covers by other artists. Some are on Apple under a native-script title only, with no English
  spelling to check a romanised Spotify title against (Spotify's "Kaikai Kitan" is Apple's 廻廻奇譚), so they stay out.
- **Last run (2026-09-21):** 408 of the Chinese playlist's 456 songs and 489 of the Japanese playlist's 522 are playable, 897
  in all (54 of them are also in the curated mix and use its entries).
- **Years are Apple's release dates,** not curated, so the era filter can be off for re-issued songs. A song that is also in
  the curated catalogue uses the catalogue's entry instead.
- **It is rate-limited:** Apple throttles searches (HTTP 429), so the first full run of both playlists takes about 40
  minutes. Every answer is cached in `scripts/.cache`, so re-runs take seconds and only new songs cost anything.

## Add a language

1. Create `scripts/seeds/<code>.json`, e.g. `ko.json`. Each entry:
   ```json
   {"t": "Title", "a": "Artist", "y": 2019, "ta": ["English gloss / romanisation"], "aa": ["Artist in English"]}
   ```
   - `t`, `a`, `y`: title and artist as displayed, and the **original release year** (it drives the era filter).
   - `ta`: extra spellings people may type; the first entries are shown under the title.
   - `tm`: spellings used only for matching Apple's data (e.g. Apple writes カタカナ where you wrote romaji).
   - `aa`: extra artist spellings.
2. Register the language in `scripts/build-catalog.mjs` (`LANGS`, with the iTunes storefronts to try) and in
   `src/data/languages.ts` (name, glyph, `htmlLang`, ink `color` and readable `onColor`).
3. `npm run catalog`. Songs Apple can't preview are dropped and listed in `scripts/.cache/last-report.txt`.
   Searches are cached in `scripts/.cache`, so re-runs are fast and only new songs hit the network.

Storefront note: Apple's Search API returns **nothing** for the China (`cn`) and Korea (`kr`) storefronts, so Mandarin
uses Taiwan/Hong Kong (Traditional Chinese) and a Korean list would need a different storefront such as `us` or `jp`
(check with a few searches first). Looking a song up *by ID* does work with `country=kr`, and Apple's chart feed
(`rss.applemarketingtools.com/api/v2/kr/music/most-played/100/songs.json`) lists Korean songs with their IDs, which is
another way in. Simplified/Traditional variants and pinyin are generated automatically for Mandarin so all of them are
accepted as guesses.

## Notes

- Some artists are simply not previewable on Apple Music (e.g. SMAP, RADWIMPS, Arashi), so they aren't in the lists.
- Release years are hand-curated. `last-report.txt` flags songs where Apple's date disagrees by two or more years;
  those are usually compilation dates, not errors.
- **Licensing: treat this as a local prototype.** Apple's Search API documentation allows previews and artwork only to
  promote store content, not for entertainment, and requires them to sit next to an Apple store badge. A guessing game
  plays the previews as the entertainment itself, so don't publish it publicly as is. Before doing that, switch to a source
  you're licensed to use or get Apple's permission.
- **iTunes API limits** (Apple's docs, checked): `limit` is 1–200 per search (default 50); the Search API is capped at
  roughly 20 calls a minute (subject to change; heavier use is meant to go through Apple's partner feed). Lookup accepts
  many comma-separated IDs in one call (120 tested). `scripts/build-catalog.mjs` paces itself at about one search per
  1.8 s, caches every result, and backs off on HTTP 403/429.
- Volume: a mute button and slider next to the try counter. Dragging with a mouse or finger snaps to 5% steps (the slider
  has ~90px of travel for 101 values, so at 1% some values can't be reached by dragging); the arrow keys move in exact 1%
  steps. The level (a squared curve, so the quiet half stays usable) and mute state are remembered. 100% is the loudest
  the game goes; your system volume is the ceiling.
- Settings, stats and volume live in `localStorage`; nothing is sent anywhere.
- **Bundle size:** the song lists (`src/data/*.json`) are compiled into the JavaScript so the site stays plain static
  files. With both playlists that is about 1.1 MB (roughly 300 kB gzipped). If it ever matters, load `playlists.json` with
  a dynamic `import()` the first time the My playlists tab is opened.
=======
# babel_beats
This is a mini game project where users will be guessing the name of the song after hearing it with specific durations. There are different languages and difficulties available for users to explore and challenge themselves.
>>>>>>> deb45b024318e6b62840a8892d4c41bed78f853c
