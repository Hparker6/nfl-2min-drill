/**
 * The account API (server/accounts/routes.ts) from the browser. Same-origin only: the session is an HttpOnly cookie
 * the page never sees. Every answer is the server's; nothing here can grant ownership.
 */
import { forgetEditionState } from './edition';

export type Payments = 'off' | 'test' | 'live';
export type Me =
  | { state: 'off' }                                         // this server has no accounts (production today)
  | { state: 'unreachable' }                                 // no server answered (e.g. the Vite dev server alone)
  | { state: 'signed-out'; payments: Payments }
  | { state: 'signed-in'; email: string; owns: string[]; payments: Payments };

export const COACH_EDITION = 'coach_edition';
const OWNS_KEY = 'the4thcall:account:owns';
const PAY_KEY = 'the4thcall:account:payments';

async function post(path: string, body: unknown = {}): Promise<{ status: number; data: Record<string, unknown> }> {
  const r = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  return { status: r.status, data };
}

export async function fetchMe(): Promise<Me> {
  try {
    const r = await fetch('/v1/me', { credentials: 'same-origin' });
    if (r.status === 404) { rememberPayments('off'); return { state: 'off' }; }
    if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) return { state: 'unreachable' };
    const d = await r.json();
    if (!d || typeof d !== 'object') return { state: 'unreachable' };
    const payments: Payments = d.payments === 'test' || d.payments === 'live' ? d.payments : 'off';
    const owns = Array.isArray(d.owns) ? d.owns.filter((x: unknown) => typeof x === 'string') : [];
    const me: Me = d.signedIn === true ? { state: 'signed-in', email: typeof d.email === 'string' ? d.email : '', owns, payments } : { state: 'signed-out', payments };
    rememberPayments(payments);
    rememberOwns(me.state === 'signed-in' ? me.owns : []);
    return me;
  } catch { return { state: 'unreachable' }; }
}

/** The server's last word on what this browser's account owns (for the edition gate; the server re-checks everything). */
function rememberOwns(owns: string[]) {
  try { localStorage.setItem(OWNS_KEY, JSON.stringify(owns)); } catch { /* storage off */ }
  forgetEditionState();   // a refund or a purchase elsewhere shows on the next screen, not the next page load
}
/** Whether this site's server sells the edition, and in which mode (the production gate shows it only for 'live'). */
function rememberPayments(p: Payments) {
  try { if (localStorage.getItem(PAY_KEY) !== p) { localStorage.setItem(PAY_KEY, p); forgetEditionState(); } } catch { /* storage off */ }
}
export function lastKnownPayments(): Payments {
  try { const v = localStorage.getItem(PAY_KEY); return v === 'test' || v === 'live' ? v : 'off'; } catch { return 'off'; }
}
export function lastKnownOwns(): string[] {
  try { const v = JSON.parse(localStorage.getItem(OWNS_KEY) ?? '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}

const err = (d: Record<string, unknown>, fallback: string) => (typeof d.error === 'string' ? d.error : fallback);

export async function requestSignIn(email: string, turnstile?: string): Promise<string | null> {
  try {
    const { status, data } = await post('/v1/auth/email/start', { email, ...(turnstile ? { turnstile } : {}) });
    return status === 200 ? null : err(data, 'Something went wrong. Try again.');
  } catch { return 'No connection. Try again.'; }
}

export async function verify(input: { token: string } | { email: string; code: string }): Promise<string | null> {
  try {
    const { status, data } = await post('/v1/auth/email/verify', input);
    return status === 200 ? null : err(data, 'That didn’t work. Ask for a new link.');
  } catch { return 'No connection. Try again.'; }
}

/** True when the server confirmed. False: this browser forgot the account, but the session may still be live. */
export async function signOut(everywhere = false): Promise<boolean> {
  let ok = false;
  try { ok = (await post(everywhere ? '/v1/auth/logout-all' : '/v1/auth/logout')).status === 200; } catch { ok = false; }
  rememberOwns([]);
  return ok;
}

export async function deleteAccount(email: string): Promise<string | null> {
  try {
    const { status, data } = await post('/v1/me/delete', { email });
    if (status === 200) { rememberOwns([]); return null; }
    return err(data, 'The account could not be deleted. Try again.');
  } catch { return 'No connection. Try again.'; }
}

export type SupportKind = 'refund' | 'bug' | 'account' | 'other';

/** The help & refunds form (server/accounts/support.ts). The answer carries the reference the server assigned. */
export async function sendSupport(f: { kind: SupportKind; email: string; message: string; page: string; website?: string; turnstile?: string }): Promise<{ ref?: string; error?: string }> {
  try {
    const { status, data } = await post('/v1/support', f);
    return status === 200 && typeof data.ref === 'string' ? { ref: data.ref } : { error: err(data, 'The message could not be sent. Try again.') };
  } catch { return { error: 'No connection. Try again.' }; }
}

/** Start Stripe Checkout: the server makes the session at its own fixed price and sends back Stripe's page. */
export async function startCheckout(): Promise<{ url?: string; error?: string }> {
  try {
    const { status, data } = await post('/v1/checkout');
    // the server already checks this; the browser checks again, so nothing can send a player anywhere but Stripe
    return status === 200 && typeof data.url === 'string' && /^https:\/\/checkout\.stripe\.com\//.test(data.url) ? { url: data.url } : { error: err(data, 'Checkout could not be started.') };
  } catch { return { error: 'No connection. Try again.' }; }
}

/** What our server's records say about a checkout (the page we land on after Stripe proves nothing by itself). */
export async function checkoutStatus(sessionId: string): Promise<{ found: boolean; owns: boolean; status?: string } | 'unreachable' | null> {
  try {
    const r = await fetch(`/v1/checkout/status?session_id=${encodeURIComponent(sessionId)}`, { credentials: 'same-origin' });
    if (r.status === 401) return null;            // signed out: the panel shows the sign-in instead
    if (!r.ok) return 'unreachable';
    const d = await r.json();
    if (d.owns) rememberOwns([...new Set([...lastKnownOwns(), COACH_EDITION])]);
    return d;
  } catch { return 'unreachable'; }
}
