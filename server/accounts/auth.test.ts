/**
 * Accounts, Phase 1: passwordless email sign-in, sessions, account deletion, and the checks around them (origin,
 * cookies, rate limits, token expiry, no account enumeration). Runs the real routes on the real schema (testing.ts).
 */
import { describe, expect, it } from 'vitest';
import { accountsConfig } from './config';
import { call, inbox, ORIGIN, PEPPER, signInAs, testDb, testEnv, type Call } from './testing';
import { TOKEN_TTL_MS } from './auth';
import { SESSION_IDLE_MS, SESSION_MAX_MS } from './sessions';
import { sweep } from './ratelimit';
import { signInText } from './mailer';

const T0 = Date.UTC(2026, 9, 20, 12);
const MIN = 60_000, DAY = 86_400_000;

function setup(extra = {}) {
  const env = testEnv(extra);
  const box = inbox();
  return { env, box, at: (now: number) => ({ now, mailer: box.mailer }) };
}

describe('off unless configured', () => {
  it('every account route answers 404 without the database, the switch, an origin or a long secret', async () => {
    const box = inbox();
    const cases = [
      testEnv({ DB: undefined }), testEnv({ ACCOUNTS: 'off' }), testEnv({ ACCOUNTS: undefined }), testEnv({ AUTH_PEPPER: 'short' }),
      testEnv({ SITE_ORIGIN: 'http://game.test' }), testEnv({ SITE_ORIGIN: '' }),
    ];
    for (const env of cases) {
      for (const [path, body] of [['/v1/auth/email/start', { email: 'a@b.co' }], ['/v1/me', undefined], ['/v1/checkout', {}], ['/v1/stripe/webhook', {}]] as const) {
        const r = await call(env, path, { body }, { now: T0, mailer: box.mailer });
        expect(r.status, path).toBe(404);
      }
    }
    expect(box.sent.length).toBe(0);
  });

  it('printing sign-in links to the log is only allowed on localhost', () => {
    expect(accountsConfig(testEnv({ MAIL_MODE: 'console' }))?.mail).toEqual({ kind: 'off', why: 'console mail is for localhost only' });
    expect(accountsConfig(testEnv({ MAIL_MODE: 'console', SITE_ORIGIN: 'http://localhost:8787' }))?.mail).toEqual({ kind: 'console' });
  });

  it('without a mail provider, asking for a sign-in says it is unavailable', async () => {
    const env = testEnv();
    const r = await call(env, '/v1/auth/email/start', { body: { email: 'pat@example.com' } }, { now: T0 });
    expect(r.status).toBe(503);
  });
});

