/**
 * Sessions: a random 256-bit token in an HttpOnly cookie; the database keeps only its SHA-256. A session lasts 30 days
 * from its last use (renewed at most once a day) and never more than 180 days from sign-in. Signing in always makes a
 * new session (no fixation); signing out deletes it; "sign out everywhere" deletes all of the user's.
 */
import type { D1Database } from './d1';
import { randomToken, sha256 } from './crypto';

export const SESSION_IDLE_MS = 30 * 86_400_000;
export const SESSION_MAX_MS = 180 * 86_400_000;
const RENEW_AFTER_MS = 86_400_000;

export interface Session { tokenHash: string; userId: string; email: string; createdAt: number; expiresAt: number }

export async function createSession(db: D1Database, userId: string, now: number): Promise<{ token: string; expiresAt: number }> {
  const token = randomToken(32);
  const expiresAt = now + SESSION_IDLE_MS;
  await db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?)')
    .bind(await sha256(token), userId, now, expiresAt, now).run();
  return { token, expiresAt };
}

/**
 * The session for a cookie token, or null (unknown, expired, or past its 180 days). `renewed` is the new expiry when
 * this use extended it, so the caller can refresh the cookie.
 */
export async function readSession(db: D1Database, token: string | null, now: number): Promise<(Session & { renewed?: number }) | null> {
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const tokenHash = await sha256(token);
  const row = await db.prepare(
    `SELECT s.token_hash, s.user_id, s.created_at, s.expires_at, s.last_seen_at, u.email
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`,
  ).bind(tokenHash).first<{ token_hash: string; user_id: string; created_at: number; expires_at: number; last_seen_at: number; email: string }>();
  if (!row) return null;
  if (row.expires_at <= now || now - row.created_at >= SESSION_MAX_MS) {
    await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
    return null;
  }
  const s: Session & { renewed?: number } = { tokenHash, userId: row.user_id, email: row.email, createdAt: row.created_at, expiresAt: row.expires_at };
  if (now - row.last_seen_at >= RENEW_AFTER_MS) {
    const expiresAt = Math.min(now + SESSION_IDLE_MS, row.created_at + SESSION_MAX_MS);
    await db.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?').bind(now, expiresAt, tokenHash).run();
    s.expiresAt = expiresAt;
    s.renewed = expiresAt;
  }
  return s;
}

export async function endSession(db: D1Database, tokenHash: string) {
  await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
}

export async function endAllSessions(db: D1Database, userId: string): Promise<number> {
  const r = await db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId).run();
  return r.meta.changes;
}
