#!/usr/bin/env node
/**
 * Builds src/data/nfl-rosters.json from nflverse's public data (CC-BY 4.0): the season's rosters (names, jersey
 * numbers, positions), its daily depth charts and weekly injury reports, and regular-season player statistics from
 * this season so far and the one before. It also writes src/data/nfl-rosters-audit.md, every team's starters and why,
 * to review before shipping a rebuild.
 *
 *   node scripts/build-rosters.mjs [season]      (default 2026; downloads into data-cache/, which is git-ignored;
 *                                                  delete the season's files there to pull fresh ones)
 *
 * STARTERS ARE THE HEALTHY STARTERS. Each team's starter at a position is the player its depth chart has listed first
 * the longest this year (regular-season days count double, the spring's a quarter), as long as he's still on the
 * team. A player who is hurt (injured reserve, inactive, or out or doubtful on the latest injury report) or simply
 * missing from today's chart keeps that credit, so a star who is injured still starts here and his fill-in doesn't.
 * A healthy player listed below someone else today has lost the job, and his credit with it. Volume per game breaks
 * ties and fills spots the depth chart doesn't name.
 *
 * Every player gets 0-100 GAME RATINGS computed here, by the formulas below, from that season's statistics. They are
 * this game's own estimates, not official measurements and not any other game's ratings. A player whose stats cannot
 * support a rating (linemen, kickers, low-snap players) is marked `estimated` and rated from his team's results or a
 * position baseline. The output records the season and source so the game can say where every number came from.
 *
 * Rating scale: for each attribute, a player's raw metric (from both seasons' statistics combined, so a player hurt
 * this year is rated on last year's) is ranked among the league's starters at his position and mapped to 52 (worst
 * starter) .. 98 (best). Positions are read from nflverse's depth-chart position (T/G/C, DE/DT/NT, OLB/ILB/MLB, CB/FS/SS).
 */
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const season = process.argv[2] || '2026';
const prior = String(Number(season) - 1);
const cache = join(root, 'data-cache');
mkdirSync(cache, { recursive: true });

const NFLVERSE = 'https://github.com/nflverse/nflverse-data/releases/download';
const SOURCES = {
  roster: `${NFLVERSE}/rosters/roster_${season}.csv`,
  stats: `${NFLVERSE}/stats_player/stats_player_reg_${season}.csv`,
  priorStats: `${NFLVERSE}/stats_player/stats_player_reg_${prior}.csv`,
  depth: `${NFLVERSE}/depth_charts/depth_charts_${season}.csv`,
  injuries: `${NFLVERSE}/injuries/injuries_${season}.csv`,
};

/** City, nickname and two colors for every franchise, by nflverse abbreviation. */
const TEAMS = {
  ARI: ['Arizona', 'Cardinals', '#97233F', '#FFB612'], ATL: ['Atlanta', 'Falcons', '#A71930', '#000000'],
  BAL: ['Baltimore', 'Ravens', '#241773', '#9E7C0C'], BUF: ['Buffalo', 'Bills', '#00338D', '#C60C30'],
  CAR: ['Carolina', 'Panthers', '#0085CA', '#101820'], CHI: ['Chicago', 'Bears', '#0B162A', '#C83803'],
  CIN: ['Cincinnati', 'Bengals', '#FB4F14', '#000000'], CLE: ['Cleveland', 'Browns', '#311D00', '#FF3C00'],
  DAL: ['Dallas', 'Cowboys', '#003594', '#869397'], DEN: ['Denver', 'Broncos', '#FB4F14', '#002244'],
  DET: ['Detroit', 'Lions', '#0076B6', '#B0B7BC'], GB: ['Green Bay', 'Packers', '#203731', '#FFB612'],
  HOU: ['Houston', 'Texans', '#03202F', '#A71930'], IND: ['Indianapolis', 'Colts', '#002C5F', '#A2AAAD'],
  JAX: ['Jacksonville', 'Jaguars', '#006778', '#D7A22A'], KC: ['Kansas City', 'Chiefs', '#E31837', '#FFB81C'],
  LV: ['Las Vegas', 'Raiders', '#000000', '#A5ACAF'], LAC: ['Los Angeles', 'Chargers', '#0080C6', '#FFC20E'],
  LA: ['Los Angeles', 'Rams', '#003594', '#FFA300'], MIA: ['Miami', 'Dolphins', '#008E97', '#FC4C02'],
  MIN: ['Minnesota', 'Vikings', '#4F2683', '#FFC62F'], NE: ['New England', 'Patriots', '#002244', '#C60C30'],
  NO: ['New Orleans', 'Saints', '#101820', '#D3BC8D'], NYG: ['New York', 'Giants', '#0B2265', '#A71930'],
  NYJ: ['New York', 'Jets', '#125740', '#FFFFFF'], PHI: ['Philadelphia', 'Eagles', '#004C54', '#A5ACAF'],
  PIT: ['Pittsburgh', 'Steelers', '#101820', '#FFB612'], SF: ['San Francisco', '49ers', '#AA0000', '#B3995D'],
  SEA: ['Seattle', 'Seahawks', '#002244', '#69BE28'], TB: ['Tampa Bay', 'Buccaneers', '#D50A0A', '#34302B'],
  TEN: ['Tennessee', 'Titans', '#0C2340', '#4B92DB'], WAS: ['Washington', 'Commanders', '#5A1414', '#FFB612'],
};

