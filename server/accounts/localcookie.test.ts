/** Local development over http: a plain dev cookie (Safari won't keep a Secure one on http://localhost); never on https. */
import { describe, expect, it } from 'vitest';
import { handleAccounts } from './routes';
import { inbox, testEnv } from './testing';

const LOCAL = 'http://localhost:5173';
async function go(env: ReturnType<typeof testEnv>, path: string, body: unknown, cookie?: string, mailer?: ReturnType<typeof inbox>['mailer']) {
  const headers: Record<string, string> = { 'cf-connecting-ip': '203.0.113.9', ...(cookie ? { cookie } : {}) };
  if (body !== undefined) { headers.origin = LOCAL; headers['content-type'] = 'application/json'; }
  const url = new URL(path, LOCAL);
  return handleAccounts(new Request(url, { method: body !== undefined ? 'POST' : 'GET', headers, body: body !== undefined ? JSON.stringify(body) : undefined }), env, url, { random: () => 1, mailer, now: Date.UTC(2026, 9, 21, 12) });
}

describe('the local dev cookie', () => {
  it('on a localhost origin, signs in with a plain cookie that works on the next request', async () => {
    const env = testEnv({ SITE_ORIGIN: LOCAL, MAIL_MODE: 'console' });
    const box = inbox();
    expect((await go(env, '/v1/auth/email/start', { email: 'pat@example.com' }, undefined, box.mailer)).status).toBe(200);
    const token = box.last().link.split('#signin=')[1];
    const v = await go(env, '/v1/auth/email/verify', { token });
    const set = v.headers.get('set-cookie') ?? '';
    expect(set.startsWith('4c_sid_dev=')).toBe(true);
    expect(set).not.toContain('Secure');
    expect(set).toContain('HttpOnly');
    const sid = set.match(/^4c_sid_dev=([^;]+)/)![1];
    const me = await (await go(env, '/v1/me', undefined, `4c_sid_dev=${sid}`)).json();
    expect(me.signedIn).toBe(true);
  });
  it('on an https origin, the cookie is the __Host- one, Secure, as always', async () => {
    const env = testEnv({ MAIL_MODE: 'console' });   // the test origin is https
    const box = inbox();
    const url = new URL('/v1/auth/email/start', 'https://game.test');
    const start = await handleAccounts(new Request(url, { method: 'POST', headers: { origin: 'https://game.test', 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9' }, body: JSON.stringify({ email: 'pat@example.com' }) }), env, url, { random: () => 1, mailer: box.mailer });
    expect(start.status).toBe(200);
    const token = box.last().link.split('#signin=')[1];
    const vurl = new URL('/v1/auth/email/verify', 'https://game.test');
    const v = await handleAccounts(new Request(vurl, { method: 'POST', headers: { origin: 'https://game.test', 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9' }, body: JSON.stringify({ token }) }), env, vurl, { random: () => 1, mailer: box.mailer });
    const set = v.headers.get('set-cookie') ?? '';
    expect(set.startsWith('__Host-4c_sid=')).toBe(true);
    expect(set).toContain('Secure');
  });
});
