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
 *   POST /v1/support            { kind, email, message, page?, turnstile? }  a refund request, bug report or question (support.ts)
 *
 * Every POST from a browser must come from one of our origins, as JSON (http.ts checkWrite); the webhook is the
 * exception, and is authenticated by Stripe's signature instead.
 */
import { accountsConfig, isLocal, type AccountsEnv, type Config } from './config';
import { addressKey, checkWrite, clearSessionCookie, fail, json, readCookie, readJson, SESSION_COOKIE, sessionCookie } from './http';
import { deleteAccount, maskEmail, normalizeEmail, startEmail, verifyCode, verifyLink, type AuthDeps, type SignedIn } from './auth';
import { endAllSessions, endSession, readSession } from './sessions';
import { consoleMailer, resendMailer, type Mailer, type Notice } from './mailer';
import { sweep } from './ratelimit';
import { checkoutStatus, createCheckout, entitlementsOf, handleWebhook } from './purchases';
import { submitSupport } from './support';
import { verifyTurnstile } from './turnstile';
import { audit } from './audit';

export interface RouteOpts { now?: number; mailer?: Mailer; notifier?: (n: Notice) => Promise<boolean>; fetch?: typeof fetch; random?: () => number }

export const isAccountsPath = (p: string) => p.startsWith('/v1/auth/') || p === '/v1/me' || p.startsWith('/v1/me/') || p === '/v1/checkout' || p.startsWith('/v1/checkout/') || p === '/v1/stripe/webhook' || p === '/v1/support';

const NOT_FOUND = () => fail(404, 'not found');
const offMailer: Mailer = { send: async () => false };

export async function handleAccounts(req: Request, env: AccountsEnv, url: URL, opts: RouteOpts = {}): Promise<Response> {
  const cfg = accountsConfig(env);
  if (!cfg) return NOT_FOUND();
  if (isLocal(cfg.origin)) return localCookies(req, (r) => routeAccounts(r, cfg, url, opts));
  return routeAccounts(req, cfg, url, opts);
}

/**
 * Local development over plain http: Safari (unlike Chrome) won't keep a Secure cookie for http://localhost, and a
 * __Host- cookie must be Secure. On a localhost origin only, the browser gets a plain dev cookie, translated to the
 * real one on the way in and back on the way out. A deployed origin is always https (config.ts) and never gets here.
 */
const DEV_COOKIE = '4c_sid_dev';
async function localCookies(req: Request, run: (r: Request) => Promise<Response>): Promise<Response> {
  const c = req.headers.get('cookie');
  let r = req;
  if (c && c.includes(`${DEV_COOKIE}=`)) {
    const h = new Headers(req.headers);
    // an old Secure cookie Chrome kept from before would come first and win: drop it, the dev one is the session
    h.set('cookie', c.split(';').filter((x) => !x.trim().startsWith(`${SESSION_COOKIE}=`)).map((x) => (x.trim().startsWith(`${DEV_COOKIE}=`) ? x.replace(`${DEV_COOKIE}=`, `${SESSION_COOKIE}=`) : x)).join(';'));
    r = new Request(req, { headers: h });
  }
  const res = await run(r);
  const set = res.headers.get('set-cookie');
  if (set && set.startsWith(`${SESSION_COOKIE}=`)) res.headers.set('set-cookie', set.replace(`${SESSION_COOKIE}=`, `${DEV_COOKIE}=`).replace('; Secure', ''));
  return res;
}

async function routeAccounts(req: Request, cfg: Config, url: URL, opts: RouteOpts): Promise<Response> {
  const now = opts.now ?? Date.now();
  const p = url.pathname;
  try {
    if (p === '/v1/stripe/webhook') {
      if (req.method !== 'POST' || !cfg.payments) return NOT_FOUND();
      return await handleWebhook(cfg.db, cfg.payments, req, now, opts.fetch ?? fetch, cfg.pepper);
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
      const body = await readJson(req, 4096);
      if (!body) return fail(400, 'Something in the request isn’t right.');
      if (cfg.turnstile && !(await verifyTurnstile(cfg.turnstile, body?.turnstile, req.headers.get('cf-connecting-ip'), opts.fetch ?? fetch))) { audit('signin.bot_check_failed', {}); return fail(403, 'The bot check did not pass. Reload and try again.'); }
      if ((opts.random ?? Math.random)() < 0.02) await sweep(cfg.db, now).catch((e) => console.error(`sweep failed: ${String((e as Error)?.message).slice(0, 200)}`));
      const r = await startEmail(deps, body?.email, addr);
      audit('signin.requested', { ok: r.ok, error: r.ok ? null : r.error });
      if (r.ok) return json({ ok: true });
      if (r.error === 'invalid-email') return fail(400, 'That doesn’t look like an email address.');
      if (r.error === 'rate-limited') return fail(429, 'Too many sign-in requests. Try again in a few minutes.');
      return fail(502, 'The sign-in email could not be sent. Try again.');
    }
    if (p === '/v1/auth/email/verify') {
      const body = await readJson(req);
      const done = body && 'token' in body ? await verifyLink(deps, body.token, addr) : await verifyCode(deps, body?.email, body?.code, addr);
      audit('signin.verify', { by: body && 'token' in body ? 'link' : 'code', ok: !!done, created: done?.created ?? null });
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
        audit('account.deleted', {});
        return json({ ok: true, deleted: true }, 200, { 'set-cookie': clearSessionCookie() });
      });
    }
    if (p === '/v1/checkout') {
      if (!cfg.payments) return fail(503, 'Purchases are not open.');
      return await withSession(cfg, req, now, async (s) => { const r = await createCheckout(cfg.db, cfg.payments!, cfg.origin, s, now, opts.fetch ?? fetch, cfg.pepper); audit('checkout.started', { status: r.status, live: cfg.payments!.live }); return r; });
    }
    if (p === '/v1/support') {
      const body = await readJson(req, 12288);
      if (!body) return fail(400, 'Something in the form isn’t right (too long, or not sent as the game sends it).');
      if (cfg.turnstile && !(await verifyTurnstile(cfg.turnstile, body?.turnstile, req.headers.get('cf-connecting-ip'), opts.fetch ?? fetch))) { audit('support.bot_check_failed', {}); return fail(403, 'The bot check did not pass. Reload and try again.'); }
      const s = await readSession(cfg.db, readCookie(req, SESSION_COOKIE), now);   // optional: a locked-out player can still write
      const r = await submitSupport({ db: cfg.db, pepper: cfg.pepper, mail: cfg.mail, supportTo: cfg.supportTo, now, fetch: opts.fetch ?? fetch, notifier: opts.notifier }, body, addr, s?.userId ?? null);
      if (r.ok) return json({ ok: true, ref: r.ref });
      if (r.error === 'rate-limited') return fail(429, 'Too many requests from here today. Try again tomorrow.');
      return fail(400, r.field === 'email' ? 'That doesn’t look like an email address.' : r.field === 'message' ? 'Write between 10 and 2000 characters.' : 'Something in the form isn’t right.');
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
