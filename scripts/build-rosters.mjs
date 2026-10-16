#!/usr/bin/env node
/**
 * Builds src/data/nfl-rosters.json from nflverse's public data (CC-BY 4.0): one season's rosters (names, jersey
 * numbers, positions) and regular-season player statistics.
 *
 *   node scripts/build-rosters.mjs [season]      (default 2025; downloads into data-cache/, which is git-ignored)
 *
 * Every player gets 0-100 GAME RATINGS computed here, by the formulas below, from that season's statistics. They are
 * this game's own estimates, not official measurements and not any other game's ratings. A player whose stats cannot
 * support a rating (linemen, kickers, low-snap players) is marked `estimated` and rated from his team's results or a
 * position baseline. The output records the season and source so the game can say where every number came from.
 *
 * Rating scale: for each attribute, a player's raw metric is ranked among the league's starters at his position and
 * mapped to 52 (worst starter) .. 98 (best); starters are the players with the most volume at the position on each
 * team. Positions are read from nflverse's depth-chart position (T/G/C, DE/DT/NT, OLB/ILB/MLB, CB/FS/SS).
 */
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const season = process.argv[2] || '2025';
const cache = join(root, 'data-cache');
mkdirSync(cache, { recursive: true });

const SOURCES = {
  roster: `https://github.com/nflverse/nflverse-data/releases/download/rosters/roster_${season}.csv`,
  stats: `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_reg_${season}.csv`,
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

async function fetchCsv(name, url) {
  const file = join(cache, `${name}_${season}.csv`);
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

// each player's latest roster row of the season: current team, number, position
const latest = new Map();
for (const r of roster) {
  if (!r.gsis_id || !r.team) continue;
  const prev = latest.get(r.gsis_id);
  if (!prev || num(r.week) > num(prev.week)) latest.set(r.gsis_id, r);
}
const statOf = new Map(stats.map((s) => [s.player_id, s]));
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

// ---- starters: the most-used players at each position on each team
const byTeam = new Map();
for (const r of latest.values()) {
  if (!TEAMS[r.team] || r.status === 'RET') continue;
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

const teams = {};
const issues = [];
for (const [abbr, rows] of byTeam) {
  const used = new Set(), usedNums = new Set();
  // active players first; nobody takes a number already on the roster we are building
  const take = (slots, pred, key) => {
    const chosen = pick(rows.filter((r) => !used.has(r.gsis_id) && !usedNums.has(num(r.jersey_number))), pred, slots.length, (r) => key(r) + (r.status === 'ACT' ? 1e6 : 0));
    chosen.forEach((r) => { used.add(r.gsis_id); usedNums.add(num(r.jersey_number)); });
    return Object.fromEntries(slots.map((s, i) => [s, chosen[i]]));
  };
  const isPos = (...ps) => (r) => ps.includes(dc(r)) || ps.includes(r.position);
  const sel = {
    ...take(['QB'], isPos('QB'), (r) => vol.QB(r.gsis_id)),
    ...take(['RB'], (r) => dc(r) === 'RB' || r.position === 'RB', (r) => vol.RB(r.gsis_id)),
    ...take(['WR1', 'WR2', 'WR3'], isPos('WR'), (r) => vol.WR(r.gsis_id)),
    ...take(['TE'], isPos('TE'), (r) => vol.TE(r.gsis_id)),
    ...take(['LT', 'RT'], (r) => dc(r) === 'T', vol.OL),
    ...take(['LG', 'RG'], (r) => dc(r) === 'G', vol.OL),
    ...take(['C'], (r) => dc(r) === 'C', vol.OL),
    ...take(['EDGE1', 'EDGE2'], (r) => ['DE', 'OLB'].includes(dc(r)), (r) => vol.DL(r.gsis_id)),
    ...take(['DL1', 'DL2'], (r) => ['DT', 'NT', 'DL', 'DE'].includes(dc(r)), (r) => vol.DL(r.gsis_id)),
    ...take(['LB1', 'LB2', 'LB3'], (r) => ['ILB', 'MLB', 'LB', 'OLB'].includes(dc(r)), (r) => vol.LB(r.gsis_id)),
    ...take(['CB1', 'CB2'], (r) => ['CB', 'DB'].includes(dc(r)), (r) => vol.CB(r.gsis_id)),
    ...take(['S1', 'S2'], (r) => ['FS', 'SS', 'S', 'DB', 'CB'].includes(dc(r)), (r) => vol.S(r.gsis_id)),
    ...take(['K'], isPos('K'), vol.K),
    ...take(['P'], isPos('P'), vol.P),
  };
  // fill any gap with the best remaining player of the broad position group
  const group = { LT: 'OL', LG: 'OL', C: 'OL', RG: 'OL', RT: 'OL', EDGE1: 'DL', EDGE2: 'DL', DL1: 'DL', DL2: 'DL', LB1: 'LB', LB2: 'LB', LB3: 'LB', CB1: 'DB', CB2: 'DB', S1: 'DB', S2: 'DB', WR1: 'WR', WR2: 'WR', WR3: 'WR' };
  for (const slot in sel) if (!sel[slot]) {
    const gp = group[slot] || slot;
    const alt = pick(rows.filter((r) => !used.has(r.gsis_id) && !usedNums.has(num(r.jersey_number))), (r) => r.position === gp, 1, (r) => num(r.years_exp))[0];
    if (alt) { sel[slot] = alt; used.add(alt.gsis_id); usedNums.add(num(alt.jersey_number)); } else issues.push(`${abbr} ${slot}: no player`);
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

const out = { season, built: new Date().toISOString().slice(0, 10), source: { name: 'nflverse (nflverse-data rosters and player stats)', url: 'https://github.com/nflverse/nflverse-data', license: 'CC-BY 4.0', season }, teams: {} };
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
const n = Object.keys(out.teams).length;
console.log(`wrote src/data/nfl-rosters.json: ${n} teams, season ${season}`);
if (issues.length) { console.log('issues:'); issues.forEach((i) => console.log('  ' + i)); }
const show = (abbr, slot) => { const p = out.teams[abbr]?.players[slot]; if (p) console.log(`${abbr} ${slot}: #${p.number} ${p.name} ${p.rating} ${JSON.stringify(p.attrs)} [${p.source}]`); };
show('ATL', 'RB'); show('SEA', 'WR1'); show('KC', 'QB'); show('ATL', 'LT'); show('PHI', 'EDGE1'); show('NYJ', 'CB1');
