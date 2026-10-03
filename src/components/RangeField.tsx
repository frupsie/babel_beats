import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';

interface Props {
  number: string;
  legend: string;
  value: number;
  min: number;
  max: number;
  step: number;
  /** How a value is written, e.g. 45 → "45s". */
  format: (n: number) => string;
  onChange: (value: number) => void;
}

/**
 * A labelled slider that follows the finger smoothly but only reports the value when it is let go (or, from the
 * keyboard, when the key is released), so dragging doesn't send a message for every step.
 */
export function RangeField({ number, legend, value, min, max, step, format, onChange }: Props) {
  const id = useId();
  const [draft, setDraft] = useState(value);
  const held = useRef(false);
  const input = useRef<HTMLInputElement>(null);

  // Follow the real value when it changes from outside, but never yank the thumb out of a hand that is holding it.
  useEffect(() => {
    if (!held.current) setDraft(value);
  }, [value]);

  const commit = () => {
    const next = Number(input.current?.value);
    if (Number.isFinite(next) && next !== value) onChange(next);
  };

  const beginDrag = () => {
    held.current = true;
    const end = () => {
      held.current = false;
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      commit();
    };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  };

  return (
    <div className="range">
      <label className="kicker" htmlFor={id}>
        <span className="kicker__n">{number}</span>
        {legend}
        <output className="range__value" htmlFor={id}>
          {format(draft)}
        </output>
      </label>
      <input
        ref={input}
        id={id}
        className="volume__slider range__input"
        type="range"
        min={min}
        max={max}
        step={step}
        value={draft}
        aria-valuetext={format(draft)}
        style={{ '--p': (draft - min) / (max - min) } as CSSProperties}
        onPointerDown={beginDrag}
        onChange={(e) => setDraft(Number(e.target.value))}
        onKeyUp={commit}
        onBlur={commit}
      />
      <div className="range__ends" aria-hidden="true">
        <span>{format(min)}</span>
        <span>{format(max)}</span>
      </div>
    </div>
  );
}
