import type { CSSProperties } from 'react';
import { cx } from '../lib/format';

interface Props {
  loading: boolean;
  /** Set while audio is playing; `id` changes per play so the progress ring restarts. */
  playing: { id: number; seconds: number } | null;
  /** Text under the icon: clip length, "Tuning", ... */
  label: string;
  ariaLabel: string;
  /** Cover art shown on the record label once the song is revealed. */
  art?: string | null;
  disabled?: boolean;
  onToggle: () => void;
}

const PlayIcon = () => (
  <svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true">
    <path d="M7 4.5v15L20 12z" fill="currentColor" />
  </svg>
);

const StopIcon = () => (
  <svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true">
    <rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" />
  </svg>
);

/** The record: press the label to play. The ring around it fills in real time as the clip plays. */
export function Vinyl({ loading, playing, label, ariaLabel, art, disabled, onToggle }: Props) {
  return (
    <div className={cx('vinyl', playing && 'is-playing', loading && 'is-loading')}>
      <svg className="vinyl__ring" viewBox="0 0 100 100" aria-hidden="true">
        <circle className="vinyl__track" cx="50" cy="50" r="48" />
        {playing && (
          <circle
            key={playing.id}
            className="vinyl__progress"
            cx="50"
            cy="50"
            r="48"
            pathLength={1}
            style={{ animationDuration: `${playing.seconds}s` } as CSSProperties}
          />
        )}
      </svg>
      <div className="vinyl__disc" aria-hidden="true">
        <div className="vinyl__label" style={art ? { backgroundImage: `url("${art}")` } : undefined}>
          <i className="vinyl__notch" />
        </div>
      </div>
      <button type="button" className={cx('vinyl__btn', art && 'has-art')} onClick={onToggle} disabled={disabled} aria-label={ariaLabel}>
        {playing ? <StopIcon /> : <PlayIcon />}
        <span className="vinyl__time">{label}</span>
      </button>
    </div>
  );
}
