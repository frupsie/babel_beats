import type { RefObject } from 'react';
import { LANGUAGES } from '../data/languages';
import { langStyle } from '../lib/format';
import type { Stats } from '../types';

interface Props {
  dialogRef: RefObject<HTMLDialogElement | null>;
  stats: Stats;
  onReset: () => void;
}

export function StatsDialog({ dialogRef, stats, onReset }: Props) {
  const rate = stats.played ? Math.round((stats.won / stats.played) * 100) : 0;
  const close = () => dialogRef.current?.close();

  return (
    <dialog
      ref={dialogRef}
      className="sheet"
      aria-labelledby="stats-title"
      onClick={(e) => {
        // A click on the backdrop targets the <dialog> element itself.
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="sheet__inner">
        <h2 id="stats-title" className="sheet__title">
          Your record
        </h2>
        <dl className="numbers">
          <div>
            <dt>Played</dt>
            <dd>{stats.played}</dd>
          </div>
          <div>
            <dt>Win rate</dt>
            <dd>{rate}%</dd>
          </div>
          <div>
            <dt>Streak</dt>
            <dd>{stats.streak}</dd>
          </div>
          <div>
            <dt>Best</dt>
            <dd>{stats.best}</dd>
          </div>
        </dl>

        <h3 className="kicker">By language</h3>
        <ul className="bars">
          {LANGUAGES.map((lang) => {
            const s = stats.byLang[lang.code];
            const pct = s.played ? (s.won / s.played) * 100 : 0;
            return (
              <li key={lang.code} style={langStyle(lang.code)}>
                <span className="bars__name">
                  <span lang={lang.htmlLang}>{lang.glyph}</span> {lang.name}
                </span>
                <span className="bars__track" aria-hidden="true">
                  <span className="bars__fill" style={{ width: `${pct}%` }} />
                </span>
                <span className="bars__val">
                  {s.won}/{s.played}
                </span>
              </li>
            );
          })}
        </ul>
        <p className="note note--tight">Singapore now rounds count toward played, win rate and streak, but not the language bars.</p>

        <div className="sheet__actions">
          <button
            type="button"
            className="btn"
            onClick={() => {
              if (window.confirm('Reset your stats and streak?')) onReset();
            }}
          >
            Reset
          </button>
          <button type="button" className="btn btn--primary" onClick={close} autoFocus>
            Close
          </button>
        </div>
      </div>
    </dialog>
  );
}
