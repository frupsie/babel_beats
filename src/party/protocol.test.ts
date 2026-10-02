import { describe, expect, it } from 'vitest';
import { DEFAULT_PARTY_SETTINGS, NAME_MAX, cleanName, cleanSettings, normaliseCode, parseClientMsg, pointsFor, randomRoomCode } from './protocol';

const SECRET = 'abcdefghijklmnop1234';
const msg = (v: unknown) => parseClientMsg(JSON.stringify(v));

describe('parseClientMsg', () => {
  it('accepts well-formed messages', () => {
    expect(msg({ t: 'join', secret: SECRET, name: ' Ann ', code: 'ab-cd' })).toEqual({ t: 'join', secret: SECRET, name: 'Ann', code: 'ABCD' });
    expect(msg({ t: 'guess', no: 3, songId: '535824738', text: 'qing tian' })).toEqual({ t: 'guess', no: 3, songId: '535824738', text: 'qing tian' });
    expect(msg({ t: 'skip', no: 1 })).toEqual({ t: 'skip', no: 1 });
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

  it('rejects settings with no language, an unknown list or an odd time limit', () => {
    expect(cleanSettings({ ...DEFAULT_PARTY_SETTINGS, langs: [] })).toBeNull();
    expect(cleanSettings({ ...DEFAULT_PARTY_SETTINGS, pool: 'spotify' })).toBeNull();
    expect(cleanSettings({ ...DEFAULT_PARTY_SETTINGS, seconds: 5 })).toBeNull();
  });
});

describe('room codes', () => {
  it('are four easy-to-read letters', () => {
    for (let i = 0; i < 50; i++) expect(randomRoomCode()).toMatch(/^[A-HJKMNP-Z]{4}$/);
  });

  it('are read forgivingly', () => {
    expect(normaliseCode(' xy z-w ')).toBe('XYZW');
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
