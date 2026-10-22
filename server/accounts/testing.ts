/**
 * Tests only: D1's API over Node's built-in SQLite, with the real migrations applied, plus helpers to call the routes
 * the way a browser would. D1 enforces foreign keys, so this does too.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { D1Database, D1PreparedStatement, D1Result, D1Value } from './d1';
import { handleAccounts, type RouteOpts } from './routes';
import type { AccountsEnv } from './config';
import type { SignInEmail } from './mailer';

const MIGRATIONS = new URL('../db/migrations/', import.meta.url);

export function testDb(): D1Database & { raw: DatabaseSync } {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON');
  for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith('.sql')).sort()) raw.exec(readFileSync(new URL(f, MIGRATIONS), 'utf8'));
  const stmt = (sql: string, args: D1Value[] = []): D1PreparedStatement & { exec(): D1Result } => ({
    bind: (...v: D1Value[]) => stmt(sql, v),
    exec() {
      const s = raw.prepare(sql);
      if (/\bRETURNING\b|^\s*SELECT/i.test(sql)) {
        const rows = s.all(...args) as Record<string, unknown>[];
        return { results: rows, success: true, meta: { changes: rows.length } };
      }
      const r = s.run(...args);
      return { results: [], success: true, meta: { changes: Number(r.changes) } };
    },
    async first<T>() { return ((this.exec().results[0] ?? null) as T | null); },
    async all<T>() { return this.exec() as D1Result<T>; },
    async run() { return this.exec(); },
  });
  return {
    raw,
    prepare: (sql) => stmt(sql),
    async batch(list) {
      raw.exec('BEGIN');
      try {
        const out = list.map((s) => (s as ReturnType<typeof stmt>).exec());
        raw.exec('COMMIT');
        return out;
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      }
    },
  };
}

export const ORIGIN = 'https://game.test';
export const PEPPER = 'test-pepper-0123456789-abcdefghijklmnop';

export function testEnv(extra: Partial<AccountsEnv> = {}): AccountsEnv & { DB: ReturnType<typeof testDb> } {
  return { DB: testDb(), ACCOUNTS: 'on', SITE_ORIGIN: ORIGIN, AUTH_PEPPER: PEPPER, ...extra } as AccountsEnv & { DB: ReturnType<typeof testDb> };
}

/** A mailer that keeps what it "sends". */
export function inbox() {
  const sent: SignInEmail[] = [];
  return { sent, mailer: { send: async (m: SignInEmail) => { sent.push(m); return true; } }, last: () => sent[sent.length - 1] };
}

export interface Call { method?: string; body?: unknown; cookie?: string | null; origin?: string | null; ip?: string; headers?: Record<string, string>; raw?: string }

/** Call a route as a browser on our site would (override any part to act as someone else). */
export async function call(env: AccountsEnv, path: string, c: Call, opts: RouteOpts) {
  const method = c.method ?? (c.body !== undefined || c.raw !== undefined ? 'POST' : 'GET');
  const headers: Record<string, string> = { 'cf-connecting-ip': c.ip ?? '203.0.113.7', ...(c.headers ?? {}) };
  if (method === 'POST') {
    if (c.origin !== null) headers.origin = c.origin ?? ORIGIN;
    if (!('content-type' in headers)) headers['content-type'] = 'application/json';
  }
  if (c.cookie) headers.cookie = `__Host-4c_sid=${c.cookie}`;
  const url = new URL(path, ORIGIN);
  const req = new Request(url, { method, headers, body: method === 'POST' ? (c.raw ?? JSON.stringify(c.body ?? {})) : undefined });
  const res = await handleAccounts(req, env, url, { random: () => 1, ...opts });
  const setCookie = res.headers.get('set-cookie');
  const cookie = setCookie?.match(/__Host-4c_sid=([^;]*)/)?.[1] ?? null;
  return { status: res.status, body: await res.json() as Record<string, unknown>, setCookie, cookie, headers: res.headers };
}

/** Sign in by the emailed link; returns the session cookie value. */
export async function signInAs(env: AccountsEnv, email: string, opts: RouteOpts & { mailer: { send: (m: SignInEmail) => Promise<boolean> } }, box: ReturnType<typeof inbox>, ip?: string): Promise<string> {
  const s = await call(env, '/v1/auth/email/start', { body: { email }, ip }, opts);
  if (s.status !== 200) throw new Error(`start ${s.status}`);
  const token = box.last().link.split('#signin=')[1];
  const v = await call(env, '/v1/auth/email/verify', { body: { token }, ip }, opts);
  if (v.status !== 200 || !v.cookie) throw new Error(`verify ${v.status}`);
  return v.cookie;
}
