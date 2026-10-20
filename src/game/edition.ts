/**
 * The Coach's Edition: the one-time unlock (Career Legacy, more career slots, the Gridiron Challenge ladder).
 *
 * There is no purchase yet, so nothing can own it in a production build: there the edition is hidden, and every
 * screen looks and plays exactly as it did before. In development (`npm run dev`) it shows, so it can be reviewed,
 * in one of two states, switched with the address bar and remembered on this device:
 *   ?edition=locked  what a player who hasn't bought it sees (the default)
 *   ?edition=owned   everything unlocked
 *   ?edition=hidden  what production shows
 *   ?edition=account owned when the signed-in account owns it, by the server's last answer (needs the Worker:
 *                    wrangler dev --env dev); the start of the replacement for this whole gate
 * The payment step will replace `editionState` with a check of a signed key; nothing else needs to change.
 */
import { COACH_EDITION, lastKnownOwns } from './account';

export type EditionState = 'hidden' | 'locked' | 'owned';
type DevChoice = EditionState | 'account';

export const EDITION_NAME = "Coach's Edition";
export const EDITION_PRICE = '$4.99';
/** Accounts and checkout show in development only, like the rest of the edition. */
export const accountsShown = () => editionShown();
const DEV_KEY = 'the4thcall:edition:dev';

const isChoice = (v: unknown): v is DevChoice => v === 'hidden' || v === 'locked' || v === 'owned' || v === 'account';

/** Development only: read (and remember) `?edition=` from the address. */
function devState(): EditionState {
  try {
    const q = new URLSearchParams(location.search).get('edition');
    if (isChoice(q)) localStorage.setItem(DEV_KEY, q);
    const v = localStorage.getItem(DEV_KEY);
    if (v === 'account') return lastKnownOwns().includes(COACH_EDITION) ? 'owned' : 'locked';
    return v === 'hidden' || v === 'owned' ? v : 'locked';
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
