/**
 * Sign-in email delivery: configuration (on only when complete, console only on localhost), the Resend request,
 * provider failures (a link that wasn't delivered can't be used), and what never leaks: the address, the link, the
 * code and the API key stay out of logs and out of every response.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { accountsConfig, mailConfig } from './config';
import { MAIL_TIMEOUT_MS, resendMailer, signInText } from './mailer';
import { call, ORIGIN, testEnv } from './testing';

const T0 = Date.UTC(2026, 9, 20, 12);
const KEY = 're_TESTKEY_abc123xyz';
const RESEND = { MAIL_MODE: 'resend', RESEND_API_KEY: KEY, MAIL_FROM: 'The 4th Call <sign-in@mail.example.com>' };

/** A pretend Resend: answers with `status` (or throws), and keeps every request. */
function fakeResend(status = 200, mode: 'answer' | 'throw' | 'timeout' = 'answer') {
  const sent: { url: string; init: RequestInit; body: Record<string, unknown> }[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    sent.push({ url: String(input), init: init!, body: JSON.parse(String(init!.body)) });
    if (mode === 'throw') throw new TypeError('network down');
    if (mode === 'timeout') throw Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    return Response.json(status < 300 ? { id: 'email_123' } : { name: 'error', message: 'nope', statusCode: status }, { status });
  }) as typeof fetch;
  return { sent, fetch: f };
}

let logs: string[] = [];
beforeEach(() => {
  logs = [];
  for (const k of ['log', 'warn', 'error', 'info'] as const) vi.spyOn(console, k).mockImplementation((...a: unknown[]) => { logs.push(a.map(String).join(' ')); });
});
afterEach(() => vi.restoreAllMocks());

const rows = (env: ReturnType<typeof testEnv>) => env.DB.raw.prepare('SELECT used_at FROM login_tokens').all() as { used_at: number | null }[];

describe('configuration', () => {
  it('resend needs a well-formed key and sender; anything less leaves email off, saying why', () => {
    expect(mailConfig(RESEND, ORIGIN)).toEqual({ kind: 'resend', apiKey: KEY, from: RESEND.MAIL_FROM });
    expect(mailConfig({ ...RESEND, MAIL_FROM: 'sign-in@mail.example.com' }, ORIGIN).kind).toBe('resend');
    // the sender staging is configured with (wrangler.jsonc)
    expect(mailConfig({ ...RESEND, MAIL_FROM: 'The 4th Call <signin@nfl-2min-drill.com>' }, ORIGIN).kind).toBe('resend');
    const off = (env: Record<string, string | undefined>) => mailConfig(env, ORIGIN);
    expect(off({ ...RESEND, RESEND_API_KEY: undefined })).toEqual({ kind: 'off', why: 'RESEND_API_KEY is missing or malformed' });
    expect(off({ ...RESEND, RESEND_API_KEY: 'sk_live_wrongkind' }).kind).toBe('off');
    expect(off({ ...RESEND, MAIL_FROM: undefined })).toEqual({ kind: 'off', why: 'MAIL_FROM is missing or malformed' });
    for (const from of ['not an address', 'The 4th Call <a@b.co', 'a@b.co>', 'Evil\r\nBcc: x@y.z <a@b.co>', 'Name <a@b.co>\nX: y', '<a@b.co>']) {
      expect(off({ ...RESEND, MAIL_FROM: from }).kind, JSON.stringify(from)).toBe('off');
    }
    expect(off({})).toEqual({ kind: 'off', why: 'MAIL_MODE is not set' });
    expect(off({ MAIL_MODE: 'smtp' }).kind).toBe('off');
  });

  it('console mail is refused anywhere but localhost', () => {
    expect(mailConfig({ MAIL_MODE: 'console' }, 'https://staging.example.com').kind).toBe('off');
    expect(mailConfig({ MAIL_MODE: 'console' }, 'http://localhost:5173').kind).toBe('console');
    expect(mailConfig({ MAIL_MODE: 'console' }, 'http://127.0.0.1:8787').kind).toBe('console');
  });

  it('a non-local site without email configured fails closed: 503, nothing written, nothing sent, the reason logged', async () => {
    for (const extra of [{}, { MAIL_MODE: 'console' }, { MAIL_MODE: 'resend' }, { ...RESEND, RESEND_API_KEY: '' }]) {
      const env = testEnv(extra);
      const r = fakeResend();
      const res = await call(env, '/v1/auth/email/start', { body: { email: 'pat@example.com' } }, { now: T0, fetch: r.fetch });
      expect(res.status).toBe(503);
      expect(r.sent.length).toBe(0);
      expect(rows(env).length).toBe(0);
    }
    expect(logs.every((l) => l.startsWith('sign-in email is off:') || l.startsWith('{"audit"'))).toBe(true);
    expect(logs.join('\n')).not.toContain('pat@example.com');
  });
});

