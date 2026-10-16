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
import PCT from '../../src/data/percentiles.json';

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

// ---------------------------------------------------------------- pages ---
// /leaderboard/ and /stats/ are drawn here, from the live scores, so search engines index real names and numbers
// (fresh every day) without running the game's JavaScript.

const SITE = 'https://nfl-2min-drill.com';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const utcDay = (ms = Date.now()) => new Date(ms).toISOString().slice(0, 10);
const dayNumber = (d) => Math.round((Date.parse(d + 'T00:00:00Z') - Date.parse('2026-01-01T00:00:00Z')) / 864e5) + 1;
const fmtDay = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const PAGE_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'public, max-age=60',
  'content-security-policy': "default-src 'self'; script-src 'self' https://static.cloudflareinsights.com; connect-src 'self' https://cloudflareinsights.com; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
};

function page({ path, title, description, h1, body, jsonld, eyebrow }) {
  const nav = [['/how-to-play/', 'How to play'], ['/leaderboard/', 'Leaderboard'], ['/stats/', 'Stats']]
    .map(([href, label]) => `<a href="${href}"${href === path ? ' aria-current="page"' : ''}>${label}</a>`).join('');
  return `<!doctype html>
<html lang="en"><head>
<meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}" />
<link rel="canonical" href="${SITE}${path}" />
<meta name="theme-color" content="#0a0e0c" />
<link rel="icon" href="/favicon.svg" type="image/svg+xml" /><link rel="apple-touch-icon" href="/apple-touch-icon.png" />
<meta property="og:type" content="website" /><meta property="og:site_name" content="The 4th Call" />
<meta property="og:title" content="${esc(title)}" /><meta property="og:description" content="${esc(description)}" />
<meta property="og:url" content="${SITE}${path}" /><meta property="og:image" content="${SITE}/og.jpg" />
<meta name="twitter:card" content="summary_large_image" />
<link rel="preconnect" href="https://fonts.googleapis.com" /><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700;800&family=Barlow:wght@400;500;600;700&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="/pages.css" />
${jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, '\\u003c')}</script>` : ''}
</head><body>
<header class="top"><div class="top-in">
<a class="brand" href="/"><span class="mark" aria-hidden="true"><svg viewBox="0 0 64 64" width="18" height="18"><g transform="rotate(-35 32 32)"><ellipse cx="32" cy="32" rx="21" ry="13" fill="currentColor"/></g></svg></span><span>The <em>4th</em> Call</span></a>
<nav class="nav" aria-label="Site">${nav}<a class="play" href="/">Play</a></nav>
</div></header>
<main>${eyebrow ? `<p class="eyebrow">${eyebrow}</p>` : ''}<h1>${h1}</h1>${body}</main>
<footer><div class="in"><span class="brandline">The <em>4th</em> Call</span><nav aria-label="More"><a href="/">Play</a><a href="/how-to-play/">How to play</a><a href="/leaderboard/">Leaderboard</a><a href="/stats/">Stats</a></nav>
An independent fan game, not affiliated with or endorsed by the NFL, its teams or the NFLPA. Rosters and statistics from nflverse (CC-BY 4.0). Scores are reported by each player's browser.</div></footer>
</body></html>`;
}

const breadcrumb = (name, path) => ({ '@type': 'BreadcrumbList', itemListElement: [
  { '@type': 'ListItem', position: 1, name: 'The 4th Call', item: `${SITE}/` },
  { '@type': 'ListItem', position: 2, name, item: `${SITE}${path}` },
] });

// benchmarks: the simulated play-callers behind the game's "better than X%" (src/data/percentiles.json). Shown
// labeled, never ranked, so a new day's board has something to beat without pretending anyone played.
const SIM = [...PCT.scores].sort((a, b) => a - b);
const simAt = (q) => SIM[Math.min(SIM.length - 1, Math.floor(q * (SIM.length - 1)))];
const BENCH = [
  { name: 'Simulated pro', tag: 'Top 10%', score: simAt(0.9) },
  { name: 'Simulated coach', tag: 'Average', score: simAt(0.5) },
];
const untilNext = () => {
  const ms = Date.parse(utcDay(Date.now() + 864e5) + 'T00:00:00Z') - Date.now();
  const h = Math.floor(ms / 36e5), m = Math.floor((ms % 36e5) / 6e4);
  return `${h}h ${String(m).padStart(2, '0')}m`;
};
const shortDay = (d) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** Players and benchmarks in one table: players ranked 1, 2, 3…; benchmarks sit at their score, unranked. */
function boardTable(best, withBench) {
  const rows = best.map((e, i) => ({ ...e, rank: i + 1 }));
  if (withBench) for (const b of BENCH) rows.push({ ...b, bench: true });
  rows.sort((a, b) => b.score - a.score || (a.bench ? 1 : 0) - (b.bench ? 1 : 0));
  const tr = rows.map((e) => e.bench
    ? `<tr class="bench"><td class="rk"><span class="rank" aria-hidden="true">·</span></td><td>${esc(e.name)}<span class="badge">${esc(e.tag)}</span></td><td class="num score">${e.score}</td></tr>`
    : `<tr class="r${e.rank}"><td class="rk"><span class="rank">${e.rank}</span></td><td>${esc(e.name)}</td><td class="num score">${e.score}</td></tr>`).join('');
  return `<div class="panel"><table><thead><tr><th class="rk">#</th><th>Coach</th><th class="num">Score</th></tr></thead><tbody>${tr}</tbody></table></div>`;
}

