interface Option<T extends string> {
  id: T;
  label: string;
  title?: string;
  /** Shown beside the label, e.g. how many songs that choice leaves in play. */
  count?: number;
  /** Greyed out and not selectable (an era with no songs for the languages chosen, say). */
  disabled?: boolean;
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
            <input type="radio" name={name} value={o.id} checked={o.id === value} disabled={o.disabled} onChange={() => onChange(o.id)} />
            <span>
              {o.label}
              {o.count !== undefined && <small className="seg__n">{o.count}</small>}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
