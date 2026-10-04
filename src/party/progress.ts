// How far each player has got in the current round, for the live status under their name. Pure functions so the
// rules are easy to test; the scoreboard (PartyView.tsx) draws what they return.
import type { PublicPlayer } from './protocol.ts';

type PlayerRound = PublicPlayer['round'];

/**
 * One state per attempt: what the player did with it (`skip`, `wrong`, `right`), `current` for the one they are on,
 * `gone` for attempts they will not use (they gave up, ran out of time, or sit the round out), `future` otherwise.
 */
export type PipState = 'skip' | 'wrong' | 'right' | 'current' | 'future' | 'gone';

export function pipStates(round: PlayerRound, attempts: number): PipState[] {
  return Array.from({ length: attempts }, (_, i): PipState => {
    const done = round.tries[i];
    if (done) return done;
    if (round.status === 'playing' && i === round.tries.length) return 'current';
    return round.status === 'lost' || round.status === 'out' ? 'gone' : 'future';
  });
}

/** The words next to the attempts: where the player is, or how their round ended. */
export function progressLabel(round: PlayerRound, attempts: number): string {
  const used = round.tries.length;
  switch (round.status) {
    case 'waiting':
      return 'Loading';
    case 'out':
      return 'Sitting out';
    case 'playing':
      return `Try ${used + 1} of ${attempts}`;
    case 'won':
      return `Got it · try ${used}`;
    case 'lost':
      return round.gaveUp ? 'Gave up' : used >= attempts ? 'Out of tries' : 'Out of time';
  }
}
