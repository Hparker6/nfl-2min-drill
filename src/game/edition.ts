/**
 * The Coach's Edition: the one-time unlock (Career Legacy, more career slots, the Gridiron Challenge ladder).
 *
 * There is no purchase yet, so nothing can own it in a production build: there the edition is hidden, and every
 * screen looks and plays exactly as it did before. In development (`npm run dev`) it shows, so it can be reviewed,
 * in one of two states, switched with the address bar and remembered on this device:
 *   ?edition=locked  what a player who hasn't bought it sees (the default)
 *   ?edition=owned   everything unlocked
 *   ?edition=hidden  what production shows
 * The payment step will replace `editionState` with a check of a signed key; nothing else needs to change.
 */
export type EditionState = 'hidden' | 'locked' | 'owned';

export const EDITION_NAME = "Coach's Edition";
export const EDITION_PRICE = '$4.99';
const DEV_KEY = 'the4thcall:edition:dev';

const isState = (v: unknown): v is EditionState => v === 'hidden' || v === 'locked' || v === 'owned';

/** Development only: read (and remember) `?edition=` from the address. */
function devState(): EditionState {
  try {
    const q = new URLSearchParams(location.search).get('edition');
    if (isState(q)) localStorage.setItem(DEV_KEY, q);
    const v = localStorage.getItem(DEV_KEY);
    return isState(v) ? v : 'locked';
  } catch { return 'locked'; }
}

let cached: EditionState | null = null;

export function editionState(): EditionState {
  if (cached) return cached;
  cached = import.meta.env.DEV ? devState() : 'hidden';
  return cached;
}

/** The edition's screens and teasers show at all. */
export const editionShown = () => editionState() !== 'hidden';
/** The edition's features work. */
export const ownsEdition = () => editionState() === 'owned';

/** Tests: set the state directly. */
export function setEditionForTest(s: EditionState | null) { cached = s; }
