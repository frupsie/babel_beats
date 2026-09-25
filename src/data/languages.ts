/**
 * The single place a language is defined. To add one: add an entry here, create
 * scripts/seeds/<code>.json, register its storefronts in scripts/build-catalog.mjs,
 * and run `npm run catalog`.
 *
 * `color` is the language's ink; `onColor` is the text colour that stays readable on top of it.
 */
export const LANGUAGES = [
  { code: 'en', name: 'English', native: 'English', glyph: 'A', htmlLang: 'en', color: '#2a45e8', onColor: '#f7f1e3' },
  { code: 'zh', name: 'Mandarin', native: '中文', glyph: '中', htmlLang: 'zh-Hant', color: '#ee4a24', onColor: '#17140f' },
  { code: 'ja', name: 'Japanese', native: '日本語', glyph: 'あ', htmlLang: 'ja', color: '#ff5fa2', onColor: '#17140f' },
] as const;

export type LanguageInfo = (typeof LANGUAGES)[number];
export type LangCode = LanguageInfo['code'];

export const LANG_CODES: LangCode[] = LANGUAGES.map((l) => l.code);

const byCode = Object.fromEntries(LANGUAGES.map((l) => [l.code, l])) as Record<LangCode, LanguageInfo>;

export function languageInfo(code: LangCode): LanguageInfo {
  return byCode[code];
}

export function isLangCode(value: unknown): value is LangCode {
  return typeof value === 'string' && value in byCode;
}
