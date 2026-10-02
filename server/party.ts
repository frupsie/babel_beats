// Party rooms over WebSockets, at /party on whatever HTTP server it is attached to: Vite's dev and preview servers
// (see vite.config.ts) or the production server (server/index.ts). Rooms live in memory, so restarting the server
// ends any games in progress. Node runs this file directly: erasable TypeScript only, `.ts` imports.
import { readFileSync } from 'node:fs';
import type { IncomingMessage, Server } from 'node:http';
import path from 'node:path';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import type { PlaylistsFile } from '../src/lib/lists.ts';
import { buildPools, type SongPools } from '../src/lib/pools.ts';
import type { SgSnapshot } from '../src/lib/sgNow.ts';
import { parseClientMsg, randomRoomCode, type ClientMsg, type ErrorCode, type ServerMsg } from '../src/party/protocol.ts';
import { Room } from '../src/party/room.ts';
import type { Song } from '../src/types.ts';

export const PARTY_PATH = '/party';
const MAX_ROOMS = 300;
/** A room nobody has been connected to for this long is deleted. */
const ABANDONED_MS = 10 * 60_000;
/** Pings keep connections alive through proxies and find players whose connection silently died. */
const HEARTBEAT_MS = 25_000;
/** More messages than this in RATE_WINDOW_MS and the extra ones are ignored. */
const RATE_LIMIT = 40;
const RATE_WINDOW_MS = 10_000;

/** Reads the song lists from src/data, the same files the browser bundle is built from. */
export function loadSongPools(rootDir: string): SongPools {
  const read = <T>(name: string): T => JSON.parse(readFileSync(path.join(rootDir, 'src', 'data', name), 'utf8')) as T;
  let sg: SgSnapshot | null = null;
  try {
    sg = read<SgSnapshot>('sg-now.json');
  } catch {
    // No chart downloaded yet: the "Singapore now" list is simply empty.
  }
  return buildPools(read<Song[]>('catalog.json'), read<PlaylistsFile>('playlists.json'), sg);
}

interface Conn {
  ws: WebSocket;
  room: Room | null;
  playerId: string | null;
  alive: boolean;
  windowStart: number;
  count: number;
}

export interface PartyServer {
  roomCount(): number;
  close(): void;
}

export function attachParty(server: Server, pools: SongPools, log: Pick<Console, 'info' | 'warn'> = console): PartyServer {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4096, perMessageDeflate: false });
  const rooms = new Map<string, Room>();
  /** `${roomCode}/${playerId}` → that player's connection. */
  const sockets = new Map<string, Conn>();
  const key = (room: Room, playerId: string) => `${room.code}/${playerId}`;

  const send = (conn: Conn, msg: ServerMsg) => {
    if (conn.ws.readyState === conn.ws.OPEN) conn.ws.send(JSON.stringify(msg));
  };
  const fail = (conn: Conn, code: ErrorCode, message: string) => send(conn, { t: 'error', code, message });

  function newRoom(settings: Extract<ClientMsg, { t: 'create' }>['settings']): Room | null {
    if (rooms.size >= MAX_ROOMS) return null;
    let code = randomRoomCode();
    for (let i = 0; rooms.has(code) && i < 50; i++) code = randomRoomCode();
    if (rooms.has(code)) return null;
    const room: Room = new Room({
      code,
      pools,
      settings,
      send: (playerId, msg) => {
        const conn = sockets.get(key(room, playerId));
        if (conn) send(conn, msg);
      },
    });
    rooms.set(code, room);
    return room;
  }

  function enter(conn: Conn, room: Room, secret: string, name: string) {
    const result = room.join(secret, name);
    if (!result.ok) return fail(conn, result.code, result.message);
    const k = key(room, result.playerId);
    const previous = sockets.get(k);
    conn.room = room;
    conn.playerId = result.playerId;
    sockets.set(k, conn);
    // The same player opened the game again (a reconnect, or a second tab): the newest connection wins.
    if (previous && previous !== conn) {
      previous.room = null;
      previous.playerId = null;
      previous.ws.close(4000, 'Opened somewhere else');
    }
    room.broadcast(); // includes the newcomer, now that their connection is registered
  }

  function onMessage(conn: Conn, raw: string) {
    const now = Date.now();
    if (now - conn.windowStart > RATE_WINDOW_MS) {
      conn.windowStart = now;
      conn.count = 0;
    }
    if (++conn.count > RATE_LIMIT) return;

    const msg = parseClientMsg(raw);
    if (!msg) return fail(conn, 'bad-request', 'That message could not be read.');

    if (msg.t === 'create' || msg.t === 'join') {
      if (conn.room) return; // already in a room on this connection
      if (msg.t === 'create') {
        const room = newRoom(msg.settings);
        if (!room) return fail(conn, 'busy', 'The server has too many rooms open right now. Try again in a few minutes.');
        log.info(`[party] room ${room.code} created (${rooms.size} open)`);
        return enter(conn, room, msg.secret, msg.name);
      }
      const room = rooms.get(msg.code);
      if (!room) return fail(conn, 'no-room', `There is no room ${msg.code}. Check the code with your host.`);
      return enter(conn, room, msg.secret, msg.name);
    }

    if (!conn.room || !conn.playerId) return;
    if (msg.t === 'leave') {
      sockets.delete(key(conn.room, conn.playerId));
      conn.room.leave(conn.playerId);
      conn.room = null;
      conn.playerId = null;
      return;
    }
    conn.room.handle(conn.playerId, msg);
  }

  function onClose(conn: Conn) {
    const { room, playerId } = conn;
    if (!room || !playerId) return;
    const k = key(room, playerId);
    if (sockets.get(k) === conn) {
      sockets.delete(k);
      room.disconnect(playerId);
    }
  }

  const conns = new Set<Conn>();
  wss.on('connection', (ws: WebSocket) => {
    const conn: Conn = { ws, room: null, playerId: null, alive: true, windowStart: Date.now(), count: 0 };
    conns.add(conn);
    ws.on('pong', () => (conn.alive = true));
    ws.on('message', (data, isBinary) => {
      if (!isBinary) onMessage(conn, data.toString());
    });
    ws.on('close', () => {
      conns.delete(conn);
      onClose(conn);
    });
    ws.on('error', () => ws.terminate());
  });

  const onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (new URL(req.url ?? '/', 'http://localhost').pathname !== PARTY_PATH) return;
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  };
  server.on('upgrade', onUpgrade);

  const heartbeat = setInterval(() => {
    for (const conn of conns) {
      if (!conn.alive) {
        conn.ws.terminate();
        continue;
      }
      conn.alive = false;
      conn.ws.ping();
    }
  }, HEARTBEAT_MS);

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [code, room] of rooms) {
      if (room.emptySince !== null && now - room.emptySince > ABANDONED_MS) {
        room.dispose();
        rooms.delete(code);
        log.info(`[party] room ${code} closed (abandoned; ${rooms.size} open)`);
      }
    }
  }, 60_000);
  heartbeat.unref?.();
  sweep.unref?.();

  return {
    roomCount: () => rooms.size,
    close() {
      clearInterval(heartbeat);
      clearInterval(sweep);
      server.off('upgrade', onUpgrade);
      for (const room of rooms.values()) room.dispose();
      rooms.clear();
      for (const conn of conns) conn.ws.terminate();
      wss.close();
    },
  };
}
