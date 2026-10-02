// The messages between a party room's players and the server (server/party.ts), plus the rules both sides share.
// Node runs this file directly, so keep it to erasable TypeScript and give relative imports their `.ts` extension.
import { LANG_CODES, isLangCode } from '../data/languages.ts';
import { DIFFICULTIES, ERAS } from '../lib/game.ts';
import type { Difficulty, Era, LangCode, Pool } from '../types.ts';

export const MAX_PLAYERS = 12;
export const NAME_MAX = 20;
export const ROUND_CHOICES = [5, 10, 15] as const;
export const SECONDS_CHOICES = [30, 60, 90] as const;
/** How long players get to download the round's preview before the round starts without the slow ones. */
export const LOAD_TIMEOUT_MS = 8_000;
/** The 3-2-1 before a round, so everyone starts listening together. */
export const COUNTDOWN_MS = 3_000;
/** How long the answer stays up before the next round starts by itself (the host can skip ahead). */
export const REVEAL_MS = 12_000;
/** Points for a right answer on try 1..6, before the speed bonus. */
export const POINTS_BY_TRY = [1000, 850, 700, 550, 400, 250] as const;

export interface PartySettings {
  pool: Pool;
  langs: LangCode[];
  era: Era;
  difficulty: Difficulty;
  rounds: number;
  /** Time limit per round. */
  seconds: number;
}

export const DEFAULT_PARTY_SETTINGS: PartySettings = {
  pool: 'mix',
  langs: [...LANG_CODES],
  era: 'any',
  difficulty: 'medium',
  rounds: 10,
  seconds: 60,
};

export type Phase = 'lobby' | 'loading' | 'playing' | 'reveal' | 'final';

/**
 * A player's part in the current round. `out`: joined too late for it, or couldn't download its preview.
 * `waiting`: still downloading the preview.
 */
export type PlayerRoundStatus = 'out' | 'waiting' | 'playing' | 'won' | 'lost';
export type TryKind = 'skip' | 'wrong' | 'right';

export interface PublicPlayer {
  id: string;
  name: string;
  host: boolean;
  connected: boolean;
  score: number;
  round: {
    status: PlayerRoundStatus;
    tries: TryKind[];
    points: number;
    /** Milliseconds from the start of the round to the right answer. */
    ms: number | null;
  };
}

export interface PublicRound {
  no: number;
  total: number;
  /** The answer. Players need it to download the preview; nobody is shown it before the round ends. */
  songId: string;
  ladder: number[];
  /** Server time when listening starts (after the countdown); null while previews download. */
  goAt: number | null;
  /** Server time when the round ends at the latest. */
  deadline: number | null;
  /** Server time when the next round starts by itself, during the reveal. */
  nextAt: number | null;
}

export interface RoomState {
  code: string;
  phase: Phase;
  settings: PartySettings;
  players: PublicPlayer[];
  round: PublicRound | null;
  /** A problem everyone should see, e.g. no songs match the settings. */
  notice: string | null;
  /** The server's clock when this was sent, so players can line their countdowns up with it. */
  now: number;
}

export type ClientMsg =
  | { t: 'create'; secret: string; name: string; settings: PartySettings }
  | { t: 'join'; secret: string; name: string; code: string }
  | { t: 'settings'; settings: PartySettings }
  | { t: 'start' }
  | { t: 'loaded'; no: number }
  | { t: 'loadFailed'; no: number }
  | { t: 'guess'; no: number; songId: string | null; text: string }
  | { t: 'skip'; no: number }
  | { t: 'next' }
  | { t: 'lobby' }
  | { t: 'leave' };

export type ErrorCode = 'no-room' | 'full' | 'bad-request' | 'busy';

export type ServerMsg =
  | { t: 'state'; you: string; state: RoomState }
  | { t: 'error'; code: ErrorCode; message: string };

// ------------------------------------------------------------------ validation (the server trusts nothing it receives)

// Letters and digits that can't be mistaken for one another when read out or typed: no I, L, O, 0 or 1.
const CODE_LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ';
const CODE_DIGITS = '23456789';
const CODE_ALPHABET = CODE_LETTERS + CODE_DIGITS;
export const CODE_LENGTH = 4;

