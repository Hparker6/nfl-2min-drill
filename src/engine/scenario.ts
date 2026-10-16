/**
 * Scenarios: a late fourth-quarter spot between two fictional teams. Daily spots are seeded by the UTC date so
 * everyone gets the same three; Survivor spots by run and game number. A generated spot is only kept if it is
 * still in doubt (the AI coaches win it between 8% and 88% of the time), so no spot is decided before the first call.
 */
import { DEF_POS, FIRST, FRANCHISES, LAST, OFF_POS } from './data';
import { evaluate } from './evaluate';
import { clip, hash, pickWeighted, rng, type Rng } from './rng';
import type { Player, Ratings, State, Team, TeamInfo, Weather } from './types';
import { GROUP_ATTRS, SLOT_GROUP, units, type Attr, type PosGroup, type RosterMeta, type RosterPlayer } from './roster';
import { NFL_IDS, hasRealTeam, realTeam } from './nfl';

/** The current rosters are fictional: every name, number and rating below is generated. */
export const FICTIONAL_ROSTER: RosterMeta = { sourceName: 'Generated for fictional teams (The 4th Call)' };

// numbers each position usually wears; a team never repeats one
const NUMBER_POOL: Record<PosGroup, number[]> = {
  QB: range(1, 19), RB: [...range(20, 39), ...range(2, 9)], WR: [...range(10, 19), ...range(80, 89), ...range(1, 9)],
  TE: [...range(80, 89), ...range(40, 49)], OL: [...range(60, 79), ...range(50, 59)], DL: [...range(90, 99), ...range(50, 59)],
  LB: [...range(40, 59), ...range(90, 99)], CB: [...range(20, 39), ...range(1, 9)], S: [...range(20, 49)],
  K: [...range(1, 19)], P: [...range(1, 19)],
};
function range(a: number, b: number) { return Array.from({ length: b - a + 1 }, (_, i) => a + i); }

/**
 * Game ratings for a generated player: each attribute of the position spreads up to 7 points either side of the
 * player's level, so two equally rated receivers can still be a burner and a route technician.
 */
function genAttrs(group: PosGroup, level: number, r: Rng): Partial<Record<Attr, number>> {
  const out: Partial<Record<Attr, number>> = {};
  for (const a of GROUP_ATTRS[group]) out[a] = clip(Math.round(level + (r() * 2 - 1) * 7), 40, 99);
  return out;
}

export type Mode = 'daily' | 'survivor' | 'practice';

export interface Scenario {
  id: string;
  seed: number;
  mode: Mode;
  teams: [TeamInfo, TeamInfo]; // [you, them]
  home: Team;
  start: State;
  baseWp: number;              // how often the AI coach wins it from here
  kind?: DailyKind;            // the daily's situation type (rotates by day)
}

/** The situation types a daily rotates through, so no two days in a row feel alike. */
export type DailyKind = 'drill' | 'hole' | 'tied' | 'closeout' | 'stand' | 'goalline' | 'fourthdown';
export const DAILY_KINDS: Record<DailyKind, { name: string; tagline: string }> = {
  drill: { name: 'Two-minute drill', tagline: 'Down a score, short on clock. Get into range.' },
  hole: { name: 'Dig out of the hole', tagline: 'Down more than a field goal. You need a touchdown, and maybe more.' },
  tied: { name: 'Win it on this drive', tagline: 'Tied. Whoever handles the clock better goes home happy.' },
  closeout: { name: 'Close it out', tagline: 'You lead with the ball. Burn the clock without giving it back.' },
  stand: { name: 'Goal-line stand', tagline: 'They have the ball and the clock. Make the stop.' },
  goalline: { name: 'Four downs to win', tagline: 'Inside their 10 with time running out. Punch it in.' },
  fourthdown: { name: 'Fourth-down call', tagline: 'It starts on fourth down. Kick, punt or go?' },
};

export const SPOTS_PER_DAY = 1;

export function utcDate(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}
export function dayNumber(date: string): number {
  return Math.round((Date.parse(date + 'T00:00:00Z') - Date.parse('2026-01-01T00:00:00Z')) / 864e5) + 1;
}

const rnd = (r: Rng, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));