describe('sign-in by email', () => {
  it('sends a link and a 6-digit code, and stores neither', async () => {
    const { env, box, at } = setup();
    const r = await call(env, '/v1/auth/email/start', { body: { email: '  Pat@Example.COM ' } }, at(T0));
    expect(r).toMatchObject({ status: 200, body: { ok: true } });
    const m = box.last();
    expect(m.to).toBe('pat@example.com');
    expect(m.link).toMatch(new RegExp(`^${ORIGIN}/#signin=[A-Za-z0-9_-]{43}$`));
    expect(m.code).toMatch(/^\d{6}$/);
    const token = m.link.split('#signin=')[1];
    const rows = env.DB.raw.prepare('SELECT * FROM login_tokens').all() as Record<string, unknown>[];
    expect(rows.length).toBe(1);
    const stored = JSON.stringify(rows);
    expect(stored).not.toContain(token);
    expect(stored).not.toContain(m.code);
    expect(signInText(m).text).toContain(m.link);
  });

  it('the link signs in once, with a secure session cookie, and creates the account', async () => {
    const { env, box, at } = setup();
    await call(env, '/v1/auth/email/start', { body: { email: 'pat@example.com' } }, at(T0));
    const token = box.last().link.split('#signin=')[1];
    const v = await call(env, '/v1/auth/email/verify', { body: { token } }, at(T0 + MIN));
    expect(v.status).toBe(200);
    expect(v.body).toMatchObject({ ok: true, created: true, email: 'p••@example.com' });
    expect(v.setCookie).toMatch(/^__Host-4c_sid=[A-Za-z0-9_-]{43}; Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=2592000$/);
    const me = await call(env, '/v1/me', { cookie: v.cookie }, at(T0 + 2 * MIN));
    expect(me.body).toMatchObject({ signedIn: true, email: 'p••@example.com', owns: [], payments: 'off' });
    // used once
    const again = await call(env, '/v1/auth/email/verify', { body: { token } }, at(T0 + 2 * MIN));
    expect(again.status).toBe(400);
    expect(again.cookie).toBeNull();
    // the session's token is stored only as a hash
    expect(JSON.stringify(env.DB.raw.prepare('SELECT * FROM sessions').all())).not.toContain(v.cookie!);
  });

  it('a second sign-in finds the same account (created: false) and retires older sign-in emails', async () => {
    const { env, box, at } = setup();
    await signInAs(env, 'pat@example.com', at(T0), box);
    await call(env, '/v1/auth/email/start', { body: { email: 'pat@example.com' } }, at(T0 + MIN));
    const older = box.last().link.split('#signin=')[1];
    await call(env, '/v1/auth/email/start', { body: { email: 'pat@example.com' } }, at(T0 + 2 * MIN));
    const newer = box.last().link.split('#signin=')[1];
    const v = await call(env, '/v1/auth/email/verify', { body: { token: newer } }, at(T0 + 3 * MIN));
    expect(v.body.created).toBe(false);
    expect((await call(env, '/v1/auth/email/verify', { body: { token: older } }, at(T0 + 4 * MIN))).status).toBe(400);
    expect(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({ n: 1 });
  });

  it('links and codes expire after 15 minutes', async () => {
    const { env, box, at } = setup();
    await call(env, '/v1/auth/email/start', { body: { email: 'pat@example.com' } }, at(T0));
    const { link, code } = box.last();
    const late = T0 + TOKEN_TTL_MS + 1;
    expect((await call(env, '/v1/auth/email/verify', { body: { token: link.split('#signin=')[1] } }, at(late))).status).toBe(400);
    expect((await call(env, '/v1/auth/email/verify', { body: { email: 'pat@example.com', code } }, at(late))).status).toBe(400);
  });

  it('the code works for its own address only, and five wrong tries end it', async () => {
    const { env, box, at } = setup();
    await call(env, '/v1/auth/email/start', { body: { email: 'pat@example.com' } }, at(T0));
    const { code } = box.last();
    expect((await call(env, '/v1/auth/email/verify', { body: { email: 'sam@example.com', code } }, at(T0 + MIN))).status).toBe(400);
    const wrong = code === '000000' ? '000001' : '000000';
    for (let i = 0; i < 5; i++) expect((await call(env, '/v1/auth/email/verify', { body: { email: 'pat@example.com', code: wrong } }, at(T0 + MIN))).status).toBe(400);
    expect((await call(env, '/v1/auth/email/verify', { body: { email: 'pat@example.com', code } }, at(T0 + MIN))).status).toBe(400);
    // the link from that email still works: wrong code guesses (which anyone can make for any address) never kill it
    expect((await call(env, '/v1/auth/email/verify', { body: { token: box.last().link.split('#signin=')[1] } }, at(T0 + MIN))).status).toBe(200);
  });

  it('the right code signs in', async () => {
    const { env, box, at } = setup();
    await call(env, '/v1/auth/email/start', { body: { email: 'pat@example.com' } }, at(T0));
    const v = await call(env, '/v1/auth/email/verify', { body: { email: 'PAT@example.com', code: box.last().code } }, at(T0 + MIN));
    expect(v.status).toBe(200);
    expect(v.cookie).toBeTruthy();
  });

  it('malformed tokens, codes and emails are refused', async () => {
    const { env, at } = setup();
    for (const body of [{ token: 'short' }, { token: 'x'.repeat(43) + '!' }, { token: 123 }, { email: 'pat@example.com', code: '12345' }, { email: 'nope', code: '123456' }, {}]) {
      expect((await call(env, '/v1/auth/email/verify', { body }, at(T0))).status).toBe(400);
    }
    for (const email of ['', 'pat', 'pat@', '@example.com', 'a b@example.com', 'x'.repeat(250) + '@e.co', 42]) {
      expect((await call(env, '/v1/auth/email/start', { body: { email } }, at(T0))).status).toBe(400);
    }
  });
});

describe('no account enumeration', () => {
  it('asking for an address with an account and one without gets the same answer', async () => {
    const { env, box, at } = setup();
    await signInAs(env, 'known@example.com', at(T0), box);
    const a = await call(env, '/v1/auth/email/start', { body: { email: 'known@example.com' } }, at(T0 + MIN));
    const b = await call(env, '/v1/auth/email/start', { body: { email: 'unknown@example.com' } }, at(T0 + MIN));
    expect(a.status).toBe(b.status);
    expect(a.body).toEqual(b.body);
    expect([...a.headers.entries()]).toEqual([...b.headers.entries()]);
  });

  it('an address that asked too often still gets the same answer (nothing is sent)', async () => {
    const { env, box, at } = setup();
    const answers = [];
    for (let i = 0; i < 5; i++) answers.push(await call(env, '/v1/auth/email/start', { body: { email: 'pat@example.com' }, ip: `198.51.100.${i}` }, at(T0 + i)));
    expect(answers.every((r) => r.status === 200 && r.body.ok === true)).toBe(true);
    expect(box.sent.length).toBe(3);
    // the next window allows more
    await call(env, '/v1/auth/email/start', { body: { email: 'pat@example.com' } }, at(T0 + 16 * MIN));
    expect(box.sent.length).toBe(4);
  });
});

describe('rate limits', () => {
  it('one caller asking for many addresses is slowed down (429), whatever the addresses', async () => {
    const { env, box, at } = setup();
    const st = [];
    for (let i = 0; i < 12; i++) st.push((await call(env, '/v1/auth/email/start', { body: { email: `p${i}@example.com` } }, at(T0 + i))).status);
    expect(st.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(st.slice(10)).toEqual([429, 429]);
    expect(box.sent.length).toBe(10);
    // another caller is unaffected
    expect((await call(env, '/v1/auth/email/start', { body: { email: 'q@example.com' }, ip: '192.0.2.1' }, at(T0 + 20))).status).toBe(200);
  });

  it('a daily cap per address', async () => {
    const { env, box, at } = setup();
    for (let i = 0; i < 14; i++) await call(env, '/v1/auth/email/start', { body: { email: 'pat@example.com' }, ip: `198.51.100.${i}` }, at(T0 + i * 16 * MIN));
    expect(box.sent.length).toBe(10);
  });

  it('code guessing is capped per address across emails', async () => {
    const { env, box, at } = setup();
    let tries = 0;
    for (let round = 0; round < 3; round++) {
      await call(env, '/v1/auth/email/start', { body: { email: 'pat@example.com' }, ip: `198.51.100.${round}` }, at(T0 + round));
      const wrong = box.last().code === '999999' ? '999998' : '999999';
      for (let i = 0; i < 5; i++) { await call(env, '/v1/auth/email/verify', { body: { email: 'pat@example.com', code: wrong }, ip: `198.51.100.${round}` }, at(T0 + round)); tries++; }
    }
    // the 11th try within the hour is refused even with the right code
    await call(env, '/v1/auth/email/start', { body: { email: 'pat@example.com' }, ip: '198.51.100.9' }, at(T0 + 10));
    expect(tries).toBe(15);
    const v = await call(env, '/v1/auth/email/verify', { body: { email: 'pat@example.com', code: box.last().code }, ip: '198.51.100.9' }, at(T0 + 11));
    expect(v.status).toBe(400);
  });
});

describe('request checks (forged and cross-site requests)', () => {
  it('a POST from another origin, with no origin, marked cross-site, or not JSON, is refused', async () => {
    const { env, box, at } = setup();
    const cases: Call[] = [
      { origin: 'https://evil.example' }, { origin: null }, { origin: 'https://game.test.evil.example' },
      { headers: { 'sec-fetch-site': 'cross-site' } }, { headers: { 'content-type': 'text/plain' } }, { headers: { 'content-type': 'application/x-www-form-urlencoded' } },
    ];
    for (const c of cases) {
      const r = await call(env, '/v1/auth/email/start', { body: { email: 'pat@example.com' }, ...c }, at(T0));
      expect(r.status, JSON.stringify(c)).toBe(403);
    }
    expect(box.sent.length).toBe(0);
  });

  it('sign-out and deletion refuse cross-site requests too (a session cookie alone is not enough)', async () => {
    const { env, box, at } = setup();
    const cookie = await signInAs(env, 'pat@example.com', at(T0), box);
    expect((await call(env, '/v1/auth/logout-all', { body: {}, cookie, origin: 'https://evil.example' }, at(T0))).status).toBe(403);
    expect((await call(env, '/v1/me/delete', { body: { email: 'pat@example.com' }, cookie, origin: 'https://evil.example' }, at(T0))).status).toBe(403);
    expect((await call(env, '/v1/me', { cookie }, at(T0))).body.signedIn).toBe(true);
  });

  it('local development origins are allowed only when listed and local', () => {
    expect(accountsConfig(testEnv({ DEV_ORIGINS: 'http://localhost:5173, https://evil.example' }))?.origins).toEqual([ORIGIN, 'http://localhost:5173']);
  });

  it('oversized bodies are refused', async () => {
    const { env, at } = setup();
    const r = await call(env, '/v1/auth/email/start', { raw: JSON.stringify({ email: 'a@b.co', pad: 'x'.repeat(5000) }) }, at(T0));
    expect(r.status).toBe(400);
  });
});

describe('sessions', () => {
  it('an unknown or tampered cookie is not signed in', async () => {
    const { env, box, at } = setup();
    const cookie = await signInAs(env, 'pat@example.com', at(T0), box);
    for (const c of ['nope', cookie.slice(0, -1) + (cookie.endsWith('A') ? 'B' : 'A'), 'x'.repeat(500)]) {
      expect((await call(env, '/v1/me', { cookie: c }, at(T0))).body.signedIn).toBe(false);
    }
  });

  it('expires after 30 days without use; use renews it (at most daily); never more than 180 days', async () => {
    const { env, box, at } = setup();
    const a = await signInAs(env, 'pat@example.com', at(T0), box);
    expect((await call(env, '/v1/me', { cookie: a }, at(T0 + SESSION_IDLE_MS + 1))).body.signedIn).toBe(false);
    const b = await signInAs(env, 'pat@example.com', at(T0), box);
    let t = T0;
    for (let i = 0; i < 7; i++) {   // 25-day steps up to day 175, within the 180-day cap
      t += 25 * DAY;
      const r = await call(env, '/v1/me', { cookie: b }, at(t));
      expect(r.body.signedIn).toBe(true);
      expect(r.setCookie).toMatch(/Max-Age=\d+/);   // renewed: the cookie is refreshed
    }
    expect((await call(env, '/v1/me', { cookie: b }, at(T0 + SESSION_MAX_MS))).body.signedIn).toBe(false);
  });

  it('signing out ends this session only; signing out everywhere ends all of this account’s, no one else’s', async () => {
    const { env, box, at } = setup();
    const a1 = await signInAs(env, 'pat@example.com', at(T0), box);
    const a2 = await signInAs(env, 'pat@example.com', at(T0), box, '192.0.2.10');
    const b = await signInAs(env, 'sam@example.com', at(T0), box, '192.0.2.11');
    const out = await call(env, '/v1/auth/logout', { body: {}, cookie: a1 }, at(T0 + MIN));
    expect(out.setCookie).toMatch(/Max-Age=0/);
    expect((await call(env, '/v1/me', { cookie: a1 }, at(T0 + MIN))).body.signedIn).toBe(false);
    expect((await call(env, '/v1/me', { cookie: a2 }, at(T0 + MIN))).body.signedIn).toBe(true);
    const a3 = await signInAs(env, 'pat@example.com', at(T0), box, '192.0.2.12');
    const all = await call(env, '/v1/auth/logout-all', { body: {}, cookie: a3 }, at(T0 + 2 * MIN));
    expect(all.body).toMatchObject({ ok: true, ended: 2 });
    expect((await call(env, '/v1/me', { cookie: a2 }, at(T0 + 2 * MIN))).body.signedIn).toBe(false);
    expect((await call(env, '/v1/me', { cookie: b }, at(T0 + 2 * MIN))).body.signedIn).toBe(true);
  });

  it('signing in always makes a new session: a cookie planted beforehand never becomes signed in', async () => {
    const { env, box, at } = setup();
    const planted = 'A'.repeat(43);
    await call(env, '/v1/auth/email/start', { body: { email: 'pat@example.com' }, cookie: planted }, at(T0));
    const v = await call(env, '/v1/auth/email/verify', { body: { token: box.last().link.split('#signin=')[1] }, cookie: planted }, at(T0));
    expect(v.cookie).not.toBe(planted);
    expect((await call(env, '/v1/me', { cookie: planted }, at(T0))).body.signedIn).toBe(false);
  });

  it('account endpoints need a session', async () => {
    const { env, at } = setup();
    expect((await call(env, '/v1/auth/logout-all', { body: {} }, at(T0))).status).toBe(401);
    expect((await call(env, '/v1/me/delete', { body: { email: 'pat@example.com' } }, at(T0))).status).toBe(401);
    expect((await call(env, '/v1/checkout/status?session_id=cs_test_abcdefghijkl', {}, at(T0))).status).toBe(401);
  });
});

describe('deleting an account', () => {
  it('needs the email typed again; then removes the user, sessions, sign-in methods and pending emails', async () => {
    const { env, box, at } = setup();
    const a = await signInAs(env, 'pat@example.com', at(T0), box);
    const a2 = await signInAs(env, 'pat@example.com', at(T0), box, '192.0.2.20');
    await call(env, '/v1/auth/email/start', { body: { email: 'pat@example.com' }, ip: '192.0.2.21' }, at(T0 + MIN));
    expect((await call(env, '/v1/me/delete', { body: { email: 'sam@example.com' }, cookie: a }, at(T0 + MIN))).status).toBe(400);
    const d = await call(env, '/v1/me/delete', { body: { email: ' PAT@example.com' }, cookie: a }, at(T0 + MIN));
    expect(d).toMatchObject({ status: 200, body: { ok: true, deleted: true } });
    expect(d.setCookie).toMatch(/Max-Age=0/);
    for (const t of ['users', 'sessions', 'identities', 'login_tokens']) expect(env.DB.raw.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get(), t).toEqual({ n: 0 });
    expect((await call(env, '/v1/me', { cookie: a2 }, at(T0 + MIN))).body.signedIn).toBe(false);
    // the address can sign up again, as a new account
    const again = await call(env, '/v1/auth/email/start', { body: { email: 'pat@example.com' }, ip: '192.0.2.22' }, at(T0 + 20 * MIN));
    expect(again.status).toBe(200);
    const v = await call(env, '/v1/auth/email/verify', { body: { token: box.last().link.split('#signin=')[1] }, ip: '192.0.2.22' }, at(T0 + 20 * MIN));
    expect(v.body.created).toBe(true);
  });
});

describe('housekeeping', () => {
  it('sweeping removes old counters, stale sign-in tokens and expired sessions, and nothing current', async () => {
    const db = testDb();
    db.raw.exec(`INSERT INTO users VALUES ('u1', 'p@e.co', 0, 0);
      INSERT INTO sessions VALUES ('old', 'u1', 0, ${T0 - 1}, 0), ('live', 'u1', 0, ${T0 + DAY}, 0);
      INSERT INTO login_tokens (token_hash, email, code_hash, created_at, expires_at) VALUES ('t-old', 'p@e.co', 'h', 0, ${T0 - 2 * DAY}), ('t-new', 'p@e.co', 'h', 0, ${T0 + MIN});
      INSERT INTO rate_limits VALUES ('k', ${T0 - 3 * DAY}, 1), ('k', ${T0}, 1);`);
    await sweep(db, T0);
    expect(db.raw.prepare('SELECT token_hash FROM sessions').all()).toEqual([{ token_hash: 'live' }]);
    expect(db.raw.prepare('SELECT token_hash FROM login_tokens').all()).toEqual([{ token_hash: 't-new' }]);
    expect(db.raw.prepare('SELECT win FROM rate_limits').all()).toEqual([{ win: T0 }]);
  });

  it('the test secret is long enough to be accepted (and a short one is not)', () => {
    expect(PEPPER.length).toBeGreaterThanOrEqual(32);
  });
});
