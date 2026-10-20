/**
 * Passwordless sign-in by email. Asking for a sign-in sends a link and a 6-digit code to the address; either one,
 * used once within 15 minutes, signs that browser in and creates the account the first time. There are no passwords.
 *
 * What it gives away: nothing about whether an address has an account. Asking always gets the same answer, and no
 * account is looked up until a token is used. Rate limits (ratelimit.ts) cap emails per address and per caller; a
 * code allows 5 tries, so guessing one takes on the order of 100,000 emails.
 */
import type { D1Database } from './d1';
import { hmacSha256, randomCode, randomToken, safeEqual, sha256 } from './crypto';
import { hit, LIMITS } from './ratelimit';
import { createSession } from './sessions';
import type { Mailer } from './mailer';

export const TOKEN_TTL_MS = 15 * 60_000;
export const MAX_CODE_TRIES = 5;

/** Lowercased and trimmed, or null when it isn't a plausible address. (Not a full RFC 5322 check: the email proves it.) */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const e = raw.trim().toLowerCase();
  if (e.length < 6 || e.length > 254) return null;
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(e)) return null;
  return e;
}

/** a•••@example.com */
export function maskEmail(e: string): string {
  const [user, domain] = e.split('@');
  return `${user.slice(0, 1)}${'•'.repeat(Math.min(6, Math.max(1, user.length - 1)))}@${domain}`;
}

export interface AuthDeps { db: D1Database; pepper: string; origin: string; mailer: Mailer; now: number }

export type StartResult = { ok: true } | { ok: false; error: 'invalid-email' | 'rate-limited' | 'mail-failed' };

/**
 * Send a sign-in email. The answer is the same whether or not the address has an account; when the address has asked
 * too often, nothing is sent but the answer doesn't change either (the caller's address limit is what says 429).
 */
export async function startEmail(d: AuthDeps, rawEmail: unknown, addr: string): Promise<StartResult> {
  const email = normalizeEmail(rawEmail);
  if (!email) return { ok: false, error: 'invalid-email' };
  if (!(await hit(d.db, LIMITS.startPerAddress, addr, d.now))) return { ok: false, error: 'rate-limited' };
  const ek = await sha256(`${d.pepper}:email:${email}`);
  const a = await hit(d.db, LIMITS.startPerEmail15m, ek, d.now);
  const b = await hit(d.db, LIMITS.startPerEmailDay, ek, d.now);
  if (!a || !b) return { ok: true };
  const token = randomToken(32), code = randomCode();
  const tokenHash = await sha256(token);
  await d.db.prepare('INSERT INTO login_tokens (token_hash, email, code_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
    .bind(tokenHash, email, await codeHash(d.pepper, tokenHash, code), d.now, d.now + TOKEN_TTL_MS).run();
  const sent = await d.mailer.send({ to: email, link: `${d.origin}/#signin=${token}`, code, minutes: TOKEN_TTL_MS / 60_000 });
  if (sent) return { ok: true };
  // never delivered: retire it, so a link or code that may yet turn up late (or was never seen) can't be used
  await d.db.prepare('UPDATE login_tokens SET used_at = ? WHERE token_hash = ?').bind(d.now, tokenHash).run();
  return { ok: false, error: 'mail-failed' };
}

const codeHash = (pepper: string, tokenHash: string, code: string) => hmacSha256(pepper, `code:${tokenHash}:${code}`);

export interface SignedIn { userId: string; email: string; token: string; expiresAt: number; created: boolean }

/** Use a sign-in link's token (once). Null for anything unknown, used, expired or locked. */
export async function verifyLink(d: AuthDeps, rawToken: unknown, addr: string): Promise<SignedIn | null> {
  if (!(await hit(d.db, LIMITS.verifyPerAddress, addr, d.now))) return null;
  if (typeof rawToken !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(rawToken)) return null;
  const row = await d.db.prepare(
    `UPDATE login_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ? AND attempts < ? RETURNING email`,
  ).bind(d.now, await sha256(rawToken), d.now, MAX_CODE_TRIES).first<{ email: string }>();
  return row ? signIn(d, row.email) : null;
}

/** Use the code from the latest sign-in email to this address. Each wrong try counts; five end that email's code. */
export async function verifyCode(d: AuthDeps, rawEmail: unknown, rawCode: unknown, addr: string): Promise<SignedIn | null> {
  if (!(await hit(d.db, LIMITS.verifyPerAddress, addr, d.now))) return null;
  const email = normalizeEmail(rawEmail);
  if (!email || typeof rawCode !== 'string' || !/^\d{6}$/.test(rawCode)) return null;
  if (!(await hit(d.db, LIMITS.codePerEmailHour, await sha256(`${d.pepper}:email:${email}`), d.now))) return null;
  const row = await d.db.prepare(
    `UPDATE login_tokens SET attempts = attempts + 1
      WHERE token_hash = (SELECT token_hash FROM login_tokens WHERE email = ? AND used_at IS NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 1)
        AND attempts < ?
      RETURNING token_hash, code_hash`,
  ).bind(email, d.now, MAX_CODE_TRIES).first<{ token_hash: string; code_hash: string }>();
  if (!row || !safeEqual(row.code_hash, await codeHash(d.pepper, row.token_hash, rawCode))) return null;
  const used = await d.db.prepare('UPDATE login_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL RETURNING email')
    .bind(d.now, row.token_hash).first<{ email: string }>();
  return used ? signIn(d, used.email) : null;
}

/** The address is proven: find or create the account, retire its other sign-in emails, start a new session. */
async function signIn(d: AuthDeps, email: string): Promise<SignedIn> {
  const id = crypto.randomUUID();
  const ins = await d.db.prepare('INSERT INTO users (id, email, email_verified_at, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (email) DO NOTHING')
    .bind(id, email, d.now, d.now).run();
  const user = (await d.db.prepare('SELECT id FROM users WHERE email = ?').bind(email).first<{ id: string }>())!;
  await d.db.batch([
    d.db.prepare('INSERT INTO identities (provider, subject, user_id, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING').bind('email', email, user.id, d.now),
    d.db.prepare('UPDATE login_tokens SET used_at = ? WHERE email = ? AND used_at IS NULL').bind(d.now, email),
  ]);
  const s = await createSession(d.db, user.id, d.now);
  return { userId: user.id, email, token: s.token, expiresAt: s.expiresAt, created: ins.meta.changes === 1 };
}

/**
 * Delete an account: the user, their sign-in methods, sessions, pending sign-in emails and what they own. Their
 * purchase records stay, no longer linked to anyone (refunds and disputes still need them; how long sales records are
 * kept is a legal question). Stripe keeps its own copy of the customer; deleting that is a separate request to Stripe.
 */
export async function deleteAccount(db: D1Database, userId: string, email: string) {
  await db.batch([
    db.prepare('UPDATE purchases SET user_id = NULL WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM entitlements WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM stripe_customers WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM identities WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM login_tokens WHERE email = ?').bind(email),
    db.prepare('DELETE FROM users WHERE id = ?').bind(userId),
  ]);
}
