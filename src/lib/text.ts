// Pure text helpers shared by the app and by scripts/build-catalog.mjs
// (Node runs this file directly, so keep it to erasable TypeScript: no enums or namespaces).

/**
 * Fold a string down to lowercase letters and digits so that "Don't Stop Believin'",
 * "dont stop believin", "Ｄｏｎ’ｔ…" and "Beyoncé"/"beyonce" all compare equal.
 * Works for Latin, kana, kanji and hanzi; the diacritic strip only touches U+0300–U+036F,
 * so Japanese dakuten (が = か + U+3099) survive the NFD → NFC round trip.
 * Katakana is folded to hiragana so "キセキ" and "きせき" are the same guess.
 */
export function compact(input: string): string {
  return input
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60))
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

const INNERMOST_BRACKETS = /\s*[(（[【][^()（）[\]【】]*[)）\]】]/g;

/** Drop "(feat. X)", "[Remastered]", "（Live）", " - Single Version" and trailing "feat. X". */
export function stripDecor(title: string): string {
  let out = title;
  // Remove innermost bracket pairs repeatedly so nesting like "(TVBS連續劇【片尾曲】)" comes out clean.
  for (let prev = ''; prev !== out; ) {
    prev = out;
    out = out.replace(INNERMOST_BRACKETS, '');
  }
  out = out
    .replace(/\s+[-–—]\s+.*$/, '')
    .replace(/\s+(?:feat|ft)\.?\s+.*$/i, '')
    .trim();
  return out || title.trim();
}

/** Compact form used for comparing song titles. */
export function titleKey(title: string): string {
  return compact(stripDecor(title));
}

const HAN = /\p{Script=Han}/u;
export function hasHan(s: string): boolean {
  return HAN.test(s);
}