async function fetchCsv(name, url, yr = season) {
  const file = join(cache, `${name}_${yr}.csv`);
  if (!existsSync(file)) {
    process.stdout.write(`downloading ${url}\n`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    await pipeline(Readable.fromWeb(res.body), createWriteStream(file));
  }
  return parseCsv(readFileSync(file, 'utf8'));
}

function parseCsv(txt) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < txt.length; i++) {
    const c = txt[i];
    if (q) { if (c === '"') { if (txt[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const h = rows[0];
  return rows.slice(1).filter((r) => r.length === h.length).map((r) => Object.fromEntries(h.map((k, i) => [k, r[i]])));
}

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const clip = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

/** Rank-based scale: the worst starter at the position scores 52, the best 98. */
function scale(values) {
  const sorted = [...values].filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  return (v) => {
    if (!sorted.length || !Number.isFinite(v)) return 70;
    let below = 0, eq = 0;
    for (const x of sorted) { if (x < v) below++; else if (x === v) eq++; }
    const pct = (below + eq / 2) / sorted.length;
    return Math.round(52 + 46 * pct);
  };
}

const roster = await fetchCsv('roster', SOURCES.roster);
const stats = await fetchCsv('stats', SOURCES.stats);
const priorStats = await fetchCsv('stats', SOURCES.priorStats, prior);
const depth = await fetchCsv('depth_charts', SOURCES.depth);
const injuries = await fetchCsv('injuries', SOURCES.injuries);

// each player's latest roster row of the season: current team, number, position
const latest = new Map();
for (const r of roster) {
  if (!r.gsis_id || !r.team) continue;
  const prev = latest.get(r.gsis_id);
  if (!prev || num(r.week) > num(prev.week)) latest.set(r.gsis_id, r);
}
// both seasons' statistics, combined per player: counts add up, rates and shares are averaged by games played
const RATES = new Set(['passing_cpoe', 'target_share', 'air_yards_share', 'wopr', 'racr', 'pacr', 'dakota']);
const statOf = new Map();
for (const rows of [priorStats, stats]) for (const s of rows) {
  const cur = statOf.get(s.player_id);
  if (!cur) { statOf.set(s.player_id, { ...s }); continue; }
  const ga = num(cur.games), gb = num(s.games);
  for (const k in s) {
    if (k === 'season' || k === 'player_id' || !Number.isFinite(parseFloat(s[k]))) continue;
    cur[k] = RATES.has(k) ? (num(cur[k]) * ga + num(s[k]) * gb) / Math.max(1, ga + gb) : num(cur[k]) + num(s[k]);
  }
}
const g = (id, k) => num(statOf.get(id)?.[k]);
const games = (id) => Math.max(1, g(id, 'games'));

// ---- raw metrics per attribute (documented in the header). Higher is always better.
const METRIC = {
  QB: {
    accuracy: (id) => g(id, 'completions') / Math.max(1, g(id, 'attempts')) + 0.01 * g(id, 'passing_cpoe'),
    arm: (id) => g(id, 'passing_air_yards') / Math.max(1, g(id, 'attempts')) + 3 * g(id, 'passing_40') / Math.max(1, g(id, 'attempts')),
    decision: (id) => g(id, 'passing_epa') / Math.max(1, g(id, 'attempts')) - 2 * g(id, 'passing_interceptions') / Math.max(1, g(id, 'attempts')) - 1.5 * g(id, 'sacks_suffered') / Math.max(1, g(id, 'attempts') + g(id, 'sacks_suffered')),
    mobility: (id) => g(id, 'rushing_yards') / games(id) + 0.5 * g(id, 'carries') / games(id),
  },
  RB: {
    speed: (id) => (g(id, 'rushing_20') + 2 * g(id, 'rushing_40') + g(id, 'receiving_20')) / Math.max(1, g(id, 'carries') + g(id, 'receptions')),
    acceleration: (id) => g(id, 'rushing_10') / Math.max(1, g(id, 'carries')),
    agility: (id) => g(id, 'rushing_yards') / Math.max(1, g(id, 'carries')) + 0.02 * g(id, 'rushing_epa'),
    power: (id) => (g(id, 'rushing_first_downs') + 2 * g(id, 'rushing_tds')) / Math.max(1, g(id, 'carries')) - 0.5 * g(id, 'rushing_fumbles_lost') / Math.max(1, g(id, 'carries')),
    hands: (id) => g(id, 'receptions') / Math.max(1, g(id, 'targets')) + 0.01 * g(id, 'receiving_yards') / games(id),
  },
  WR: {
    speed: (id) => (g(id, 'receiving_20') + 2 * g(id, 'receiving_40')) / Math.max(1, g(id, 'receptions')) + 0.05 * g(id, 'receiving_yards_after_catch') / Math.max(1, g(id, 'receptions')),
    acceleration: (id) => g(id, 'receiving_yards_after_catch') / Math.max(1, g(id, 'receptions')),
    routeRunning: (id) => g(id, 'receiving_yards') / Math.max(1, g(id, 'targets')) + 20 * num(statOf.get(id)?.target_share),
    hands: (id) => g(id, 'receptions') / Math.max(1, g(id, 'targets')) - 0.1 * g(id, 'receiving_fumbles') / Math.max(1, g(id, 'receptions')),
    release: (id) => num(statOf.get(id)?.air_yards_share) + 0.005 * g(id, 'receiving_air_yards') / games(id),
    contested: (id) => (g(id, 'receiving_tds') + 0.5 * g(id, 'receiving_first_downs')) / Math.max(1, g(id, 'targets')) + 0.02 * g(id, 'receiving_epa') / games(id),
  },
  TE: null,   // same as WR for route/hands/speed/contested; blocking is estimated
  DL: {
    passRush: (id) => (g(id, 'def_sacks') + 0.5 * g(id, 'def_qb_hits')) / games(id),
    runDefense: (id) => (g(id, 'def_tackles_for_loss') + 0.25 * (g(id, 'def_tackles_solo') + g(id, 'def_tackle_assists'))) / games(id),
    tackling: (id) => (g(id, 'def_tackles_solo') + 0.5 * g(id, 'def_tackle_assists')) / games(id) - 0.3 * g(id, 'def_fumbles') / games(id),
    pursuit: (id) => (g(id, 'def_tackles_solo') + g(id, 'def_tackle_assists') + g(id, 'def_fumbles_forced')) / games(id),
  },
  LB: {
    passRush: (id) => (g(id, 'def_sacks') + 0.5 * g(id, 'def_qb_hits')) / games(id),
    runDefense: (id) => (g(id, 'def_tackles_for_loss') + 0.3 * (g(id, 'def_tackles_solo') + g(id, 'def_tackle_assists'))) / games(id),
    tackling: (id) => (g(id, 'def_tackles_solo') + 0.5 * g(id, 'def_tackle_assists')) / games(id),
    pursuit: (id) => (g(id, 'def_tackles_solo') + g(id, 'def_tackle_assists') + g(id, 'def_fumbles_forced')) / games(id),
    coverage: (id) => (g(id, 'def_pass_defended') + 2 * g(id, 'def_interceptions')) / games(id),
  },
  CB: {
    coverage: (id) => (g(id, 'def_pass_defended') + 2 * g(id, 'def_interceptions')) / games(id),
    reaction: (id) => g(id, 'def_pass_defended') / games(id),
    speed: (id) => (g(id, 'def_pass_defended') + g(id, 'def_interceptions')) / games(id) + 0.1 * g(id, 'def_tackles_solo') / games(id),   // proxy: closing on throws
    tackling: (id) => (g(id, 'def_tackles_solo') + 0.5 * g(id, 'def_tackle_assists')) / games(id),
    ballSkills: (id) => (2 * g(id, 'def_interceptions') + 0.5 * g(id, 'def_pass_defended') + g(id, 'def_fumbles_forced')) / games(id),
  },
};
METRIC.TE = METRIC.WR;
METRIC.S = METRIC.CB;

// ---- starters: the healthy starters, from the depth charts (see the header)
const KICKOFF = (() => { const d = new Date(Date.UTC(+season, 8, 1)); while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1); d.setUTCDate(d.getUTCDate() + 3); return d.toISOString().slice(0, 10); })();
const CAMP = new Date(Date.parse(KICKOFF) - 50 * 864e5).toISOString().slice(0, 10);
const dayWeight = (day) => (day >= KICKOFF ? 2 : day >= CAMP ? 1 : 0.25);
/** A depth-chart spot's position group, by the defense's front (a 3-4's outside linebackers are its edge rushers). */
const spotGroup = (grp, abb) => ({ QB: 'QB', RB: 'RB', WR: 'WR', TE: 'TE', LT: 'T', RT: 'T', LG: 'G', RG: 'G', C: 'C', PK: 'K', P: 'P', LCB: 'CB', RCB: 'CB', SS: 'S', FS: 'S' })[abb]
  ?? (grp === 'Base 4-3 D' ? { LDE: 'EDGE', RDE: 'EDGE', LDT: 'DL', RDT: 'DL', WLB: 'LB', MLB: 'LB', SLB: 'LB' }[abb]
    : grp === 'Base 3-4 D' ? { WLB: 'EDGE', SLB: 'EDGE', LDE: 'DL', NT: 'DL', RDE: 'DL', LILB: 'LB', RILB: 'LB' }[abb] : undefined);
const chartDays = new Map();    // team|group|id → { d1: Set of days listed first, d2: Set of days listed second }
const lastChart = new Map();    // team → the latest snapshot's time
for (const d of depth) if (TEAMS[d.team] && d.dt > (lastChart.get(d.team) ?? '')) lastChart.set(d.team, d.dt);
const nowRank = new Map();      // team|group|id → best rank on the latest chart
const onChartNow = new Set();   // team|id: on the latest chart somewhere
// a player's rank is his place within his own spot: the receivers' ranks run on across the three receiver spots
// (first in each spot: 1, 2, 3; then the backups 4, 5, 6), so "listed first" means first in his spot
const spotRows = new Map();
for (const d of depth) {
  const key = `${d.dt}|${d.team}|${d.pos_grp}|${d.pos_slot}`;
  if (!spotRows.has(key)) spotRows.set(key, []);
  spotRows.get(key).push(d);
}
const spotRank = new Map();
for (const rows of spotRows.values()) rows.sort((a, b) => num(a.pos_rank) - num(b.pos_rank)).forEach((d, i) => spotRank.set(d, i + 1));
for (const d of depth) {
  const gp = spotGroup(d.pos_grp, d.pos_abb);
  if (!gp || !d.gsis_id || !TEAMS[d.team]) continue;
  const k = `${d.team}|${gp}|${d.gsis_id}`, rank = spotRank.get(d), day = d.dt.slice(0, 10);
  if (!chartDays.has(k)) chartDays.set(k, { d1: new Set(), d2: new Set() });
  if (rank === 1) chartDays.get(k).d1.add(day); else if (rank === 2) chartDays.get(k).d2.add(day);
  if (d.dt === lastChart.get(d.team)) { nowRank.set(k, Math.min(nowRank.get(k) ?? 99, rank)); onChartNow.add(`${d.team}|${d.gsis_id}`); }
}
const weighted = (days) => [...(days ?? [])].reduce((a, day) => a + dayWeight(day), 0);
// hurt now: on a reserve list or inactive, or out or doubtful on the latest week's injury report
const lastWeek = Math.max(...injuries.map((i) => num(i.week)));
const hurt = new Set(injuries.filter((i) => num(i.week) === lastWeek && /^(Out|Doubtful)$/.test(i.report_status)).map((i) => i.gsis_id));
for (const r of latest.values()) if (r.status === 'RES' || r.status === 'INA') hurt.add(r.gsis_id);
/** How strongly the depth chart makes this player the team's starter in the group, healthy or not. */
const chartCredit = (abbr, gp, r) => {
  const k = `${abbr}|${gp}|${r.gsis_id}`, c = chartDays.get(k), now = nowRank.get(k);
  // healthy and listed below someone today, or listed today only at another position (he moved): the job is gone
  const benched = !hurt.has(r.gsis_id) && ((now != null && now > 1) || (now == null && onChartNow.has(`${abbr}|${r.gsis_id}`)));
  return { first: benched ? 0 : weighted(c?.d1), second: weighted(c?.d2), now, benched };
};

const byTeam = new Map();
for (const r of latest.values()) {
  // released, retired, traded-away and exempt players are off the team; the practice squad only fills a slot nobody else can
  if (!TEAMS[r.team] || ['RET', 'CUT', 'TRD', 'TRT', 'EXE'].includes(r.status)) continue;
  if (!byTeam.has(r.team)) byTeam.set(r.team, []);
  byTeam.get(r.team).push(r);
}
const dc = (r) => r.depth_chart_position || r.position;
const vol = {
  QB: (id) => g(id, 'attempts'), RB: (id) => g(id, 'carries') + 0.5 * g(id, 'targets'), WR: (id) => g(id, 'targets'), TE: (id) => g(id, 'targets'),
  DL: (id) => g(id, 'def_tackles_solo') + g(id, 'def_tackle_assists') + 3 * g(id, 'def_sacks') + g(id, 'def_qb_hits'),
  LB: (id) => g(id, 'def_tackles_solo') + g(id, 'def_tackle_assists') + 2 * g(id, 'def_sacks'),
  CB: (id) => g(id, 'def_tackles_solo') + g(id, 'def_tackle_assists') + 2 * g(id, 'def_pass_defended'),
  S: (id) => g(id, 'def_tackles_solo') + g(id, 'def_tackle_assists') + 2 * g(id, 'def_pass_defended'),
  OL: (r) => num(r.years_exp) + (num(r.draft_number) ? (300 - num(r.draft_number)) / 300 : 0),
  K: () => 1, P: () => 1,
};
const pick = (rows, pred, n, key) => rows.filter(pred).sort((a, b) => key(b) - key(a)).slice(0, n);
const perGame = (f) => (id) => f(id) / games(id);
/** The starter key: depth-chart credit first, then volume per game (which also orders the starters within a group). */
const VPG = { QB: perGame(vol.QB), RB: perGame(vol.RB), WR: perGame(vol.WR), TE: perGame(vol.TE), EDGE: perGame(vol.DL), DL: perGame(vol.DL), LB: perGame(vol.LB), CB: perGame(vol.CB), S: perGame(vol.S) };
/** A star: per-game production in the top quarter of the players the league's charts list first at the position (6+ games). */
const STAR = {};
for (const gp in VPG) {
  const xs = [];
  for (const [k, c] of chartDays) { const [, g2, id] = k.split('|'); if (g2 === gp && c.d1.size && games(id) >= 6) xs.push(VPG[gp](id)); }
  xs.sort((a, b) => a - b);
  STAR[gp] = xs.length ? xs[Math.floor(xs.length * 0.75)] : Infinity;
}
/**
 * A player's claim to start in these groups: his depth-chart credit, raised above everyone's when he is a star who
 * is hurt (out since before the season, say, so this year's charts barely list him): he starts here regardless.
 */
const CHART_GROUPS = ['QB', 'RB', 'WR', 'TE', 'T', 'G', 'C', 'EDGE', 'DL', 'LB', 'CB', 'S', 'K', 'P'];
/** The group a player's team charts him in most (listed first or second), or null if it never has. */
const mainGroup = (abbr, id) => {
  let best = null, n = 0;
  for (const gp of CHART_GROUPS) { const c = chartDays.get(`${abbr}|${gp}|${id}`); const m = c ? c.d1.size + c.d2.size : 0; if (m > n) { n = m; best = gp; } }
  return best;
};
const claim = (abbr, groups, r) => {
  const c = groups.map((gp) => chartCredit(abbr, gp, r));
  const home = mainGroup(abbr, r.gsis_id);   // a star only counts at his own position (or, never charted, the roster's)
  const star = hurt.has(r.gsis_id) && games(r.gsis_id) >= 6 && (home == null || groups.includes(home))
    && groups.some((gp) => VPG[gp] && VPG[gp](r.gsis_id) >= STAR[gp]);
  const first = Math.max(...c.map((x) => x.first));
  return { first: star ? Math.max(first, 1e4) : first, second: Math.max(...c.map((x) => x.second)), now: c.find((x) => x.now != null)?.now, star, chart: first };
};
const starter = (abbr, groups, vpg) => (r) => {
  const c = claim(abbr, groups, r);
  return 1000 * c.first + 10 * c.second + vpg(r);
};
const why = {};   // team → slot → the reason, for the audit

const teams = {};
const issues = [];
for (const [abbr, rows] of byTeam) {
  const used = new Set(), usedNums = new Set();
  // active players first; nobody takes a number already on the roster we are building
  why[abbr] = {};
  // the starters by the depth chart; within a group (WR1-3, CB1-2...) the one with the most volume per game is first
  const take = (slots, pred, groups, vpg) => {
    const key = starter(abbr, groups, (r) => vpg(r.gsis_id) / 1000);
    const chosen = pick(rows.filter((r) => !used.has(r.gsis_id) && !usedNums.has(num(r.jersey_number))), pred, slots.length, (r) => key(r) + (r.status === 'DEV' ? -1e7 : 0))
      .sort((a, b) => vpg(b.gsis_id) - vpg(a.gsis_id));
    chosen.forEach((r) => { used.add(r.gsis_id); usedNums.add(num(r.jersey_number)); });
    slots.forEach((s, i) => {
      const r = chosen[i];
      if (!r) return;
      const c = claim(abbr, groups, r);
      why[abbr][s] = c.first >= 1e4 && c.chart < 1e4 && c.chart < 50 ? 'star, hurt (barely on this year’s charts): starts here regardless'
        : c.first ? (hurt.has(r.gsis_id) ? 'starter, hurt: starts here regardless' : c.now == null ? 'starter, not on today’s chart: starts here regardless' : 'starter')
        : c.second ? 'backup (the chart names no other starter)' : 'filled (not a listed starter)';
    });
    return Object.fromEntries(slots.map((s, i) => [s, chosen[i]]));
  };
  const isPos = (...ps) => (r) => ps.includes(dc(r)) || ps.includes(r.position);
  const olKey = (id) => vol.OL(rows.find((r) => r.gsis_id === id) ?? {});
  const sel = {
    ...take(['QB'], isPos('QB'), ['QB'], perGame(vol.QB)),
    ...take(['RB'], (r) => dc(r) === 'RB' || r.position === 'RB', ['RB'], perGame(vol.RB)),
    ...take(['WR1', 'WR2', 'WR3'], isPos('WR'), ['WR'], perGame(vol.WR)),
    ...take(['TE'], isPos('TE'), ['TE'], perGame(vol.TE)),
    ...take(['LT', 'RT'], (r) => dc(r) === 'T' || r.position === 'T' || r.position === 'OT', ['T'], olKey),
    ...take(['LG', 'RG'], (r) => dc(r) === 'G' || r.position === 'G' || r.position === 'OG', ['G'], olKey),
    ...take(['C'], (r) => dc(r) === 'C' || r.position === 'C', ['C'], olKey),
    ...take(['EDGE1', 'EDGE2'], (r) => ['DE', 'OLB'].includes(dc(r)), ['EDGE'], perGame(vol.DL)),
    ...take(['DL1', 'DL2'], (r) => ['DT', 'NT', 'DL', 'DE'].includes(dc(r)), ['DL'], perGame(vol.DL)),
    ...take(['LB1', 'LB2', 'LB3'], (r) => ['ILB', 'MLB', 'LB', 'OLB'].includes(dc(r)), ['LB', 'EDGE'], perGame(vol.LB)),
    ...take(['CB1', 'CB2'], (r) => ['CB', 'DB'].includes(dc(r)), ['CB'], perGame(vol.CB)),
    ...take(['S1', 'S2'], (r) => ['FS', 'SS', 'S', 'DB', 'CB'].includes(dc(r)), ['S'], perGame(vol.S)),
    ...take(['K'], isPos('K'), ['K'], vol.K),
    ...take(['P'], isPos('P'), ['P'], vol.P),
  };
  // fill any gap with the best remaining player of the broad position group
  const group = { LT: 'OL', LG: 'OL', C: 'OL', RG: 'OL', RT: 'OL', EDGE1: 'DL', EDGE2: 'DL', DL1: 'DL', DL2: 'DL', LB1: 'LB', LB2: 'LB', LB3: 'LB', CB1: 'DB', CB2: 'DB', S1: 'DB', S2: 'DB', WR1: 'WR', WR2: 'WR', WR3: 'WR' };
  for (const slot in sel) if (!sel[slot]) {
    const gp = group[slot] || slot;
    const alt = pick(rows.filter((r) => !used.has(r.gsis_id) && !usedNums.has(num(r.jersey_number))), (r) => r.position === gp, 1, (r) => num(r.years_exp))[0];
    if (alt) { sel[slot] = alt; used.add(alt.gsis_id); usedNums.add(num(alt.jersey_number)); why[abbr][slot] = 'filled (no player at the position)'; } else issues.push(`${abbr} ${slot}: no player`);
  }
  teams[abbr] = sel;
}

// ---- team-level numbers for linemen (no individual stats): sack rate allowed and yards per carry
const teamPro = {}, teamRun = {};
for (const abbr in teams) {
  const qb = teams[abbr].QB?.gsis_id;
  const att = g(qb, 'attempts'), sk = g(qb, 'sacks_suffered');
  teamPro[abbr] = att ? -sk / (att + sk) : -0.07;
  const rb = teams[abbr].RB?.gsis_id;
  teamRun[abbr] = g(rb, 'carries') ? g(rb, 'rushing_yards') / g(rb, 'carries') : 4.2;
}
const proScale = scale(Object.values(teamPro)), runScale = scale(Object.values(teamRun));

// ---- ratings: rank each starter's metric among all starters at the same slot group
const slotGroup = (slot) => slot.startsWith('WR') ? 'WR' : slot.startsWith('EDGE') || slot.startsWith('DL') ? 'DL' : slot.startsWith('LB') ? 'LB' : slot.startsWith('CB') ? 'CB' : slot.startsWith('S') ? 'S' : ['LT', 'LG', 'C', 'RG', 'RT'].includes(slot) ? 'OL' : slot;
const qualifies = { QB: (id) => g(id, 'attempts') >= 100, RB: (id) => g(id, 'carries') >= 50, WR: (id) => g(id, 'targets') >= 30, TE: (id) => g(id, 'targets') >= 20, DL: (id) => games(id) >= 6, LB: (id) => games(id) >= 6, CB: (id) => games(id) >= 6, S: (id) => games(id) >= 6 };
const scales = {};
for (const gp of ['QB', 'RB', 'WR', 'TE', 'DL', 'LB', 'CB', 'S']) {
  const ids = [];
  for (const abbr in teams) for (const slot in teams[abbr]) if (slotGroup(slot) === gp && teams[abbr][slot] && qualifies[gp](teams[abbr][slot].gsis_id)) ids.push(teams[abbr][slot].gsis_id);
  scales[gp] = {};
  for (const attr in METRIC[gp]) scales[gp][attr] = scale(ids.map((id) => METRIC[gp][attr](id)));
}
const jitter = (seed) => { let h = 2166136261; for (const ch of seed) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return (h % 1000) / 1000; };

const out = { season, built: new Date().toISOString().slice(0, 10), source: { name: 'nflverse (nflverse-data rosters, depth charts, injury reports and player stats)', url: 'https://github.com/nflverse/nflverse-data', license: 'CC-BY 4.0', season, stats: `${prior}-${season}` }, teams: {} };
for (const abbr in teams) {
  const t = TEAMS[abbr];
  const players = {};
  for (const slot in teams[abbr]) {
    const r = teams[abbr][slot];
    if (!r) continue;
    const id = r.gsis_id, gp = slotGroup(slot);
    let attrs = {}, source = 'stats';
    if (gp === 'OL') {
      const base = 0.55 * proScale(teamPro[abbr]) + 0.45 * runScale(teamRun[abbr]);
      const j = Math.round((jitter(id) - 0.5) * 6);
      attrs = { passPro: clip(Math.round(proScale(teamPro[abbr]) + j), 50, 99), runBlock: clip(Math.round(runScale(teamRun[abbr]) - j), 50, 99) };
      void base;
      source = 'estimated';
    } else if (gp === 'K' || gp === 'P') {
      attrs = gp === 'K' ? { kickPower: 80, kickAccuracy: 82 } : { kickPower: 80 };
      source = 'estimated';
    } else if (!qualifies[gp](id)) {
      // too few snaps to rate: a below-average starter, by position
      const names = Object.keys(METRIC[gp]);
      attrs = Object.fromEntries(names.map((a) => [a, 64 + Math.round((jitter(id + a) - 0.5) * 8)]));
      source = 'estimated';
    } else {
      for (const attr in METRIC[gp]) attrs[attr] = scales[gp][attr](METRIC[gp][attr](id));
    }
    if (gp === 'TE') { attrs.runBlock = 70 + Math.round((jitter(id + 'rb') - 0.5) * 16); attrs.passPro = 68 + Math.round((jitter(id + 'pp') - 0.5) * 16); }
    const vals = Object.values(attrs);
    players[slot] = {
      name: r.full_name, number: num(r.jersey_number), rating: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length), attrs, source,
      id,
    };
  }
  out.teams[abbr] = { id: abbr, city: t[0], name: t[1], color: t[2], color2: t[3], players };
}

// ---- checks: every slot filled, numbers unique within a team, attributes present
for (const abbr in out.teams) {
  const seen = new Map();
  for (const slot of ['QB', 'RB', 'WR1', 'WR2', 'WR3', 'TE', 'LT', 'LG', 'C', 'RG', 'RT', 'EDGE1', 'DL1', 'DL2', 'EDGE2', 'LB1', 'LB2', 'LB3', 'CB1', 'CB2', 'S1', 'S2', 'K', 'P']) {
    const p = out.teams[abbr].players[slot];
    if (!p) { issues.push(`${abbr} ${slot}: missing`); continue; }
    if (seen.has(p.number)) issues.push(`${abbr} ${slot}: #${p.number} also ${seen.get(p.number)}`);
    seen.set(p.number, slot);
  }
}
mkdirSync(join(root, 'src/data'), { recursive: true });
writeFileSync(join(root, 'src/data/nfl-rosters.json'), JSON.stringify(out));
// the audit: every team's starters and why, the injured stars kept in, to review before shipping
const SLOTS = ['QB', 'RB', 'WR1', 'WR2', 'WR3', 'TE', 'LT', 'LG', 'C', 'RG', 'RT', 'EDGE1', 'DL1', 'DL2', 'EDGE2', 'LB1', 'LB2', 'LB3', 'CB1', 'CB2', 'S1', 'S2', 'K', 'P'];
const kept = [];
const md = [`# NFL starters, ${season} (built ${out.built})`, '',
  `Healthy starters from nflverse depth charts (latest snapshot ${[...lastChart.values()].sort().pop()?.slice(0, 10)}) and injury reports (week ${lastWeek}); ratings from ${prior} and ${season} statistics. Generated by scripts/build-rosters.mjs: review the "regardless" rows and spot-check the names before shipping.`, ''];
for (const abbr of Object.keys(out.teams).sort()) {
  md.push(`## ${abbr} ${TEAMS[abbr][0]} ${TEAMS[abbr][1]}`, '', '| Slot | Player | # | Rating | Why |', '|---|---|---|---|---|');
  for (const slot of SLOTS) {
    const p = out.teams[abbr].players[slot];
    if (!p) continue;
    const w = why[abbr]?.[slot] ?? '';
    if (/regardless/.test(w)) kept.push(`${abbr} ${slot} ${p.name}`);
    md.push(`| ${slot} | ${p.name} | ${p.number} | ${p.rating} | ${w} |`);
  }
  md.push('');
}
md.splice(4, 0, `Injured or off-chart starters kept in (${kept.length}): ${kept.join(', ') || 'none'}.`, '');
writeFileSync(join(root, 'src/data/nfl-rosters-audit.md'), md.join('\n'));
console.log(`kept in despite injury or absence: ${kept.length}`);
const n = Object.keys(out.teams).length;
console.log(`wrote src/data/nfl-rosters.json: ${n} teams, season ${season}`);
if (issues.length) { console.log('issues:'); issues.forEach((i) => console.log('  ' + i)); }
const show = (abbr, slot) => { const p = out.teams[abbr]?.players[slot]; if (p) console.log(`${abbr} ${slot}: #${p.number} ${p.name} ${p.rating} ${JSON.stringify(p.attrs)} [${p.source}]`); };
show('CIN', 'QB'); show('SF', 'RB'); show('KC', 'QB'); show('ATL', 'RB'); show('SEA', 'WR1'); show('PHI', 'EDGE1'); show('NYJ', 'CB1');
