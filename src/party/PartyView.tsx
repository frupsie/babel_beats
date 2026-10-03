// "Play with friends": live rooms where everyone hears the same song at the same moment and races to name it.
// The server (server/party.ts) runs the game; this view shows it, plays the clips and sends guesses.
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { LANGUAGES, LANG_CODES, type LangCode } from '../data/languages';
import { GuessBox } from '../components/GuessBox';
import { Ladder } from '../components/Ladder';
import { LanguagePicker } from '../components/LanguagePicker';
import { PoolSwitch } from '../components/PoolSwitch';
import { Reveal } from '../components/Reveal';
import { Segmented } from '../components/Segmented';
import { Vinyl } from '../components/Vinyl';
import { VolumeControl } from '../components/VolumeControl';
import { engine } from '../lib/engine';
import { cx, fmtSeconds, formatChartDate } from '../lib/format';
import {
  AUTOPLAY_AFTER_SKIP_MS,
  DIFFICULTIES,
  ERAS,
  FULL_PREVIEW_SECONDS,
  currentClip,
  poolFor,
  skipGain,
  type GuessEntry,
  type RoundState,
} from '../lib/game';
import { resolveTrack } from '../lib/itunes';
import { isCorrectTitle } from '../lib/match';
import { poolSongs } from '../lib/pools';
import { INDEX, POOLS, SG_SNAPSHOT, songById } from '../lib/songData';
import type { AudioPrefs } from '../lib/volume';
import type { Settings, Song } from '../types';
import {
  CODE_LENGTH,
  NAME_MAX,
  ROUND_CHOICES,
  SECONDS_CHOICES,
  cleanName,
  isRoomCode,
  normaliseCode,
  type PartySettings,
  type PublicPlayer,
  type RoomState,
} from './protocol';
import { roomFromUrl, roomLink, savedName, sessionName, useParty, type Party } from './useParty';

interface Props {
  /** The solo settings, used as the starting point for a new room. */
  soloSettings: Settings;
  audio: AudioPrefs;
  onAudioChange: (prefs: AudioPrefs) => void;
  onExit: () => void;
}

export function PartyView({ soloSettings, audio, onAudioChange, onExit }: Props) {
  const party = useParty();
  const { state, you } = party;
  const me = state?.players.find((p) => p.id === you) ?? null;

  const exit = () => {
    engine.stop();
    party.leave();
    onExit();
  };

  if (!state || !me) return <PartyEntry party={party} soloSettings={soloSettings} onBack={exit} />;

  const inRound = state.phase === 'loading' || state.phase === 'playing' || state.phase === 'reveal';
  return (
    <main className={cx('board party', inRound && 'is-in-round')}>
      <section className="setup party__side" aria-label="Room">
        <RoomCard state={state} me={me} party={party} onLeave={exit} />
        <Scoreboard state={state} you={me.id} />
      </section>
      <section className="stage" aria-label="Game">
        {state.phase === 'lobby' ? (
          <Lobby state={state} me={me} party={party} />
        ) : state.phase === 'final' ? (
          <Final state={state} me={me} party={party} />
        ) : (
          <PartyRound state={state} me={me} party={party} audio={audio} onAudioChange={onAudioChange} />
        )}
      </section>
    </main>
  );
}

// ------------------------------------------------------------------ getting into a room

