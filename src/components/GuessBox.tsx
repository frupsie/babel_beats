import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { SG_STYLE, fmtSeconds, langStyle, songHtmlLang } from '../lib/format';
import { searchSongs, type IndexedSong } from '../lib/match';
import type { Song } from '../types';

interface Props {
  index: readonly IndexedSong[];
  disabled: boolean;
  /** Seconds the next attempt would add; null on the last attempt (skipping = giving up). */
  skipGain: number | null;
  /** Returns false when the guess was not accepted (nothing usable was chosen). */
  onGuess: (song: Song | null, typed: string) => boolean;
  onSkip: () => void;
}

/** Autocomplete over the whole catalogue (every language), so the list never hints at the answer's language. */
export function GuessBox({ index, disabled, skipGain, onGuess, onSkip }: Props) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  // True once the player has explicitly moved through the list (arrows or mouse).
  const [picked, setPicked] = useState(false);
  const [nudge, setNudge] = useState<string | null>(null);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => searchSongs(index, query), [index, query]);
  const showList = open && results.length > 0;

  const submit = (song: Song | null, typed: string) => {
    if (!song && !typed.trim()) return;
    if (!onGuess(song, typed)) {
      setNudge('Pick a song from the list to lock in a guess.');
      return;
    }
    setNudge(null);
    setQuery('');
    setOpen(false);
    setActive(0);
    setPicked(false);
    inputRef.current?.focus();
  };

  const submitCurrent = () => {
    if (picked) {
      const choice = results[active];
      if (choice) submit(choice, '');
    } else {
      submit(results[0] ?? null, query);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // Enter while an IME (Chinese/Japanese input) is composing only commits the text; it must not submit.
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        if (results.length === 0) return;
        e.preventDefault();
        const step = e.key === 'ArrowDown' ? 1 : -1;
        setOpen(true);
        setPicked(true);
        setActive((a) => (a + step + results.length) % results.length);
        break;
      }
      case 'Enter':
        e.preventDefault();
        submitCurrent();
        break;
      case 'Escape':
        setOpen(false);
        break;
    }
  };

  return (
    <div className="guess">
      <div className="guess__anchor">
      <div className="guess__field">
        <svg className="guess__icon" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path d="M9.5 3a6.5 6.5 0 0 1 5.2 10.4l5.4 5.4-1.4 1.4-5.4-5.4A6.5 6.5 0 1 1 9.5 3Zm0 2a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9Z" fill="currentColor" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-label="Name that track"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && picked ? `${listId}-${active}` : undefined}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="go"
          placeholder="Name that track…  (title, artist, romaji, pinyin)"
          value={query}
          disabled={disabled}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActive(0);
            setPicked(false);
            setNudge(null);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
        />
      </div>

      {showList && (
        <ul id={listId} role="listbox" className="guess__list">
          {results.map((song, i) => {
            const htmlLang = songHtmlLang(song);
            return (
              <li
                key={song.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active && picked}
                className={i === active && picked ? 'opt is-active' : 'opt'}
                style={song.fromChart ? SG_STYLE : langStyle(song.lang)}
                onMouseDown={(e) => e.preventDefault()}
                onMouseMove={() => {
                  if (!picked || active !== i) {
                    setPicked(true);
                    setActive(i);
                  }
                }}
                onClick={() => submit(song, '')}
              >
                <span className="opt__dot" aria-hidden="true" />
                <span className="opt__main">
                  <span className="opt__title" lang={htmlLang}>
                    {song.title}
                  </span>
                  {song.subtitle && <span className="opt__sub">{song.subtitle}</span>}
                </span>
                <span className="opt__artist" lang={htmlLang}>
                  {song.artist}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      </div>

      {nudge && (
        <p className="guess__nudge" role="alert">
          {nudge}
        </p>
      )}

      <div className="guess__actions">
        <button type="button" className="btn" onClick={onSkip} disabled={disabled}>
          {skipGain === null ? 'Give up' : `Skip  +${fmtSeconds(skipGain)}`}
        </button>
        <button type="button" className="btn btn--primary" onClick={submitCurrent} disabled={disabled || !query.trim()}>
          Guess
        </button>
      </div>
    </div>
  );
}