/** A real team when the id is one (the season's rosters), otherwise a generated fictional one (tests, old saves). */
export function makeTeam(id: string, seed: string): TeamInfo {
  if (hasRealTeam(id)) return realTeam(id);
  const f = FRANCHISES.find((x) => x[0] === id) || FRANCHISES[0];
  const r = rng(hash('team', id, seed));
  const off = rnd(r, 72, 92), def = rnd(r, 72, 92);
  const j = (v: number, s: number) => clip(Math.round(v + (r() * 2 - 1) * s), 55, 99);
  const rat: Ratings = {
    ovr: Math.round((off + def) / 2), off, def,
    qb: j(off, 5), ol: j(off - 2, 6), dl: j(def, 6), k: rnd(r, 72, 94),
    rcv: { WR1: j(off + 3, 4), WR2: j(off, 4), WR3: j(off - 4, 4), TE: j(off - 3, 5), RB: j(off - 2, 5) },
  };
  const names = rng(hash('names', id));
  const players: Record<string, Player> = {};
  const used = new Set<string>();
  const name = () => {
    for (;;) {
      const n = `${FIRST[Math.floor(names() * FIRST.length)]} ${LAST[Math.floor(names() * LAST.length)]}`;
      if (!used.has(n)) { used.add(n); return n; }
    }
  };
  const levels: Record<string, number> = {};
  // linemen and backs are generated on the same scale as the defense they face (the team rating has them 2 lower)
  for (const p of OFF_POS) levels[p] = p === 'QB' ? rat.qb : p === 'RB' ? rat.rcv.RB + 2 : p in rat.rcv ? rat.rcv[p as keyof Ratings['rcv']] : j(rat.ol + 2, 4);
  for (const p of DEF_POS) levels[p] = p.startsWith('EDGE') || p.startsWith('DL') ? j(rat.dl, 4) : j(def, 6);
  levels.K = rat.k;
  levels.P = j(78, 8);
  const ar = rng(hash('attrs', id, seed));
  const nr = rng(hash('numbers', id));
  const taken = new Set<number>();
  const roster: Record<string, RosterPlayer> = {};
  for (const slot of [...OFF_POS, ...DEF_POS, 'K', 'P']) {
    const g = SLOT_GROUP[slot];
    const attrs = genAttrs(g, levels[slot], ar);
    const vals = Object.values(attrs) as number[];
    const pool = NUMBER_POOL[g].filter((n) => !taken.has(n));
    const number = pool[Math.floor(nr() * Math.min(pool.length, 8))];
    taken.add(number);
    roster[slot] = { name: name(), number, rating: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length), attrs, source: 'generated' };
  }
  for (const slot in roster) players[slot] = roster[slot];
  rat.units = units(roster);
  return { id: f[0], city: f[1], name: f[2], color: f[3], color2: f[4], rat, players };
}

export interface SpotParams {
  you: string;
  them: string;
  side: 'off' | 'def';
  t: number;
  lead: number;          // your lead (negative: you trail)
  yl: number;            // the offense's yard line (from its own goal)
  down: number;
  dist: number;
  to: [number, number];
  running: boolean;
  home: Team;
  weather?: Weather;
}

/** How often each kind of weather turns up. Rare, so most games are clear. */
export const WEATHER_ODDS: Record<Weather, number> = { clear: 0.9, rain: 0.04, wind: 0.04, snow: 0.02 };

export function stateFrom(p: SpotParams, teams: [TeamInfo, TeamInfo]): State {
  const base = 14 + 3 * ((hash(p.you, p.them, p.t) % 6));
  const themScore = Math.max(0, base);
  const youScore = Math.max(0, themScore + p.lead);
  return {
    t: p.t, off: p.side === 'off' ? 0 : 1, score: [youScore, youScore - p.lead], to: [p.to[0], p.to[1]],
    down: p.down, dist: Math.min(p.dist, 100 - p.yl), yl: p.yl, running: p.running, stage: 'pre', warned: p.t <= 120,
    adj: 0, kicker: 0, safetyKick: false, pendLook: null, shownLook: null, pendPlay: null, k: 0,
    rat: [teams[0].rat, teams[1].rat],
    weather: p.weather ?? 'clear',
  };
}

function quickWp(s: State, seed: number): number {
  const [st] = evaluate(s, [{}], 160, seed);
  return st.wp / st.n;
}