function PartyEntry({ party, soloSettings, onBack }: { party: Party; soloSettings: Settings; onBack: () => void }) {
  const [name, setName] = useState(() => sessionName() ?? savedName());
  const [code, setCode] = useState(() => normaliseCode(roomFromUrl() ?? ''));
  const cleaned = cleanName(name);
  const busy = party.connection === 'connecting';

  // A reload in the middle of a game: go straight back into the room as the same player.
  const { join: rejoin } = party;
  useEffect(() => {
    const roomCode = normaliseCode(roomFromUrl() ?? '');
    const known = cleanName(sessionName());
    if (isRoomCode(roomCode) && known) rejoin(known, roomCode);
  }, [rejoin]);

  const create = (e: FormEvent) => {
    e.preventDefault();
    if (!cleaned) return;
    engine.unlock(); // this click lets the first clip of each round play by itself later
    party.create(cleaned, { ...soloSettings, rounds: 10, seconds: 60 });
  };
  const join = (e: FormEvent) => {
    e.preventDefault();
    if (!cleaned || !isRoomCode(code)) return;
    engine.unlock();
    party.join(cleaned, code);
  };

  return (
    <main className="party-entry">
      <section className="stage party-entry__card">
        <h2 className="party__title">Play with friends</h2>
        <p className="note">
          Everyone hears the same clip at the same moment. Name it first, in fewer tries, for more points. Each player listens on their
          own phone or computer.
        </p>

        <label className="field">
          <span className="field__label">Your name</span>
          <input
            className="field__input"
            value={name}
            maxLength={NAME_MAX * 2}
            autoComplete="nickname"
            placeholder="What should others see?"
            onChange={(e) => setName(e.target.value)}
          />
        </label>

        {party.error && (
          <p className="party__error" role="alert">
            {party.error.message}
          </p>
        )}

        <div className="party-entry__split">
          <form onSubmit={create} className="party-entry__half">
            <h3 className="kicker">
              <span className="kicker__n">A</span>Host
            </h3>
            <p className="note note--tight-top">You choose the songs and start each game. Your friends join with a code.</p>
            <button type="submit" className="btn btn--primary" disabled={!cleaned || busy}>
              {busy ? 'Opening…' : 'Start a room'}
            </button>
          </form>

          <form onSubmit={join} className="party-entry__half">
            <h3 className="kicker">
              <span className="kicker__n">B</span>Join
            </h3>
            <label className="field">
              <span className="field__label">Room code</span>
              <input
                className="field__input field__input--code"
                value={code}
                maxLength={CODE_LENGTH + 2}
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                placeholder="e.g. K7P3"
                onChange={(e) => setCode(normaliseCode(e.target.value))}
              />
            </label>
            <button type="submit" className="btn" disabled={!cleaned || !isRoomCode(code) || busy}>
              Join room
            </button>
          </form>
        </div>

        <button type="button" className="linkish party-entry__back" onClick={onBack}>
          ← Back to playing solo
        </button>
      </section>
    </main>
  );
}

// ------------------------------------------------------------------ the room panel

function RoomCard({ state, me, party, onLeave }: { state: RoomState; me: PublicPlayer; party: Party; onLeave: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(roomLink(state.code));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked: the code is on screen to read out instead.
    }
  };

  return (
    <div className="room-card">
      <p className="room-card__label">Room code</p>
      <p className="room-card__code" aria-label={`Room code ${state.code.split('').join(' ')}`}>
        {state.code}
      </p>
      <div className="room-card__actions">
        <button type="button" className="btn btn--small" onClick={() => void copy()}>
          {copied ? 'Link copied' : 'Copy invite link'}
        </button>
        <button type="button" className="btn btn--small" onClick={onLeave}>
          Leave
        </button>
      </div>
      {party.connection === 'reconnecting' && (
        <p className="party__error" role="status">
          Connection lost. Reconnecting…
        </p>
      )}
      <p className="note note--mono room-card__you">
        You are {me.name}
        {me.host ? ' · host' : ''}
      </p>
    </div>
  );
}

const STATUS_MARK: Record<PublicPlayer['round']['status'], string> = { out: '–', waiting: '…', playing: '♪', won: '✓', lost: '✕' };
const STATUS_WORD: Record<PublicPlayer['round']['status'], string> = {
  out: 'sitting this round out',
  waiting: 'loading the song',
  playing: 'still guessing',
  won: 'got it',
  lost: 'missed it',
};

