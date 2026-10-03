import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PARTY_SETTINGS,
  NAME_MAX,
  ROUNDS_MAX,
  ROUNDS_MIN,
  cleanName,
  cleanSettings,
  isRoomCode,
  normaliseCode,
  parseClientMsg,
  pointsFor,
  randomRoomCode,
} from './protocol';

const SECRET = 'abcdefghijklmnop1234';
const msg = (v: unknown) => parseClientMsg(JSON.stringify(v));

describe('parseClientMsg', () => {
  it('accepts well-formed messages', () => {
    expect(msg({ t: 'join', secret: SECRET, name: ' Ann ', code: 'k7-p3' })).toEqual({ t: 'join', secret: SECRET, name: 'Ann', code: 'K7P3' });
    expect(msg({ t: 'guess', no: 3, songId: '535824738', text: 'qing tian' })).toEqual({ t: 'guess', no: 3, songId: '535824738', text: 'qing tian' });
    expect(msg({ t: 'skip', no: 1 })).toEqual({ t: 'skip', no: 1 });
    expect(msg({ t: 'giveUp', no: 2 })).toEqual({ t: 'giveUp', no: 2 });
    expect(msg({ t: 'start', extra: 'ignored' })).toEqual({ t: 'start' });
  });

  it('rejects anything malformed', () => {
    for (const bad of [
      'not json',
      'null',
      '[1,2]',
      JSON.stringify({ t: 'unknown' }),
      JSON.stringify({ t: 'join', secret: 'short', name: 'Ann', code: 'ABCD' }),
      JSON.stringify({ t: 'join', secret: SECRET, name: '   ', code: 'ABCD' }),
      JSON.stringify({ t: 'join', secret: SECRET, name: 'Ann', code: 'ABC' }),
      JSON.stringify({ t: 'join', secret: SECRET, name: 'Ann', code: 'ABCI' }), // I is not used in codes
      JSON.stringify({ t: 'guess', no: 0, songId: '1', text: '' }),
      JSON.stringify({ t: 'guess', no: 1, songId: 'DROP TABLE', text: '' }),
      JSON.stringify({ t: 'guess', no: 1.5, songId: '1', text: '' }),
      JSON.stringify({ t: 'create', secret: SECRET, name: 'Ann', settings: { ...DEFAULT_PARTY_SETTINGS, rounds: 1000 } }),
    ]) {
      expect(parseClientMsg(bad), bad).toBeNull();
    }
  });

  it('caps a guess’s text', () => {
    const parsed = msg({ t: 'guess', no: 1, songId: null, text: 'x'.repeat(10_000) });
    expect(parsed?.t === 'guess' && parsed.text.length).toBe(200);
  });
});

describe('cleanName', () => {
  it('trims, collapses spaces and caps the length', () => {
    expect(cleanName('  Ann   Lee ')).toBe('Ann Lee');
    expect([...cleanName('名'.repeat(50))]).toHaveLength(NAME_MAX);
  });

  it('removes invisible and text-direction characters that could disguise a name', () => {
    expect(cleanName('A\u0000n\u200bn\u202e')).toBe('Ann');
  });

  it('keeps CJK and emoji names', () => {
    expect(cleanName('小明 🎵')).toBe('小明 🎵');
  });
});

describe('cleanSettings', () => {
  it('drops unknown languages and duplicates', () => {
    expect(cleanSettings({ ...DEFAULT_PARTY_SETTINGS, langs: ['zh', 'zh', 'xx'] })?.langs).toEqual(['zh']);
  });

  it('rejects settings with no language or an unknown list', () => {
    expect(cleanSettings({ ...DEFAULT_PARTY_SETTINGS, langs: [] })).toBeNull();
    expect(cleanSettings({ ...DEFAULT_PARTY_SETTINGS, pool: 'spotify' })).toBeNull();
  });

  it('accepts any number of songs the slider can make and nothing else', () => {
    for (const rounds of [ROUNDS_MIN, 7, 10, 23, ROUNDS_MAX]) {
      expect(cleanSettings({ ...DEFAULT_PARTY_SETTINGS, rounds })?.rounds).toBe(rounds);
    }
    // below the range, above it, not a whole number, not a number
    for (const rounds of [ROUNDS_MIN - 1, 0, ROUNDS_MAX + 1, 1000, 10.5, NaN, '10', null]) {
      expect(cleanSettings({ ...DEFAULT_PARTY_SETTINGS, rounds })).toBeNull();
    }
  });

  it('accepts the Impossible difficulty', () => {
    expect(cleanSettings({ ...DEFAULT_PARTY_SETTINGS, difficulty: 'impossible' })?.difficulty).toBe('impossible');
    expect(cleanSettings({ ...DEFAULT_PARTY_SETTINGS, difficulty: 'expert' })).toBeNull();
  });
});

describe('room codes', () => {
  it('are four easy-to-read characters, always mixing letters and digits', () => {
    for (let i = 0; i < 500; i++) {
      const code = randomRoomCode();
      expect(code).toMatch(/^[A-HJKMNP-Z2-9]{4}$/); // never I, L, O, 0 or 1
      expect(code).toMatch(/[A-Z]/);
      expect(code).toMatch(/[2-9]/);
    }
  });

  it('keeps trying until a code has both, even when the dice keep landing on letters', () => {
    let n = 0;
    // Picks 1-11 are all "A" (two letter-only codes thrown away), then pick 12 is the last digit, "9".
    const rand = () => (n++ < 11 ? 0 : 0.99);
    expect(randomRoomCode(rand)).toBe('AAA9');
  });

  it('are read forgivingly', () => {
    expect(normaliseCode(' k7 p-3 ')).toBe('K7P3');
  });

  it('turn away look-alike characters that are never used', () => {
    for (const bad of ['K7P0', 'K7PO', 'K1P3', 'KIP3', 'KLP3']) expect(isRoomCode(bad), bad).toBe(false);
    expect(isRoomCode('K7P3')).toBe(true);
  });
});

describe('pointsFor', () => {
  it('gives 1000 for an instant first-try answer, less for each try and for taking longer', () => {
    expect(pointsFor(1, 0, 60_000)).toBe(1000);
    expect(pointsFor(2, 0, 60_000)).toBe(850);
    expect(pointsFor(1, 30_000, 60_000)).toBe(750);
    expect(pointsFor(6, 60_000, 60_000)).toBe(125);
  });
});
