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
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; frame-ancestors 'none'" },
});

// names are public on the board: letters, digits and a little punctuation, 20 characters, no obvious abuse
const BLOCK = /\b(fuck\w*|shit\w*|cunt\w*|nigg\w*|fag\w*|bitch\w*|whore\w*|slut\w*|rape\w*|rapist|nazi\w*|hitler|porn\w*|dick|dicks|cock|cocks|pussy|asshole\w*|retard\w*)\b/i;
function cleanName(s) {
  const n = String(s ?? '').normalize('NFKC').replace(/[^\p{L}\p{N} _.'-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 20);
  if (!n) return 'Anonymous';
  return BLOCK.test(n) ? 'Coach' : n;
}


/** One day's scores. */
/**
 * One day's scores, in the Durable Object's own SQLite: a row per browser token, ranked by index, so a busy day (or
 * a flood) never builds one huge value. Each address can post a limited number of times a day.
 */
const POSTS_PER_ADDRESS = 30;   // (a Worker module may export only handlers and classes)
export class DayBoard extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => {
      this.sql.exec(`CREATE TABLE IF NOT EXISTS scores (tok TEXT PRIMARY KEY, name TEXT, score INTEGER, grades TEXT, win INTEGER, t INTEGER);
        CREATE INDEX IF NOT EXISTS by_score ON scores (score DESC, t ASC);
        CREATE TABLE IF NOT EXISTS posts (addr TEXT PRIMARY KEY, n INTEGER)`);
      // the first version kept the day as one object: move it into the table once
      const old = await ctx.storage.get('scores');
      if (old && typeof old === 'object') {
        for (const [tok, e] of Object.entries(old)) this.sql.exec('INSERT OR REPLACE INTO scores VALUES (?, ?, ?, ?, ?, ?)', tok, e.name, e.score, e.grades ?? '', e.win ? 1 : 0, e.t ?? Date.now());
        await ctx.storage.delete('scores');
      }
    });
  }
  summary(day, token) {
    const q = (s, ...b) => this.sql.exec(s, ...b).toArray();
    const { count, average } = q('SELECT COUNT(*) AS count, AVG(score) AS average FROM scores')[0];
    const mine = token ? q('SELECT score FROM scores WHERE tok = ?', token)[0] : null;
    const bands = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (const r of q('SELECT MIN(9, score / 10) AS b, COUNT(*) AS n FROM scores GROUP BY b')) bands[r.b] = r.n;
    return {
      day, count, bands,
      rank: mine ? q('SELECT COUNT(*) AS n FROM scores WHERE score > ?', mine.score)[0].n + 1 : null,
      tied: mine ? q('SELECT COUNT(*) AS n FROM scores WHERE score = ?', mine.score)[0].n - 1 : 0,
      best: q('SELECT name, score FROM scores ORDER BY score DESC, t ASC LIMIT 10'),
      average: count ? Math.round(average * 10) / 10 : 0,
    };
  }
  /** null when this address has posted too often today. */
  submit(day, entry, addr) {
    const n = this.sql.exec('SELECT n FROM posts WHERE addr = ?', addr).toArray()[0]?.n ?? 0;
    if (n >= POSTS_PER_ADDRESS) return null;
    this.sql.exec('INSERT INTO posts VALUES (?, 1) ON CONFLICT(addr) DO UPDATE SET n = n + 1', addr);
    this.sql.exec(`INSERT INTO scores VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(tok) DO UPDATE SET name = excluded.name, score = excluded.score, grades = excluded.grades, win = excluded.win`,
    entry.token, entry.name, entry.score, entry.grades, entry.win ? 1 : 0, Date.now());
    return this.summary(day, entry.token);
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
    // a score is a few dozen bytes; anything big is not one
    const raw = await request.text();
    if (raw.length > 2048) return json({ error: 'too large' }, 413);
    let body;
    try { body = JSON.parse(raw); } catch { return json({ error: 'bad json' }, 400); }
    const token = String(body.token || '').slice(0, 64);
    const score = Number(body.score);
    if (!/^[a-f0-9]{8,64}$/.test(token) || !Number.isFinite(score) || score < 0 || score > 100) return json({ error: 'bad score' }, 400);
    // the address only counts posts, and only as a salted hash: no IP is stored
    const ip = request.headers.get('cf-connecting-ip') || 'unknown';
    const addr = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(day + ':' + ip)))].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
    const sum = await board.submit(day, { token, name: cleanName(body.name), score: Math.round(score), grades: String(body.grades || '').replace(/[^gyor]/g, '').slice(0, 64), win: !!body.win }, addr);
    if (!sum) return json({ error: 'too many scores from this address today' }, 429);
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
