import type { LangCode } from './data/languages';

export type { LangCode };
export type Era = 'any' | 'classic' | '2000s' | '2010s' | '2020s';
export type Difficulty = 'easy' | 'medium' | 'hard' | 'expert' | 'impossible';
/** Where songs come from: the curated language catalogue, your own Spotify playlists, or this week's Singapore chart. */
export type Pool = 'mix' | 'mine' | 'sg-now';

/** One playable song, as written by scripts/build-catalog.mjs. */
export interface Song {
  /** iTunes track id */
  id: string;
  lang: LangCode;
  title: string;
  /** Other spellings people may type: English gloss, romaji, pinyin, Simplified/Traditional. */
  titleAlt: string[];
  /** Romanisation / translation shown under the title for non-English songs. */
  subtitle?: string;
  artist: string;
  artistAlt: string[];
  artistEn?: string;
  year: number;
  album: string;
  previewUrl: string;
  artworkUrl: string;
  trackViewUrl: string;
  /** iTunes storefront the track was found in; used to refresh the preview URL at play time. */
  country: string;
  /** Set on songs that exist only in the Singapore chart. Their `lang` is a guess from the script, not curated. */
  fromChart?: boolean;
}

export interface Settings {
  langs: LangCode[];
  difficulty: Difficulty;
  era: Era;
  pool: Pool;
}

export interface LangStat {
  played: number;
  won: number;
}

export interface Stats {
  played: number;
  won: number;
  streak: number;
  best: number;
  byLang: Record<LangCode, LangStat>;
}
