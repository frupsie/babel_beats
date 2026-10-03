/**
 * The game's little bits of personality, in one place so they are easy to change or tone down. They have a Singapore
 * flavour ("Singlish"). It is kept to the moments of celebration, commiseration and waiting; anything that tells you
 * how to play stays in plain English, so nothing is unclear to someone who doesn't speak it.
 */
export const VOICE = {
  /** The rubber stamp on the answer card, by how the round went. Short: it is printed large in a corner. */
  stamp: { first: 'Wah, steady!', quick: 'Shiok!', slow: 'Can lah!', missed: 'Aiyo, miss!' },
  /** The status line while a song downloads, and the game's own loading screen (the same words are in index.html). */
  loadingSong: 'Loading, wait ah…',
  /** Party: the 3-2-1 is about to start. */
  getReady: 'Get ready lah…',
  /** Party: you got it; `points` is what it scored. */
  gotIt: (points: number) => `Steady! +${points}. Waiting for the others…`,
  /** Party, final scores. */
  youWin: 'You win, steady lah!',
  nobodyScored: 'Aiyo, nobody scored this time',
  /** The link under the guess box that ends the round. */
  giveUp: 'Don’t know ah? Give up',
  /** Something went wrong. */
  nothingToPlay: 'Aiyo, nothing to play here',
  previewFailed: 'Aiyo, couldn’t load a preview',
} as const;
