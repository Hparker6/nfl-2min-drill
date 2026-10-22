/**
 * The leaderboard's score posts: only from our own pages, only possible scores, IPv6 counted per /64, a failed stats
 * update never fails a score that counted, and the names the board shows.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({ DurableObject: class {} }));
// @ts-expect-error: a plain JavaScript module
const W = await import('./worker.js');
const worker = W.default as { fetch: (r: Request, env: unknown) => Promise<Response> };
// @ts-expect-error: a plain JavaScript module
const { cleanName, callerOf } = (await import('./board.js')) as { cleanName: (s: unknown) => string; callerOf: (ip: string) => string };

const SITE = 'https://nfl-2min-drill.com';
const today = () => new Date().toISOString().slice(0, 10);

function env(opts: { statsFail?: boolean } = {}) {
  const posts: { addr: string; entry: Record<string, unknown> }[] = [];
  const board = { submit: async (_d: string, entry: Record<string, unknown>, addr: string) => { posts.push({ addr, entry }); return { day: _d, count: posts.length, bands: [], rank: 1, tied: 0, best: [], average: 0 }; }, summary: async () => ({}) };
  const all = { set: async () => { if (opts.statsFail) throw new Error('overloaded'); }, get: async () => ({}) };
  return {
    posts,
    env: { DAY_BOARD: { idFromName: (x: string) => x, get: () => board }, ALL_DAYS: { idFromName: (x: string) => x, get: () => all }, ASSETS: { fetch: async () => new Response('') } },
  };
}
const post = (e: unknown, body: unknown, h: Record<string, string> = {}) => worker.fetch(new Request(`${SITE}/v1/day/${today()}/score`, {
  method: 'POST', headers: { 'content-type': 'application/json', origin: SITE, 'cf-connecting-ip': '203.0.113.5', ...h }, body: typeof body === 'string' ? body : JSON.stringify(body),
}), e);
const ok = { token: 'abcdef1234', name: 'Pat', score: 80, grades: 'ggy', win: true };

describe('posting a score', () => {
  it('takes a real one from our own page', async () => {
    const x = env();
    expect((await post(x.env, ok)).status).toBe(200);
    expect(x.posts).toHaveLength(1);
  });
  it('refuses another site, a missing origin and a non-JSON body (the no-preflight trick)', async () => {
    const x = env();
    expect((await post(x.env, ok, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await post(x.env, ok, { origin: '' })).status).toBe(403);
    expect((await post(x.env, ok, { 'content-type': 'text/plain' })).status).toBe(415);
    expect(x.posts).toHaveLength(0);
  });
  it('refuses scores no game can produce: a loss above 66, a win below 34; and a null or array body', async () => {
    const x = env();
    expect((await post(x.env, { ...ok, win: false, score: 100 })).status).toBe(400);
    expect((await post(x.env, { ...ok, win: true, score: 10 })).status).toBe(400);
    expect((await post(x.env, 'null')).status).toBe(400);
    expect((await post(x.env, '[1]')).status).toBe(400);
    expect((await post(x.env, { ...ok, win: false, score: 66 })).status).toBe(200);
    expect((await post(x.env, { ...ok, win: true, score: 34 })).status).toBe(200);
  });
  it('counts IPv6 callers by their /64', async () => {
    const x = env();
    await post(x.env, ok, { 'cf-connecting-ip': '2001:db8:1:2::1' });
    await post(x.env, ok, { 'cf-connecting-ip': '2001:db8:1:2:ffff:ffff:ffff:fffe' });
    await post(x.env, ok, { 'cf-connecting-ip': '2001:db8:1:3::1' });
    expect(x.posts[0].addr).toBe(x.posts[1].addr);
    expect(x.posts[2].addr).not.toBe(x.posts[0].addr);
    expect(callerOf('2001:0db8:0001:0002:0000:0000:0000:0001')).toBe('2001:db8:1:2::/64');
    expect(callerOf('203.0.113.5')).toBe('203.0.113.5');
  });
  it('a stats-page update that fails still answers the saved score', async () => {
    const x = env({ statsFail: true });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await post(x.env, ok)).status).toBe(200);
  });
});

describe('names on the board', () => {
  it('keeps ordinary names, in any script', () => {
    for (const n of ['Pat', 'Jo Ann', "D'Andre", 'Ana-María', '田中', 'Coach K', 'Dickens', 'Scunthorpe fan', 'Harshita', 'Akshita', 'Ishita', 'Kshitij', 'Yoshito', 'Hoshi Takeshi', 'Josh Ito', 'Siriporn', 'Thanaporn', 'Chris Luther', 'Russ Lutz', 'Ross Hitchcock', 'Wes Hitchens', 'Josh17', 'Ash17', 'Rush17', 'J. R. Smith', 'Sporn', 'Mukesh Itani']) expect(cleanName(n), n).toBe(n.slice(0, 20));
  });
  it('blanks, invisible letters and look-alike swear words become safe', () => {
    expect(cleanName('ㅤ')).toBe('Anonymous');        // U+3164, a Hangul filler that renders as nothing
    expect(cleanName('  ')).toBe('Anonymous');
    for (const n of ['fuсk', 'f.u.c.k', 'f_u_c_k', 'f u c k', 'ꓑꓳꓣꓠ', 'SHIT', 'nazi', 'shithead', 'Big Dick']) expect(cleanName(n), n).toBe('Coach');
  });
});
