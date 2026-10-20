/**
 * Phase 2: the Coach's Edition purchase in Stripe test mode. Ownership comes only from a verified webhook about a
 * checkout Stripe's API confirms; duplicates and replays change nothing; refunds and disputes revoke; the server-side
 * switch keeps checkout closed unless turned on; live keys are refused.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { hmacSha256 } from './crypto';
import { accountsConfig, LIVE_PAYMENTS_ALLOWED, paymentsConfig } from './config';
import { call, inbox, signInAs, testEnv } from './testing';
import { encodeForm, verifyStripeSignature } from './stripe';
import { entitlementFor } from './purchases';

const T0 = Date.UTC(2026, 9, 20, 12);
const MIN = 60_000;
const SECRET = 'whsec_testsecret123';
const PAY = { PAYMENTS: 'on', STRIPE_SECRET_KEY: 'sk_test_abc123', STRIPE_WEBHOOK_SECRET: SECRET, STRIPE_PRICE_ID: 'price_coach499' };

/** A pretend Stripe: objects by id, and a log of every API call. */
function fakeStripe() {
  const objects = new Map<string, Record<string, unknown>>();
  const calls: { method: string; url: string; body: string; headers: Record<string, string> }[] = [];
  let n = 0;
  const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input), method = init?.method ?? 'GET';
    calls.push({ method, url, body: String(init?.body ?? ''), headers: (init?.headers ?? {}) as Record<string, string> });
    const path = new URL(url).pathname;
    if (method === 'POST' && path === '/v1/checkout/sessions') {
      const id = `cs_test_session${++n}abcdef`;
      return Response.json({ id, url: `https://checkout.stripe.com/c/pay/${id}` });
    }
    const id = decodeURIComponent(path.split('/').pop()!);
    const o = objects.get(id);
    return o ? Response.json(o) : Response.json({ error: { message: 'No such object' } }, { status: 404 });
  }) as typeof fetch;
  return { objects, calls, fetch: fakeFetch };
}

/** A completed, paid checkout as Stripe's API would return it (expanded line items). */
const session = (userId: string, o: Record<string, unknown> = {}) => ({
  id: 'cs_test_paid0001abcdef', object: 'checkout.session', mode: 'payment', status: 'complete', payment_status: 'paid', livemode: false,
  amount_total: 499, currency: 'usd', client_reference_id: userId, customer: 'cus_test_1', payment_intent: 'pi_test_1',
  metadata: { user_id: userId, product: 'coach_edition' }, line_items: { data: [{ quantity: 1, price: { id: 'price_coach499' } }] }, ...o,
});

async function signed(body: string, now: number, secret = SECRET) {
  const t = Math.floor(now / 1000);
  return `t=${t},v1=${await hmacSha256(secret, `${t}.${body}`)}`;
}

let evN = 0;
async function webhook(env: ReturnType<typeof testEnv>, f: typeof fetch, type: string, objectId: string, now: number, o: { id?: string; livemode?: boolean; sig?: string; secret?: string } = {}) {
  const body = JSON.stringify({ id: o.id ?? `evt_test_${++evN}`, type, livemode: o.livemode ?? false, data: { object: { id: objectId } } });
  return call(env, '/v1/stripe/webhook', { raw: body, origin: null, headers: { 'stripe-signature': o.sig ?? await signed(body, now, o.secret) } }, { now, fetch: f });
}

function world() {
  const env = testEnv(PAY);
  const box = inbox();
  const stripe = fakeStripe();
  const at = (now: number) => ({ now, mailer: box.mailer, fetch: stripe.fetch });
  const userId = async (cookie: string) => (await call(env, '/v1/me', { cookie }, at(T0))).body;
  const idOf = (email: string) => (env.DB.raw.prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: string }).id;
  return { env, box, stripe, at, userId, idOf };
}

beforeEach(() => { evN = 0; });