function Scoreboard({ state, you }: { state: RoomState; you: string }) {
  const inGame = state.phase !== 'lobby';
  const players = inGame ? [...state.players].sort((a, b) => b.score - a.score) : state.players;
  const showRound = state.phase === 'loading' || state.phase === 'playing' || state.phase === 'reveal';

  return (
    <div className="scoreboard">
      <h2 className="kicker">
        <span className="kicker__n">{state.players.length}</span>
        {inGame ? 'Scores' : 'Players'}
      </h2>
      <ol className="scoreboard__list">
        {players.map((p) => (
          <li key={p.id} className={cx('scoreboard__row', p.id === you && 'is-you', !p.connected && 'is-away')}>
            {showRound && (
              <span className={cx('scoreboard__mark', `is-${p.round.status}`)} title={STATUS_WORD[p.round.status]}>
                {STATUS_MARK[p.round.status]}
                <span className="sr-only">{STATUS_WORD[p.round.status]}</span>
              </span>
            )}
            <span className="scoreboard__name">
              {p.name}
              {p.host && <span className="scoreboard__host" title="Host"> ★</span>}
              {!p.connected && <span className="scoreboard__away"> (away)</span>}
            </span>
            {state.phase === 'reveal' && p.round.points > 0 && <span className="scoreboard__gain">+{p.round.points}</span>}
            {inGame && <span className="scoreboard__score">{p.score}</span>}
          </li>
        ))}
      </ol>
      {state.notice && <p className="party__error">{state.notice}</p>}
    </div>
  );
}

// ------------------------------------------------------------------ lobby

function Lobby({ state, me, party }: { state: RoomState; me: PublicPlayer; party: Party }) {
  const s = state.settings;
  const update = (patch: Partial<PartySettings>) => party.send({ t: 'settings', settings: { ...s, ...patch } });
  const counts = useMemo(() => {
    const c = Object.fromEntries(LANGUAGES.map((l) => [l.code, 0])) as Record<LangCode, number>;
    for (const song of poolSongs(POOLS, s.pool)) c[song.lang] += 1;
    return c;
  }, [s.pool]);
  const eligible = s.pool === 'sg-now' ? POOLS.sg.pool.length : poolFor(poolSongs(POOLS, s.pool), s).length;
  const others = state.players.length - 1;

  if (!me.host) {
    const host = state.players.find((p) => p.host);
    return (
      <div className="party-lobby">
        <h2 className="party__title">Waiting for {host?.name ?? 'the host'} to start</h2>
        <SettingsSummary settings={s} eligible={eligible} />
        <p className="note">The first clip plays by itself when the round starts, so turn your sound on.</p>
      </div>
    );
  }

  const setPool = (pool: PartySettings['pool']) => {
    if (pool !== 'mine') return update({ pool });
    const have = LANG_CODES.filter((code) => POOLS.mine.pool.some((song) => song.lang === code));
    update({ pool, langs: s.langs.some((code) => have.includes(code)) ? s.langs : have });
  };

  return (
    <div className="party-lobby">
      <h2 className="party__title">{others === 0 ? 'Share the code with your friends' : `${others} ${others === 1 ? 'friend' : 'friends'} in`}</h2>
      <PoolSwitch
        pool={s.pool}
        onChange={setPool}
        mixCount={POOLS.catalog.length}
        mineCount={POOLS.mine.pool.length}
        sgCount={POOLS.sg.pool.length}
        chartDate={formatChartDate(SG_SNAPSHOT.chartUpdated)}
      />
      <LanguagePicker selected={s.langs} counts={counts} onChange={(langs) => update({ langs })} disabled={s.pool === 'sg-now'} />
      <p className="note">{eligible} songs to draw from.</p>
      <Segmented
        name="party-difficulty"
        number="1"
        legend="How much do you get"
        value={s.difficulty}
        options={DIFFICULTIES.map((d) => ({ id: d.id, label: d.label }))}
        onChange={(difficulty) => update({ difficulty })}
      />
      <Segmented
        name="party-era"
        number="2"
        legend="Era"
        value={s.era}
        options={ERAS.map((e) => ({ id: e.id, label: e.label, title: e.title }))}
        onChange={(era) => update({ era })}
        disabled={s.pool === 'sg-now'}
      />
      <Segmented
        name="party-rounds"
        number="3"
        legend="Songs"
        value={String(s.rounds)}
        options={ROUND_CHOICES.map((n) => ({ id: String(n), label: String(n) }))}
        onChange={(v) => update({ rounds: Number(v) })}
      />
      <Segmented
        name="party-seconds"
        number="4"
        legend="Time per song"
        value={String(s.seconds)}
        options={SECONDS_CHOICES.map((n) => ({ id: String(n), label: `${n}s` }))}
        onChange={(v) => update({ seconds: Number(v) })}
      />
      <button
        type="button"
        className="btn btn--primary party__start"
        disabled={eligible === 0}
        onClick={() => {
          engine.unlock();
          party.send({ t: 'start' });
        }}
      >
        Start the game
      </button>
    </div>
  );
}

