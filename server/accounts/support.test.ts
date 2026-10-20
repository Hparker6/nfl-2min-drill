/** The help & refunds form: validation, the honeypot, rate limits, storage before notification, the notice itself. */
import { describe, expect, it } from 'vitest';
import { call, inbox, signInAs, testEnv } from './testing';
import { cleanText, parseSupport } from './support';
import type { Notice } from './mailer';

const T0 = Date.UTC(2026, 9, 20, 12);
const good = { kind: 'refund', email: 'Pat@Example.com', message: 'I bought this yesterday by mistake, please refund it.', page: 'daily' };

function notices() {
  const sent: Notice[] = [];
  return { sent, notifier: async (n: Notice) => { sent.push(n); return true; } };
}

describe('the support form', () => {
  it('stores the request, numbers it, and emails the owner with reply-to set to the player', async () => {
    const env = testEnv({ SUPPORT_TO: 'owner@game.test' });
    const n = notices();
    const r = await call(env, '/v1/support', { body: good }, { now: T0, notifier: n.notifier });
    expect(r.status).toBe(200);
    expect(r.body.ref).toMatch(/^[0-9A-F]{8}$/);
    const row = env.DB.raw.prepare('SELECT kind, email, user_id, message, page, status, notified_at FROM support_requests').get() as Record<string, unknown>;
    expect(row).toMatchObject({ kind: 'refund', email: 'pat@example.com', user_id: null, message: good.message, page: 'daily', status: 'open', notified_at: T0 });
    expect(n.sent).toHaveLength(1);
    expect(n.sent[0]).toMatchObject({ to: 'owner@game.test', replyTo: 'pat@example.com' });
    expect(n.sent[0].subject).toContain(String(r.body.ref));
    expect(n.sent[0].text).toContain(good.message);
    expect(n.sent[0].text).toContain('no account signed in');
  });

  it('is kept even when the owner cannot be notified', async () => {
    const env = testEnv({ SUPPORT_TO: 'owner@game.test' });
    const r = await call(env, '/v1/support', { body: good }, { now: T0, notifier: async () => false });
    expect(r.status).toBe(200);
    const row = env.DB.raw.prepare('SELECT notified_at FROM support_requests').get() as { notified_at: number | null };
    expect(row.notified_at).toBeNull();
  });

  it('matches a signed-in player to their purchase', async () => {
    const env = testEnv({ SUPPORT_TO: 'owner@game.test' });
    const box = inbox();
    const cookie = await signInAs(env, 'buyer@example.com', { now: T0, mailer: box.mailer }, box);
    const uid = (env.DB.raw.prepare('SELECT id FROM users').get() as { id: string }).id;
    env.DB.raw.prepare("INSERT INTO purchases (id, user_id, product, checkout_session_id, payment_intent_id, amount, currency, livemode, status, created_at, updated_at) VALUES ('p1', ?, 'coach_edition', 'cs_test_x', 'pi_x', 499, 'usd', 0, 'paid', ?, ?)").run(uid, T0 - 86_400_000, T0);
    const n = notices();
    const r = await call(env, '/v1/support', { body: { ...good, email: 'buyer@example.com' }, cookie }, { now: T0, notifier: n.notifier });
    expect(r.status).toBe(200);
    expect(n.sent[0].text).toContain('Signed in: yes');
    expect(n.sent[0].text).toContain('paid, 4.99 USD');
    expect((env.DB.raw.prepare('SELECT user_id FROM support_requests').get() as { user_id: string }).user_id).toBe(uid);
  });

  it('rejects bad input with a field-specific message and stores nothing', async () => {
    const env = testEnv({ SUPPORT_TO: 'owner@game.test' });
    const n = notices();
    const cases: [Record<string, unknown>, number, string][] = [
      [{ ...good, kind: 'lawsuit' }, 400, 'form'],
      [{ ...good, email: 'nope' }, 400, 'email'],
      [{ ...good, message: 'short' }, 400, '10 and 2000'],
      [{ ...good, message: 'x'.repeat(2001) }, 400, '10 and 2000'],
      [{ ...good, message: 12345 }, 400, '10 and 2000'],
    ];
    for (const [body, status, text] of cases) {
      const r = await call(env, '/v1/support', { body }, { now: T0, notifier: n.notifier });
      expect(r.status, JSON.stringify(body).slice(0, 40)).toBe(status);
      expect(String(r.body.error)).toContain(text);
    }
    expect(env.DB.raw.prepare('SELECT count(*) AS n FROM support_requests').get()).toEqual({ n: 0 });
    expect(n.sent).toHaveLength(0);
  });

  it('swallows a filled honeypot: a bot is told it worked, nothing is stored or sent', async () => {
    const env = testEnv({ SUPPORT_TO: 'owner@game.test' });
    const n = notices();
    const r = await call(env, '/v1/support', { body: { ...good, website: 'http://spam.example' } }, { now: T0, notifier: n.notifier });
    expect(r.status).toBe(200);
    expect(env.DB.raw.prepare('SELECT count(*) AS n FROM support_requests').get()).toEqual({ n: 0 });
    expect(n.sent).toHaveLength(0);
  });

  it('limits a caller to five an hour and an address to five a day', async () => {
    const env = testEnv({ SUPPORT_TO: 'owner@game.test' });
    const n = notices();
    for (let i = 0; i < 5; i++) expect((await call(env, '/v1/support', { body: { ...good, email: `p${i}@example.com` } }, { now: T0, notifier: n.notifier })).status).toBe(200);
    expect((await call(env, '/v1/support', { body: { ...good, email: 'p9@example.com' } }, { now: T0, notifier: n.notifier })).status).toBe(429);
    // another caller, the same address, five times across the day
    for (let i = 0; i < 5; i++) expect((await call(env, '/v1/support', { body: good, ip: `198.51.100.${i}` }, { now: T0 + i * 3_600_000, notifier: n.notifier })).status).toBe(200);
    expect((await call(env, '/v1/support', { body: good, ip: '198.51.100.99' }, { now: T0 + 6 * 3_600_000, notifier: n.notifier })).status).toBe(429);
  });

  it('must come from our site as JSON, like every other write', async () => {
    const env = testEnv({ SUPPORT_TO: 'owner@game.test' });
    expect((await call(env, '/v1/support', { body: good, origin: 'https://evil.example' }, { now: T0 })).status).toBe(403);
    expect((await call(env, '/v1/support', { body: good, headers: { 'content-type': 'text/plain' } }, { now: T0 })).status).toBe(403);
  });

  it('strips control characters and keeps the message as plain text', () => {
    expect(cleanText('hi\u0000there\u001b[31m\r\nok  ', 100)).toBe('hithere[31m\nok');
    const p = parseSupport({ kind: 'bug', email: 'a@b.co', message: '<script>alert(1)</script> but long enough', page: 'x'.repeat(500) });
    expect(p.ok && p.input.message).toContain('<script>');   // stored as text; it is escaped wherever it is shown
    expect(p.ok && p.input.page?.length).toBe(120);
  });
});
