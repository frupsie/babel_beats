// The browser's side of a party room: one WebSocket to server/party.ts, reconnecting by itself if it drops.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClientMsg, ErrorCode, PartySettings, RoomState, ServerMsg } from './protocol';

const SECRET_KEY = 'babel-beats:party-secret';
const NAME_KEY = 'babel-beats:party-name';
const MAX_BACKOFF_MS = 15_000;

/** Where rooms live: the same server as the page, unless VITE_PARTY_URL points elsewhere (e.g. a static site + a separate server). */
function partyUrl(): string {
  const configured = import.meta.env.VITE_PARTY_URL as string | undefined;
  if (configured) return configured;
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/party`;
}

/** Identifies this tab to the server so a dropped connection can rejoin as the same player. Never shown to anyone. */
function playerSecret(): string {
  try {
    const saved = sessionStorage.getItem(SECRET_KEY);
    if (saved) return saved;
  } catch {
    // storage blocked: a fresh secret per page load still works, just without rejoining after a reload
  }
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  const secret = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  try {
    sessionStorage.setItem(SECRET_KEY, secret);
  } catch {
    // see above
  }
  return secret;
}

/**
 * The name this tab played under, if it has been in a room (it survives a reload, like the secret), so a reload can
 * rejoin without asking. Kept per tab: another tab of the same browser may be a different player.
 */
export function sessionName(): string | null {
  try {
    return sessionStorage.getItem(SECRET_KEY) !== null ? sessionStorage.getItem(NAME_KEY) : null;
  } catch {
    return null;
  }
}

/** The name last used on this browser, to fill in the form. */
export function savedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

function saveName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
    sessionStorage.setItem(NAME_KEY, name);
  } catch {
    // not important
  }
}

/** Puts the room code in the address bar (so a reload or a copied link lands in the same room), or takes it out. */
function setRoomInUrl(code: string | null): void {
  const url = new URL(location.href);
  if (code) url.searchParams.set('room', code);
  else url.searchParams.delete('room');
  history.replaceState(history.state, '', url);
}

export function roomFromUrl(): string | null {
  return new URL(location.href).searchParams.get('room');
}

export function roomLink(code: string): string {
  const url = new URL(location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('room', code);
  return url.toString();
}

export type Connection = 'idle' | 'connecting' | 'open' | 'reconnecting';

export interface Party {
  connection: Connection;
  state: RoomState | null;
  /** This player's id in `state.players`. */
  you: string | null;
  error: { code: ErrorCode | 'offline'; message: string } | null;
  /** The server's clock now (ms); countdowns use this so every player sees the same numbers. */
  serverNow: () => number;
  create: (name: string, settings: PartySettings) => void;
  join: (name: string, code: string) => void;
  send: (msg: ClientMsg) => void;
  leave: () => void;
}

export function useParty(): Party {
  const [connection, setConnection] = useState<Connection>('idle');
  const [state, setState] = useState<RoomState | null>(null);
  const [you, setYou] = useState<string | null>(null);
  const [error, setError] = useState<Party['error']>(null);

  const wsRef = useRef<WebSocket | null>(null);
  /** The message that (re)enters the room: create the first time, then join with the room's code. */
  const entryRef = useRef<ClientMsg | null>(null);
  const retryRef = useRef<{ timer: ReturnType<typeof setTimeout> | null; delay: number }>({ timer: null, delay: 1000 });
  const offsetRef = useRef<number | null>(null);
  const leavingRef = useRef(false);

  const open = useCallback(() => {
    const entry = entryRef.current;
    if (!entry) return;
    const ws = new WebSocket(partyUrl());
    wsRef.current = ws;

    ws.onopen = () => {
      retryRef.current.delay = 1000;
      ws.send(JSON.stringify(entryRef.current));
    };

    ws.onmessage = (event) => {
      let msg: ServerMsg;
      try {
        msg = JSON.parse(String(event.data)) as ServerMsg;
      } catch {
        return;
      }
      if (msg.t === 'error') {
        setError({ code: msg.code, message: msg.message });
        // Couldn't get into the room at all: stop here rather than retrying forever.
        if (msg.code !== 'bad-request') {
          entryRef.current = null;
          ws.close();
          setConnection('idle');
          setState(null);
          setRoomInUrl(null);
        }
        return;
      }
      // Line our clock up with the server's, smoothing out network jitter.
      const sample = msg.state.now - Date.now();
      offsetRef.current = offsetRef.current === null ? sample : offsetRef.current * 0.7 + sample * 0.3;
      setConnection('open');
      setError(null);
      setYou(msg.you);
      setState(msg.state);
      // From now on, getting back in means joining this room with the same secret.
      if (entryRef.current?.t === 'create') entryRef.current = { t: 'join', secret: entryRef.current.secret, name: entryRef.current.name, code: msg.state.code };
      setRoomInUrl(msg.state.code);
    };

    ws.onclose = (event) => {
      if (wsRef.current !== ws) return;
      wsRef.current = null;
      if (leavingRef.current || !entryRef.current) return;
      if (event.code === 4000) {
        // This player opened the room somewhere else (another tab); that one carries on.
        entryRef.current = null;
        setConnection('idle');
        setState(null);
        setError({ code: 'offline', message: 'You joined this room from another tab or device, so this one stopped.' });
        return;
      }
      setConnection('reconnecting');
      const retry = retryRef.current;
      retry.timer = setTimeout(open, retry.delay);
      retry.delay = Math.min(retry.delay * 2, MAX_BACKOFF_MS);
    };
  }, []);

  const begin = useCallback(
    (entry: ClientMsg) => {
      leavingRef.current = false;
      entryRef.current = entry;
      setError(null);
      setConnection('connecting');
      wsRef.current?.close();
      open();
    },
    [open],
  );

  const create = useCallback(
    (name: string, settings: PartySettings) => {
      saveName(name);
      begin({ t: 'create', secret: playerSecret(), name, settings });
    },
    [begin],
  );

  const join = useCallback(
    (name: string, code: string) => {
      saveName(name);
      begin({ t: 'join', secret: playerSecret(), name, code });
    },
    [begin],
  );

  const send = useCallback((msg: ClientMsg) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);

  const leave = useCallback(() => {
    leavingRef.current = true;
    entryRef.current = null;
    if (retryRef.current.timer) clearTimeout(retryRef.current.timer);
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'leave' } satisfies ClientMsg));
    ws?.close();
    wsRef.current = null;
    setConnection('idle');
    setState(null);
    setYou(null);
    setRoomInUrl(null);
  }, []);

  // Closing the party view (or the page) drops the connection; the server keeps the seat for a while.
  useEffect(
    () => () => {
      leavingRef.current = true;
      if (retryRef.current.timer) clearTimeout(retryRef.current.timer);
      wsRef.current?.close();
    },
    [],
  );

  const serverNow = useCallback(() => Date.now() + (offsetRef.current ?? 0), []);

  return { connection, state, you, error, serverNow, create, join, send, leave };
}
