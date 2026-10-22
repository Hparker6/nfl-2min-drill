/** Fixed-window rate limits, counted in D1 under hashed keys. */
import type { D1Database } from './d1';

export interface Limit { name: string; max: number; windowSec: number }

/** The limits. Sign-in links per email are deliberately few: each one is an email to a real inbox. */
export const LIMITS = {
  startPerEmail15m: { name: 'start-email-15m', max: 3, windowSec: 900 },
  startPerEmailDay: { name: 'start-email-day', max: 10, windowSec: 86400 },
  startPerAddress: { name: 'start-addr-15m', max: 10, windowSec: 900 },
  verifyPerAddress: { name: 'verify-addr-15m', max: 30, windowSec: 900 },
  codePerEmailHour: { name: 'code-email-1h', max: 10, windowSec: 3600 },
  checkoutPerUser: { name: 'checkout-user-1h', max: 10, windowSec: 3600 },
  supportPerAddress: { name: 'support-addr-1h', max: 5, windowSec: 3600 },
  supportPerEmailDay: { name: 'support-email-day', max: 5, windowSec: 86400 },
} satisfies Record<string, Limit>;

/** Count one hit. True while it's within the limit. */
export async function hit(db: D1Database, limit: Limit, key: string, now: number): Promise<boolean> {
  const len = limit.windowSec * 1000;
  const win = Math.floor(now / len) * len;   // the window's start time
  const row = await db.prepare(
    `INSERT INTO rate_limits (key, win, count) VALUES (?, ?, 1)
     ON CONFLICT (key, win) DO UPDATE SET count = count + 1 RETURNING count`,
  ).bind(`${limit.name}:${key}`, win).first<{ count: number }>();
  return (row?.count ?? 1) <= limit.max;
}

/** Drop what's no longer needed: old counters, used or expired sign-in tokens, expired sessions. */
export async function sweep(db: D1Database, now: number) {
  await db.batch([
    db.prepare('DELETE FROM rate_limits WHERE win < ?').bind(now - 2 * 86_400_000),
    db.prepare('DELETE FROM login_tokens WHERE expires_at < ?').bind(now - 86_400_000),
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now),
  ]);
}
