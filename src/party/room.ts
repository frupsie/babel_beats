// One party room: who is in it, the settings, and the round in progress. The server is in charge of everything that
// decides the game (which song, the clock, whether a guess is right, the score); players only play their clips.
// No networking here: server/party.ts feeds messages in and delivers what `send` produces, which keeps this testable.
// Node runs this file directly, so keep it to erasable TypeScript (no parameter properties) and use `.ts` imports.
import { ladderFor } from '../lib/game.ts';
import { isCorrectTitle } from '../lib/match.ts';
import { pickNext, type SongPools } from '../lib/pools.ts';
import type { Song } from '../types.ts';
import {
  COUNTDOWN_MS,
  LOAD_TIMEOUT_MS,
  MAX_PLAYERS,
  REVEAL_MS,
  pointsFor,
  type ClientMsg,
  type PartySettings,
  type Phase,
  type PlayerRoundStatus,
  type PublicPlayer,
  type RoomState,
  type ServerMsg,
  type TryKind,
} from './protocol.ts';

/** A host who drops out gets this long to come back before someone else becomes host. */
export const HOST_GRACE_MS = 20_000;
/** Songs to try before giving up on a round whose preview nobody could download. */
const MAX_SONG_TRIES = 3;

interface PlayerRec {
  id: string;
  secret: string;
  name: string;
  connected: boolean;
  score: number;
  status: PlayerRoundStatus;
  tries: TryKind[];
  points: number;
  ms: number | null;
}

interface RoundRec {
  no: number;
  song: Song;
  ladder: number[];
  /** Songs already tried for this round number (a preview nobody could load is replaced). */
  songTries: number;
  goAt: number | null;
  deadline: number | null;
  nextAt: number | null;
}

export interface RoomDeps {
  code: string;
  pools: SongPools;
  settings: PartySettings;
  /** Delivers a message to one player (by public id). */
  send: (playerId: string, msg: ServerMsg) => void;
  now?: () => number;
  rand?: () => number;
}

export type JoinResult = { ok: true; playerId: string } | { ok: false; code: 'full'; message: string };

export class Room {
  readonly code: string;
  private readonly pools: SongPools;
  private readonly sendTo: RoomDeps['send'];
  private readonly now: () => number;
  private readonly rand: () => number;

  private phase: Phase = 'lobby';
  private settings: PartySettings;
  /** In join order; the order decides who becomes host next. */
  private readonly players = new Map<string, PlayerRec>();
  private hostId: string | null = null;
  private round: RoundRec | null = null;
  private notice: string | null = null;
  /** Songs heard in this room, so a long session doesn't repeat itself. */
  private readonly played = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private hostTimer: ReturnType<typeof setTimeout> | null = null;
  private nextPlayerNo = 1;
  /** When the last player disconnected (null while anyone is connected), for cleaning up abandoned rooms. */
  emptySince: number | null = null;

  constructor(deps: RoomDeps) {
    this.code = deps.code;
    this.pools = deps.pools;
    this.settings = deps.settings;
    this.sendTo = deps.send;
    this.now = deps.now ?? Date.now;
    this.rand = deps.rand ?? Math.random;
  }

  // ---------------------------------------------------------------- people coming and going

  /** Adds a player, or reconnects one who was here before with the same secret. */
  join(secret: string, name: string): JoinResult {
    const known = this.bySecret(secret);
    if (known) {
      known.connected = true;
      known.name = name;
      // Back while the previews are still downloading: there is still time to get in on this round.
      if (this.phase === 'loading' && known.status === 'out') known.status = 'waiting';
      this.afterConnectChange();
      return { ok: true, playerId: known.id };
    }
    if (this.players.size >= MAX_PLAYERS) return { ok: false, code: 'full', message: `This room is full (${MAX_PLAYERS} players).` };
    const id = `p${this.nextPlayerNo++}`;
    // Someone arriving mid-round sits that round out, unless the previews are still downloading.
    const status: PlayerRoundStatus = this.phase === 'loading' ? 'waiting' : 'out';
    this.players.set(id, { id, secret, name, connected: true, score: 0, status, tries: [], points: 0, ms: null });
    this.hostId ??= id;
    this.afterConnectChange();
    return { ok: true, playerId: id };
  }

  /** The player's connection dropped; they stay in the room and can come back. */
  disconnect(playerId: string): void {
    const p = this.players.get(playerId);
    if (!p || !p.connected) return;
    p.connected = false;
    this.afterConnectChange();
  }