describe('sending through Resend', () => {
  it('posts one message, to the address only, with the link and the code in the body and neither in the subject', async () => {
    const env = testEnv(RESEND);
    const r = fakeResend(200);
    const res = await call(env, '/v1/auth/email/start', { body: { email: ' Pat@Example.com ' } }, { now: T0, fetch: r.fetch });
    expect(res).toMatchObject({ status: 200, body: { ok: true } });
    expect(r.sent.length).toBe(1);
    const { url, init, body } = r.sent[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`);
    expect(init.signal).toBeTruthy();
    expect(body.to).toEqual(['pat@example.com']);
    expect(body.from).toBe(RESEND.MAIL_FROM);
    expect(body.subject).toBe('Sign in to The 4th Call');
    const text = String(body.text), html = String(body.html);
    const link = text.match(/https:\/\/game\.test\/#signin=[A-Za-z0-9_-]{43}/)?.[0];
    const code = text.match(/code: (\d{6})/)?.[1];
    expect(link && code).toBeTruthy();
    expect(String(body.subject)).not.toContain(code!);
    expect(html).toContain(`href="${link}"`);
    expect(html).toContain(code!);
    expect(body.tags).toEqual([{ name: 'category', value: 'sign_in' }]);
    // the emailed link signs in
    const v = await call(env, '/v1/auth/email/verify', { body: { token: link!.split('#signin=')[1] } }, { now: T0 + 60_000 });
    expect(v.status).toBe(200);
    expect(logs.filter((l) => !l.startsWith('{"audit"'))).toEqual([]);
    expect(logs.join('\n')).not.toContain('pat@example.com');
  });

  it('still says the same thing for every address (no account probing through the provider)', async () => {
    const env = testEnv(RESEND);
    const r = fakeResend(200);
    const a = await call(env, '/v1/auth/email/start', { body: { email: 'one@example.com' } }, { now: T0, fetch: r.fetch });
    const b = await call(env, '/v1/auth/email/start', { body: { email: 'two@example.com' } }, { now: T0, fetch: r.fetch });
    expect([a.status, a.body]).toEqual([b.status, b.body]);
  });

  for (const [what, provider] of [
    ['rejects it (422)', () => fakeResend(422)], ['is down (500)', () => fakeResend(500)], ['rate-limits it (429)', () => fakeResend(429)],
    ['is unreachable', () => fakeResend(200, 'throw')], ['times out', () => fakeResend(200, 'timeout')],
  ] as const) {
    it(`when the provider ${what}: a 502, the undelivered link and code retired, nothing sensitive logged or returned`, async () => {
      const env = testEnv(RESEND);
      const r = provider();
      const res = await call(env, '/v1/auth/email/start', { body: { email: 'pat@example.com' } }, { now: T0, fetch: r.fetch });
      expect(res.status).toBe(502);
      expect(res.body).toEqual({ error: 'The sign-in email could not be sent. Try again.' });
      expect(rows(env)).toEqual([{ used_at: T0 }]);
      const { text } = r.sent[0].body as { text: string };
      const token = text.match(/#signin=([A-Za-z0-9_-]{43})/)![1], code = text.match(/code: (\d{6})/)![1];
      expect((await call(env, '/v1/auth/email/verify', { body: { token } }, { now: T0 + 1000 })).status).toBe(400);
      expect((await call(env, '/v1/auth/email/verify', { body: { email: 'pat@example.com', code } }, { now: T0 + 1000 })).status).toBe(400);
      const all = logs.join('\n') + JSON.stringify(res.body);
      for (const secret of ['pat@example.com', token, code, KEY]) expect(all).not.toContain(secret);
      expect(logs.some((l) => l.startsWith('sign-in email not sent:'))).toBe(true);
    });
  }

  it('an address built to inject headers never reaches the provider', async () => {
    const env = testEnv(RESEND);
    const r = fakeResend(200);
    for (const email of ['pat@example.com\r\nBcc: all@example.com', 'pat@example.com, other@example.com', 'Pat <pat@example.com>']) {
      expect((await call(env, '/v1/auth/email/start', { body: { email } }, { now: T0, fetch: r.fetch })).status).toBe(400);
    }
    expect(r.sent.length).toBe(0);
  });

  it('the key is sent only to Resend, only in the Authorization header, and never appears in a response', async () => {
    const env = testEnv(RESEND);
    const r = fakeResend(200);
    const res = await call(env, '/v1/auth/email/start', { body: { email: 'pat@example.com' } }, { now: T0, fetch: r.fetch });
    expect(JSON.stringify(res.body) + [...res.headers.values()].join(' ')).not.toContain(KEY);
    expect(r.sent.every((s) => new URL(s.url).host === 'api.resend.com')).toBe(true);
    expect(JSON.stringify(r.sent[0].body)).not.toContain(KEY);
  });

  it('the mailer never throws, and uses a timeout', async () => {
    const m = resendMailer({ kind: 'resend', apiKey: KEY, from: 'a@b.co' }, (async () => { throw new Error('boom'); }) as unknown as typeof fetch);
    await expect(m.send({ to: 'p@e.co', link: 'https://x/#signin=t', code: '123456', minutes: 15 })).resolves.toBe(false);
    expect(MAIL_TIMEOUT_MS).toBeLessThanOrEqual(10_000);
  });

  it('the message escapes what it puts in HTML', () => {
    const { html } = signInText({ to: 'p@e.co', link: 'https://x/#signin="><script>', code: '123456', minutes: 15 });
    expect(html).not.toContain('"><script>');
    expect(html).toContain('&quot;&gt;&lt;script&gt;');
  });
});

describe('local development', () => {
  it('console mode on localhost prints the link and works without a provider', async () => {
    const env = testEnv({ MAIL_MODE: 'console', SITE_ORIGIN: 'http://localhost:5173' });
    expect(accountsConfig(env)?.mail.kind).toBe('console');
    const res = await call(env, '/v1/auth/email/start', { body: { email: 'pat@example.com' }, origin: 'http://localhost:5173' }, { now: T0 });
    expect(res.status).toBe(200);
    expect(logs.some((l) => l.includes('[dev mail]') && l.includes('#signin='))).toBe(true);
  });
});

describe('the sign-in message, hardened', () => {
  const m = { to: 'p@e.co', link: 'https://nfl-2min-drill.com/#signin=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', code: '042917', minutes: 15 };
  it('keeps the code out of the subject and the preview line, and copyable as six digits', () => {
    const { subject, html, text } = signInText(m);
    expect(subject).not.toContain(m.code);
    const preview = html.match(/<div style="display:none[^>]*>([^<]*)<\/div>/)?.[1] ?? '';
    expect(preview).not.toContain(m.code);
    expect(html).toContain(`>${m.code}</td>`);
    expect(text).toContain(`code: ${m.code}`);
  });
  it('says why it arrived and warns against sharing the code, in both versions', () => {
    const { html, text } = signInText(m);
    for (const s of [html, text]) {
      expect(s).toContain('never ask you for this code');
      expect(s).toContain('There is no mailing list');
      expect(s).toContain('nfl-2min-drill.com');
    }
  });
  it('has no images and no external resources (nothing to block, nothing that tracks)', () => {
    const { html } = signInText(m);
    expect(html).not.toMatch(/<img|src=|url\(|<link /i);
  });
  it('escapes a hostile link everywhere it appears', () => {
    const { html } = signInText({ ...m, link: 'https://x.test/#signin="><img src=x onerror=alert(1)>' });
    expect(html).not.toContain('<img');
    expect(html).not.toContain('onerror=alert(1)>');
  });
});