/** A room code such as "K7P3": always at least one letter and one digit. */
export function randomRoomCode(rand: () => number = Math.random): string {
  for (;;) {
    let code = '';
    for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[Math.floor(rand() * CODE_ALPHABET.length)];
    if (/[A-Z]/.test(code) && /[0-9]/.test(code)) return code;
  }
}

export function normaliseCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH);
}

export function isRoomCode(value: unknown): value is string {
  return typeof value === 'string' && value.length === CODE_LENGTH && [...value].every((c) => CODE_ALPHABET.includes(c));
}

/** A display name: trimmed, no control characters, at most NAME_MAX characters. Empty means invalid. */
export function cleanName(value: unknown): string {
  if (typeof value !== 'string') return '';
  // Control characters, zero-width characters and text-direction overrides, which could garble or disguise a name.
  return [...value.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, '').replace(/\s+/g, ' ').trim()]
    .slice(0, NAME_MAX)
    .join('');
}

const POOLS: readonly Pool[] = ['mix', 'mine', 'sg-now'];

/** Valid settings, or null. */
export function cleanSettings(value: unknown): PartySettings | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  const langs = Array.isArray(v.langs) ? [...new Set(v.langs.filter(isLangCode))] : [];
  const ok =
    POOLS.includes(v.pool as Pool) &&
    langs.length > 0 &&
    ERAS.some((e) => e.id === v.era) &&
    DIFFICULTIES.some((d) => d.id === v.difficulty) &&
    (ROUND_CHOICES as readonly unknown[]).includes(v.rounds) &&
    (SECONDS_CHOICES as readonly unknown[]).includes(v.seconds);
  if (!ok) return null;
  return {
    pool: v.pool as Pool,
    langs,
    era: v.era as Era,
    difficulty: v.difficulty as Difficulty,
    rounds: v.rounds as number,
    seconds: v.seconds as number,
  };
}

const isSecret = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(v);
const isRoundNo = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 100;

/** Parses one message from a player, or returns null if it is not a well-formed message. */
export function parseClientMsg(raw: string): ClientMsg | null {
  let v: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    v = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  switch (v.t) {
    case 'create': {
      const settings = cleanSettings(v.settings);
      const name = cleanName(v.name);
      return isSecret(v.secret) && name && settings ? { t: 'create', secret: v.secret, name, settings } : null;
    }
    case 'join': {
      const name = cleanName(v.name);
      const code = typeof v.code === 'string' ? normaliseCode(v.code) : '';
      return isSecret(v.secret) && name && isRoomCode(code) ? { t: 'join', secret: v.secret, name, code } : null;
    }
    case 'settings': {
      const settings = cleanSettings(v.settings);
      return settings ? { t: 'settings', settings } : null;
    }
    case 'loaded':
    case 'loadFailed':
    case 'skip':
      return isRoundNo(v.no) ? { t: v.t, no: v.no } : null;
    case 'guess': {
      const songId = v.songId === null ? null : typeof v.songId === 'string' && /^\d{1,20}$/.test(v.songId) ? v.songId : undefined;
      const text = typeof v.text === 'string' ? v.text.slice(0, 200) : undefined;
      return isRoundNo(v.no) && songId !== undefined && text !== undefined ? { t: 'guess', no: v.no, songId, text } : null;
    }
    case 'start':
    case 'next':
    case 'lobby':
    case 'leave':
      return { t: v.t };
    default:
      return null;
  }
}

/** Points for a right answer on try `tries` (1-6), `elapsedMs` into a round of `limitMs`: up to half lost to time. */
export function pointsFor(tries: number, elapsedMs: number, limitMs: number): number {
  const base = POINTS_BY_TRY[Math.min(Math.max(tries, 1), POINTS_BY_TRY.length) - 1]!;
  const late = Math.min(1, Math.max(0, elapsedMs / limitMs));
  return Math.round(base * (1 - 0.5 * late));
}
