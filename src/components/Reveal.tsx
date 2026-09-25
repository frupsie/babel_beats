import { languageInfo } from '../data/languages';
import { SG_STYLE, cx, langStyle, songHtmlLang } from '../lib/format';
import type { RoundState } from '../lib/game';

interface Props {
  round: RoundState;
  art: string | null;
  /** Position in this week's Singapore chart, when the round came from that list. */
  rank?: number;
  playingFull: boolean;
  onPlayFull: () => void;
  onNext: () => void;
}

function stampText(round: RoundState): string {
  if (round.status === 'lost') return 'Missed it';
  const tries = round.guesses.length;
  if (tries === 1) return 'First listen!';
  return tries <= 3 ? 'Nailed it' : 'Got it';
}

/** Shown after the round ends: the answer, its cover, and a rubber-stamp verdict. */
export function Reveal({ round, art, rank, playingFull, onPlayFull, onNext }: Props) {
  const { song, status, guesses } = round;
  const info = languageInfo(song.lang);
  const won = status === 'won';
  const inChart = rank !== undefined;
  // A chart-only song's language is only a guess, so it shows its chart position instead of a language tag.
  const showLanguage = !(inChart && song.fromChart);
  const htmlLang = songHtmlLang(song);

  return (
    <section className="reveal" style={inChart ? SG_STYLE : langStyle(song.lang)} aria-label="Answer">
      <div className={cx('result-stamp', won ? 'is-won' : 'is-lost')} aria-hidden="true">
        {stampText(round)}
      </div>

      <div className="reveal__main">
        <img className="reveal__art" src={art ?? song.artworkUrl} alt={`Cover of ${song.album}`} width={112} height={112} />
        <div className="reveal__body">
          <p className="reveal__meta">
            {inChart && <span className="tag">SG #{rank}</span>}
            {showLanguage && (
              <span className="tag" style={langStyle(song.lang)}>
                <span lang={info.htmlLang}>{info.glyph}</span> {info.name}
              </span>
            )}
            {!inChart && <span>{song.year}</span>}
            <span>{won ? `${guesses.length} ${guesses.length === 1 ? 'try' : 'tries'}` : 'not this time'}</span>
          </p>
          <h2 className="reveal__title" lang={htmlLang}>
            {song.title}
          </h2>
          {song.subtitle && <p className="reveal__sub">{song.subtitle}</p>}
          <p className="reveal__artist" lang={htmlLang}>
            {song.artist}
            {song.artistEn && <span lang="en"> · {song.artistEn}</span>}
          </p>
        </div>
      </div>

      <div className="reveal__actions">
        <button type="button" className="btn btn--primary" onClick={onNext}>
          Next song →
        </button>
        <button type="button" className="btn" onClick={onPlayFull}>
          {playingFull ? 'Stop' : 'Hear 30s'}
        </button>
        <a className="btn" href={song.trackViewUrl} target="_blank" rel="noreferrer">
          Apple Music ↗
        </a>
      </div>
    </section>
  );
}
