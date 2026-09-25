import type { GuessEntry, RoundState } from '../lib/game';
import { cx, fmtSeconds } from '../lib/format';

type CellState = 'skip' | 'wrong' | 'right' | 'current' | 'future';

const MARK: Record<CellState, string> = { skip: '»', wrong: '✕', right: '✓', current: '', future: '' };
const WORD: Record<CellState, string> = {
  skip: 'skipped',
  wrong: 'wrong guess',
  right: 'correct',
  current: 'current attempt',
  future: 'locked',
};

function stateAt(i: number, guesses: GuessEntry[], status: RoundState['status']): CellState {
  const g = guesses[i];
  if (g) return g.kind;
  return i === guesses.length && status === 'playing' ? 'current' : 'future';
}

/** Six tickets, one per attempt, each labelled with how much of the song that attempt unlocks. */
export function Ladder({ round }: { round: RoundState }) {
  return (
    <ol className="ladder" aria-label="Attempts">
      {round.ladder.map((seconds, i) => {
        const state = stateAt(i, round.guesses, round.status);
        return (
          <li key={i} className={cx('ladder__cell', `is-${state}`)} aria-current={state === 'current' ? 'step' : undefined}>
            <span className="ladder__time">{fmtSeconds(seconds)}</span>
            {MARK[state] && (
              <span className="ladder__mark" aria-hidden="true">
                {MARK[state]}
              </span>
            )}
            <span className="sr-only">{`Attempt ${i + 1}, ${WORD[state]}`}</span>
          </li>
        );
      })}
    </ol>
  );
}
