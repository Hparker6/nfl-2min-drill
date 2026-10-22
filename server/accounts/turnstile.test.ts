/** The bot check: on only with a secret; the token must come back as real from Cloudflare; failures fail closed. */
import { describe, expect, it } from 'vitest';
import { accountsConfig } from './config';
import { isTestSecret, verifyTurnstile } from './turnstile';
import { call, inbox, testEnv } from './testing';

const T0 = Date.UTC(2026, 9, 20, 12);
const SECRET = '1x0000000000000000000000000000000AA';
const cloudflare = (ok: boolean, status = 200) => {
  const calls: { body: string }[] = [];
  const f = (async (url: string, init: RequestInit) => { expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify'); calls.push({ body: String(init.body) }); return new Response(JSON.stringify({ success: ok }), { status }); }) as unknown as typeof fetch;
  return { f, calls };
};

describe('Turnstile', () => {
  it('is off without a plausible secret', () => {
    expect(accountsConfig(testEnv())?.turnstile).toBeNull();
    expect(accountsConfig(testEnv({ TURNSTILE_SECRET: 'short' }))?.turnstile).toBeNull();
    expect(accountsConfig(testEnv({ TURNSTILE_SECRET: SECRET }))?.turnstile).toBe(SECRET);
  });
  it('asks Cloudflare with the secret, the token and the caller, and trusts only success:true', async () => {
    const c = cloudflare(true);
    expect(await verifyTurnstile(SECRET, 'XXXX.DUMMY.TOKEN.XXXX', '203.0.113.7', c.f)).toBe(true);
    expect(c.calls[0].body).toBe(`secret=${SECRET}&response=XXXX.DUMMY.TOKEN.XXXX&remoteip=203.0.113.7`);
    expect(await verifyTurnstile(SECRET, 'XXXX.DUMMY.TOKEN.XXXX', null, cloudflare(false).f)).toBe(false);
    expect(await verifyTurnstile(SECRET, 'XXXX.DUMMY.TOKEN.XXXX', null, cloudflare(true, 500).f)).toBe(false);
    const down = (async () => { throw new Error('net'); }) as unknown as typeof fetch;
    expect(await verifyTurnstile(SECRET, 'XXXX.DUMMY.TOKEN.XXXX', null, down)).toBe(false);
  });
  it('refuses a missing, short or odd token without calling anyone', async () => {
    const c = cloudflare(true);
    for (const t of [undefined, null, '', 'short', 'a'.repeat(3000), 'has spaces here', 42]) expect(await verifyTurnstile(SECRET, t, null, c.f), String(t)).toBe(false);
    expect(c.calls).toHaveLength(0);
  });
  it('gates the sign-in request and the support form when on, and not when off', async () => {
    const box = inbox();
    const on = testEnv({ TURNSTILE_SECRET: SECRET, SUPPORT_TO: 'o@game.test' });
    const bad = cloudflare(false), good = cloudflare(true);
    expect((await call(on, '/v1/auth/email/start', { body: { email: 'a@example.com' } }, { now: T0, mailer: box.mailer, fetch: bad.f })).status).toBe(403);
    expect(box.sent).toHaveLength(0);
    expect((await call(on, '/v1/auth/email/start', { body: { email: 'a@example.com', turnstile: 'XXXX.DUMMY.TOKEN.XXXX' } }, { now: T0, mailer: box.mailer, fetch: good.f })).status).toBe(200);
    expect(box.sent).toHaveLength(1);
    const support = { kind: 'bug', email: 'a@example.com', message: 'something is broken on the field view' };
    expect((await call(on, '/v1/support', { body: support }, { now: T0, fetch: bad.f, notifier: async () => true })).status).toBe(403);
    expect((await call(on, '/v1/support', { body: { ...support, turnstile: 'XXXX.DUMMY.TOKEN.XXXX' } }, { now: T0, fetch: good.f, notifier: async () => true })).status).toBe(200);
    const off = testEnv({ SUPPORT_TO: 'o@game.test' });
    expect((await call(off, '/v1/support', { body: support }, { now: T0, fetch: bad.f, notifier: async () => true })).status).toBe(200);
  });

  describe('a real secret also checks the form and the site the token was made for', () => {
    const REAL = '0x4AAAAAAAREALSECRETFORTESTSONLYxx';
    const reply = (o: Record<string, unknown>) => (async () => Response.json({ success: true, ...o })) as unknown as typeof fetch;
    const want = { action: 'signin', hostnames: ['nfl-2min-drill.com'] };
    it('accepts only the right action on one of our hostnames', async () => {
      expect(await verifyTurnstile(REAL, 'XXXX.DUMMY.TOKEN.XXXX', null, reply({ action: 'signin', hostname: 'nfl-2min-drill.com' }), want)).toBe(true);
      expect(await verifyTurnstile(REAL, 'XXXX.DUMMY.TOKEN.XXXX', null, reply({ action: 'support', hostname: 'nfl-2min-drill.com' }), want)).toBe(false);
      expect(await verifyTurnstile(REAL, 'XXXX.DUMMY.TOKEN.XXXX', null, reply({ action: 'signin', hostname: 'evil.example' }), want)).toBe(false);
      expect(await verifyTurnstile(REAL, 'XXXX.DUMMY.TOKEN.XXXX', null, reply({ action: 'signin' }), want)).toBe(false);
      expect(await verifyTurnstile(REAL, 'XXXX.DUMMY.TOKEN.XXXX', null, reply({}), want)).toBe(false);
    });
    it('Cloudflare test secrets skip those two checks (their answers carry a placeholder hostname); real ones never do', () => {
      expect(isTestSecret('1x0000000000000000000000000000000AA')).toBe(true);
      expect(isTestSecret('2x0000000000000000000000000000000AA')).toBe(true);
      expect(isTestSecret(REAL)).toBe(false);
    });
    it('the routes ask for the sign-in action on the sign-in form and the support action on the support form, on our host', async () => {
      const seen: string[] = [];
      const env = testEnv({ TURNSTILE_SECRET: REAL, SUPPORT_TO: 'o@game.test' });
      const f = ((action: string) => (async () => { seen.push(action); return Response.json({ success: true, action, hostname: 'game.test' }); }) as unknown as typeof fetch);
      const box = inbox();
      expect((await call(env, '/v1/auth/email/start', { body: { email: 'a@example.com', turnstile: 'XXXX.DUMMY.TOKEN.XXXX' } }, { now: T0, mailer: box.mailer, fetch: f('signin') })).status).toBe(200);
      expect((await call(env, '/v1/auth/email/start', { body: { email: 'b@example.com', turnstile: 'XXXX.DUMMY.TOKEN.XXXX' } }, { now: T0, mailer: box.mailer, fetch: f('support') })).status).toBe(403);
      const support = { kind: 'bug', email: 'a@example.com', message: 'something is broken on the field view', turnstile: 'XXXX.DUMMY.TOKEN.XXXX' };
      expect((await call(env, '/v1/support', { body: support }, { now: T0, fetch: f('support'), notifier: async () => true })).status).toBe(200);
      expect((await call(env, '/v1/support', { body: support }, { now: T0, fetch: f('signin'), notifier: async () => true })).status).toBe(403);
      expect(seen.length).toBe(4);
    });
  });
});
