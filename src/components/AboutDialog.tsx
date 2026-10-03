import type { RefObject } from 'react';
import { startHere } from '../lib/format';

interface Props {
  dialogRef: RefObject<HTMLDialogElement | null>;
}

/** How to play, plus where the music comes from and what the site keeps. Opened from the footer. */
export function AboutDialog({ dialogRef }: Props) {
  const close = () => dialogRef.current?.close();

  return (
    <dialog
      ref={dialogRef}
      className="sheet"
      aria-labelledby="about-title"
      onClick={(e) => {
        // A click on the backdrop targets the <dialog> element itself.
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="sheet__inner" tabIndex={-1} ref={startHere}>
        <h2 id="about-title" className="sheet__title">
          How to play
        </h2>
        <ol className="howto">
          <li>Tap the record to hear a short clip of a song.</li>
          <li>Type a guess and pick the song from the list, or skip to hear a longer clip.</li>
          <li>You have six tries. The fewer you need, the better your result.</li>
        </ol>
        <p className="note">
          Pick the languages, the era and how long the clips are on the left (on phones, above and below the record). Don’t know a song?
          Give up to see the answer.
        </p>

        <h3 className="kicker">Play with friends</h3>
        <p className="note">
          Start a room and share its code or invite link. Everyone hears the same clip at the same moment. Right answers score up to 1000
          points: fewer tries and faster answers score more.
        </p>

        <h3 className="kicker">About</h3>
        <ul className="about">
          <li>Song previews and artwork come from Apple’s iTunes Search API. Babel Beats is not affiliated with Apple or any artist.</li>
          <li>All songs, recordings and artwork belong to their respective owners.</li>
          <li>
            Your settings, stats and volume stay in this browser. In a party room, the name you enter and your guesses are sent to the game’s
            server to run the game.
          </li>
        </ul>

        <div className="sheet__actions sheet__actions--end">
          <button type="button" className="btn btn--primary" onClick={close}>
            Close
          </button>
        </div>
      </div>
    </dialog>
  );
}
