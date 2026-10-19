/**
 * Box scores from a full game's events: every snap credited to the players involved, the way the NFL keeps stats.
 * Who made the tackle, the sack or the pass breakup is not in the engine's result, so it is drawn here from the
 * defenders who could have (by position, the coverage and the play), seeded by the game and the snap.
 */
import { hash, rng, type Rng } from '../engine/rng';
import type { Ev, Team, TeamInfo } from '../engine/types';
import { pickWeighted } from '../engine/rng';

/** One player's game (or season): only the stats he has are present. */
export type Line = Partial<Record<Stat, number>>;
export type Stat =
  | 'gp'                                                         // games played
  | 'pa' | 'pc' | 'py' | 'ptd' | 'pint' | 'sk' | 'sky' | 'plng'  // passing: attempts, completions, yards, TD, INT, sacked, sack yards, long
  | 'ra' | 'ry' | 'rtd' | 'rlng' | 'fum'                         // rushing; fumbles lost (any touch)
  | 'tgt' | 'rec' | 'rcy' | 'rctd' | 'rclng'                     // receiving
  | 'tk' | 'tfl' | 'sck' | 'int' | 'inty' | 'pd' | 'ff' | 'dtd'  // defense
  | 'fga' | 'fgm' | 'fglng' | 'xpa' | 'xpm' | 'pn' | 'pny';      // kicking

export interface TeamLine {
  pts: number; yds: number; py: number; ry: number; plays: number; fd: number; to: number;
  td3: number; att3: number; pen: number; top: number; sacks: number;
}

export interface ScoringPlay { q: number; t: number; team: Team; text: string; score: [number, number] }

export interface Box {
  /** player id → line */
  players: Record<string, Line>;
  team: [TeamLine, TeamLine];
  /** points by period: [team][period index] */
  byQ: [number[], number[]];
  scoring: ScoringPlay[];
  final: [number, number];
  ot: boolean;
}

const MAX: Stat[] = ['plng', 'rlng', 'rclng', 'fglng'];

export function add(line: Line, k: Stat, v: number) {
  if (MAX.includes(k)) line[k] = Math.max(line[k] ?? -99, v);
  else line[k] = (line[k] ?? 0) + v;
}

/** Add one line into a season total. */
export function addLine(into: Line, l: Line) {
  for (const k in l) add(into, k as Stat, l[k as Stat]!);
}

/** NFL passer rating. */
export function passerRating(l: Line): number {
  const a = l.pa ?? 0;
  if (!a) return 0;
  const c = (x: number) => Math.max(0, Math.min(2.375, x));
  const v = c(((l.pc ?? 0) / a - 0.3) * 5) + c(((l.py ?? 0) / a - 3) * 0.25) + c(((l.ptd ?? 0) / a) * 20) + c(2.375 - ((l.pint ?? 0) / a) * 25);
  return Math.round((v / 6) * 1000) / 10;
}

const emptyTeam = (): TeamLine => ({ pts: 0, yds: 0, py: 0, ry: 0, plays: 0, fd: 0, to: 0, td3: 0, att3: 0, pen: 0, top: 0, sacks: 0 });

/** Who on defense: weights by slot for each kind of play. */
const TACKLE_RUN: Record<string, number> = { LB1: 5, LB2: 4, LB3: 2.5, DL1: 2, DL2: 2, EDGE1: 1.6, EDGE2: 1.6, S1: 2.2, S2: 1.8, CB1: 1, CB2: 1 };
const TACKLE_SHORT: Record<string, number> = { LB1: 3, LB2: 3, LB3: 2, CB1: 3, CB2: 3, S1: 2, S2: 2, EDGE1: 0.4, EDGE2: 0.4 };
const TACKLE_DEEP: Record<string, number> = { CB1: 3, CB2: 3, S1: 3.5, S2: 3.5, LB1: 1, LB2: 0.6 };
const SACK: Record<string, number> = { EDGE1: 5, EDGE2: 4.5, DL1: 2.4, DL2: 2.2, LB1: 1.2, LB2: 0.8, LB3: 0.6, S1: 0.3, CB2: 0.2 };
const COVER: Record<string, string> = { WR1: 'CB1', WR2: 'CB2', WR3: 'S2', TE: 'LB2', RB: 'LB1' };

