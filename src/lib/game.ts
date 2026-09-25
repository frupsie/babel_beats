import type { LangCode } from '../data/languages';
import type { Difficulty, Era, Pool, Song } from '../types';

/** iTunes previews are 30 seconds long. */
export const FULL_PREVIEW_SECONDS = 30;

/** Clip length (seconds) for each of the six attempts. Every wrong guess or skip unlocks the next rung. */
export const DIFFICULTIES: ReadonlyArray<{ id: Difficulty; label: string; ladder: readonly number[] }> = [
  { id: 'easy', label: 'Easy', ladder: [3, 5, 8, 12, 18, 30] },
  { id: 'medium', label: 'Medium', ladder: [1.5, 3, 5, 8, 12, 20] },
  { id: 'hard', label: 'Hard', ladder: [1, 2, 3, 5, 8, 12] },
  { id: 'expert', label: 'Expert', ladder: [0.5, 1, 2, 3, 5, 8] },
  { id: 'impossible', label: 'Impossible', ladder: [0.1, 0.25, 0.5, 1, 2, 4] },
];

export const ERAS: ReadonlyArray<{ id: Era; label: string; title: string }> = [
  { id: 'any', label: 'Any era', title: 'Every year' },
  { id: 'classic', label: 'Classic', title: 'Up to 1999' },
  { id: '2000s', label: '2000s', title: '2000–2009' },
  { id: '2010s', label: '2010s', title: '2010–2019' },
  { id: '2020s', label: '2020s', title: '2020 and later' },
];

export function ladderFor(difficulty: Difficulty): readonly number[] {
  return (DIFFICULTIES.find((d) => d.id === difficulty) ?? DIFFICULTIES[1]!).ladder;
}

export function eraOf(year: number): Exclude<Era, 'any'> {
  if (year < 2000) return 'classic';
  if (year < 2010) return '2000s';
  if (year < 2020) return '2010s';
  return '2020s';
}

export function inEra(era: Era, year: number): boolean {
  return era === 'any' || eraOf(year) === era;
}

/** The part of Settings that decides which songs are eligible. */
export interface PoolFilter {
  readonly langs: readonly LangCode[];
  readonly era: Era;
}

/** Songs that match the chosen languages and era. */
export function poolFor(catalog: readonly Song[], settings: PoolFilter): Song[] {
  return catalog.filter((s) => settings.langs.includes(s.lang) && inEra(settings.era, s.year));
}

/**
 * Picks the next song. The language is chosen first (evenly among the selected languages that still
 * have unplayed songs), then a song within it, so a big English list never drowns out a small
 * Japanese one. Songs already in `played` are skipped until a language runs out, at which point
 * that language's entries are cleared from `played` (this function mutates the set for that reset).
 */
export function pickSong(
  catalog: readonly Song[],
  settings: PoolFilter,
  played: Set<string>,
  rand: () => number = Math.random,
): Song | null {
  const groups = new Map<LangCode, Song[]>();
  for (const song of poolFor(catalog, settings)) {
    const group = groups.get(song.lang);
    if (group) group.push(song);
    else groups.set(song.lang, [song]);
  }
  const all = [...groups.values()];
  if (all.length === 0) return null;

  const fresh = all.filter((g) => g.some((s) => !played.has(s.id)));
  const choices = fresh.length > 0 ? fresh : all;
  const group = choices[Math.floor(rand() * choices.length)]!;

  let candidates = group.filter((s) => !played.has(s.id));
  if (candidates.length === 0) {
    for (const s of group) played.delete(s.id);
    candidates = group;
  }
  return candidates[Math.floor(rand() * candidates.length)]!;
}

/**
 * Picks uniformly from a ready-made list, such as the Singapore chart. Unlike `pickSong` it does not balance
 * by language: a chart is one list, and its few Mandarin songs should turn up as often as their share of it.
 * Songs already in `played` are skipped; when all are played, they are cleared (this mutates the set) and it starts over.
 */
export function pickFromList(songs: readonly Song[], played: Set<string>, rand: () => number = Math.random): Song | null {
  if (songs.length === 0) return null;
  let candidates = songs.filter((s) => !played.has(s.id));
  if (candidates.length === 0) {
    for (const s of songs) played.delete(s.id);
    candidates = [...songs];
  }
  return candidates[Math.floor(rand() * candidates.length)]!;
}

// ------------------------------------------------------------------ a single round

export type GuessEntry =
  | { kind: 'skip' }
  | { kind: 'wrong'; song: Song | null; text: string }
  | { kind: 'right'; text: string };

export interface RoundState {
  song: Song;
  ladder: readonly number[];
  guesses: GuessEntry[];
  status: 'playing' | 'won' | 'lost';
  /** Whether the player asked for the language hint. */
  hint: boolean;
  /** Which list the song was drawn from; stats and the reveal card depend on it. */
  pool: Pool;
}

export function newRound(song: Song, ladder: readonly number[], pool: Pool = 'mix'): RoundState {
  return { song, ladder, guesses: [], status: 'playing', hint: false, pool };
}

/** Length of the clip the player may hear right now. */
export function currentClip(round: RoundState): number {
  return round.ladder[Math.min(round.guesses.length, round.ladder.length - 1)]!;
}

/** Extra seconds the next attempt would unlock, or null when this is the last attempt. */
export function skipGain(round: RoundState): number | null {
  const i = round.guesses.length;
  const next = round.ladder[i + 1];
  const now = round.ladder[i];
  if (round.status !== 'playing' || next === undefined || now === undefined) return null;
  return Math.round((next - now) * 100) / 100;
}

export function applyGuess(round: RoundState, entry: GuessEntry): RoundState {
  if (round.status !== 'playing') return round;
  const guesses = [...round.guesses, entry];
  const status = entry.kind === 'right' ? 'won' : guesses.length >= round.ladder.length ? 'lost' : 'playing';
  return { ...round, guesses, status };
}