function SettingsSummary({ settings: s, eligible }: { settings: PartySettings; eligible: number }) {
  const list = s.pool === 'sg-now' ? 'Popular' : s.pool === 'mine' ? 'Playlists' : 'All Time';
  const langs = s.pool === 'sg-now' ? 'all languages' : s.langs.map((c) => LANGUAGES.find((l) => l.code === c)?.name).join(', ');
  const diff = DIFFICULTIES.find((d) => d.id === s.difficulty)?.label;
  const era = ERAS.find((e) => e.id === s.era)?.label;
  return (
    <ul className="party-summary">
      <li>
        <b>{s.rounds}</b> songs, <b>{s.seconds}s</b> each
      </li>
      <li>
        {list} · {langs}
        {s.pool !== 'sg-now' && ` · ${era}`}
      </li>
      <li>
        {diff} clips · {eligible} songs to draw from
      </li>
    </ul>
  );
}

// ------------------------------------------------------------------ a round

/** Re-renders a few times a second while `active`, for countdowns. */
function useTicker(active: boolean): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick((t) => t + 1), 200);
    return () => clearInterval(id);
  }, [active]);
}

const TRY_ENTRY: Record<PublicPlayer['round']['tries'][number], GuessEntry> = {
  skip: { kind: 'skip' },
  wrong: { kind: 'wrong', song: null, text: '' },
  right: { kind: 'right', text: '' },
};

