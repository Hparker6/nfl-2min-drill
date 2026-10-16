/**
 * Scenarios: a late fourth-quarter spot between two fictional teams. Daily spots are seeded by the UTC date so
 * everyone gets the same three; Survivor spots by run and game number. A generated spot is only kept if it is
 * still in doubt (the AI coaches win it between 8% and 88% of the time), so no spot is decided before the first call.
 */
import { DEF_POS, FIRST, FRANCHISES, LAST, OFF_POS } from './data';
import { evaluate } from './evaluate';
import { clip, hash, pickWeighted, rng, type Rng } from './rng';
import type { Player, Ratings, State, Team, TeamInfo } from './types';

export type Mode = 'daily' | 'survivor' | 'practice';

export interface Scenario {
  id: string;
  seed: number;
  mode: Mode;
  teams: [TeamInfo, TeamInfo]; // [you, them]
  home: Team;
  start: State;
  baseWp: number;              // how often the AI coach wins it from here
}

export const SPOTS_PER_DAY = 3;

export function utcDate(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}
export function dayNumber(date: string): number {
  return Math.round((Date.parse(date + 'T00:00:00Z') - Date.parse('2026-01-01T00:00:00Z')) / 864e5) + 1;
}

const rnd = (r: Rng, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));

export function makeTeam(id: string, seed: string): TeamInfo {
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
  for (const p of OFF_POS) {
    const rating = p === 'QB' ? rat.qb : p in rat.rcv ? rat.rcv[p as keyof Ratings['rcv']] : j(rat.ol, 4);
    players[p] = { name: name(), rating };
  }
  for (const p of DEF_POS) {
    const rating = p.startsWith('EDGE') || p.startsWith('DL') ? j(rat.dl, 4) : j(def, 6);
    players[p] = { name: name(), rating };
  }
  players.K = { name: name(), rating: rat.k };
  players.P = { name: name(), rating: j(78, 8) };
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
}

export function stateFrom(p: SpotParams, teams: [TeamInfo, TeamInfo]): State {
  const base = 14 + 3 * ((hash(p.you, p.them, p.t) % 6));
  const themScore = Math.max(0, base);
  const youScore = Math.max(0, themScore + p.lead);
  return {
    t: p.t, off: p.side === 'off' ? 0 : 1, score: [youScore, youScore - p.lead], to: [p.to[0], p.to[1]],
    down: p.down, dist: Math.min(p.dist, 100 - p.yl), yl: p.yl, running: p.running, stage: 'pre', warned: p.t <= 120,
    adj: 0, kicker: 0, safetyKick: false, pendLook: null, shownLook: null, pendPlay: null, k: 0,
    rat: [teams[0].rat, teams[1].rat],
  };
}

function quickWp(s: State, seed: number): number {
  const [st] = evaluate(s, [{}], 160, seed);
  return st.wp / st.n;
}

export function genScenario(seedStr: string, mode: Mode, opts: { side?: 'off' | 'def'; hard?: number } = {}): Scenario {
  const r = rng(hash('spot', seedStr));
  const ids = FRANCHISES.map((f) => f[0]);
  const a = ids[Math.floor(r() * ids.length)];
  let b = ids[Math.floor(r() * ids.length)];
  while (b === a) b = ids[Math.floor(r() * ids.length)];
  const teams: [TeamInfo, TeamInfo] = [makeTeam(a, seedStr), makeTeam(b, seedStr)];
  const hard = opts.hard ?? 0;   // survivor ramps this up: deeper holes, less time

  let best: { s: State; wp: number; p: SpotParams } | null = null;
  for (let tries = 0; tries < 14; tries++) {
    const side = opts.side ?? (r() < 0.72 ? 'off' : 'def');
    const band = pickWeighted(r, { short: 0.3 + hard * 0.1, mid: 0.4, long: 0.3 - hard * 0.1 });
    const t = band === 'short' ? rnd(r, 28, 75) : band === 'mid' ? rnd(r, 76, 140) : rnd(r, 141, 270);
    let lead: number;
    if (side === 'off') {
      const k = pickWeighted(r, { close: 0.34, deep: 0.3 + hard * 0.08, tied: 0.2, ahead: 0.16 - hard * 0.05 });
      lead = k === 'close' ? -rnd(r, 1, 3) : k === 'deep' ? -rnd(r, 4, 8) : k === 'tied' ? 0 : rnd(r, 1, 6);
    } else {
      lead = r() < 0.8 ? rnd(r, 1, 8) : 0;
    }
    const yl = rnd(r, 15, 45);
    const toPick = () => Number(pickWeighted(r, { 0: 0.18, 1: 0.3, 2: 0.3, 3: 0.22 }));
    const p: SpotParams = {
      you: a, them: b, side, t, lead, yl, down: 1, dist: 10, to: [toPick(), toPick()],
      running: r() < 0.5, home: r() < 0.5 ? 0 : 1,
    };
    const s = stateFrom(p, teams);
    const wp = quickWp(s, hash(seedStr, tries));
    if (wp >= 0.08 && wp <= 0.88) { best = { s, wp, p }; break; }
    if (!best || Math.abs(wp - 0.4) < Math.abs(best.wp - 0.4)) best = { s, wp, p };
  }
  return { id: seedStr, seed: hash(seedStr), mode, teams, home: best!.p.home, start: best!.s, baseWp: best!.wp };
}

export function dailyScenarios(date: string): Scenario[] {
  // spot 3 of the day is on defense half the time, so every day is not all offense
  const sides: ('off' | 'def' | undefined)[] = ['off', 'off', undefined];
  return Array.from({ length: SPOTS_PER_DAY }, (_, i) => genScenario(`daily:${date}:${i}`, 'daily', { side: sides[i] }));
}

export function survivorScenario(run: number, game: number): Scenario {
  return genScenario(`surv:${run}:${game}`, 'survivor', { hard: Math.min(2, game / 5) });
}

export function customScenario(p: SpotParams, seedStr: string): Scenario {
  const teams: [TeamInfo, TeamInfo] = [makeTeam(p.you, seedStr), makeTeam(p.them, seedStr)];
  const s = stateFrom(p, teams);
  return { id: seedStr, seed: hash(seedStr), mode: 'practice', teams, home: p.home, start: s, baseWp: quickWp(s, hash(seedStr)) };
}
