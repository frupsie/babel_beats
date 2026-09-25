interface Option<T extends string> {
  id: T;
  label: string;
  title?: string;
}

interface Props<T extends string> {
  name: string;
  legend: string;
  number: string;
  value: T;
  options: ReadonlyArray<Option<T>>;
  onChange: (value: T) => void;
  /** Greys out and disables every option (a disabled fieldset does this natively). */
  disabled?: boolean;
}

/** A radio group dressed as pills; native inputs give keyboard and screen-reader behaviour for free. */
export function Segmented<T extends string>({ name, legend, number, value, options, onChange, disabled = false }: Props<T>) {
  return (
    <fieldset className="seg" disabled={disabled}>
      <legend className="sr-only">{legend}</legend>
      <div className="kicker" aria-hidden="true">
        <span className="kicker__n">{number}</span>
        {legend}
      </div>
      <div className="seg__row">
        {options.map((o) => (
          <label key={o.id} className="seg__opt" title={o.title}>
            <input type="radio" name={name} value={o.id} checked={o.id === value} onChange={() => onChange(o.id)} />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