  /** The player left on purpose. */
  leave(playerId: string): void {
    if (!this.players.delete(playerId)) return;
    if (this.hostId === playerId) this.hostId = this.firstConnected()?.id ?? this.players.keys().next().value ?? null;
    this.afterConnectChange();
  }

  get connectedCount(): number {
    return [...this.players.values()].filter((p) => p.connected).length;
  }

  private bySecret(secret: string): PlayerRec | undefined {
    return [...this.players.values()].find((p) => p.secret === secret);
  }

  private firstConnected(): PlayerRec | undefined {
    return [...this.players.values()].find((p) => p.connected);
  }

  private afterConnectChange(): void {
    this.emptySince = this.connectedCount === 0 ? (this.emptySince ?? this.now()) : null;
    this.checkHost();
    // Someone who dropped out shouldn't hold everyone up.
    if (this.phase === 'loading') this.maybeStartListening();
    if (this.phase === 'playing') this.maybeEndRound();
    this.broadcast();
  }

  /** A host who disconnects keeps the role for HOST_GRACE_MS, then it passes to the next connected player. */
  private checkHost(): void {
    const host = this.hostId ? this.players.get(this.hostId) : undefined;
    if (host?.connected || !host) {
      if (this.hostTimer) clearTimeout(this.hostTimer);
      this.hostTimer = null;
      if (!host) this.hostId = this.firstConnected()?.id ?? null;
      return;
    }
    this.hostTimer ??= setTimeout(() => {
      this.hostTimer = null;
      const stillGone = this.hostId && !this.players.get(this.hostId)?.connected;
      const next = this.firstConnected();
      if (stillGone && next) {
        this.hostId = next.id;
        this.broadcast();
      }
    }, HOST_GRACE_MS);
  }

  // ---------------------------------------------------------------- messages

  handle(playerId: string, msg: ClientMsg): void {
    const p = this.players.get(playerId);
    if (!p) return;
    const isHost = playerId === this.hostId;
    switch (msg.t) {
      case 'settings':
        if (isHost && (this.phase === 'lobby' || this.phase === 'final')) {
          this.settings = msg.settings;
          this.notice = null;
          this.broadcast();
        }
        return;
      case 'start':
        if (isHost && (this.phase === 'lobby' || this.phase === 'final')) this.startGame();
        return;
      case 'loaded':
      case 'loadFailed':
        if (this.phase === 'loading' && this.round?.no === msg.no && p.status === 'waiting') {
          p.status = msg.t === 'loaded' ? 'playing' : 'out';
          this.maybeStartListening();
          this.broadcast();
        }
        return;
      case 'guess':
      case 'skip':
        this.attempt(p, msg);
        return;
      case 'giveUp':
        this.giveUp(p, msg.no);
        return;
      case 'next':
        if (isHost && this.phase === 'reveal') this.advance();
        return;
      case 'lobby':
        if (isHost && this.phase === 'final') {
          this.phase = 'lobby';
          this.round = null;
          this.broadcast();
        }
        return;
      case 'leave':
        this.leave(playerId);
        return;
      case 'create':
      case 'join':
        return; // handled by the server before a player is in a room
    }
  }

  // ---------------------------------------------------------------- the game

  private startGame(): void {
    for (const p of this.players.values()) p.score = 0;
    this.notice = null;
    this.startRound(1, 0);
  }

  /** Picks a song and asks everyone to download its preview. */
  private startRound(no: number, songTries: number): void {
    this.clearTimer();
    const song = pickNext(this.pools, this.settings, this.played, this.rand);
    if (!song) {
      this.phase = 'lobby';
      this.round = null;
      this.notice = 'No songs match these settings. Try another era, list or more languages.';
      this.broadcast();
      return;
    }
    this.played.add(song.id);
    this.round = { no, song, ladder: [...ladderFor(this.settings.difficulty)], songTries, goAt: null, deadline: null, nextAt: null };
    this.phase = 'loading';
    for (const p of this.players.values()) {
      p.status = p.connected ? 'waiting' : 'out';
      p.tries = [];
      p.points = 0;
      p.ms = null;
    }
    this.schedule(LOAD_TIMEOUT_MS, () => this.startListening());
    this.broadcast();
  }

  /** Starts as soon as every connected player has the preview (or has failed to get it). */
  private maybeStartListening(): void {
    const waiting = [...this.players.values()].some((p) => p.connected && p.status === 'waiting');
    if (!waiting) this.startListening();
  }

