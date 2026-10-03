import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildPools } from '../lib/pools';
import type { Song } from '../types';
import { COUNTDOWN_MS, DEFAULT_PARTY_SETTINGS, LOAD_TIMEOUT_MS, REVEAL_MS, type RoomState, type ServerMsg } from './protocol';
import { HOST_GRACE_MS, Room } from './room';

const song = (id: string, title: string, lang: Song['lang'] = 'en'): Song => ({
  id,
  lang,
  title,
  titleAlt: [],
  artist: `Artist ${id}`,
  artistAlt: [],
  year: 2015,
  album: 'Album',
  previewUrl: `https://audio.test/${id}.m4a`,
  artworkUrl: 'https://img.test/a.jpg',
  trackViewUrl: 'https://music.test/x',
  country: 'us',
});

const CATALOG = [song('1', 'Alpha'), song('2', 'Bravo'), song('3', 'Charlie'), song('4', '晴天', 'zh')];
const pools = buildPools(CATALOG, { lists: [] }, null);

/** A room plus a record of what each player was last sent. */
function setup(settings = { ...DEFAULT_PARTY_SETTINGS, rounds: 2, seconds: 30 }) {
  const last = new Map<string, RoomState>();
  const sent: ServerMsg[] = [];
  const room = new Room({
    code: 'ABCD',
    pools,
    settings,
    send: (id, msg) => {
      sent.push(msg);
      if (msg.t === 'state') last.set(id, msg.state);
    },
    rand: () => 0, // always the first eligible song
  });
  const join = (secret: string, name: string) => {
    const r = room.join(secret.padEnd(16, 'x'), name);
    if (!r.ok) throw new Error(r.message);
    return r.playerId;
  };
  const state = () => room.publicState();
  const player = (id: string) => state().players.find((p) => p.id === id)!;
  const answer = () => state().round!.songId;
  return { room, join, state, player, answer, last, sent };
}

/** Everyone loads the preview, then the countdown runs out: the round is open for guesses. */
function startListening(room: Room, ids: string[]) {
  const no = room.publicState().round!.no;
  for (const id of ids) room.handle(id, { t: 'loaded', no });
  vi.advanceTimersByTime(COUNTDOWN_MS);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-02T12:00:00Z'));
});
afterEach(() => vi.useRealTimers());

describe('joining', () => {
  it('makes the first player host and tells everyone who is in the room', () => {
    const { join, last } = setup();
    const a = join('a', 'Ann');
    const b = join('b', 'Ben');
    const seenByA = last.get(a)!;
    expect(seenByA.players.map((p) => [p.name, p.host])).toEqual([
      ['Ann', true],
      ['Ben', false],
    ]);
    expect(last.get(b)!.players).toHaveLength(2);
  });

  it('lets a player back in with the same secret, keeping their score', () => {
    const { room, join, player, answer } = setup();
    const a = join('a', 'Ann');
    room.handle(a, { t: 'start' });
    startListening(room, [a]);
    room.handle(a, { t: 'guess', no: 1, songId: answer(), text: '' });
    const score = player(a).score;
    room.disconnect(a);
    expect(player(a).connected).toBe(false);
    expect(join('a', 'Ann again')).toBe(a);
    expect(player(a)).toMatchObject({ connected: true, name: 'Ann again', score });
  });

  it('refuses a 13th player', () => {
    const { room, join } = setup();
    for (let i = 0; i < 12; i++) join(`player${i}`, `P${i}`);
    expect(room.join('newcomer'.padEnd(16, 'x'), 'Late')).toMatchObject({ ok: false, code: 'full' });
  });
});

describe('host', () => {
  it('only the host can change settings or start', () => {
    const { room, join, state } = setup();
    join('a', 'Ann');
    const b = join('b', 'Ben');
    room.handle(b, { t: 'settings', settings: { ...DEFAULT_PARTY_SETTINGS, difficulty: 'expert' } });
    room.handle(b, { t: 'start' });
    expect(state()).toMatchObject({ phase: 'lobby', settings: { difficulty: 'medium' } });
  });

  it('passes to the next player if the host stays away', () => {
    const { room, join, player } = setup();
    const a = join('a', 'Ann');
    const b = join('b', 'Ben');
    room.disconnect(a);
    vi.advanceTimersByTime(HOST_GRACE_MS - 1);
    expect(player(a).host).toBe(true); // a short drop-out keeps the role
    vi.advanceTimersByTime(1);
    expect(player(b).host).toBe(true);
  });

  it('keeps the role if the host is back in time', () => {
    const { room, join, player } = setup();
    const a = join('a', 'Ann');
    join('b', 'Ben');
    room.disconnect(a);
    vi.advanceTimersByTime(HOST_GRACE_MS / 2);
    join('a', 'Ann');
    vi.advanceTimersByTime(HOST_GRACE_MS);
    expect(player(a).host).toBe(true);
  });
});