function bandBars(bands) {
  const max = Math.max(1, ...bands);
  const rows = bands.map((n, i) => `<div class="bar"><span>${i * 10}${i === 9 ? '+' : ''}</span><i style="width:${Math.round((n / max) * 100)}%"></i><b>${n}</b></div>`).join('');
  return `<div class="panel"><div class="bars" aria-label="How today's scores spread out"><div class="hd"><span>Score</span><span></span><span style="text-align:right">Players</span></div>${rows}</div></div>`;
}

async function leaderboardPage(env) {
  const today = utcDay(), yesterday = utcDay(Date.now() - 864e5);
  const [t, y] = await Promise.all([today, yesterday].map((d) => env.DAY_BOARD.get(env.DAY_BOARD.idFromName(d)).summary(d, null)));
  const yest = y.best.length
    ? `${boardTable(y.best.slice(0, 3), false)}<p class="note">${y.count.toLocaleString('en-US')} played Daily #${dayNumber(yesterday)} (${esc(shortDay(yesterday))}), average ${y.average}.</p>`
    : '<p class="empty">No scores yesterday.</p>';
  const body = `
<p class="lede">Everyone plays the same NFL two-minute drill spot today. These are the best play-callers so far, scored on the game's Performance rating (0–100): every call graded against every option.</p>
<div class="cta"><a class="btn primary" href="/">Play today's game</a><a class="btn" href="/how-to-play/#grades">How it's scored</a></div>
<p class="next">New Daily in <b>${untilNext()}</b> · midnight UTC</p>
<div class="stats three">
  <div class="stat"><b>${t.count.toLocaleString('en-US')}</b><span>played today</span></div>
  <div class="stat"><b>${t.count ? t.average : '–'}</b><span>average</span></div>
  <div class="stat"><b>${t.best[0]?.score ?? '–'}</b><span>top score</span></div>
</div>
<h2>Today's board</h2>
${boardTable(t.best, true)}
<p class="note">${t.count ? '' : 'No scores yet today: be the first on the board. Play the Daily, then post your name. '}Rows marked <span class="badge" style="margin:0">Top 10%</span> and <span class="badge" style="margin:0">Average</span> are benchmarks from simulated play-callers, shown to beat. They are not players and are not ranked.</p>
${t.count ? `<h2>How today's scores spread out</h2>${bandBars(t.bands)}` : ''}
<h2>Yesterday's best</h2>
${yest}
<p class="muted small" style="margin-top:22px">Every Daily's numbers are on the <a href="/stats/">stats page</a>.</p>`;
  return page({
    path: '/leaderboard/', eyebrow: `<i></i>Live · Daily #${dayNumber(today)} · ${esc(fmtDay(today))}`,
    title: `Leaderboard: Daily #${dayNumber(today)} | The 4th Call, NFL 2-Minute Drill Game`,
    description: `Today's best play-callers in The 4th Call, the free NFL 2-minute drill game. ${t.count ? `${t.count} played Daily #${dayNumber(today)}, top score ${t.best[0].score}.` : `Daily #${dayNumber(today)} is open.`} Play the same game and post your score.`,
    h1: 'Daily <em>leaderboard</em>', body, jsonld: { '@context': 'https://schema.org', '@graph': [breadcrumb('Leaderboard', '/leaderboard/')] },
  });
}

