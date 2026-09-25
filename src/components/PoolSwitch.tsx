import type { Pool } from '../types';

interface Option {
  id: Pool;
  label: string;
  detail: string;
  disabled: boolean;
}

interface Props {
  pool: Pool;
  onChange: (pool: Pool) => void;
  /** Songs in the curated language catalogue. */
  mixCount: number;
  /** Playable songs from your Spotify playlists; 0 disables that tab. */
  mineCount: number;
  /** Playable songs in the Singapore chart snapshot; 0 disables that tab. */
  sgCount: number;
  /** When Apple last updated the chart, already formatted ("21 Sep"). */
  chartDate: string;
}

/** Tabs for where songs come from: the curated language mix, your own playlists, or this week's Singapore chart. */
export function PoolSwitch({ pool, onChange, mixCount, mineCount, sgCount, chartDate }: Props) {
  const options: Option[] = [
    { id: 'mix', label: 'My mix', detail: `${mixCount} songs`, disabled: false },
    { id: 'mine', label: 'My playlists', detail: mineCount > 0 ? `${mineCount} songs` : 'none yet', disabled: mineCount === 0 },
    { id: 'sg-now', label: 'Singapore now', detail: sgCount > 0 ? `top ${sgCount} · ${chartDate}` : 'not downloaded yet', disabled: sgCount === 0 },
  ];

  return (
    <fieldset className="pool">
      <legend className="sr-only">Song list</legend>
      {options.map((o) => (
        <label key={o.id} className="pool__opt">
          <input type="radio" name="pool" value={o.id} checked={pool === o.id} disabled={o.disabled} onChange={() => onChange(o.id)} />
          <span className="pool__face">
            <b>{o.label}</b>
            <small>{o.detail}</small>
          </span>
        </label>
      ))}
    </fieldset>
  );
}