describe('a round', () => {
  it('waits for everyone to download the preview, then counts down', () => {
    const { room, join, state } = setup();
    const a = join('a', 'Ann');
    const b = join('b', 'Ben');
    room.handle(a, { t: 'start' });
    expect(state()).toMatchObject({ phase: 'loading', round: { no: 1, total: 2, goAt: null } });
    room.handle(a, { t: 'loaded', no: 1 });
    expect(state().phase).toBe('loading');
    room.handle(b, { t: 'loaded', no: 1 });
    expect(state().phase).toBe('playing');
    expect(state().round!.goAt).toBe(Date.now() + COUNTDOWN_MS);
    expect(state().round!.deadline).toBe(Date.now() + COUNTDOWN_MS + 30_000);
  });

  it('starts without a player who is too slow to download, who then sits the round out', () => {
    const { room, join, state, player } = setup();
    const a = join('a', 'Ann');
    const b = join('b', 'Ben');
    room.handle(a, { t: 'start' });
    room.handle(a, { t: 'loaded', no: 1 });
    vi.advanceTimersByTime(LOAD_TIMEOUT_MS);
    expect(state().phase).toBe('playing');
    expect(player(b).round.status).toBe('out');
  });

  it('ignores guesses during the countdown', () => {
    const { room, join, player, answer } = setup();
    const a = join('a', 'Ann');
    room.handle(a, { t: 'start' });
    room.handle(a, { t: 'loaded', no: 1 });
    room.handle(a, { t: 'guess', no: 1, songId: answer(), text: '' });
    expect(player(a).round.tries).toEqual([]);
  });

  it('scores a right answer by tries and speed, and adds it to the total', () => {
    const { room, join, player, answer } = setup();
    const a = join('a', 'Ann');
    const b = join('b', 'Ben');
    room.handle(a, { t: 'start' });
    startListening(room, [a, b]);
    room.handle(a, { t: 'guess', no: 1, songId: answer(), text: '' }); // first try, instantly: full 1000
    room.handle(b, { t: 'skip', no: 1 });
    vi.advanceTimersByTime(15_000); // half the time gone: half the speed bonus lost
    room.handle(b, { t: 'guess', no: 1, songId: answer(), text: '' });
    expect(player(a).round).toMatchObject({ status: 'won', tries: ['right'], points: 1000, ms: 0 });
    expect(player(b).round).toMatchObject({ status: 'won', tries: ['skip', 'right'], points: 638 }); // 850 × 0.75
    expect(player(b).score).toBe(638);
  });

  it('accepts a typed title, and needs a song from the list for anything else', () => {
    const { room, join, player } = setup();
    const a = join('a', 'Ann');
    room.handle(a, { t: 'start' });
    startListening(room, [a]);
    room.handle(a, { t: 'guess', no: 1, songId: null, text: 'nope' });
    expect(player(a).round.tries).toEqual([]);
    room.handle(a, { t: 'guess', no: 1, songId: null, text: 'alpha' }); // rand 0 picks "Alpha"
    expect(player(a).round.status).toBe('won');
  });

  it('counts a wrong pick, and six misses lose the round', () => {
    const { room, join, player, answer } = setup();
    const a = join('a', 'Ann');
    const b = join('b', 'Ben');
    room.handle(a, { t: 'start' });
    startListening(room, [a, b]);
    const wrong = CATALOG.find((s) => s.id !== answer())!.id;
    for (let i = 0; i < 6; i++) room.handle(a, { t: 'guess', no: 1, songId: wrong, text: '' });
    expect(player(a).round).toMatchObject({ status: 'lost', points: 0 });
    room.handle(a, { t: 'guess', no: 1, songId: answer(), text: '' }); // too late
    expect(player(a).round.status).toBe('lost');
  });

  it('lets a player give up, keeping their tries, and ends the round when everyone is done', () => {
    const { room, join, state, player, answer } = setup();
    const a = join('a', 'Ann');
    const b = join('b', 'Ben');
    room.handle(a, { t: 'start' });
    startListening(room, [a, b]);
    room.handle(a, { t: 'skip', no: 1 });
    room.handle(a, { t: 'giveUp', no: 1 });
    expect(player(a).round).toMatchObject({ status: 'lost', tries: ['skip'], points: 0 });
    room.handle(a, { t: 'guess', no: 1, songId: answer(), text: '' }); // too late now
    expect(player(a).round.status).toBe('lost');
    expect(state().phase).toBe('playing'); // Ben is still guessing
    room.handle(b, { t: 'giveUp', no: 1 });
    expect(state().phase).toBe('reveal');
  });

  it('ignores giving up during the countdown', () => {
    const { room, join, player } = setup();
    const a = join('a', 'Ann');
    room.handle(a, { t: 'start' });
    room.handle(a, { t: 'loaded', no: 1 });
    room.handle(a, { t: 'giveUp', no: 1 });
    expect(player(a).round.status).toBe('playing');
  });

  it('ends early once everyone is done, then moves on by itself after the reveal', () => {
    const { room, join, state, answer } = setup();
    const a = join('a', 'Ann');
    room.handle(a, { t: 'start' });
    startListening(room, [a]);
    room.handle(a, { t: 'guess', no: 1, songId: answer(), text: '' });
    expect(state()).toMatchObject({ phase: 'reveal', round: { nextAt: Date.now() + REVEAL_MS } });
    vi.advanceTimersByTime(REVEAL_MS);
    expect(state()).toMatchObject({ phase: 'loading', round: { no: 2 } });
  });

  it('ends at the time limit, and whoever is still guessing loses', () => {
    const { room, join, state, player } = setup();
    const a = join('a', 'Ann');
    room.handle(a, { t: 'start' });
    startListening(room, [a]);
    vi.advanceTimersByTime(30_000);
    expect(state().phase).toBe('reveal');
    expect(player(a).round.status).toBe('lost');
  });

  it('lets the host skip the reveal, and finishes after the last round', () => {
    const { room, join, state, answer } = setup();
    const a = join('a', 'Ann');
    room.handle(a, { t: 'start' });
    for (const no of [1, 2]) {
      startListening(room, [a]);
      room.handle(a, { t: 'guess', no, songId: answer(), text: '' });
      room.handle(a, { t: 'next' });
    }
    expect(state().phase).toBe('final');
    expect(state().players[0]!.score).toBe(2000);
  });

  it('does not repeat a song within a session', () => {
    const { room, join, state, answer } = setup({ ...DEFAULT_PARTY_SETTINGS, langs: ['en'], rounds: 3, seconds: 30 });
    const a = join('a', 'Ann');
    room.handle(a, { t: 'start' });
    const heard: string[] = [];
    for (const no of [1, 2, 3]) {
      heard.push(answer());
      startListening(room, [a]);
      room.handle(a, { t: 'guess', no, songId: answer(), text: '' });
      room.handle(a, { t: 'next' });
    }
    expect(new Set(heard).size).toBe(3);
    expect(state().phase).toBe('final');
  });

  it('tries another song when nobody can download the preview', () => {
    const { room, join, state } = setup();
    const a = join('a', 'Ann');
    room.handle(a, { t: 'start' });
    const first = state().round!.songId;
    room.handle(a, { t: 'loadFailed', no: 1 });
    expect(state()).toMatchObject({ phase: 'loading', round: { no: 1 } });
    expect(state().round!.songId).not.toBe(first);
  });

  it('does not wait for a player who drops out mid-round', () => {
    const { room, join, state, answer } = setup();
    const a = join('a', 'Ann');
    const b = join('b', 'Ben');
    room.handle(a, { t: 'start' });
    startListening(room, [a, b]);
    room.handle(a, { t: 'guess', no: 1, songId: answer(), text: '' });
    expect(state().phase).toBe('playing');
    room.disconnect(b);
    expect(state().phase).toBe('reveal');
  });

  it('says so when no song matches the settings', () => {
    const { room, join, state } = setup({ ...DEFAULT_PARTY_SETTINGS, langs: ['ja'], rounds: 5, seconds: 30 });
    const a = join('a', 'Ann');
    room.handle(a, { t: 'start' });
    expect(state().phase).toBe('lobby');
    expect(state().notice).toMatch(/No songs match/);
  });
});
