import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { buildPools } from '../src/lib/pools.ts';
import { DEFAULT_PARTY_SETTINGS, type RoomState, type ServerMsg } from '../src/party/protocol.ts';
import type { Song } from '../src/types.ts';
import { PARTY_PATH, attachParty, type PartyServer } from './party.ts';

const song = (id: string, title: string): Song => ({
  id,
  lang: 'en',
  title,
  titleAlt: [],
  artist: 'Someone',
  artistAlt: [],
  year: 2015,
  album: 'Album',
  previewUrl: '',
  artworkUrl: '',
  trackViewUrl: '',
  country: 'us',
});
const pools = buildPools([song('1', 'Alpha'), song('2', 'Bravo')], { lists: [] }, null);

let cleanup: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanup.reverse()) fn();
  cleanup = [];
});

async function startServer(): Promise<{ url: string; party: PartyServer }> {
  const server = http.createServer();
  const party = attachParty(server, pools, { info: () => {}, warn: () => {} });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(() => {
    party.close();
    server.close();
  });
  return { url: `ws://127.0.0.1:${(server.address() as AddressInfo).port}${PARTY_PATH}`, party };
}

/** A test player: a WebSocket that remembers every message and can wait for one that matches. */
async function connect(url: string) {
  const ws = new WebSocket(url);
  const inbox: ServerMsg[] = [];
  const waiters: Array<{ test: (m: ServerMsg) => boolean; resolve: (m: ServerMsg) => void }> = [];
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString()) as ServerMsg;
    inbox.push(msg);
    for (const w of [...waiters]) if (w.test(msg)) (waiters.splice(waiters.indexOf(w), 1), w.resolve(msg));
  });
  await new Promise((resolve, reject) => (ws.once('open', resolve), ws.once('error', reject)));
  cleanup.push(() => ws.terminate());
  const until = (test: (m: ServerMsg) => boolean, ms = 2000) =>
    new Promise<ServerMsg>((resolve, reject) => {
      const seen = inbox.find(test);
      if (seen) return resolve(seen);
      waiters.push({ test, resolve });
      setTimeout(() => reject(new Error('timed out waiting for a message')), ms);
    });
  const untilState = (test: (s: RoomState) => boolean) =>
    until((m) => m.t === 'state' && test(m.state)).then((m) => (m as Extract<ServerMsg, { t: 'state' }>).state);
  return { ws, inbox, until, untilState, send: (msg: object) => ws.send(JSON.stringify(msg)) };
}

const secret = (s: string) => s.padEnd(20, '0');

describe('party server', () => {
  it('runs a room: create, join by code, play a round over real WebSockets', async () => {
    const { url, party } = await startServer();
    const ann = await connect(url);
    ann.send({ t: 'create', secret: secret('ann'), name: 'Ann', settings: { ...DEFAULT_PARTY_SETTINGS, rounds: 5 } });
    const created = await ann.untilState((s) => s.players.length === 1);
    expect(created.code).toMatch(/^(?=.*[A-Z])(?=.*[2-9])[A-HJKMNP-Z2-9]{4}$/);
    expect(party.roomCount()).toBe(1);

    const ben = await connect(url);
    ben.send({ t: 'join', secret: secret('ben'), name: 'Ben', code: created.code.toLowerCase() });
    await ann.untilState((s) => s.players.length === 2);

    ann.send({ t: 'start' });
    const loading = await ben.untilState((s) => s.phase === 'loading');
    ann.send({ t: 'loaded', no: 1 });
    ben.send({ t: 'loaded', no: 1 });
    const playing = await ann.untilState((s) => s.phase === 'playing');
    expect(playing.round!.goAt).toBeGreaterThan(playing.now);
    expect(loading.round!.songId).toBe(playing.round!.songId);
  });

  it('rejects an unknown room code with a readable error', async () => {
    const { url } = await startServer();
    const ann = await connect(url);
    ann.send({ t: 'join', secret: secret('ann'), name: 'Ann', code: 'ZZZZ' });
    const err = await ann.until((m) => m.t === 'error');
    expect(err).toMatchObject({ t: 'error', code: 'no-room' });
  });

  it('answers garbage with an error instead of crashing', async () => {
    const { url } = await startServer();
    const ann = await connect(url);
    ann.ws.send('{"t":"create"');
    expect(await ann.until((m) => m.t === 'error')).toMatchObject({ code: 'bad-request' });
  });

  it('marks a player disconnected when their connection drops, and restores them on reconnect', async () => {
    const { url } = await startServer();
    const ann = await connect(url);
    ann.send({ t: 'create', secret: secret('ann'), name: 'Ann', settings: DEFAULT_PARTY_SETTINGS });
    const { code } = await ann.untilState(() => true);
    const ben = await connect(url);
    ben.send({ t: 'join', secret: secret('ben'), name: 'Ben', code });
    await ann.untilState((s) => s.players.length === 2);

    ben.ws.close();
    await ann.untilState((s) => s.players.some((p) => p.name === 'Ben' && !p.connected));

    const benAgain = await connect(url);
    benAgain.send({ t: 'join', secret: secret('ben'), name: 'Ben', code });
    const back = await ann.untilState((s) => s.players.some((p) => p.name === 'Ben' && p.connected));
    expect(back.players).toHaveLength(2); // the same player, not a new one
  });

  it('closes the older connection when the same player connects twice', async () => {
    const { url } = await startServer();
    const first = await connect(url);
    first.send({ t: 'create', secret: secret('ann'), name: 'Ann', settings: DEFAULT_PARTY_SETTINGS });
    const { code } = await first.untilState(() => true);
    const closed = new Promise<number>((resolve) => first.ws.once('close', (c) => resolve(c)));
    const second = await connect(url);
    second.send({ t: 'join', secret: secret('ann'), name: 'Ann', code });
    expect(await closed).toBe(4000);
    const state = await second.untilState(() => true);
    expect(state.players).toHaveLength(1);
    expect(state.players[0]!.connected).toBe(true);
  });

  it('ignores WebSocket requests to other paths', async () => {
    const { url } = await startServer();
    const other = new WebSocket(url.replace(PARTY_PATH, '/elsewhere'), { handshakeTimeout: 500 });
    cleanup.push(() => other.terminate());
    await expect(new Promise((resolve, reject) => (other.once('open', resolve), other.once('error', reject)))).rejects.toThrow();
  });
});
