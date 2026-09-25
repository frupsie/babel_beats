import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import catalogJson from './data/catalog.json';
import playlistsJson from './data/playlists.json';
import sgSnapshotJson from './data/sg-now.json';
import { LANGUAGES, LANG_CODES, languageInfo, type LangCode } from './data/languages';
import { GuessBox } from './components/GuessBox';
import { Ladder } from './components/Ladder';
import { LanguagePicker } from './components/LanguagePicker';
import { PoolSwitch } from './components/PoolSwitch';
import { Reveal } from './components/Reveal';
import { Segmented } from './components/Segmented';
import { StatsDialog } from './components/StatsDialog';
import { Vinyl } from './components/Vinyl';
import { VolumeControl } from './components/VolumeControl';
import { ClipEngine } from './lib/audio';
import { cx, fmtSeconds, formatChartDate, langStyle } from './lib/format';
import {
  DIFFICULTIES,
  ERAS,
  FULL_PREVIEW_SECONDS,
  applyGuess,
  currentClip,
  ladderFor,
  newRound,
  pickFromList,
  pickSong,
  poolFor,
  skipGain,
  type GuessEntry,
  type RoundState,
} from './lib/game';
import { resolveTrack } from './lib/itunes';
import { buildListPool, type PlaylistsFile } from './lib/lists';
import { indexSongs, isCorrectTitle } from './lib/match';
import { ageInDays, buildSgPool, type SgSnapshot } from './lib/sgNow';
import {
  emptyStats,
  loadAudioPrefs,
  loadSettings,
  loadStats,
  recordResult,
  saveAudioPrefs,
  saveSettings,
  saveStats,
} from './lib/storage';
import { gainFor } from './lib/volume';
import type { Difficulty, Era, Pool, Settings, Song, Stats } from './types';

const CATALOG = catalogJson as unknown as Song[];

// "Singapore now": the snapshot is written by scripts/snapshot-sg.mjs, which npm runs before `dev` and `build`
// whenever the file is 7+ days old. It is a static file because Apple's chart feed can't be read from a browser.
const SG_SNAPSHOT = sgSnapshotJson as unknown as SgSnapshot;
const SG = buildSgPool(SG_SNAPSHOT, CATALOG);
const SG_CHART_DATE = formatChartDate(SG_SNAPSHOT.chartUpdated);
const SG_STALE = SG.pool.length > 0 && ageInDays(SG_SNAPSHOT.fetchedAt) > 10;

// "My playlists": your Spotify playlists, resolved to songs Apple can preview by scripts/build-playlists.mjs.
const PLAYLISTS = (playlistsJson as unknown as PlaylistsFile).lists;
const MINE = buildListPool(
  PLAYLISTS.flatMap((l) => l.entries),
  CATALOG,
);

/** The songs a round can draw from for each list. */
const poolSongs = (pool: Pool): readonly Song[] => (pool === 'mine' ? MINE.pool : pool === 'sg-now' ? SG.pool : CATALOG);

// The guess box must be able to find every song that can be the answer (one entry per id; the catalogue's copy wins).
const INDEX = indexSongs([...new Map([...SG.extra, ...MINE.extra, ...CATALOG].map((s) => [s.id, s] as const)).values()]);

const engine = new ClipEngine();
/** How many different songs to try before giving up when previews fail to load. */
const MAX_LOAD_TRIES = 4;

type Phase = 'loading' | 'ready' | 'empty' | 'error';

/** Filter that roughens edges so stamps and the wordmark look printed rather than typeset. */
function InkFilter() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true" focusable="false">
      <filter id="ink-rough" x="-5%" y="-5%" width="110%" height="110%">
        <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="2" seed="7" result="noise" />
        <feDisplacementMap in="SourceGraphic" in2="noise" scale="3" xChannelSelector="R" yChannelSelector="G" />
      </filter>
    </svg>
  );
}

