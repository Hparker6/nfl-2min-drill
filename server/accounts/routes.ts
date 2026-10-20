/**
 * The account and purchase API, under /v1/. Answers 404 to everything when accounts are off (config.ts), which is
 * how production runs until they're turned on.
 *
 *   POST /v1/auth/email/start   { email }                 send a sign-in link and code (same answer for every address)
 *   POST /v1/auth/email/verify  { token } | { email, code } sign in: sets the session cookie
 *   POST /v1/auth/logout                                   end this session
 *   POST /v1/auth/logout-all                               end every session of this account
 *   GET  /v1/me                                            who is signed in, what they own, whether checkout is open
 *   POST /v1/me/delete          { email }                  delete the account (the email typed again, as confirmation)
 *   POST /v1/checkout                                      start a Stripe Checkout for the Coach's Edition
 *   GET  /v1/checkout/status?session_id=                   what our records say about that checkout (never Stripe's redirect)
 *   POST /v1/stripe/webhook                                Stripe's events (signature checked; see purchases.ts)
 *
 * Every POST from a browser must come from one of our origins, as JSON (http.ts checkWrite); the webhook is the
 * exception, and is authenticated by Stripe's signature instead.
 */
import { accountsConfig, type AccountsEnv, type Config } from './config';
import { addressKey, checkWrite, clearSessionCookie, fail, json, readCookie, readJson, SESSION_COOKIE, sessionCookie } from './http';
import { deleteAccount, maskEmail, normalizeEmail, startEmail, verifyCode, verifyLink, type AuthDeps, type SignedIn } from './auth';
import { endAllSessions, endSession, readSession } from './sessions';
import { consoleMailer, resendMailer, type Mailer } from './mailer';
import { sweep } from './ratelimit';
import { checkoutStatus, createCheckout, entitlementsOf, handleWebhook } from './purchases';

export interface RouteOpts { now?: number; mailer?: Mailer; fetch?: typeof fetch; random?: () => number }

export const isAccountsPath = (p: string) => p.startsWith('/v1/auth/') || p === '/v1/me' || p.startsWith('/v1/me/') || p === '/v1/checkout' || p.startsWith('/v1/checkout/') || p === '/v1/stripe/webhook';

const NOT_FOUND = () => fail(404, 'not found');
const offMailer: Mailer = { send: async () => false };

