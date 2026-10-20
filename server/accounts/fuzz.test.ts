/**
 * Garbage in, never a 500 out: every account route is hit with hundreds of random bodies, headers and cookies. The
 * only acceptable answers are the documented 4xx ones (or 200/503 where the route allows), and nothing an attacker
 * sent may come back in a response or a log line.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { call, inbox, testEnv } from './testing';
import { hash, rng } from '../../src/engine/rng';

const T0 = Date.UTC(2026, 9, 20, 12);
const ROUTES = ['/v1/auth/email/start', '/v1/auth/email/verify', '/v1/auth/logout', '/v1/auth/logout-all', '/v1/me', '/v1/me/delete', '/v1/checkout', '/v1/checkout/status?session_id=cs_test_abcdefghijk', '/v1/stripe/webhook', '/v1/support', '/v1/auth/nothing', '/v1/me/../me'];
const STRINGS = ['', ' ', 'a', 'x'.repeat(5000), '\u0000', '‮', '😀'.repeat(100), '<script>alert(1)</script>', "' OR 1=1 --", '{"__proto__":{"a":1}}', 'null', '0', '-1', '1e309', 'pat@example.com', 'PAT@EXAMPLE.COM ', '123456', 'cs_test_x', 'evt_1', '../../etc/passwd', '%00', 'a'.repeat(254) + '@b.co'];
const KEYS = ['email', 'code', 'token', 'kind', 'message', 'page', 'website', 'turnstile', 'session_id', 'id', 'type', 'data', 'livemode', 'constructor', '__proto__'];

function randomBody(r: () => number): unknown {
  const pick = <T>(a: T[]) => a[Math.floor(r() * a.length)];
  const kind = r();
  if (kind < 0.1) return null;
  if (kind < 0.2) return pick(STRINGS);
  if (kind < 0.3) return [pick(STRINGS), 1, null];
  const o: Record<string, unknown> = {};
  const n = 1 + Math.floor(r() * 5);
  for (let i = 0; i < n; i++) {
    const v = r();
    o[pick(KEYS)] = v < 0.5 ? pick(STRINGS) : v < 0.7 ? Math.floor(r() * 1e6) : v < 0.8 ? { nested: pick(STRINGS) } : v < 0.9 ? [pick(STRINGS)] : r() < 0.5;
  }
  return o;
}

let logs: string[] = [];
beforeEach(() => { logs = []; for (const k of ['log', 'warn', 'error', 'info'] as const) vi.spyOn(console, k).mockImplementation((...a: unknown[]) => { logs.push(a.map(String).join(' ')); }); });
afterEach(() => vi.restoreAllMocks());

describe('fuzzing the account routes', () => {
  it('answers every random request with a documented status and never a 500', async () => {
    const env = testEnv({ SUPPORT_TO: 'o@game.test', PAYMENTS: 'on', STRIPE_SECRET_KEY: 'sk_test_fuzz1234567890', STRIPE_WEBHOOK_SECRET: 'whsec_fuzz1234567890', STRIPE_PRICE_ID: 'price_fuzz' });
    const box = inbox();
    const stripeDown = (async () => new Response('{}', { status: 503 })) as unknown as typeof fetch;
    const r = rng(hash('fuzz', 1));
    const seen = new Map<string, Set<number>>();
    for (let i = 0; i < 600; i++) {
      const path = ROUTES[i % ROUTES.length];
      const body = randomBody(r);
      const method = r() < 0.15 ? (['GET', 'PUT', 'DELETE', 'PATCH', 'HEAD'] as const)[Math.floor(r() * 5)] : undefined;
      const headers: Record<string, string> = {};
      if (r() < 0.2) headers['content-type'] = STRINGS[Math.floor(r() * STRINGS.length)].replace(/[^!-~ ]/g, '') || 'text/plain';
      if (r() < 0.2) headers['content-length'] = String(Math.floor(r() * 1e9));
      if (r() < 0.2) headers['stripe-signature'] = 't=' + Math.floor(T0 / 1000) + ',v1=' + 'ab'.repeat(32);
      // a cookie must be a legal header value (a browser can't send anything else); the server sees the odd ones
      const cookie = r() < 0.3 ? STRINGS[Math.floor(r() * STRINGS.length)].replace(/[^!-~]/g, '') || null : null;
      const origin = r() < 0.15 ? 'https://evil.example' : undefined;
      const raw = r() < 0.1 ? STRINGS[Math.floor(r() * STRINGS.length)] : undefined;
      let res;
      try {
        res = await call(env, path, { body: raw === undefined ? body : undefined, raw, method, headers, cookie, origin }, { now: T0 + i * 1000, mailer: box.mailer, fetch: stripeDown, notifier: async () => true });
      } catch (e) {
        throw new Error(`threw on ${path} with ${JSON.stringify(body).slice(0, 80)}: ${(e as Error).message}`);
      }
      expect(res.status, `${path} ${JSON.stringify(body).slice(0, 60)}`).not.toBe(500);
      expect([200, 400, 401, 403, 404, 405, 409, 413, 429, 502, 503]).toContain(res.status);
      // nothing an attacker typed comes back verbatim in the answer (the answers are fixed sentences)
      const out = JSON.stringify(res.body);
      for (const s of ['<script>', "' OR 1=1", '../../', '__proto__']) expect(out).not.toContain(s);
      const key = path.split('?')[0];
      if (!seen.has(key)) seen.set(key, new Set());
      seen.get(key)!.add(res.status);
    }
    // the logs carry statuses and reasons, never the attacker's strings or an address
    const all = logs.join('\n');
    for (const s of ['<script>', "' OR 1=1", 'pat@example.com', '../../etc']) expect(all, 'logs').not.toContain(s);
    console.log([...seen].map(([k, v]) => `${k}: ${[...v].sort().join(',')}`).join('\n'));
    console.log(`sign-in emails the fuzz happened to trigger: ${box.sent.length}`);   // informational: random bodies rarely form a valid request
  }, 120_000);
});