export default function App() {
  const [settings, setSettings] = useState<Settings>(() => {
    const saved = loadSettings();
    // A saved "My playlists" choice is no use if the playlist data is missing (say, the file was reset).
    return saved.pool === 'mine' && MINE.pool.length === 0 ? { ...saved, pool: 'mix' } : saved;
  });
  const [stats, setStats] = useState<Stats>(loadStats);
  const [audio, setAudio] = useState(loadAudioPrefs);
  const [phase, setPhase] = useState<Phase>('loading');
  const [round, setRound] = useState<RoundState | null>(null);
  const [art, setArt] = useState<string | null>(null);
  const [playing, setPlaying] = useState<{ id: number; seconds: number } | null>(null);
  const [announcement, setAnnouncement] = useState('');

  const bufferRef = useRef<AudioBuffer | null>(null);
  const playedRef = useRef<Set<string>>(new Set());
  const loadTokenRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const playIdRef = useRef(0);
  const statsDialogRef = useRef<HTMLDialogElement>(null);

  // Songs per language in the list being played; a language with none can't be switched on.
  const counts = useMemo(() => {
    const c = Object.fromEntries(LANGUAGES.map((l) => [l.code, 0])) as Record<LangCode, number>;
    for (const s of poolSongs(settings.pool)) c[s.lang] += 1;
    return c;
  }, [settings.pool]);
  const poolSize = useMemo(
    () => (settings.pool === 'sg-now' ? SG.pool.length : poolFor(poolSongs(settings.pool), settings).length),
    [settings],
  );

  // ---------------------------------------------------------------- rounds
  const startRound = useCallback(async (s: Settings) => {
    const token = ++loadTokenRef.current;
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;

    engine.stop();
    setPlaying(null);
    setPhase('loading');
    setRound(null);
    setArt(null);
    bufferRef.current = null;

    for (let attempt = 0; attempt < MAX_LOAD_TRIES; attempt++) {
      const song =
        s.pool === 'sg-now' ? pickFromList(SG.pool, playedRef.current) : pickSong(poolSongs(s.pool), s, playedRef.current);
      if (!song) {
        if (token === loadTokenRef.current) setPhase('empty');
        return;
      }
      playedRef.current.add(song.id);
      try {
        const track = await resolveTrack(song, abort.signal);
        const buffer = await engine.load(track.previewUrl, abort.signal);
        if (token !== loadTokenRef.current) return;
        bufferRef.current = buffer;
        setArt(track.artworkUrl);
        setRound(newRound(song, ladderFor(s.difficulty), s.pool));
        setPhase('ready');
        return;
      } catch (err) {
        if (token !== loadTokenRef.current || abort.signal.aborted) return;
        console.warn(`Skipping "${song.title}": preview could not be loaded`, err);
      }
    }
    if (token === loadTokenRef.current) setPhase('error');
  }, []);

  // A new round starts on mount and whenever the list, language, difficulty or era changes.
  useEffect(() => {
    void startRound(settings);
  }, [settings, startRound]);

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  // Volume is deliberately separate from `settings`: it must never start a new round.
  useEffect(() => {
    engine.setVolume(gainFor(audio));
    saveAudioPrefs(audio);
  }, [audio]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      engine.stop();
    },
    [],
  );

  // ---------------------------------------------------------------- playback
  const togglePlay = () => {
    const buffer = bufferRef.current;
    if (!round || !buffer) return;
    if (playing) {
      engine.stop();
      setPlaying(null);
      return;
    }
    const seconds = round.status === 'playing' ? currentClip(round) : FULL_PREVIEW_SECONDS;
    const id = ++playIdRef.current;
    setPlaying({ id, seconds: Math.min(seconds, buffer.duration) });
    engine.play(buffer, seconds, () => setPlaying((p) => (p?.id === id ? null : p)));
  };

  // ---------------------------------------------------------------- guessing
  const conclude = (next: RoundState) => {
    if (next.status === 'playing') return;
    // Chart songs have no curated language, so they only count toward the totals and the streak.
    const updated = recordResult(stats, next.pool === 'sg-now' ? null : next.song.lang, next.status === 'won');
    setStats(updated);
    saveStats(updated);
  };

  const commit = (current: RoundState, entry: GuessEntry) => {
    engine.stop();
    setPlaying(null);
    const next = applyGuess(current, entry);
    setRound(next);
    conclude(next);

    const left = next.ladder.length - next.guesses.length;
    if (next.status === 'won') setAnnouncement('Correct!');
    else if (next.status === 'lost') setAnnouncement(`Out of tries. It was ${next.song.title} by ${next.song.artist}.`);
    else if (entry.kind === 'skip') setAnnouncement(`Skipped. The clip is now ${fmtSeconds(currentClip(next))} long. ${left} tries left.`);
    else setAnnouncement(`Not that one. The clip is now ${fmtSeconds(currentClip(next))} long. ${left} tries left.`);
  };

  const guess = (song: Song | null, typed: string): boolean => {
    if (!round || round.status !== 'playing') return false;
    if (song?.id === round.song.id || (typed !== '' && isCorrectTitle(typed, round.song))) {
      commit(round, { kind: 'right', text: typed || round.song.title });
      return true;
    }
    if (!song) return false;
    commit(round, { kind: 'wrong', song, text: song.title });
    return true;
  };

  const skip = () => {
    if (round?.status === 'playing') commit(round, { kind: 'skip' });
  };

  // ---------------------------------------------------------------- settings
  const setLangs = (langs: LangCode[]) => setSettings((s) => ({ ...s, langs }));
  const setDifficulty = (difficulty: Difficulty) => setSettings((s) => ({ ...s, difficulty }));
  const setEra = (era: Era) => setSettings((s) => ({ ...s, era }));
  const setPool = (pool: Pool) =>
    setSettings((s) => {
      if (pool !== 'mine') return { ...s, pool };
      // Coming from a list with other languages: make sure a language that has songs here is switched on.
      const have = LANG_CODES.filter((code) => MINE.pool.some((song) => song.lang === code));
      return { ...s, pool, langs: s.langs.some((code) => have.includes(code)) ? s.langs : have };
    });

  // ---------------------------------------------------------------- derived view state
  const sgMode = settings.pool === 'sg-now';
  const finished = round !== null && round.status !== 'playing';
  const clip = round ? currentClip(round) : 0;
  const ladder = ladderFor(settings.difficulty);
  const vinylLabel = phase === 'loading' ? 'Tuning' : finished ? `${FULL_PREVIEW_SECONDS}s` : fmtSeconds(clip);
  const vinylAria = finished
    ? playing ? 'Stop the preview' : 'Play the 30 second preview'
    : playing ? 'Stop the clip' : `Play a ${fmtSeconds(clip)} clip`;
  // The language hint only makes sense for the curated mix; a chart song's language isn't known.
  const showHint = round?.status === 'playing' && round.pool !== 'sg-now' && settings.langs.length > 1 && round.guesses.length >= 2;
  const difficultyNote = ladder.map((n) => fmtSeconds(n)).join(' → ');

  return (
    <div className="app">
      <InkFilter />

      <header className="masthead">
        <div>
          <p className="masthead__kicker">
            <span>Guess the song</span>
            <i aria-hidden="true">/</i>
            <span lang="zh-Hant">猜歌</span>
            <i aria-hidden="true">/</i>
            <span lang="ja">イントロクイズ</span>
          </p>
          <h1 className="wordmark" aria-label="Babel Beats">
            <span className="wordmark__line" data-text="Babel" aria-hidden="true">
              Babel
            </span>
            <span className="wordmark__line wordmark__line--b" data-text="Beats" aria-hidden="true">
              Beats
            </span>
          </h1>
        </div>
        <div className="masthead__side">
          <span className="chip">
            Streak <b>{stats.streak}</b>
          </span>
          <button type="button" className="btn btn--small" onClick={() => statsDialogRef.current?.showModal()}>
            Stats
          </button>
        </div>
      </header>

      <main className="board">
        {/* On phones the two halves of the setup sit either side of the game: languages, game, then the rest. */}
        <section className="setup" aria-label="Game setup">
          <div className="setup__langs">
            <PoolSwitch
              pool={settings.pool}
              onChange={setPool}
              mixCount={CATALOG.length}
              mineCount={MINE.pool.length}
              sgCount={SG.pool.length}
              chartDate={SG_CHART_DATE}
            />

            <h2 className="kicker">
              <span className="kicker__n">01</span>Pick your tongues
            </h2>
            <LanguagePicker selected={settings.langs} counts={counts} onChange={setLangs} disabled={sgMode} />
            <p className="note">
              {sgMode ? (
                <>
                  This week’s Apple Music Singapore chart, {poolSize} songs. Chart songs mix languages and eras, so the language and
                  era filters are off.
                  {SG_STALE && ' This snapshot is over 10 days old: restart npm run dev to refresh it.'}
                </>
              ) : settings.pool === 'mine' ? (
                <>
                  Songs from your Spotify playlists ({PLAYLISTS.map((l) => l.name).join(', ')}), drawn evenly from each language you
                  switch on. {poolSize} in play right now.
                </>
              ) : (
                <>Songs are drawn evenly from every language you switch on. {poolSize} in play right now.</>
              )}
            </p>
          </div>

          <div className="setup__rest">
            <Segmented
              name="difficulty"
              number="02"
              legend="How much do you get"
              value={settings.difficulty}
              options={DIFFICULTIES.map((d) => ({ id: d.id, label: d.label }))}
              onChange={setDifficulty}
            />
            <p className="note note--mono">{difficultyNote}</p>

            <Segmented
              name="era"
              number="03"
              legend="Era"
              value={settings.era}
              options={ERAS.map((e) => ({ id: e.id, label: e.label, title: e.title }))}
              onChange={setEra}
              disabled={sgMode}
            />

            <ol className="howto">
              <li>Press the record. You only get a sliver.</li>
              <li>Guess, or skip to unlock more of the song.</li>
              <li>Six tries. Fewer tries, bigger stamp.</li>
            </ol>
          </div>
        </section>

        <section className="stage" aria-label="Game">
          {phase === 'empty' && sgMode && (
            <div className="notice">
              <h2>No chart yet</h2>
              <p>
                The Singapore list hasn’t been downloaded. Run <code>npm run snapshot:sg</code>, or switch back to your mix.
              </p>
              <button type="button" className="btn btn--primary" onClick={() => setPool('mix')}>
                Back to My mix
              </button>
            </div>
          )}

          {phase === 'empty' && !sgMode && (
            <div className="notice">
              <h2>Nothing to play here</h2>
              <p>
                There are no {ERAS.find((e) => e.id === settings.era)?.label} songs in the languages you picked. Try another era or switch on
                more languages.
              </p>
              <button type="button" className="btn btn--primary" onClick={() => setEra('any')}>
                Any era
              </button>
            </div>
          )}

          {phase === 'error' && (
            <div className="notice">
              <h2>Couldn’t load a preview</h2>
              <p>Song previews come from Apple’s servers. Check your connection and try again.</p>
              <button type="button" className="btn btn--primary" onClick={() => void startRound(settings)}>
                Try again
              </button>
            </div>
          )}

          {(phase === 'loading' || phase === 'ready') && (
            <>
              <Vinyl
                loading={phase === 'loading'}
                playing={playing}
                label={vinylLabel}
                ariaLabel={vinylAria}
                art={finished ? art : null}
                disabled={phase !== 'ready'}
                onToggle={togglePlay}
              />

              <div className="deck">
                <p className="tries" aria-hidden="true">
                  {round && !finished ? `Try ${round.guesses.length + 1} of ${round.ladder.length}` : finished ? 'Round over' : 'Tuning in…'}
                </p>
                <VolumeControl prefs={audio} onChange={setAudio} />
              </div>

              {round ? (
                <Ladder round={round} />
              ) : (
                <ol className="ladder is-skeleton" aria-hidden="true">
                  {ladder.map((n, i) => (
                    <li key={i} className="ladder__cell is-future">
                      <span className="ladder__time">{fmtSeconds(n)}</span>
                    </li>
                  ))}
                </ol>
              )}

              {finished && round ? (
                <Reveal
                  round={round}
                  art={art}
                  rank={round.pool === 'sg-now' ? SG.rank.get(round.song.id) : undefined}
                  playingFull={playing !== null}
                  onPlayFull={togglePlay}
                  onNext={() => void startRound(settings)}
                />
              ) : (
                <>
                  {showHint && round && (
                    <div className="hint" style={langStyle(round.song.lang)}>
                      {round.hint ? (
                        <p>
                          Hint: it’s a{' '}
                          <span className="tag">
                            <span lang={languageInfo(round.song.lang).htmlLang}>{languageInfo(round.song.lang).glyph}</span>{' '}
                            {languageInfo(round.song.lang).name}
                          </span>{' '}
                          song.
                        </p>
                      ) : (
                        <button type="button" className="linkish" onClick={() => setRound({ ...round, hint: true })}>
                          Stuck? Reveal the language
                        </button>
                      )}
                    </div>
                  )}
                  <GuessBox
                    index={INDEX}
                    disabled={phase !== 'ready' || !round}
                    skipGain={round ? skipGain(round) : null}
                    onGuess={guess}
                    onSkip={skip}
                  />
                </>
              )}
            </>
          )}
        </section>
      </main>

      <footer className="footer">
        <p>
          Previews &amp; artwork via the iTunes Search API. Not affiliated with Apple or any artist. Songs are hand-picked; add a language by
          adding a list.
        </p>
      </footer>

      <StatsDialog
        dialogRef={statsDialogRef}
        stats={stats}
        onReset={() => {
          const fresh = emptyStats();
          setStats(fresh);
          saveStats(fresh);
        }}
      />
      <p className={cx('sr-only')} role="status" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}