describe('switches', () => {
  it('payments are off unless PAYMENTS is on with well-formed Stripe settings', () => {
    expect(paymentsConfig({})).toBeNull();
    expect(paymentsConfig({ ...PAY, PAYMENTS: 'off' })).toBeNull();
    expect(paymentsConfig({ ...PAY, STRIPE_PRICE_ID: '' })).toBeNull();
    expect(paymentsConfig({ ...PAY, STRIPE_WEBHOOK_SECRET: 'nope' })).toBeNull();
    expect(paymentsConfig(PAY)).toMatchObject({ live: false, priceId: 'price_coach499' });
  });

  it('live Stripe keys are refused while live payments are not allowed in code', () => {
    expect(LIVE_PAYMENTS_ALLOWED).toBe(false);
    expect(paymentsConfig({ ...PAY, STRIPE_SECRET_KEY: 'sk_live_abc' })).toBeNull();
    expect(paymentsConfig({ ...PAY, STRIPE_SECRET_KEY: 'rk_live_abc' })).toBeNull();
    expect(accountsConfig(testEnv({ ...PAY, STRIPE_SECRET_KEY: 'sk_live_abc' }))?.payments).toBeNull();
  });

  it('with payments off: checkout is closed, the webhook does not exist, /v1/me says off', async () => {
    const env = testEnv();
    const box = inbox();
    const at = (now: number) => ({ now, mailer: box.mailer });
    const cookie = await signInAs(env, 'pat@example.com', at(T0), box);
    expect((await call(env, '/v1/checkout', { body: {}, cookie }, at(T0))).status).toBe(503);
    expect((await call(env, '/v1/stripe/webhook', { raw: '{}', origin: null }, at(T0))).status).toBe(404);
    expect((await call(env, '/v1/me', { cookie }, at(T0))).body.payments).toBe('off');
  });
});

