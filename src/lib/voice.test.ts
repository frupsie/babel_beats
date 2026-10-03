import { describe, expect, it } from 'vitest';
import { VOICE } from './voice';

describe('voice', () => {
  it('keeps the answer-card stamps short enough to be printed large in the corner of a phone', () => {
    for (const text of Object.values(VOICE.stamp)) expect(text.length).toBeLessThanOrEqual(13);
  });

  it('puts the points into the party "got it" line', () => {
    expect(VOICE.gotIt(850)).toContain('+850');
  });
});
