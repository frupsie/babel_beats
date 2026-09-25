// Chinese-text helpers shared by the catalogue builder and the Singapore snapshot script.
// Build-time only: opencc-js and pinyin-pro are far too heavy to ship to the browser.
import * as OpenCC from 'opencc-js';
import { pinyin } from 'pinyin-pro';
import { hasHan } from '../../src/lib/text.ts';

const t2s = OpenCC.Converter({ from: 't', to: 'cn' });
const s2t = OpenCC.Converter({ from: 'cn', to: 't' });

export const uniq = (arr) => [...new Set(arr.filter(Boolean))];

/** The text itself plus its Simplified and Traditional forms (when it contains Chinese and `isZh`). */
export function variants(text, isZh = true) {
  const out = [text];
  if (isZh && hasHan(text)) out.push(t2s(text), s2t(text));
  return out;
}

/** "qing tian" (no tones), for typing a Chinese title without a Chinese keyboard. */
export function plainPinyin(text) {
  if (!hasHan(text)) return '';
  return pinyin(t2s(text), { toneType: 'none', nonZh: 'consecutive' })
    .replace(/[^a-z0-9\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "qíng tiān", shown under the title. */
export function tonedPinyin(text) {
  if (!hasHan(text)) return '';
  return pinyin(t2s(text), { nonZh: 'consecutive' })
    .replace(/[，,。！？!?、·]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
