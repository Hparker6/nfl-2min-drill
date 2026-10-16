/**
 * The 4th Call daily leaderboard: a Cloudflare Worker with one KV namespace. Free tier is plenty for a launch.
 *
 * Deploy (once):   npm i -g wrangler && wrangler login
 *                  wrangler kv namespace create LEADERBOARD        -> paste the id into wrangler.toml
 *                  wrangler deploy                                 -> prints https://<name>.<you>.workers.dev
 * Then set VITE_LEADERBOARD_URL to that address in the game's build settings and redeploy the game.
 *
 * Data per day (key `day:<YYYY-MM-DD>`): { scores: { [token]: { name, score, grades, win, t } } }
 * A token is a random per-browser id; re-submitting the same day replaces that browser's entry. Names are
 * trimmed to 20 characters and stripped of control characters. Nothing else is stored.
 */

const ALLOW = (env) => env.ALLOWED_ORIGIN || '*';
const json = (data, env, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json', 'access-control-allow-origin': ALLOW(env), 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type', 'cache-control': 'no-store' },
});

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const clean = (s) => String(s ?? '').replace(/[^\p{L}\p{N} _.'\-]/gu, '').trim().slice(0, 20) || 'Anonymous';

function summarize(day, scores, token) {
  const list = Object.entries(scores).map(([tok, e]) => ({ tok, ...e }));
  const sorted = [...list].sort((a, b) => b.score - a.score || a.t - b.t);
  const mine = token ? sorted.find((e) => e.tok === token) : null;
  const bands = [0, 0, 0, 0, 0];
  let sum = 0;
  for (const e of list) { bands[Math.min(4, Math.floor(e.score / 20))]++; sum += e.score; }
  const rank = mine ? sorted.filter((e) => e.score > mine.score).length + 1 : null;
  const tied = mine ? sorted.filter((e) => e.score === mine.score).length - 1 : 0;
  return {
    day, count: list.length, rank, tied, bands,
    best: sorted.slice(0, 10).map((e) => ({ name: e.name, score: e.score })),
    average: list.length ? Math.round((sum / list.length) * 10) / 10 : 0,
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return json({}, env);
    const m = url.pathname.match(/^\/v1\/day\/(\d{4}-\d{2}-\d{2})(\/score)?$/);
    if (!m || !DAY.test(m[1])) return json({ error: 'not found' }, env, 404);
    const day = m[1];
    const key = `day:${day}`;
    const data = (await env.LEADERBOARD.get(key, 'json')) || { scores: {} };

    if (request.method === 'GET' && !m[2]) {
      return json(summarize(day, data.scores, url.searchParams.get('token')), env);
    }
    if (request.method === 'POST' && m[2]) {
      // only today and yesterday (UTC) accept scores, so old days stay fixed
      const now = Date.now(), dayMs = Date.parse(day + 'T00:00:00Z');
      if (!(now - dayMs < 2 * 864e5 && now - dayMs > -864e5)) return json({ error: 'day closed' }, env, 400);
      let body;
      try { body = await request.json(); } catch { return json({ error: 'bad json' }, env, 400); }
      const token = String(body.token || '').slice(0, 64);
      const score = Number(body.score);
      if (!/^[a-f0-9]{8,64}$/.test(token) || !Number.isFinite(score) || score < 0 || score > 100) return json({ error: 'bad score' }, env, 400);
      data.scores[token] = { name: clean(body.name), score: Math.round(score), grades: String(body.grades || '').slice(0, 64), win: !!body.win, t: data.scores[token]?.t ?? now };
      // KV writes are last-writer-wins; at launch scale the odd lost write is acceptable
      await env.LEADERBOARD.put(key, JSON.stringify(data), { expirationTtl: 60 * 60 * 24 * 60 });
      return json(summarize(day, data.scores, token), env);
    }
    return json({ error: 'method' }, env, 405);
  },
};