export function genScenario(seedStr: string, mode: Mode, opts: { side?: 'off' | 'def'; hard?: number; kind?: DailyKind; avoid?: string[] } = {}): Scenario {
  const r = rng(hash('spot', seedStr));
  const all = NFL_IDS.length ? NFL_IDS : FRANCHISES.map((f) => f[0]);
  const ids = all.filter((id) => !opts.avoid?.includes(id));
  const a = ids[Math.floor(r() * ids.length)];
  let b = ids[Math.floor(r() * ids.length)];
  while (b === a) b = ids[Math.floor(r() * ids.length)];
  const K = opts.kind;
  const teams: [TeamInfo, TeamInfo] = [makeTeam(a, seedStr), makeTeam(b, seedStr)];
  const hard = opts.hard ?? 0;   // survivor ramps this up: deeper holes, less time
  const weather = pickWeighted<Weather>(r, WEATHER_ODDS);

  let best: { s: State; wp: number; p: SpotParams } | null = null;
  for (let tries = 0; tries < 14; tries++) {
    const side = K ? (K === 'stand' ? 'def' : 'off') : opts.side ?? (r() < 0.72 ? 'off' : 'def');
    const band = pickWeighted(r, { short: 0.3 + hard * 0.1, mid: 0.4, long: 0.3 - hard * 0.1 });
    let t = band === 'short' ? rnd(r, 28, 75) : band === 'mid' ? rnd(r, 76, 140) : rnd(r, 141, 270);
    let lead: number;
    if (side === 'off') {
      const k = pickWeighted(r, { close: 0.34, deep: 0.3 + hard * 0.08, tied: 0.2, ahead: 0.16 - hard * 0.05 });
      lead = k === 'close' ? -rnd(r, 1, 3) : k === 'deep' ? -rnd(r, 4, 8) : k === 'tied' ? 0 : rnd(r, 1, 6);
    } else {
      lead = r() < 0.8 ? rnd(r, 1, 8) : 0;
    }
    let yl = rnd(r, 15, 45), down = 1, dist = 10;
    // a daily's kind fixes the shape of the spot; the details still vary with the date
    if (K === 'drill') { lead = -rnd(r, 1, 3); t = rnd(r, 95, 150); }
    if (K === 'hole') { lead = -rnd(r, 4, 8); t = rnd(r, 150, 270); }
    if (K === 'tied') { lead = 0; t = rnd(r, 60, 130); }
    if (K === 'closeout') { lead = rnd(r, 1, 6); t = rnd(r, 100, 200); }
    if (K === 'stand') { lead = rnd(r, 1, 7); t = rnd(r, 60, 150); yl = rnd(r, 40, 70); }
    if (K === 'goalline') { lead = -rnd(r, 1, 6); t = rnd(r, 22, 50); yl = rnd(r, 88, 95); dist = Math.min(10, 100 - yl); }
    if (K === 'fourthdown') { lead = -rnd(r, 1, 3); t = rnd(r, 70, 140); yl = rnd(r, 50, 68); down = 4; dist = rnd(r, 1, 6); }
    const toPick = () => Number(pickWeighted(r, { 0: 0.18, 1: 0.3, 2: 0.3, 3: 0.22 }));
    const p: SpotParams = {
      you: a, them: b, side, t, lead, yl, down, dist, to: [toPick(), toPick()],
      running: r() < 0.5, home: r() < 0.5 ? 0 : 1, weather,
    };
    const s = stateFrom(p, teams);
    if (aiMix(seedStr)) s.mix = true;
    const wp = quickWp(s, hash(seedStr, tries));
    if (wp >= 0.08 && wp <= 0.88) { best = { s, wp, p }; break; }
    if (!best || Math.abs(wp - 0.4) < Math.abs(best.wp - 0.4)) best = { s, wp, p };
  }
  return { id: seedStr, seed: hash(seedStr), mode, teams, home: best!.p.home, start: best!.s, baseWp: best!.wp, kind: K };
}

/** The day's kind: a seven-day rotation shuffled per week, so consecutive days never repeat a type. */
export function dailyKind(date: string): DailyKind {
  const n = dayNumber(date);
  const week = Math.floor((n - 1) / 7), i = (n - 1) % 7;
  const kinds = Object.keys(DAILY_KINDS) as DailyKind[];
  const r = rng(hash('daily-week', week));
  for (let k = kinds.length - 1; k > 0; k--) { const j = Math.floor(r() * (k + 1)); [kinds[k], kinds[j]] = [kinds[j], kinds[k]]; }
  return kinds[i];
}

const prevDate = (date: string) => new Date(Date.parse(date + 'T00:00:00Z') - 864e5).toISOString().slice(0, 10);

/** Today's daily: one game, the same for everyone, its teams not seen yesterday. */
/**
 * The AI defense calls the full playbook from the 2026-10-17 daily on. Earlier dailies keep the seven base calls, so
 * a game saved before the change still replays exactly (a replay that came out differently would be restarted).
 */
export const MIX_FROM = '2026-10-17';
function aiMix(seedStr: string): boolean {
  const m = seedStr.match(/^daily:(\d{4}-\d{2}-\d{2}):/);
  return !m || m[1] >= MIX_FROM;
}

export function dailyScenarios(date: string): Scenario[] {
  const y = genScenario(`daily:${prevDate(date)}:0`, 'daily', { kind: dailyKind(prevDate(date)) });
  return [genScenario(`daily:${date}:0`, 'daily', { kind: dailyKind(date), avoid: [y.teams[0].id, y.teams[1].id] })];
}

export function survivorScenario(run: number, game: number): Scenario {
  return genScenario(`surv:${run}:${game}`, 'survivor', { hard: Math.min(2, game / 5) });
}

export function customScenario(p: SpotParams, seedStr: string): Scenario {
  const teams: [TeamInfo, TeamInfo] = [makeTeam(p.you, seedStr), makeTeam(p.them, seedStr)];
  const s = stateFrom(p, teams);
  s.mix = true;
  return { id: seedStr, seed: hash(seedStr), mode: 'practice', teams, home: p.home, start: s, baseWp: quickWp(s, hash(seedStr)) };
}
