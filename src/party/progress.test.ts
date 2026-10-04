import { describe, expect, it } from 'vitest';
import { pipStates, progressLabel } from './progress';
import type { PublicPlayer } from './protocol';

const round = (over: Partial<PublicPlayer['round']>): PublicPlayer['round'] => ({
  status: 'playing',
  tries: [],
  gaveUp: false,
  points: 0,
  ms: null,
  ...over,
});

describe('pipStates', () => {
  it('shows what each used attempt was and marks the one the player is on', () => {
    expect(pipStates(round({ tries: ['skip', 'wrong'] }), 6)).toEqual(['skip', 'wrong', 'current', 'future', 'future', 'future']);
  });

  it('starts with the first attempt as the current one', () => {
    expect(pipStates(round({}), 3)).toEqual(['current', 'future', 'future']);
  });

  it('shows a player still loading, and one who sits the round out, with nothing under way', () => {
    expect(pipStates(round({ status: 'waiting' }), 3)).toEqual(['future', 'future', 'future']);
    expect(pipStates(round({ status: 'out' }), 3)).toEqual(['gone', 'gone', 'gone']);
  });

  it('keeps the attempts used after a right answer, and fades the rest', () => {
    expect(pipStates(round({ status: 'won', tries: ['skip', 'right'] }), 4)).toEqual(['skip', 'right', 'future', 'future']);
  });

  it('crosses out the attempts a player gave up on, or ran out of time before using', () => {
    expect(pipStates(round({ status: 'lost', gaveUp: true, tries: ['wrong', 'skip'] }), 5)).toEqual(['wrong', 'skip', 'gone', 'gone', 'gone']);
  });

  it('has no spare attempts for a player who used all of them', () => {
    const tries = ['wrong', 'wrong', 'wrong'] as const;
    expect(pipStates(round({ status: 'lost', tries: [...tries] }), 3)).toEqual(['wrong', 'wrong', 'wrong']);
  });
});

describe('progressLabel', () => {
  it('says where a player is while the round runs', () => {
    expect(progressLabel(round({}), 6)).toBe('Try 1 of 6');
    expect(progressLabel(round({ tries: ['skip', 'skip', 'wrong'] }), 6)).toBe('Try 4 of 6');
    expect(progressLabel(round({ status: 'waiting' }), 6)).toBe('Loading');
    expect(progressLabel(round({ status: 'out' }), 6)).toBe('Sitting out');
  });

  it('says how a finished round ended', () => {
    expect(progressLabel(round({ status: 'won', tries: ['skip', 'right'] }), 6)).toContain('try 2');
    expect(progressLabel(round({ status: 'lost', gaveUp: true, tries: ['skip'] }), 6)).toBe('Gave up');
    expect(progressLabel(round({ status: 'lost', tries: ['skip'] }), 6)).toBe('Out of time');
    expect(progressLabel(round({ status: 'lost', tries: ['wrong', 'wrong', 'wrong'] }), 3)).toBe('Out of tries');
  });
});
