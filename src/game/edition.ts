/**
 * The Coach's Edition: the one-time unlock (Career Legacy, more career slots, the Gridiron Challenge ladder).
 *
 * Nothing can be bought yet, so in a production build the edition is hidden and every screen looks and plays exactly
 * as it did before. In development (`npm run dev`) and on the staging Worker it shows, so it can be reviewed, in the state chosen with the
 * address bar (remembered on this device):
 *   ?edition=locked  what a player who hasn't bought it sees (the default)
 *   ?edition=owned   everything unlocked
 *   ?edition=hidden  what production shows
 *   ?edition=account owned when the signed-in account owns it, by the server's last answer (needs the Worker:
 *                    server/accounts/SETUP.md); the start of this gate's replacement
 * Going live means `editionState` reads the account's ownership in production too: a separate, reviewed step.
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

/**
 * The staging Worker (wrangler deploy --env staging) runs a production build, but it exists to test accounts and test-mode
 * checkout, so it gets the same preview as development. Only its workers.dev address matches: the live site never does.
 */
export const isStaging = (host = typeof location !== 'undefined' ? location.hostname : '') => /^nfl-2min-drill-staging\.[a-z0-9-]+\.workers\.dev$/i.test(host);

let cached: EditionState | null = null;

export function editionState(): EditionState {
  if (cached) return cached;
  cached = import.meta.env.DEV || isStaging() ? devState() : 'hidden';
  return cached;
}

/** The edition's screens and teasers show at all. */
export const editionShown = () => editionState() !== 'hidden';
/** The edition's features work. */
export const ownsEdition = () => editionState() === 'owned';

/** Tests: set the state directly. */
export function setEditionForTest(s: EditionState | null) { cached = s; }