describe('starting a checkout', () => {
  it('needs a session and our origin', async () => {
    const { env, at, box } = world();
    expect((await call(env, '/v1/checkout', { body: {} }, at(T0))).status).toBe(401);
    const cookie = await signInAs(env, 'pat@example.com', at(T0), box);
    expect((await call(env, '/v1/checkout', { body: {}, cookie, origin: 'https://evil.example' }, at(T0))).status).toBe(403);
  });

  it('is made by the server at the fixed price, card only, tied to the user, with an idempotency key', async () => {
    const { env, at, box, stripe, idOf } = world();
    const cookie = await signInAs(env, 'pat@example.com', at(T0), box);
    // whatever the browser sends is ignored: price, amount, product
    const r = await call(env, '/v1/checkout', { body: { price: 'price_free', amount: 1, product: 'everything' }, cookie }, at(T0));
    expect(r.status).toBe(200);
    expect(r.body.url).toMatch(/^https:\/\/checkout\.stripe\.com\//);
    const c = stripe.calls.find((x) => x.method === 'POST')!;
    const form = new URLSearchParams(c.body);
    const uid = idOf('pat@example.com');
    expect(form.get('mode')).toBe('payment');
    expect(form.get('line_items[0][price]')).toBe('price_coach499');
    expect(form.get('line_items[0][quantity]')).toBe('1');
    expect(form.get('payment_method_types[0]')).toBe('card');
    expect(form.get('client_reference_id')).toBe(uid);
    expect(form.get('metadata[user_id]')).toBe(uid);
    expect(form.get('payment_intent_data[metadata][product]')).toBe('coach_edition');
    expect(form.get('customer_email')).toBe('pat@example.com');
    expect(form.get('success_url')).toBe('https://game.test/#purchase={CHECKOUT_SESSION_ID}');
    expect(c.body).not.toContain('price_free');
    expect(c.headers['idempotency-key']).toMatch(/^checkout:/);
    expect(c.headers.authorization).toBe('Bearer sk_test_abc123');
  });
});

describe('the webhook', () => {
  it('refuses unsigned, wrongly signed, stale, oversized and wrong-mode events', async () => {
    const { env, stripe } = world();
    const body = JSON.stringify({ id: 'evt_x', type: 'checkout.session.completed', livemode: false, data: { object: { id: 'cs_test_paid0001abcdef' } } });
    const tries: { headers: Record<string, string> }[] = [
      { headers: {} },
      { headers: { 'stripe-signature': await signed(body, T0, 'whsec_wrong') } },
      { headers: { 'stripe-signature': await signed(body, T0 - 10 * MIN) } },
      { headers: { 'stripe-signature': (await signed(body, T0)).replace(/v1=./, 'v1=0') } },
    ];
    for (const t of tries) expect((await call(env, '/v1/stripe/webhook', { raw: body, origin: null, ...t }, { now: T0, fetch: stripe.fetch })).status).toBe(400);
    const big = JSON.stringify({ pad: 'x'.repeat(300 * 1024) });
    expect((await call(env, '/v1/stripe/webhook', { raw: big, origin: null, headers: { 'stripe-signature': await signed(big, T0) } }, { now: T0, fetch: stripe.fetch })).status).toBe(413);
    expect((await webhook(env, stripe.fetch, 'checkout.session.completed', 'cs_x', T0, { livemode: true })).status).toBe(400);
    expect(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM webhook_events').get()).toEqual({ n: 0 });
  });

  it('a paid checkout grants the edition; the account and status endpoint show it', async () => {
    const { env, at, box, stripe, idOf } = world();
    const cookie = await signInAs(env, 'pat@example.com', at(T0), box);
    stripe.objects.set('cs_test_paid0001abcdef', session(idOf('pat@example.com')));
    const before = await call(env, '/v1/checkout/status?session_id=cs_test_paid0001abcdef', { cookie }, at(T0));
    expect(before.body).toEqual({ found: false, owns: false });
    const w = await webhook(env, stripe.fetch, 'checkout.session.completed', 'cs_test_paid0001abcdef', T0);
    expect(w).toMatchObject({ status: 200, body: { received: true, outcome: 'granted' } });
    expect((await call(env, '/v1/me', { cookie }, at(T0))).body.owns).toEqual(['coach_edition']);
    const after = await call(env, '/v1/checkout/status?session_id=cs_test_paid0001abcdef', { cookie }, at(T0));
    expect(after.body).toEqual({ found: true, status: 'paid', owns: true });
    expect((await call(env, '/v1/checkout', { body: {}, cookie }, at(T0))).status).toBe(409);
  });

  it('the same event again, or a second event about the same checkout, changes nothing', async () => {
    const { env, at, box, stripe, idOf } = world();
    await signInAs(env, 'pat@example.com', at(T0), box);
    stripe.objects.set('cs_test_paid0001abcdef', session(idOf('pat@example.com')));
    await webhook(env, stripe.fetch, 'checkout.session.completed', 'cs_test_paid0001abcdef', T0, { id: 'evt_same' });
    const again = await webhook(env, stripe.fetch, 'checkout.session.completed', 'cs_test_paid0001abcdef', T0 + MIN, { id: 'evt_same' });
    expect(again.body).toEqual({ received: true, duplicate: true });
    await webhook(env, stripe.fetch, 'checkout.session.async_payment_succeeded', 'cs_test_paid0001abcdef', T0 + MIN, { id: 'evt_other' });
    const q = (sql: string) => env.DB.raw.prepare(sql).get();
    expect(q('SELECT COUNT(*) AS n FROM purchases')).toEqual({ n: 1 });
    expect(q('SELECT COUNT(*) AS n FROM entitlements')).toEqual({ n: 1 });
    expect(q('SELECT COUNT(*) AS n FROM webhook_events')).toEqual({ n: 2 });
  });

  it('the event body is not trusted: what Stripe’s API says now decides', async () => {
    const { env, at, box, stripe, idOf } = world();
    const cookie = await signInAs(env, 'pat@example.com', at(T0), box);
    const uid = idOf('pat@example.com');
    const bad: [string, Record<string, unknown>][] = [
      ['not paid', { payment_status: 'unpaid' }], ['not paid', { status: 'open' }], ['wrong amount', { amount_total: 1 }],
      ['wrong amount', { currency: 'eur' }], ['wrong item', { line_items: { data: [{ quantity: 1, price: { id: 'price_other' } }] } }],
      ['wrong item', { line_items: { data: [{ quantity: 2, price: { id: 'price_coach499' } }] } }], ['wrong product', { metadata: { user_id: uid, product: 'other' } }],
      ['no user', { metadata: { user_id: 'someone-else', product: 'coach_edition' } }], ['not a payment', { mode: 'subscription' }], ['wrong mode', { livemode: true }],
    ];
    for (const [why, o] of bad) {
      stripe.objects.set('cs_test_paid0001abcdef', session(uid, o));
      const w = await webhook(env, stripe.fetch, 'checkout.session.completed', 'cs_test_paid0001abcdef', T0);
      expect(w.body.outcome, JSON.stringify(o)).toBe(`ignored: ${why}`);
    }
    expect((await call(env, '/v1/me', { cookie }, at(T0))).body.owns).toEqual([]);
    expect(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM purchases').get()).toEqual({ n: 0 });
  });

  it('a checkout Stripe doesn’t know (a forged session id) grants nothing, and Stripe is asked to retry if it is down', async () => {
    const { env, at, box, stripe } = world();
    const cookie = await signInAs(env, 'pat@example.com', at(T0), box);
    const w = await webhook(env, stripe.fetch, 'checkout.session.completed', 'cs_test_madeupabcdef', T0);
    expect(w.body).toMatchObject({ received: true, outcome: 'ignored: Stripe has no such object' });
    const down = (async () => Response.json({}, { status: 503 })) as unknown as typeof fetch;
    expect((await webhook(env, down, 'checkout.session.completed', 'cs_test_paid0001abcdef', T0)).status).toBe(503);
    expect((await call(env, '/v1/me', { cookie }, at(T0))).body.owns).toEqual([]);
    expect(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM purchases').get()).toEqual({ n: 0 });
    expect(env.DB.raw.prepare('SELECT outcome FROM webhook_events').all()).toEqual([{ outcome: 'ignored: Stripe has no such object' }]);
  });
});

describe('refunds and disputes', () => {
  async function bought() {
    const w = world();
    const cookie = await signInAs(w.env, 'pat@example.com', w.at(T0), w.box);
    w.stripe.objects.set('cs_test_paid0001abcdef', session(w.idOf('pat@example.com')));
    await webhook(w.env, w.stripe.fetch, 'checkout.session.completed', 'cs_test_paid0001abcdef', T0);
    const owns = async () => (await call(w.env, '/v1/me', { cookie }, w.at(T0))).body.owns;
    const status = () => (w.env.DB.raw.prepare('SELECT status FROM purchases').get() as { status: string }).status;
    return { ...w, cookie, owns, status };
  }

  it('a full refund revokes; a partial one does not', async () => {
    const a = await bought();
    a.stripe.objects.set('ch_1', { id: 'ch_1', payment_intent: 'pi_test_1', amount: 499, amount_refunded: 100, refunded: false });
    await webhook(a.env, a.stripe.fetch, 'charge.refunded', 'ch_1', T0);
    expect(a.status()).toBe('partially_refunded');
    expect(await a.owns()).toEqual(['coach_edition']);
    a.stripe.objects.set('ch_1', { id: 'ch_1', payment_intent: 'pi_test_1', amount: 499, amount_refunded: 499, refunded: true });
    await webhook(a.env, a.stripe.fetch, 'charge.refunded', 'ch_1', T0 + MIN);
    expect(a.status()).toBe('refunded');
    expect(await a.owns()).toEqual([]);
    const e = a.env.DB.raw.prepare('SELECT status, revoked_at, reason FROM entitlements').get();
    expect(e).toEqual({ status: 'revoked', revoked_at: T0 + MIN, reason: 'refunded' });
  });

  it('a dispute suspends it; won restores it; lost revokes it', async () => {
    const a = await bought();
    const dispute = (status: string) => a.stripe.objects.set('dp_1', { id: 'dp_1', payment_intent: 'pi_test_1', charge: 'ch_1', status });
    dispute('needs_response');
    await webhook(a.env, a.stripe.fetch, 'charge.dispute.created', 'dp_1', T0);
    expect([a.status(), await a.owns()]).toEqual(['disputed', []]);
    dispute('won');
    await webhook(a.env, a.stripe.fetch, 'charge.dispute.closed', 'dp_1', T0 + MIN);
    expect([a.status(), await a.owns()]).toEqual(['dispute_won', ['coach_edition']]);
    dispute('lost');
    await webhook(a.env, a.stripe.fetch, 'charge.dispute.closed', 'dp_1', T0 + 2 * MIN);
    expect([a.status(), await a.owns()]).toEqual(['dispute_lost', []]);
  });

  it('events that arrive before their purchase are retried later, not lost or recorded', async () => {
    const { env, stripe } = world();
    stripe.objects.set('ch_9', { id: 'ch_9', payment_intent: 'pi_unknown', amount: 499, amount_refunded: 499, refunded: true });
    expect((await webhook(env, stripe.fetch, 'charge.refunded', 'ch_9', T0)).status).toBe(503);
    expect(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM webhook_events').get()).toEqual({ n: 0 });
  });

  it('unknown event types are acknowledged and ignored', async () => {
    const { env, stripe } = world();
    expect((await webhook(env, stripe.fetch, 'customer.created', 'cus_1', T0)).body).toMatchObject({ outcome: 'ignored: not handled' });
  });

  it('ownership follows the purchase state', () => {
    expect(['paid', 'partially_refunded', 'dispute_won'].map((s) => entitlementFor(s as never))).toEqual(['active', 'active', 'active']);
    expect(['refunded', 'disputed', 'dispute_lost'].map((s) => entitlementFor(s as never))).toEqual(['revoked', 'revoked', 'revoked']);
  });
});

describe('restoring and deleting', () => {
  it('signing in on another device restores the purchase; signing out there loses nothing', async () => {
    const { env, at, box, stripe, idOf } = world();
    await signInAs(env, 'pat@example.com', at(T0), box, '192.0.2.1');
    stripe.objects.set('cs_test_paid0001abcdef', session(idOf('pat@example.com')));
    await webhook(env, stripe.fetch, 'checkout.session.completed', 'cs_test_paid0001abcdef', T0);
    const other = await signInAs(env, 'PAT@example.com', at(T0 + MIN), box, '192.0.2.2');
    expect((await call(env, '/v1/me', { cookie: other }, at(T0 + MIN))).body.owns).toEqual(['coach_edition']);
    await call(env, '/v1/auth/logout', { body: {}, cookie: other }, at(T0 + MIN));
    const again = await signInAs(env, 'pat@example.com', at(T0 + 2 * MIN), box, '192.0.2.3');
    expect((await call(env, '/v1/me', { cookie: again }, at(T0 + 2 * MIN))).body.owns).toEqual(['coach_edition']);
  });

  it('another account can’t claim a purchase by its checkout id', async () => {
    const { env, at, box, stripe, idOf } = world();
    await signInAs(env, 'pat@example.com', at(T0), box, '192.0.2.1');
    stripe.objects.set('cs_test_paid0001abcdef', session(idOf('pat@example.com')));
    await webhook(env, stripe.fetch, 'checkout.session.completed', 'cs_test_paid0001abcdef', T0);
    const sam = await signInAs(env, 'sam@example.com', at(T0), box, '192.0.2.2');
    const s = await call(env, '/v1/checkout/status?session_id=cs_test_paid0001abcdef', { cookie: sam }, at(T0));
    expect(s.body).toEqual({ found: false, owns: false });
    expect((await call(env, '/v1/me', { cookie: sam }, at(T0))).body.owns).toEqual([]);
  });

  it('deleting the account removes ownership and the email; the purchase record stays, unlinked; refunds still apply', async () => {
    const { env, at, box, stripe, idOf } = world();
    const cookie = await signInAs(env, 'pat@example.com', at(T0), box);
    stripe.objects.set('cs_test_paid0001abcdef', session(idOf('pat@example.com')));
    await webhook(env, stripe.fetch, 'checkout.session.completed', 'cs_test_paid0001abcdef', T0);
    expect((await call(env, '/v1/me/delete', { body: { email: 'pat@example.com' }, cookie }, at(T0))).status).toBe(200);
    const q = (sql: string) => env.DB.raw.prepare(sql).all();
    expect(q('SELECT user_id, status FROM purchases')).toEqual([{ user_id: null, status: 'paid' }]);
    expect(q('SELECT * FROM entitlements')).toEqual([]);
    expect(q('SELECT * FROM stripe_customers')).toEqual([]);
    expect(JSON.stringify(q('SELECT * FROM purchases'))).not.toContain('pat@example.com');
    stripe.objects.set('ch_1', { id: 'ch_1', payment_intent: 'pi_test_1', amount: 499, amount_refunded: 499, refunded: true });
    expect((await webhook(env, stripe.fetch, 'charge.refunded', 'ch_1', T0 + MIN)).status).toBe(200);
    expect(q('SELECT status FROM purchases')).toEqual([{ status: 'refunded' }]);
    // a new account with the same email starts with nothing
    const fresh = await signInAs(env, 'pat@example.com', at(T0 + 20 * MIN), box, '192.0.2.9');
    expect((await call(env, '/v1/me', { cookie: fresh }, at(T0 + 20 * MIN))).body.owns).toEqual([]);
  });

  it('turning payments off later closes checkout but keeps what people own', async () => {
    const w = world();
    const cookie = await signInAs(w.env, 'pat@example.com', w.at(T0), w.box);
    w.stripe.objects.set('cs_test_paid0001abcdef', session(w.idOf('pat@example.com')));
    await webhook(w.env, w.stripe.fetch, 'checkout.session.completed', 'cs_test_paid0001abcdef', T0);
    const off = { ...w.env, PAYMENTS: 'off' };
    expect((await call(off, '/v1/me', { cookie }, w.at(T0))).body).toMatchObject({ owns: ['coach_edition'], payments: 'off' });
    expect((await call(off, '/v1/checkout', { body: {}, cookie }, w.at(T0))).status).toBe(503);
  });
});

describe('Stripe helpers', () => {
  it('signature checks accept any listed v1 and need a timestamp within 5 minutes', async () => {
    const body = '{"a":1}';
    const good = await signed(body, T0);
    expect(await verifyStripeSignature(body, good, SECRET, T0)).toBe(true);
    expect(await verifyStripeSignature(body, `${good},v1=${'0'.repeat(64)}`, SECRET, T0)).toBe(true);
    expect(await verifyStripeSignature(body + ' ', good, SECRET, T0)).toBe(false);
    expect(await verifyStripeSignature(body, good, SECRET, T0 + 301_000)).toBe(false);
    expect(await verifyStripeSignature(body, 'v1=abc', SECRET, T0)).toBe(false);
    expect(await verifyStripeSignature(body, null, SECRET, T0)).toBe(false);
  });
  it('form encoding nests the way Stripe reads it', () => {
    expect(decodeURIComponent(encodeForm({ a: 1, b: { c: 'x y' }, l: [{ p: 'q' }], e: ['card'] }))).toBe('a=1&b[c]=x y&l[0][p]=q&e[0]=card');
  });
});
