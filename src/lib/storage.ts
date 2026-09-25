import { LANG_CODES, isLangCode } from '../data/languages';
import type { Difficulty, Era, LangCode, Pool, Settings, Stats } from '../types';
import { DEFAULT_AUDIO, clampVolume, type AudioPrefs } from './volume';

const SETTINGS_KEY = 'babel-beats:settings:v1';
const STATS_KEY = 'babel-beats:stats:v1';
// Volume is stored apart from the game settings on purpose: changing a setting starts a new round, moving the slider must not.
const AUDIO_KEY = 'babel-beats:audio:v1';

const DIFFICULTY_IDS: Difficulty[] = ['easy', 'medium', 'hard', 'expert', 'impossible'];
const ERA_IDS: Era[] = ['any', 'classic', '2000s', '2010s', '2020s'];

const POOL_IDS: Pool[] = ['mix', 'mine', 'sg-now'];

export const DEFAULT_SETTINGS: Settings = { langs: [...LANG_CODES], difficulty: 'medium', era: 'any', pool: 'mix' };

function read(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null; // private mode, blocked storage or corrupt JSON: start fresh
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable; the game still works, it just won't remember */
  }
}

export function loadSettings(): Settings {
  const raw = read(SETTINGS_KEY) as Partial<Settings> | null;
  if (!raw) return DEFAULT_SETTINGS;
  const langs = Array.isArray(raw.langs) ? raw.langs.filter(isLangCode) : [];
  return {
    langs: langs.length > 0 ? LANG_CODES.filter((c) => langs.includes(c)) : DEFAULT_SETTINGS.langs,
    difficulty: DIFFICULTY_IDS.includes(raw.difficulty as Difficulty) ? (raw.difficulty as Difficulty) : DEFAULT_SETTINGS.difficulty,
    era: ERA_IDS.includes(raw.era as Era) ? (raw.era as Era) : DEFAULT_SETTINGS.era,
    // Settings saved before this list existed have no `pool`; they keep playing the language mix.
    pool: POOL_IDS.includes(raw.pool as Pool) ? (raw.pool as Pool) : DEFAULT_SETTINGS.pool,
  };
}

export function saveSettings(settings: Settings): void {
  write(SETTINGS_KEY, settings);
}

export function loadAudioPrefs(): AudioPrefs {
  const raw = read(AUDIO_KEY) as Partial<AudioPrefs> | null;
  if (!raw) return DEFAULT_AUDIO;
  return {
    volume: typeof raw.volume === 'number' ? clampVolume(raw.volume) : DEFAULT_AUDIO.volume,
    muted: raw.muted === true,
  };
}

export function saveAudioPrefs(prefs: AudioPrefs): void {
  write(AUDIO_KEY, prefs);
}

export function emptyStats(): Stats {
  const byLang = Object.fromEntries(LANG_CODES.map((c) => [c, { played: 0, won: 0 }])) as Stats['byLang'];
  return { played: 0, won: 0, streak: 0, best: 0, byLang };
}

export function loadStats(): Stats {
  const raw = read(STATS_KEY) as Partial<Stats> | null;
  const base = emptyStats();
  if (!raw) return base;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
  const byLang = { ...base.byLang };
  for (const code of LANG_CODES) {
    const s = raw.byLang?.[code];
    if (s) byLang[code] = { played: num(s.played), won: num(s.won) };
  }
  return { played: num(raw.played), won: num(raw.won), streak: num(raw.streak), best: num(raw.best), byLang };
}

export function saveStats(stats: Stats): void {
  write(STATS_KEY, stats);
}

/**
 * Returns the stats after one finished round. Pass `lang = null` for a song whose language isn't known
 * (Singapore chart rounds): it counts toward the totals and the streak, but not toward any language.
 */
export function recordResult(stats: Stats, lang: LangCode | null, won: boolean): Stats {
  const streak = won ? stats.streak + 1 : 0;
  const totals = { played: stats.played + 1, won: stats.won + (won ? 1 : 0), streak, best: Math.max(stats.best, streak) };
  if (lang === null) return { ...totals, byLang: stats.byLang };
  const prev = stats.byLang[lang];
  return { ...totals, byLang: { ...stats.byLang, [lang]: { played: prev.played + 1, won: prev.won + (won ? 1 : 0) } } };
}