function PartyRound({
  state,
  me,
  party,
  audio,
  onAudioChange,
}: {
  state: RoomState;
  me: PublicPlayer;
  party: Party;
  audio: AudioPrefs;
  onAudioChange: (prefs: AudioPrefs) => void;
}) {
  const round = state.round!;
  const song: Song | undefined = songById(round.songId);
  const [loaded, setLoaded] = useState<{ songId: string; buffer: AudioBuffer; art: string } | null>(null);
  const [playing, setPlaying] = useState<{ id: number; seconds: number } | null>(null);
  const playIdRef = useRef(0);
  const autoPlayedRef = useRef<string | null>(null);
  const buffer = loaded?.songId === round.songId ? loaded.buffer : null;

  const now = party.serverNow();
  const counting = state.phase === 'playing' && round.goAt !== null && now < round.goAt;
  useTicker(state.phase !== 'loading');

  // Download each round's preview as soon as the song is known.
  const [failedSongId, setFailedSongId] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ songId: string; done: number } | null>(null);
  useEffect(() => {
    if (!song) {
      setFailedSongId(round.songId); // our copy of the song lists doesn't have it (an out-of-date page)
      return;
    }
    const abort = new AbortController();
    (async () => {
      try {
        setProgress({ songId: song.id, done: 0 });
        const track = await resolveTrack(song, abort.signal);
        const buf = await engine.load(track.previewUrl, abort.signal, (done) => {
          if (!abort.signal.aborted) setProgress({ songId: song.id, done: 0.1 + 0.9 * done });
        });
        if (!abort.signal.aborted) setLoaded({ songId: song.id, buffer: buf, art: track.artworkUrl });
      } catch {
        if (!abort.signal.aborted) setFailedSongId(song.id);
      }
    })();
    return () => abort.abort();
  }, [song, round.songId]);

  // Tell the server when the preview is ready, or that it can't be had, while it is waiting to hear.
  const { send } = party;
  const myStatus = me.round.status;
  const failed = failedSongId === round.songId;
  useEffect(() => {
    if (state.phase !== 'loading' || myStatus !== 'waiting') return;
    if (buffer) send({ t: 'loaded', no: round.no });
    else if (failed) send({ t: 'loadFailed', no: round.no });
  }, [state.phase, myStatus, buffer, failed, round.no, send]);

  // My attempts so far, as the solo game's round shape, for the ladder and the reveal card.
  const view: RoundState | null = song
    ? {
        song,
        ladder: round.ladder,
        guesses: me.round.tries.map((k) => TRY_ENTRY[k]),
        status: me.round.status === 'won' ? 'won' : me.round.status === 'playing' || me.round.status === 'waiting' ? 'playing' : 'lost',
        hint: false,
        pool: state.settings.pool,
      }
    : null;
  const canGuess = state.phase === 'playing' && me.round.status === 'playing' && !counting;
  const revealed = state.phase === 'reveal';

  const play = (seconds: number) => {
    if (!buffer) return;
    const id = ++playIdRef.current;
    setPlaying({ id, seconds: Math.min(seconds, buffer.duration) });
    engine.play(buffer, seconds, () => setPlaying((p) => (p?.id === id ? null : p)));
  };
  const stop = () => {
    engine.stop();
    setPlaying(null);
  };
  const togglePlay = () => {
    if (playing) return stop();
    if (!view) return;
    play(revealed || view.status !== 'playing' ? FULL_PREVIEW_SECONDS : currentClip(view));
  };

  // Everyone's first clip starts by itself when the countdown ends.
  useEffect(() => {
    if (state.phase !== 'playing' || round.goAt === null || !buffer || !view || me.round.status !== 'playing') return;
    const key = `${round.no}:${round.songId}`;
    if (autoPlayedRef.current === key || me.round.tries.length > 0) return;
    const wait = round.goAt - party.serverNow();
    if (wait < -2000) return; // joined late: don't blast a clip at them mid-round
    const t = setTimeout(() => {
      autoPlayedRef.current = key;
      play(currentClip(view));
    }, Math.max(0, wait));
    return () => clearTimeout(t);
    // Deliberately not re-run for every new `view` object: only when the round, its start time or the preview changes.
  }, [state.phase, round.goAt, round.no, round.songId, buffer, me.round.status]);

  // A new attempt (wrong or skip) or the end of the round cuts the clip off, as in solo play. After a skip, the longer
  // clip follows by itself after a short pause, which leaves time to skip again or give up instead.
  const triesCount = me.round.tries.length;
  const lastTry = me.round.tries[triesCount - 1];
  const seenTriesRef = useRef({ no: round.no, count: triesCount });
  useEffect(() => {
    stop();
    const seen = seenTriesRef.current;
    const newTry = seen.no === round.no && triesCount > seen.count;
    seenTriesRef.current = { no: round.no, count: triesCount };
    if (!newTry || lastTry !== 'skip' || myStatus !== 'playing' || state.phase !== 'playing' || !view) return;
    const seconds = currentClip(view);
    const t = setTimeout(() => play(seconds), AUTOPLAY_AFTER_SKIP_MS);
    return () => clearTimeout(t);
    // Only a new attempt, a new round or the end of the round should cut in here.
  }, [triesCount, state.phase, round.no]);
  useEffect(() => () => engine.stop(), []);

  const guess = (picked: Song | null, typed: string): boolean => {
    if (!canGuess || !song) return false;
    const right = picked?.id === song.id || (typed !== '' && isCorrectTitle(typed, song));
    if (!picked && !right) return false;
    send({ t: 'guess', no: round.no, songId: picked?.id ?? null, text: typed });
    return true;
  };

  const secondsLeft = round.deadline !== null ? Math.max(0, Math.ceil((round.deadline - now) / 1000)) : null;
  const fraction = round.deadline !== null && round.goAt !== null ? Math.min(1, Math.max(0, (round.deadline - now) / (round.deadline - round.goAt))) : 1;
  const nextIn = round.nextAt !== null ? Math.max(0, Math.ceil((round.nextAt - now) / 1000)) : null;
  const clip = view ? currentClip(view) : round.ladder[0]!;

  const status =
    state.phase === 'loading'
      ? me.round.status === 'waiting'
        ? 'Loading the song…'
        : me.round.status === 'out'
          ? 'You’ll join from the next song.'
          : 'Waiting for the others to load…'
      : counting
        ? 'Get ready…'
        : revealed
          ? 'Round over'
          : me.round.status === 'out'
            ? 'You’re sitting this song out. You’re in from the next one.'
            : me.round.status === 'won'
              ? `Got it! +${me.round.points}. Waiting for the others…`
              : me.round.status === 'lost'
                ? triesCount < round.ladder.length
                  ? 'You gave up. Waiting for the others…'
                  : 'Out of tries. Waiting for the others…'
                : `${round.ladder.length - triesCount} ${round.ladder.length - triesCount === 1 ? 'try' : 'tries'} left`;

  return (
    <div className="party-round">
      <div className="party-round__head">
        <p className="party-round__no">
          Song {round.no} of {round.total}
        </p>
        {state.phase === 'playing' && !counting && secondsLeft !== null && (
          <p className={cx('party-round__clock', secondsLeft <= 10 && 'is-low')} aria-live="off">
            {secondsLeft}s
          </p>
        )}
      </div>
      <div className="party-round__bar" aria-hidden="true">
        <span style={{ transform: `scaleX(${state.phase === 'playing' && !counting ? fraction : state.phase === 'reveal' ? 0 : 1})` }} />
      </div>

      {counting && round.goAt !== null && (
        <div className="party-countdown" aria-live="assertive">
          {Math.max(1, Math.ceil((round.goAt - now) / 1000))}
        </div>
      )}

      <Vinyl
        loading={!buffer}
        playing={playing}
        label={!buffer ? 'Tuning' : revealed ? `${FULL_PREVIEW_SECONDS}s` : fmtSeconds(clip)}
        ariaLabel={playing ? 'Stop' : revealed ? 'Play the 30 second preview' : `Play a ${fmtSeconds(clip)} clip`}
        art={revealed ? (loaded?.art ?? song?.artworkUrl ?? null) : null}
        disabled={!buffer || counting || (me.round.status === 'out' && !revealed)}
        onToggle={togglePlay}
        progress={progress?.songId === round.songId ? progress.done : 0}
      />

      <div className="deck">
        <p className="tries">{status}</p>
        <VolumeControl prefs={audio} onChange={onAudioChange} />
      </div>

      {view && <Ladder round={view} />}

      {revealed && view ? (
        <Reveal
          round={view}
          art={loaded?.art ?? null}
          rank={state.settings.pool === 'sg-now' ? POOLS.sg.rank.get(view.song.id) : undefined}
          playingFull={playing !== null}
          onPlayFull={togglePlay}
          onNext={me.host ? () => party.send({ t: 'next' }) : undefined}
          nextNote={nextIn !== null ? (round.no < round.total ? `Next song in ${nextIn}s` : `Final scores in ${nextIn}s`) : undefined}
        />
      ) : (
        <GuessBox
          index={INDEX}
          disabled={!canGuess}
          skipGain={view ? skipGain(view) : null}
          onGuess={guess}
          onSkip={() => {
            if (canGuess) send({ t: 'skip', no: round.no });
          }}
          onGiveUp={() => {
            if (canGuess) send({ t: 'giveUp', no: round.no });
          }}
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ the end

function Final({ state, me, party }: { state: RoomState; me: PublicPlayer; party: Party }) {
  const ranked = [...state.players].sort((a, b) => b.score - a.score);
  const top = ranked[0]?.score ?? 0;
  const winners = ranked.filter((p) => p.score === top && top > 0);
  const place = (p: PublicPlayer) => ranked.filter((q) => q.score > p.score).length + 1;

  return (
    <div className="party-final">
      <p className="party-round__no">Final scores</p>
      <h2 className="party__title">
        {winners.length === 0
          ? 'Nobody scored this time'
          : winners.some((w) => w.id === me.id)
            ? winners.length > 1
              ? 'You tied for first!'
              : 'You win!'
            : `${winners.map((w) => w.name).join(' & ')} ${winners.length > 1 ? 'tie' : 'wins'}!`}
      </h2>
      <ol className="podium">
        {ranked.map((p) => (
          <li key={p.id} className={cx('podium__row', place(p) <= 3 && `is-${place(p)}`, p.id === me.id && 'is-you')}>
            <span className="podium__place">{place(p)}</span>
            <span className="podium__name">{p.name}</span>
            <span className="podium__score">{p.score}</span>
          </li>
        ))}
      </ol>
      {me.host ? (
        <div className="party-final__actions">
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => {
              engine.unlock();
              party.send({ t: 'start' });
            }}
          >
            Play again
          </button>
          <button type="button" className="btn" onClick={() => party.send({ t: 'lobby' })}>
            Change settings
          </button>
        </div>
      ) : (
        <p className="note">Waiting for the host to start another game.</p>
      )}
    </div>
  );
}
