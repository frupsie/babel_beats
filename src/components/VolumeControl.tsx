import { useRef, type CSSProperties } from 'react';
import { cx } from '../lib/format';
import { iconFor, isSilent, snapVolume, toggleMute, withVolume, type AudioPrefs, type VolumeIcon } from '../lib/volume';

interface Props {
  prefs: AudioPrefs;
  onChange: (next: AudioPrefs) => void;
}

/** Speaker with 0, 1 or 2 sound waves; a cross when silent. */
function SpeakerIcon({ kind }: { kind: VolumeIcon }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 9.5v5h3.5L12 18V6L7.5 9.5H4z" fill="currentColor" />
      {kind === 'muted' && <path d="M16 9.5l5 5m0-5l-5 5" />}
      {kind !== 'muted' && <path d="M15.5 9.5a3.5 3.5 0 0 1 0 5" />}
      {kind === 'high' && <path d="M18.5 7a7 7 0 0 1 0 10" />}
    </svg>
  );
}

/** Mute button plus a slider styled like the rest of the sheet. Level and mute are remembered between visits. */
export function VolumeControl({ prefs, onChange }: Props) {
  const silent = isSilent(prefs);
  // A muted player shows the slider at zero (dragging it up un-mutes); the remembered level returns on un-mute.
  const shown = silent ? 0 : prefs.volume;

  // While a mouse or finger is holding the slider its value snaps to round steps, so "20%" is always
  // reachable. Keyboard and assistive tech never snap: they keep 1% steps, and a slider that snapped
  // their +1 back to where it was would simply refuse to move.
  const pointerDown = useRef(false);
  const beginDrag = () => {
    pointerDown.current = true;
    const end = () => {
      pointerDown.current = false;
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  };

  const handleSlide = (raw: number) => {
    const next = withVolume(prefs, pointerDown.current ? snapVolume(raw) : raw);
    // Dragging within one step's width produces no change; skip it rather than re-saving the same value.
    if (next.volume !== prefs.volume || next.muted !== prefs.muted) onChange(next);
  };

  return (
    <div className={cx('volume', silent && 'is-silent')} role="group" aria-label="Volume">
      <button
        type="button"
        className="volume__btn"
        aria-label={silent ? 'Unmute' : 'Mute'}
        aria-pressed={silent}
        onClick={() => onChange(toggleMute(prefs))}
      >
        <SpeakerIcon kind={iconFor(prefs)} />
      </button>
      <input
        className="volume__slider"
        type="range"
        min={0}
        max={100}
        step={1}
        value={shown}
        aria-label="Volume"
        aria-valuetext={silent ? 'Muted' : `${prefs.volume} percent`}
        style={{ '--p': shown / 100 } as CSSProperties}
        onPointerDown={beginDrag}
        onChange={(e) => handleSlide(Number(e.target.value))}
      />
      <span className="volume__value" aria-hidden="true">
        {silent ? 'Mute' : `${prefs.volume}%`}
      </span>
    </div>
  );
}