export async function handleAccounts(req: Request, env: AccountsEnv, url: URL, opts: RouteOpts = {}): Promise<Response> {
  const cfg = accountsConfig(env);
  if (!cfg) return NOT_FOUND();
  const now = opts.now ?? Date.now();
  const p = url.pathname;
  try {
    if (p === '/v1/stripe/webhook') {
      if (req.method !== 'POST' || !cfg.payments) return NOT_FOUND();
      return await handleWebhook(cfg.db, cfg.payments, req, now, opts.fetch ?? fetch);
    }
    if (req.method === 'GET') {
      if (p === '/v1/me') return await me(cfg, req, now);
      if (p === '/v1/checkout/status') return await withSession(cfg, req, now, async (s) => json(await checkoutStatus(cfg.db, s.userId, url.searchParams.get('session_id'))));
      return NOT_FOUND();
    }
    const bad = checkWrite(req, cfg.origins);
    if (bad === 'method') return fail(405, 'method');
    if (bad) return fail(403, 'forbidden');
    const addr = await addressKey(req, cfg.pepper);
    const deps: AuthDeps = { db: cfg.db, pepper: cfg.pepper, origin: cfg.origin, mailer: opts.mailer ?? mailerFor(cfg, opts.fetch ?? fetch), now };

    if (p === '/v1/auth/email/start') {
      if (cfg.mail.kind === 'off' && !opts.mailer) {
        console.warn(`sign-in email is off: ${cfg.mail.why}`);
        return fail(503, 'Sign-in by email is not available yet.');
      }
      const body = await readJson(req);
      if ((opts.random ?? Math.random)() < 0.02) await sweep(cfg.db, now);
      const r = await startEmail(deps, body?.email, addr);
      if (r.ok) return json({ ok: true });
      if (r.error === 'invalid-email') return fail(400, 'That doesn’t look like an email address.');
      if (r.error === 'rate-limited') return fail(429, 'Too many sign-in requests. Try again in a few minutes.');
      return fail(502, 'The sign-in email could not be sent. Try again.');
    }
    if (p === '/v1/auth/email/verify') {
      const body = await readJson(req);
      const done = body && 'token' in body ? await verifyLink(deps, body.token, addr) : await verifyCode(deps, body?.email, body?.code, addr);
      if (!done) return fail(400, 'That sign-in link or code is wrong, used or expired. Ask for a new one.');
      return signedIn(done, now);
    }
    if (p === '/v1/auth/logout') {
      const s = await readSession(cfg.db, readCookie(req, SESSION_COOKIE), now);
      if (s) await endSession(cfg.db, s.tokenHash);
      return json({ ok: true }, 200, { 'set-cookie': clearSessionCookie() });
    }
    if (p === '/v1/auth/logout-all') {
      return await withSession(cfg, req, now, async (s) => json({ ok: true, ended: await endAllSessions(cfg.db, s.userId) }, 200, { 'set-cookie': clearSessionCookie() }));
    }
    if (p === '/v1/me/delete') {
      return await withSession(cfg, req, now, async (s) => {
        const body = await readJson(req);
        if (normalizeEmail(body?.email) !== s.email) return fail(400, 'Type your account’s email address to confirm.');
        await deleteAccount(cfg.db, s.userId, s.email);
        return json({ ok: true, deleted: true }, 200, { 'set-cookie': clearSessionCookie() });
      });
    }
    if (p === '/v1/checkout') {
      if (!cfg.payments) return fail(503, 'Purchases are not open.');
      return await withSession(cfg, req, now, async (s) => createCheckout(cfg.db, cfg.payments!, cfg.origin, s, now, opts.fetch ?? fetch));
    }
    return NOT_FOUND();
  } catch (e) {
    console.error('accounts error', p, (e as Error)?.message);
    return fail(500, 'Something went wrong. Try again.');
  }
}

/** The configured way to send sign-in email (opts.mailer overrides it in tests). */
function mailerFor(cfg: Config, f: typeof fetch): Mailer {
  if (cfg.mail.kind === 'console') return consoleMailer;
  if (cfg.mail.kind === 'resend') return resendMailer(cfg.mail, f);
  return offMailer;
}

async function withSession(cfg: Config, req: Request, now: number, fn: (s: NonNullable<Awaited<ReturnType<typeof readSession>>>) => Promise<Response>): Promise<Response> {
  const s = await readSession(cfg.db, readCookie(req, SESSION_COOKIE), now);
  if (!s) return fail(401, 'Sign in first.', { 'set-cookie': clearSessionCookie() });
  const res = await fn(s);
  if (s.renewed && !res.headers.has('set-cookie')) res.headers.set('set-cookie', sessionCookie(readCookie(req, SESSION_COOKIE)!, Math.round((s.renewed - now) / 1000)));
  return res;
}

async function me(cfg: Config, req: Request, now: number): Promise<Response> {
  const s = await readSession(cfg.db, readCookie(req, SESSION_COOKIE), now);
  const payments = cfg.payments ? (cfg.payments.live ? 'live' : 'test') : 'off';
  if (!s) return json({ signedIn: false, payments });
  const res = json({ signedIn: true, email: maskEmail(s.email), owns: await entitlementsOf(cfg.db, s.userId), payments });
  if (s.renewed) res.headers.set('set-cookie', sessionCookie(readCookie(req, SESSION_COOKIE)!, Math.round((s.renewed - now) / 1000)));
  return res;
}

function signedIn(r: SignedIn, now: number): Response {
  return json({ ok: true, email: maskEmail(r.email), created: r.created }, 200, { 'set-cookie': sessionCookie(r.token, Math.round((r.expiresAt - now) / 1000)) });
}