function pick(r: Rng, w: Record<string, number>, team: TeamInfo): string {
  const avail: Record<string, number> = {};
  for (const k in w) if (team.players[k]) avail[k] = w[k];
  return pickWeighted(r, avail);
}

/**
 * Build the box score. `teams[i]` is team i of the game state, and `pid(i, slot)` names the player in that slot
 * (a stable id, so lines add up across a season).
 */
export function boxScore(events: Ev[], teams: [TeamInfo, TeamInfo], seed: number, pid: (team: Team, slot: string) => string): Box {
  const players: Record<string, Line> = {};
  const L = (team: Team, slot: string) => (players[pid(team, slot)] ??= {});
  const team: [TeamLine, TeamLine] = [emptyTeam(), emptyTeam()];
  const byQ: [number[], number[]] = [[0], [0]];
  const scoring: ScoringPlay[] = [];
  const score: [number, number] = [0, 0];
  let q = 1, lastT: number | null = null, lastOff: Team | null = null, ot = false;
  const scored = (tm: Team, pts: number, t: number, text: string) => {
    score[tm] += pts; byQ[tm][q - 1] = (byQ[tm][q - 1] ?? 0) + pts;
    if (text) scoring.push({ q, t, team: tm, text, score: [score[0], score[1]] });
  };
  const nm = (tm: Team, slot: string) => teams[tm].players[slot]?.name ?? slot;

  // everyone who dressed gets a game played
  for (const tm of [0, 1] as Team[]) for (const slot in teams[tm].players) L(tm, slot).gp = 1;

  events.forEach((ev, i) => {
    const r = rng(hash(seed, i, 'box'));
    if (ev.type === 'period') {
      q = ev.q; if (q >= 5) ot = true;
      byQ[0][q - 1] ??= 0; byQ[1][q - 1] ??= 0;
      lastT = null;
      return;
    }
    if (ev.type === 'pat') {
      if (ev.def2) { scored(ev.off === 0 ? 1 : 0, 2, ev.t, `${teams[ev.off === 0 ? 1 : 0].city}: defensive two-point return`); return; }
      if (!ev.two) { add(L(ev.off, 'K'), 'xpa', 1); if (ev.good) add(L(ev.off, 'K'), 'xpm', 1); }
      if (ev.good) {
        scored(ev.off, ev.two ? 2 : 1, ev.t, '');
        const last = scoring[scoring.length - 1];
        if (last) { last.text += ev.two ? ' (two-point try good)' : ''; last.score = [score[0], score[1]]; }
      } else if (scoring.length) scoring[scoring.length - 1].text += ev.two ? ' (two-point try failed)' : ' (kick missed)';
      return;
    }
    if (ev.type === 'kick') {
      if (ev.td) scored(ev.recover, 6, ev.t, `${teams[ev.recover].city}: kickoff return touchdown`);
      lastT = ev.t; lastOff = null;
      return;
    }
    if (ev.type !== 'snap' || ev.try) return;   // a two-point try counts as the try (above), not as a play
    const o = ev.off, d: Team = o === 0 ? 1 : 0, res = ev.res;
    const T = team[o];
    // time of possession: the play itself and the runoff before it, while this offense had the ball
    if (lastT != null && lastOff === o) T.top += Math.max(0, lastT - ev.t);
    else T.top += Math.max(0, ev.t0 - ev.t);
    lastT = ev.t; lastOff = o;

    if (res.penalty) {
      if (res.penalty === 'hold') T.pen++; else team[d].pen++;
      if (ev.first) T.fd++;
      return;
    }
    const scrimmage = res.kind === 'run' || res.kind === 'pass' || res.kind === 'sack' || res.kind === 'scramble';
    if (scrimmage) {
      T.plays++;
      if (ev.down0 === 3) { T.att3++; if (ev.first || res.td) T.td3++; }
      if (ev.first && !res.td) T.fd++;
    }
    const passer = res.call === 'wr_pass' ? 'WR2' : 'QB';
    switch (res.kind) {
      case 'kneel': add(L(o, 'QB'), 'ra', 1); add(L(o, 'QB'), 'ry', res.yards); T.ry += res.yards; T.yds += res.yards; break;
      case 'spike': add(L(o, 'QB'), 'pa', 1); break;
      case 'sack': {
        add(L(o, 'QB'), 'sk', 1); add(L(o, 'QB'), 'sky', -res.yards);
        T.py += res.yards; T.yds += res.yards; team[d].sacks++;
        const by = pick(r, SACK, teams[d]);
        add(L(d, by), 'sck', 1); add(L(d, by), 'tk', 1); add(L(d, by), 'tfl', 1);
        if (res.fumble) { add(L(o, 'QB'), 'fum', 1); add(L(d, by), 'ff', 1); T.to++; }
        if (res.safety) scored(d, 2, ev.t, `${teams[d].city}: safety, ${nm(o, 'QB')} sacked in the end zone`);
        break;
      }
      case 'scramble': case 'run': {
        const who = res.kind === 'scramble' ? 'QB' : res.carrier;
        const l = L(o, who);
        add(l, 'ra', 1); add(l, 'ry', res.yards); add(l, 'rlng', res.yards);
        T.ry += res.yards; T.yds += res.yards;
        if (res.td) { add(l, 'rtd', 1); scored(o, 6, ev.t, `${teams[o].city}: ${nm(o, who)} ${res.yards}-yard run`); }
        else if (!res.oob) {
          const by = pick(r, res.yards >= 12 ? TACKLE_DEEP : TACKLE_RUN, teams[d]);
          add(L(d, by), 'tk', 1); if (res.yards < 0) add(L(d, by), 'tfl', 1);
          if (res.fumble) { add(l, 'fum', 1); add(L(d, by), 'ff', 1); T.to++; }
        }
        if (res.safety) scored(d, 2, ev.t, `${teams[d].city}: safety`);
        break;
      }
      case 'pass': {
        const q0 = L(o, passer);
        add(q0, 'pa', 1);
        const tg = res.target;
        if (tg) add(L(o, tg), 'tgt', 1);
        if (res.intercepted) {
          add(q0, 'pint', 1); T.to++;
          const by = res.carrier;
          add(L(d, by), 'int', 1); add(L(d, by), 'pd', 1); add(L(d, by), 'inty', res.retYds ?? 0);
          if (res.defTd) { add(L(d, by), 'dtd', 1); scored(d, 6, ev.t, `${teams[d].city}: ${nm(d, by)} interception return`); }
          break;
        }
        if (!res.complete) {
          if (tg && r() < 0.38) { const cv = COVER[tg]; const by = teams[d].players[cv] ? cv : pick(r, TACKLE_SHORT, teams[d]); add(L(d, by), 'pd', 1); }
          break;
        }
        const rc = L(o, tg ?? 'WR1');
        add(q0, 'pc', 1); add(q0, 'py', res.yards); add(q0, 'plng', res.yards);
        add(rc, 'rec', 1); add(rc, 'rcy', res.yards); add(rc, 'rclng', res.yards);
        T.py += res.yards; T.yds += res.yards;
        if (res.td) {
          add(q0, 'ptd', 1); add(rc, 'rctd', 1);
          scored(o, 6, ev.t, `${teams[o].city}: ${res.yards}-yard pass from ${nm(o, passer)} to ${nm(o, tg ?? 'WR1')}`);
        } else if (!res.oob) {
          const by = pick(r, (res.air ?? 0) >= 15 || res.yards >= 20 ? TACKLE_DEEP : TACKLE_SHORT, teams[d]);
          add(L(d, by), 'tk', 1);
          if (res.fumble) { add(rc, 'fum', 1); add(L(d, by), 'ff', 1); T.to++; }
        }
        break;
      }
      case 'fg': {
        const k = L(o, 'K'), dist = res.air ?? 0;
        if (res.penalty) break;
        add(k, 'fga', 1);
        if (res.good) { add(k, 'fgm', 1); add(k, 'fglng', dist); scored(o, 3, ev.t, `${teams[o].city}: ${nm(o, 'K')} ${dist}-yard field goal`); }
        break;
      }
      case 'punt': {
        if (res.blocked || res.penalty) break;
        add(L(o, 'P'), 'pn', 1); add(L(o, 'P'), 'pny', res.air ?? 0);
        if (res.defTd) scored(d, 6, ev.t, `${teams[d].city}: punt return touchdown`);
        break;
      }
    }
  });
  team[0].pts = score[0]; team[1].pts = score[1];
  return { players, team, byQ, scoring, final: [score[0], score[1]], ot };
}
