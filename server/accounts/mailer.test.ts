/** The Resend mailer and its configuration: what is sent, what counts as sent, and when the mode is on. */
import { describe, expect, it } from 'vitest';
import { resendMailer, signInText } from './mailer';
import { accountsConfig, resendConfig } from './config';
import { call, inbox, testEnv } from './testing';

const MSG = { to: 'pat@example.com', link: 'https://game.test/#signin=abc', code: '123456', minutes: 15 };

describe('the Resend mailer', () => {
  it('posts one message with the key in the header and the sign-in words in the body', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const f = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response('{"id":"x"}', { status: 200 }); }) as unknown as typeof fetch;
    const ok = await resendMailer('re_test_key_1234567890', 'The 4th Call <signin@game.test>', f).send(MSG);
    expect(ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.resend.com/emails');
    const h = calls[0].init.headers as Record<string, string>;
    expect(h.authorization).toBe('Bearer re_test_key_1234567890');
    const body = JSON.parse(String(calls[0].init.body));
    expect(body).toEqual({ from: 'The 4th Call <signin@game.test>', to: ['pat@example.com'], ...signInText(MSG) });
    expect(body.text).toContain(MSG.link);
    expect(body.subject).toContain('123456');
  });
  it('a rejected or failed request is "not sent", never a throw', async () => {
    const bad = (async () => new Response('nope', { status: 401 })) as unknown as typeof fetch;
    expect(await resendMailer('re_k_1234567890', 'a@b.co', bad).send(MSG)).toBe(false);
    const down = (async () => { throw new Error('network'); }) as unknown as typeof fetch;
    expect(await resendMailer('re_k_1234567890', 'a@b.co', down).send(MSG)).toBe(false);
  });
});

describe('the resend mode', () => {
  it('is on only with the mode, a plausible key and a sender address', () => {
    expect(resendConfig(testEnv({ MAIL_MODE: 'resend', RESEND_API_KEY: 're_abcdefghijkl', MAIL_FROM: 'The 4th Call <signin@game.test>' }))).toEqual({ apiKey: 're_abcdefghijkl', from: 'The 4th Call <signin@game.test>' });
    expect(resendConfig(testEnv({ MAIL_MODE: 'resend', RESEND_API_KEY: 're_abcdefghijkl', MAIL_FROM: 'signin@game.test' }))).not.toBeNull();
    for (const extra of [
      { MAIL_MODE: 'console', RESEND_API_KEY: 're_abcdefghijkl', MAIL_FROM: 'signin@game.test' },
      { MAIL_MODE: 'resend', RESEND_API_KEY: '', MAIL_FROM: 'signin@game.test' },
      { MAIL_MODE: 'resend', RESEND_API_KEY: 'sk_test_notresend', MAIL_FROM: 'signin@game.test' },
      { MAIL_MODE: 'resend', RESEND_API_KEY: 're_abcdefghijkl', MAIL_FROM: '' },
      { MAIL_MODE: 'resend', RESEND_API_KEY: 're_abcdefghijkl', MAIL_FROM: 'not an address' },
    ]) expect(resendConfig(testEnv(extra)), JSON.stringify(extra)).toBeNull();
    // the whole config says so too, and it works off localhost (unlike console mode)
    expect(accountsConfig(testEnv({ MAIL_MODE: 'resend', RESEND_API_KEY: 're_abcdefghijkl', MAIL_FROM: 'signin@game.test' }))?.mail).toBe('resend');
    expect(accountsConfig(testEnv({ MAIL_MODE: 'resend', RESEND_API_KEY: 'bad', MAIL_FROM: 'signin@game.test' }))?.mail).toBe('off');
  });
  it('a sign-in request goes out through Resend and answers the same as any other', async () => {
    const env = testEnv({ MAIL_MODE: 'resend', RESEND_API_KEY: 're_abcdefghijkl', MAIL_FROM: 'signin@game.test' });
    const sent: string[] = [];
    const f = (async (_url: string, init: RequestInit) => { sent.push(JSON.parse(String(init.body)).to[0]); return new Response('{}', { status: 200 }); }) as unknown as typeof fetch;
    const r = await call(env, '/v1/auth/email/start', { body: { email: 'Pat@Example.com' } }, { now: Date.UTC(2026, 9, 20, 12), fetch: f });
    expect(r.status).toBe(200);
    expect(sent).toEqual(['pat@example.com']);
    // and when Resend is down, the caller is told, without a stack trace
    const down = (async () => new Response('', { status: 500 })) as unknown as typeof fetch;
    const r2 = await call(env, '/v1/auth/email/start', { body: { email: 'kim@example.com' } }, { now: Date.UTC(2026, 9, 20, 12), fetch: down });
    expect(r2.status).toBeGreaterThanOrEqual(400);
    void inbox;
  });
});
