import type { CSSProperties } from 'react';
import { languageInfo } from '../data/languages';
import type { LangCode, Song } from '../types';

/** 0.1 -> "0.1s", 1.5 -> "1.5s", 3 -> "3s" */
export function fmtSeconds(n: number): string {
  return `${Number(n.toFixed(2))}s`;
}

/** Inline CSS variables that give an element a language's ink colours. */
export function langStyle(code: LangCode): CSSProperties {
  const { color, onColor } = languageInfo(code);
  return { '--lang': color, '--on-lang': onColor } as CSSProperties;
}

/** Plain black ink for Singapore chart songs: their language is only a guess, so they get no language colour. */
export const SG_STYLE = { '--lang': '#17140f', '--on-lang': '#f7f1e3' } as CSSProperties;

/** The `lang` attribute for a song's text: Simplified Chinese for Singapore chart songs, Traditional for other Chinese songs. */
export function songHtmlLang(song: Pick<Song, 'lang' | 'fromChart'>): string {
  return song.fromChart && song.lang === 'zh' ? 'zh-Hans' : languageInfo(song.lang).htmlLang;
}

/** "2026-09-21T09:27:00Z" -> "21 Sep" */
export function formatChartDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'unknown date' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/**
 * Ref for the content of a `<dialog>` opened with showModal(). The browser puts focus on the element marked `autofocus`
 * and otherwise on the first button, which would be drawn with a focus ring the moment the sheet opens. (React's own
 * `autoFocus` doesn't help: it focuses when the page loads, while the dialog is still closed.)
 */
export function startHere(el: HTMLElement | null): void {
  el?.setAttribute('autofocus', '');
}