async function statsPage(env) {
  const days = await env.ALL_DAYS.get(env.ALL_DAYS.idFromName('all')).get();
  const list = Object.keys(days).sort().reverse();
  const total = list.reduce((a, d) => a + days[d].count, 0);
  const most = list.reduce((a, d) => Math.max(a, days[d].count), 0);
  const bestEver = list.reduce((a, d) => { const b = days[d].best[0]; return b && (!a || b.score > a.score) ? { ...b, day: d } : a; }, null);
  const rows = list.slice(0, 30).map((d) => `<tr><td>${esc(shortDay(d))}</td><td class="num hide-sm">#${dayNumber(d)}</td><td class="num">${days[d].count.toLocaleString('en-US')}</td><td class="num">${days[d].average}</td><td class="num score">${days[d].best[0]?.score ?? '–'}</td><td>${esc(days[d].best[0]?.name ?? '')}</td></tr>`).join('');
  const table = list.length
    ? `<div class="panel"><table><thead><tr><th>Day</th><th class="num hide-sm">Daily</th><th class="num">Played</th><th class="num">Avg</th><th class="num">Best</th><th>Top coach</th></tr></thead><tbody>${rows}</tbody></table></div>`
    : '<p class="empty">No Dailies scored yet. Play today and yours is the first.</p>';
  const body = `
<p class="lede">Every day, everyone plays the same NFL two-minute drill game. Here is how the play-callers did: how many played each Daily, the average Performance score and the best of the day.</p>
<div class="cta"><a class="btn primary" href="/">Play today's game</a><a class="btn" href="/leaderboard/">Today's board</a></div>
<div class="stats">
  <div class="stat"><b>${total.toLocaleString('en-US')}</b><span>games scored</span></div>
  <div class="stat"><b>${list.length}</b><span>Dailies</span></div>
  <div class="stat"><b>${most.toLocaleString('en-US')}</b><span>most in a day</span></div>
  <div class="stat"><b>${bestEver ? bestEver.score : '–'}</b><span>best ever</span></div>
</div>
${bestEver ? `<p>The best score so far is <b>${bestEver.score}</b>, by <b>${esc(bestEver.name)}</b> on Daily #${dayNumber(bestEver.day)} (${esc(fmtDay(bestEver.day))}).</p>` : ''}
<h2>Day by day</h2>
${table}
<h2>Scores to beat</h2>
<p>Simulated play-callers set the bar: across ${SIM.length} simulated games, the top 10% scored <b>${simAt(0.9)}</b> or better and the average was <b>${simAt(0.5)}</b>. Your end-of-game screen shows how you compare.</p>
<h2>About the numbers</h2>
<p>A score is the game's Performance rating: 55% Decisions (how much win chance your calls gave up against the best option each time) and 45% Result (a win scores 75–100, a loss 0–25). See <a href="/how-to-play/#grades">how calls are graded</a>.</p>`;
  return page({
    path: '/stats/', eyebrow: 'Every Daily, all time',
    title: 'Stats: Every Daily Game | The 4th Call, NFL 2-Minute Drill Game',
    description: 'Results from every Daily of The 4th Call, the free NFL 2-minute drill game: games scored, players per day, average scores and the best play-callers.',
    h1: 'Everyone\'s <em>stats</em>', body, jsonld: { '@context': 'https://schema.org', '@graph': [breadcrumb('Stats', '/stats/')] },
  });
}

async function pages(request, env, url) {
  const p = url.pathname;
  if (p === '/leaderboard' || p === '/stats') return Response.redirect(`${url.origin}${p}/`, 301);
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
  const html = p === '/leaderboard/' ? await leaderboardPage(env) : await statsPage(env);
  return new Response(request.method === 'HEAD' ? null : html, { headers: PAGE_HEADERS });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (['/leaderboard', '/leaderboard/', '/stats', '/stats/'].includes(url.pathname)) {
      try { return await pages(request, env, url); } catch { return new Response('The leaderboard is unavailable right now. Try again in a minute.', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8', 'retry-after': '60' } }); }
    }
    if (url.pathname.startsWith('/v1/')) {
      try { return await api(request, env, url); } catch { return json({ error: 'unavailable' }, 503); }
    }
    return env.ASSETS.fetch(request);
  },
};
