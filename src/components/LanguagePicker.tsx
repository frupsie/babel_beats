import type { CSSProperties } from 'react';
import { LANGUAGES, type LangCode } from '../data/languages';
import { cx, langStyle } from '../lib/format';

interface Props {
  selected: LangCode[];
  counts: Record<LangCode, number>;
  onChange: (next: LangCode[]) => void;
  /** Greyed out and inert, e.g. while a chart list (which ignores languages) is being played. */
  disabled?: boolean;
}

/** Rubber-stamp toggles: one per language, at least one always on. */
export function LanguagePicker({ selected, counts, onChange, disabled = false }: Props) {
  const toggle = (code: LangCode) => {
    if (selected.includes(code)) {
      if (selected.length === 1) return;
      onChange(selected.filter((c) => c !== code));
    } else {
      // Keep the registry order so the saved setting is stable.
      onChange(LANGUAGES.map((l) => l.code).filter((c) => c === code || selected.includes(c)));
    }
  };

  return (
    <div className={cx('stamps', disabled && 'is-off')} role="group" aria-label="Song languages">
      {LANGUAGES.map((lang, i) => {
        const on = selected.includes(lang.code);
        const isLast = on && selected.length === 1;
        return (
          <button
            key={lang.code}
            type="button"
            className="stamp"
            style={{ ...langStyle(lang.code), '--i': i } as CSSProperties}
            aria-pressed={on}
            // A language with no songs in the list being played (English, in a Chinese + Japanese playlist) can't be switched on.
            disabled={disabled || counts[lang.code] === 0}
            aria-disabled={isLast || undefined}
            title={isLast ? 'Keep at least one language switched on' : undefined}
            onClick={() => toggle(lang.code)}
          >
            <span className="stamp__glyph" lang={lang.htmlLang} aria-hidden="true">
              {lang.glyph}
            </span>
            <span className="stamp__name">{lang.name}</span>
            <span className="stamp__count">{counts[lang.code]} songs</span>
          </button>
        );
      })}
    </div>
  );
}
