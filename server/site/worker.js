/**
 * The site's Worker: serves the static game from dist/ and, under /v1/, the daily leaderboard ("Everyone today").
 *
 * Storage is a Durable Object per day (plus one for the all-days summary). A Durable Object runs one request at a
 * time, so two players finishing at once never overwrite each other's score. Nothing has to be created by hand:
 * the binding and migration in wrangler.jsonc set it up on the next `wrangler deploy` (the Git-connected build).
 *
 *   GET  /v1/day/:day?token=…   that day's summary: count, your rank, histogram, best ten, average
 *   POST /v1/day/:day/score     { token, name, score, grades, win } -> the summary with your rank
 *   GET  /v1/stats              every day's summary
 *
 * Per score: a nickname, the 0-100 performance, the grade string and win/loss, under a random per-browser token
 * (re-submitting the same day replaces that browser's entry). Nothing that identifies the player.
 */
import { DurableObject } from 'cloudflare:workers';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});

// names are public on the board: letters, digits and a little punctuation, 20 characters, no obvious abuse
const BLOCK = /\b(fuck\w*|shit\w*|cunt\w*|nigg\w*|fag\w*|bitch\w*|whore\w*|slut\w*|rape\w*|rapist|nazi\w*|hitler|porn\w*|dick|dicks|cock|cocks|pussy|asshole\w*|retard\w*)\b/i;
function cleanName(s) {
  const n = String(s ?? '').normalize('NFKC').replace(/[^\p{L}\p{N} _.'-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 20);
  if (!n) return 'Anonymous';
  return BLOCK.test(n) ? 'Coach' : n;
}

function summarize(day, scores, token) {
  const list = Object.entries(scores).map(([tok, e]) => ({ tok, ...e }));
  const sorted = [...list].sort((a, b) => b.score - a.score || a.t - b.t);
  const mine = token ? sorted.find((e) => e.tok === token) : null;
  const bands = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  let sum = 0;
  for (const e of list) { bands[Math.min(9, Math.floor(e.score / 10))]++; sum += e.score; }
  const rank = mine ? sorted.filter((e) => e.score > mine.score).length + 1 : null;
  const tied = mine ? sorted.filter((e) => e.score === mine.score).length - 1 : 0;
  return {
    day, count: list.length, rank, tied, bands,
    best: sorted.slice(0, 10).map((e) => ({ name: e.name, score: e.score })),
    average: list.length ? Math.round((sum / list.length) * 10) / 10 : 0,
  };
}

/** One day's scores. */
export class DayBoard extends DurableObject {
  async summary(day, token) {
    return summarize(day, (await this.ctx.storage.get('scores')) || {}, token);
  }
  async submit(day, entry) {
    const scores = (await this.ctx.storage.get('scores')) || {};
    const prev = scores[entry.token];
    scores[entry.token] = { name: entry.name, score: entry.score, grades: entry.grades, win: entry.win, t: prev?.t ?? Date.now() };
    await this.ctx.storage.put('scores', scores);
    return summarize(day, scores, entry.token);
  }
}

/** Every day's summary, for the stats page. */
export class AllDays extends DurableObject {
  async get() { return (await this.ctx.storage.get('days')) || {}; }
  async set(day, sum) {
    const days = (await this.ctx.storage.get('days')) || {};
    days[day] = { count: sum.count, average: sum.average, best: sum.best, bands: sum.bands };
    await this.ctx.storage.put('days', days);
  }
}

async function api(request, env, url) {
  if (request.method === 'GET' && url.pathname === '/v1/stats') {
    return json({ days: await env.ALL_DAYS.get(env.ALL_DAYS.idFromName('all')).get() });
  }
  const m = url.pathname.match(/^\/v1\/day\/(\d{4}-\d{2}-\d{2})(\/score)?$/);
  if (!m || !DAY.test(m[1])) return json({ error: 'not found' }, 404);
  const day = m[1];
  const board = env.DAY_BOARD.get(env.DAY_BOARD.idFromName(day));
  if (request.method === 'GET' && !m[2]) return json(await board.summary(day, url.searchParams.get('token')));
  if (request.method === 'POST' && m[2]) {
    // only today and yesterday (UTC) take scores, so old days stay fixed
    const now = Date.now(), dayMs = Date.parse(day + 'T00:00:00Z');
    if (!(now - dayMs < 2 * 864e5 && now - dayMs > -864e5)) return json({ error: 'day closed' }, 400);
    let body;
    try { body = await request.json(); } catch { return json({ error: 'bad json' }, 400); }
    const token = String(body.token || '').slice(0, 64);
    const score = Number(body.score);
    if (!/^[a-f0-9]{8,64}$/.test(token) || !Number.isFinite(score) || score < 0 || score > 100) return json({ error: 'bad score' }, 400);
    const sum = await board.submit(day, { token, name: cleanName(body.name), score: Math.round(score), grades: String(body.grades || '').replace(/[^gyor]/g, '').slice(0, 64), win: !!body.win });
    await env.ALL_DAYS.get(env.ALL_DAYS.idFromName('all')).set(day, sum);
    return json(sum);
  }
  return json({ error: 'method' }, 405);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/v1/')) {
      try { return await api(request, env, url); } catch { return json({ error: 'unavailable' }, 503); }
    }
    return env.ASSETS.fetch(request);
  },
};