  private startListening(): void {
    const round = this.round;
    if (this.phase !== 'loading' || !round) return;
    for (const p of this.players.values()) if (p.status === 'waiting') p.status = 'out';
    const anyone = [...this.players.values()].some((p) => p.status === 'playing');
    if (!anyone) {
      // Nobody could download this preview: try another song, a couple of times.
      if (round.songTries + 1 < MAX_SONG_TRIES && this.connectedCount > 0) {
        this.startRound(round.no, round.songTries + 1);
        return;
      }
      this.clearTimer();
      this.phase = 'lobby';
      this.round = null;
      this.notice = this.connectedCount > 0 ? 'Nobody could download the song previews. Check your connection and start again.' : null;
      this.broadcast();
      return;
    }
    round.goAt = this.now() + COUNTDOWN_MS;
    round.deadline = round.goAt + this.settings.seconds * 1000;
    this.phase = 'playing';
    this.schedule(round.deadline - this.now(), () => this.endRound());
    this.broadcast();
  }

  private attempt(p: PlayerRec, msg: Extract<ClientMsg, { t: 'guess' } | { t: 'skip' }>): void {
    const round = this.round;
    const now = this.now();
    if (this.phase !== 'playing' || !round || round.no !== msg.no || p.status !== 'playing') return;
    if (round.goAt === null || round.deadline === null || now < round.goAt || now > round.deadline) return;

    let kind: TryKind;
    if (msg.t === 'skip') kind = 'skip';
    else if (msg.songId === round.song.id || (msg.text.trim() !== '' && isCorrectTitle(msg.text, round.song))) kind = 'right';
    else if (msg.songId !== null) kind = 'wrong';
    else return; // free text that isn't the answer: the player has to pick a song from the list, as in solo play

    p.tries.push(kind);
    if (kind === 'right') {
      p.status = 'won';
      p.ms = now - round.goAt;
      p.points = pointsFor(p.tries.length, p.ms, round.deadline - round.goAt);
      p.score += p.points;
    } else if (p.tries.length >= round.ladder.length) {
      p.status = 'lost';
    }
    this.maybeEndRound();
    this.broadcast();
  }

  /** The player stops guessing this round: no points, and the tries used so far stay as they were. */
  private giveUp(p: PlayerRec, no: number): void {
    const round = this.round;
    if (this.phase !== 'playing' || !round || round.no !== no || p.status !== 'playing') return;
    if (round.goAt === null || this.now() < round.goAt) return;
    p.status = 'lost';
    this.maybeEndRound();
    this.broadcast();
  }

  /** The round ends early once every connected player still in it has finished. */
  private maybeEndRound(): void {
    if (this.phase !== 'playing') return;
    const stillPlaying = [...this.players.values()].some((p) => p.connected && p.status === 'playing');
    if (!stillPlaying) this.endRound();
  }

  private endRound(): void {
    const round = this.round;
    if (this.phase !== 'playing' || !round) return;
    for (const p of this.players.values()) if (p.status === 'playing') p.status = 'lost';
    this.phase = 'reveal';
    round.nextAt = this.now() + REVEAL_MS;
    this.schedule(REVEAL_MS, () => this.advance());
    this.broadcast();
  }

  private advance(): void {
    const round = this.round;
    if (this.phase !== 'reveal' || !round) return;
    if (round.no < this.settings.rounds) {
      this.startRound(round.no + 1, 0);
      return;
    }
    this.clearTimer();
    this.phase = 'final';
    round.nextAt = null;
    this.broadcast();
  }

  // ---------------------------------------------------------------- plumbing

  private schedule(ms: number, fn: () => void): void {
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      fn();
    }, Math.max(0, ms));
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Stops the room's timers, when the server drops it. */
  dispose(): void {
    this.clearTimer();
    if (this.hostTimer) clearTimeout(this.hostTimer);
    this.hostTimer = null;
  }

  publicState(): RoomState {
    const round = this.round;
    const players: PublicPlayer[] = [...this.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      host: p.id === this.hostId,
      connected: p.connected,
      score: p.score,
      round: { status: p.status, tries: [...p.tries], points: p.points, ms: p.ms },
    }));
    return {
      code: this.code,
      phase: this.phase,
      settings: this.settings,
      players,
      round: round && {
        no: round.no,
        total: this.settings.rounds,
        songId: round.song.id,
        ladder: round.ladder,
        goAt: round.goAt,
        deadline: round.deadline,
        nextAt: round.nextAt,
      },
      notice: this.notice,
      now: this.now(),
    };
  }

  broadcast(): void {
    const state = this.publicState();
    for (const p of this.players.values()) if (p.connected) this.sendTo(p.id, { t: 'state', you: p.id, state });
  }
}
