/**
 * The play timeline: who moves where, and when, for a snap the engine has already resolved.
 *
 * The outcome engine (sim.ts) decides WHAT happened: the yards, the catch, the sack, the interception. This module
 * decides HOW it looked, and never changes the what: the ball ends where the engine says, the catch happens if and
 * only if the engine says so, and the tackle lands on the engine's spot. The renderer only draws what this returns.
 *
 * Movement comes from football assignments, not from "everyone run at the ball":
 *   offensive line   pass sets (kick slide, mirror the assigned rusher, hold the pocket) or the play's run scheme
 *                    (zone steps, pulls, reach blocks, wedge); after a throw they stay home unless it's a screen
 *   quarterback      the design's drop (3/5/7 steps, play-action fake, boot, option read), then throw, keep, or go down
 *   receivers        routes run at their own speed and acceleration; the target reaches the catch point at the catch
 *   defensive line   rush their lanes, engage blockers and gain ground only as fast as rush beats protection;
 *                    a sack happens when the winning rusher actually gets to the quarterback
 *   linebackers      read run or pass after a reaction delay, then fit a gap, drop to a hook zone, cover a back, or blitz
 *   corners          man (trail the receiver, a step behind his break) or zone (drop to a landmark and react)
 *   safeties         keep their depth until the ball is thrown or the runner is past the line
 * Pursuit begins only for a football reason (the throw, the catch, the runner crossing the line), each defender
 * after his own reaction time, at his own speed, along an angle to where the ball carrier is going. Exactly one
 * defender makes the tackle (the one who can get there first); the rest stop when they are close, or trail.
 *
 * Deterministic: the same snap and seed always give the same timeline, so a replay shows exactly the same play.
 */
import { CALL, ROUTES } from './data';
import { CX, DESIGN, W, defAlign, formation, type Design, type Pt } from './formation';
import { clip, rng, type Rng } from './rng';
import { flight } from './sim';
import { fieldGoalTimeline } from './kicks';
import type { Look, PlayResult, Ratings, Rcv, RouteId } from './types';

export type Key = [number, number, number];          // t, x, dy
export interface BallKey { t: number; x: number; dy: number; h: number }
export type EventKind = 'snap' | 'handoff' | 'pitch' | 'throw' | 'catch' | 'incomplete' | 'int' | 'sack' | 'pressure' | 'scramble'
  | 'tackle' | 'td' | 'oob' | 'fumble' | 'kick' | 'kneel' | 'spike' | 'lateral' | 'return' | 'good' | 'nogood' | 'blocked' | 'touchback' | 'recover';
export interface TEvent { t: number; kind: EventKind; who?: string; at?: Pt }
export interface Timeline {
  tracks: Record<string, Key[]>;
  ball: BallKey[];
  events: TEvent[];
  carrier: { t: number; key: string }[];   // who has the ball, from when
  end: number;                             // the last movement
  decisive: number;                        // when the play is decided (tackle, catch, drop, sack, score)
  throwT?: number;
  catchT?: number;
  tackler?: string;
  pressureT?: number;                      // when pressure would reach the quarterback with this protection
}
export interface ChoreoInput {
  res: PlayResult;
  yl0: number;
  off: Ratings;
  def: Ratings;
  seed: number;
  /** where the defense actually stands at the snap (a disguised look); defaults to the call's alignment */
  defStart?: Record<string, Pt>;
}

const DT = 0.05;
const OFF = ['QB', 'RB', 'WR1', 'WR2', 'WR3', 'TE', 'LT', 'LG', 'C', 'RG', 'RT'];
const DEF = ['EDGE1', 'DL1', 'DL2', 'EDGE2', 'LB1', 'LB2', 'LB3', 'CB1', 'CB2', 'S1', 'S2'];
const LINE = ['LT', 'LG', 'C', 'RG', 'RT'];
const FRONT = ['EDGE1', 'DL1', 'DL2', 'EDGE2'];
const RCV: Rcv[] = ['WR1', 'WR2', 'WR3', 'TE', 'RB'];

const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
const add = (a: Pt, b: Pt): Pt => [a[0] + b[0], a[1] + b[1]];
const mul = (a: Pt, k: number): Pt => [a[0] * k, a[1] * k];
const len = (a: Pt) => Math.hypot(a[0], a[1]);
const dist = (a: Pt, b: Pt) => len(sub(a, b));
const unit = (a: Pt): Pt => { const l = len(a) || 1; return [a[0] / l, a[1] / l]; };
const lerpP = (a: Pt, b: Pt, f: number): Pt => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
const onField = (p: Pt, yt: number): Pt => [clip(p[0], 0.4, W - 0.4), clip(p[1], -99, yt + 9.5)];

/** Movement profile from ratings: top speed (yards/s), acceleration time constant (s), reaction delay (s). */
export interface Prof { vmax: number; tau: number; react: number }
const GROUP_FACTOR: Record<string, number> = { LT: 0.72, LG: 0.72, C: 0.72, RG: 0.72, RT: 0.72, EDGE1: 0.88, EDGE2: 0.88, DL1: 0.8, DL2: 0.8, QB: 0.9, TE: 0.94 };
export function profile(R: Ratings, pos: string): Prof {
  const m = R.units?.move?.[pos];
  const spd = m?.speed ?? 75, acc = m?.accel ?? spd, rea = m?.react ?? 75;
  return {
    vmax: (5.4 + spd * 0.045) * (GROUP_FACTOR[pos] ?? (pos.startsWith('LB') ? 0.93 : 1)),
    tau: clip(0.8 - acc * 0.004, 0.35, 0.65),
    react: clip(0.42 - rea * 0.0025, 0.15, 0.36),
  };
}
/** Distance covered from a standing start after t seconds. */
export const travel = (t: number, p: Prof) => (t <= 0 ? 0 : p.vmax * (t - p.tau * (1 - Math.exp(-t / p.tau))));
/** Time to cover a distance from a standing start. */
export function timeTo(d: number, p: Prof): number {
  let lo = 0, hi = 30;
  for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (travel(m, p) < d) lo = m; else hi = m; }
  return hi;
}

/** A route as points in the offense frame, from the receiver's alignment. */
export function routePoints(start: Pt, route: RouteId, depth: number, yt: number): Pt[] {
  const R = ROUTES[route];
  const sign = start[0] < CX ? 1 : -1;
  const pts: Pt[] = [start];
  for (const [i, dd] of R.path(depth)) {
    const x = i === 99 ? CX + (start[0] - CX) * 0.25 : start[0] + sign * i;
    pts.push([clip(x, 1, W - 1), Math.min(dd, yt + 9)]);
  }
  return pts;
}
const polyLen = (pts: Pt[]) => pts.slice(1).reduce((a, p, i) => a + dist(p, pts[i]), 0);
function along(pts: Pt[], s: number, clampEnd = false): Pt {
  for (let i = 1; i < pts.length; i++) {
    const seg = dist(pts[i - 1], pts[i]);
    if (s <= seg) return lerpP(pts[i - 1], pts[i], seg ? s / seg : 1);
    s -= seg;
  }
  // past the end: a ball carrier stops there; a route keeps going in its last direction
  if (clampEnd) return pts[pts.length - 1];
  const a = pts[pts.length - 2] ?? pts[0], b = pts[pts.length - 1];
  return add(b, mul(unit(sub(b, a)), s));
}

/** A path run on a schedule: start at t0, cover the polyline with this profile (optionally already moving). */
function runner(pts: Pt[], t0: number, p: Prof, warm = 0, scale = 1, clampEnd = false): (t: number) => Pt {
  const base = travel(warm, p);
  return (t) => along(pts, (travel(t - t0 + warm, p) - base) * scale, clampEnd);
}
/** A path that must arrive at its last point exactly at t1, starting at t0 (constant pace, eased start). */
function timed(pts: Pt[], t0: number, t1: number): (t: number) => Pt {
  const L = polyLen(pts);
  return (t) => {
    if (t <= t0) return pts[0];
    const f = clip((t - t0) / Math.max(0.05, t1 - t0), 0, 1);
    const g = f < 0.25 ? f * f * 2 : 0.125 + (f - 0.25) * (0.875 / 0.75);   // a quick ramp, then steady
    return along(pts, L * g);
  };
}

interface Agent {
  key: string;
  p: Pt;
  v: number;
  prof: Prof;
  goal: (t: number) => Pt | null;          // where the assignment says to go now (null: settle)
  script?: (t: number) => Pt | null;       // a fixed path that overrides the goal (ball carriers, the tackler)
  cap?: number;                            // fraction of top speed allowed (backpedal, engaged)
  stop?: number;                           // stop this close to the goal (pursuers do not pile on)
  keys: Key[];
}

export function choreograph(inp: ChoreoInput): Timeline {
  const { res } = inp;
  const r = rng(inp.seed);
  const yt = 100 - inp.yl0;
  const call = CALL[res.call];
  const design0: Design | undefined = DESIGN[res.call];
  // the player's adjustments: play action and a roll-out change the quarterback's action and the back's job
  const design: Design | undefined = design0 && (res.mods?.roll || res.mods?.pa)
    ? { ...design0, qb: res.mods.roll ? 'boot' : design0.qb === 'boot' ? 'boot' : 'pa', rb: design0.rb === 'route' || design0.rb === 'fake' ? 'fake' : design0.rb, scheme: res.mods.roll ? 'boot' : design0.scheme === 'quick' ? 'pa' : design0.scheme }
    : design0;
  const look: Look = res.look ?? 'balanced';
  // runs go to the side the play-caller picked (strong is the tight end's side); passes bend toward the target
  const side: 1 | -1 = (res.kind === 'run' ? res.side ?? design?.side ?? 1 : design?.side ?? res.side ?? 1) as 1 | -1;
  const fm = formation(design?.formation ?? 'gun');
  const da = defAlign(look);
  const start: Record<string, Pt> = {};
  for (const k of OFF) start['o:' + k] = onField([fm[k][0], Math.max(fm[k][1], -inp.yl0 - 8)], yt);
  for (const k of DEF) start['d:' + k] = onField(inp.defStart?.['d:' + k] ?? [da[k][0], Math.min(da[k][1], yt + 9)], yt);

  const events: TEvent[] = [{ t: 0, kind: 'snap' }];
  const carrier: Timeline['carrier'] = [{ t: 0, key: 'o:C' }];
  const ball: BallKey[] = [];
  const ag: Record<string, Agent> = {};
  for (const k of OFF) ag['o:' + k] = { key: 'o:' + k, p: start['o:' + k], v: 0, prof: profile(inp.off, k), goal: () => null, keys: [] };
  for (const k of DEF) ag['d:' + k] = { key: 'd:' + k, p: start['d:' + k], v: 0, prof: profile(inp.def, k), goal: () => null, keys: [] };
  const P = (k: string) => ag[k].p;

  // ---- kicks, kneels, spikes
  if (res.kind === 'fg') return fieldGoalTimeline({ good: !!res.good, blocked: !!res.blocked, yt, off: inp.off, def: inp.def, seed: inp.seed });
  if (res.kind === 'punt' || res.kind === 'kneel' || res.kind === 'spike') {
    return special(inp, start, ag, events, carrier);
  }

  const isPassish = res.kind === 'pass' || res.kind === 'sack' || res.kind === 'scramble';
  const units = { o: inp.off.units, d: inp.def.units };
  const pro = units.o?.passPro ?? inp.off.ol, rush = units.d?.passRush ?? inp.def.dl;
  // pressure time: when the rush gets home with this protection (seconds); used for sacks and for how long the
  // quarterback can hold the ball
  const pressureT = clip(2.7 + (pro - rush) * 0.05 + (look === 'blitz' ? -0.55 : look === 'prevent' || look === 'soft' ? 0.4 : 0) + (r() - 0.5) * 0.5, 1.4, 4.5);

  // ======================================================================== passing plays
  if (isPassish) {
    const tgt: Rcv = res.target ?? call?.tgt ?? 'WR1';
    const routes = { ...(call?.routes ?? { WR1: 'go', WR2: 'go', WR3: 'hitch', TE: 'flat', RB: 'flat' } as Record<Rcv, RouteId>), ...(res.routes ?? {}) } as Record<Rcv, RouteId>;
    const qbA = design?.qb ?? 'gun5';
    const rpoThrow = call?.kind === 'rpo';
    const qb0 = P('o:QB');
    // the quarterback's set point and drop timing, by action
    const dropTo: Pt = qbA === 'boot' ? [CX + side * 9, -6.4] : qbA === 'ct7' ? [CX, -8.2] : qbA === 'ct5' ? [CX, -7] : qbA === 'gun3' ? [CX, -6.4]
      : qbA === 'rpo' ? [CX + 0.6, -5.2] : qbA === 'hail' ? [CX, -8.6] : qbA === 'pa' || qbA === 'flea' ? [CX, -8] : [CX, -7.4];
    const dropT = qbA === 'gun3' ? 0.55 : qbA === 'rpo' ? 0.5 : qbA === 'ct7' ? 1.3 : qbA === 'ct5' ? 1.0 : qbA === 'boot' ? 1.6 : qbA === 'pa' || qbA === 'flea' ? 1.35 : qbA === 'hail' ? 1.1 : 0.8;
    const develop = rpoThrow ? 0.75 : design?.develop ?? 2;

    // target route and when he gets to the catch point
    const depth = res.air ?? ROUTES[res.route ?? routes[tgt]].depth;
    const tStart = start['o:' + tgt];
    const tRoutePts = routePoints(tStart, res.route ?? routes[tgt], depth, yt);
    const tProf = ag['o:' + tgt].prof;
    const pressRelease = look === 'man' || look === 'blitz' ? clip(0.3 - ((units.o?.rcv[tgt]?.sep ?? 80) - 70) * 0.006, 0.05, 0.35) : 0.08;
    const tArrive = pressRelease + timeTo(polyLen(tRoutePts), tProf);
    const catchPt = tRoutePts[tRoutePts.length - 1];

    // the throw: when the route is ready and the design says so, never after the rush gets home
    let throwT = Math.max(dropT, develop, 0);
    const fl = flight(depth) * 1.0;
    const sack = res.kind === 'sack';
    const scramble = res.kind === 'scramble';
    let catchT = Math.max(throwT + fl, tArrive);
    throwT = catchT - fl;
    if (throwT < dropT) { throwT = dropT; catchT = throwT + fl; }
    const sackT = sack ? clip(Math.min(pressureT, throwT + 0.6), dropT + 0.35, 4.6) : 0;

    // ---- the quarterback
    const qbPath: Pt[] = qbA === 'pa' || qbA === 'flea' ? [qb0, [CX + side * 1.2, -4.2], dropTo] : qbA === 'boot' ? [qb0, [CX - side * 1.2, -4], dropTo] : [qb0, dropTo];
    const qbRun = timed(qbPath, 0.12, dropT);
    let qbScript: (t: number) => Pt = (t) => (t <= dropT ? qbRun(t) : dropTo);
    if (sack) {
      // he steps up or slides, then the rusher who beat his man gets there; he goes down at the engine's spot
      const down: Pt = [dropTo[0] + (r() < 0.5 ? -1 : 1), res.yards];
      qbScript = (t) => (t <= dropT ? qbRun(t) : t <= sackT ? lerpP(dropTo, [dropTo[0] + (down[0] - dropTo[0]) * 0.4, dropTo[1] + 0.6], (t - dropT) / (sackT - dropT)) : lerpP([dropTo[0] + (down[0] - dropTo[0]) * 0.4, dropTo[1] + 0.6], down, clip((t - sackT) / 0.35, 0, 1)));
    }
    if (scramble) {
      // pocket breaks down; he takes off for the open side
      const outT = Math.min(pressureT, dropT + 1.0);
      const exit: Pt = [CX + side * 6, dropTo[1] + 0.5];
      const endP: Pt = res.oob ? [side < 0 ? 0.4 : W - 0.4, res.yards] : [CX + side * (10 + r() * 6), res.yards];
      const run = runner([exit, endP], outT + 0.35, ag['o:QB'].prof, 0.3, 1, true);
      const L2 = dist(exit, endP);
      const tEnd = outT + 0.35 + timeTo(L2, ag['o:QB'].prof);
      qbScript = (t) => (t <= dropT ? qbRun(t) : t <= outT ? dropTo : t <= outT + 0.35 ? lerpP(dropTo, exit, (t - outT) / 0.35) : t <= tEnd ? run(t) : endP);
      events.push({ t: outT, kind: 'scramble', who: 'o:QB' });
    }
    ag['o:QB'].script = qbScript;
    // play-action / flea fake: the back meets the quarterback, then blocks (or pitches back on the flea)
    if (design?.rb === 'fake') {
      const mesh: Pt = qbA === 'boot' ? [CX - side * 1.2, -4] : [CX + side * 1.2, -4.2];
      const rb0 = P('o:RB');
      const thru: Pt = [mesh[0] + side * 1, -1.2];
      ag['o:RB'].script = timed([rb0, mesh, thru], 0.12, 1.0);
    }

    // ---- receivers: routes at their own speed. The target is timed to the catch point.
    for (const rk of RCV) {
      const key = 'o:' + rk;
      if (rk === 'RB' && design?.rb === 'fake') continue;
      if (rk === 'RB' && design?.rb === 'block' && tgt !== 'RB') {
        // stays in to protect: steps up beside the quarterback and picks up the first free rusher
        ag[key].goal = (t) => (t < 0.5 ? [CX + (P(key)[0] < CX ? -1.6 : 1.6), -4.6] : null);
        continue;
      }
      if (rk === 'TE' && (design?.te === 'block' || design?.te === 'chip') && tgt !== 'TE') {
        const chipT = design?.te === 'chip' ? 0.9 : 99;
        ag[key].goal = (t) => (t < chipT ? [P('d:EDGE2')[0] - 0.6, Math.min(P('d:EDGE2')[1] - 0.9, -0.4)] : [P(key)[0] + 2, 4]);
        continue;
      }
      const rt = rk === tgt ? res.route ?? routes[rk] : routes[rk];
      const pts = rk === tgt ? tRoutePts : routePoints(start[key], rt, Math.min(ROUTES[rt].depth, yt + 4), yt);
      if (rk === tgt) {
        const reachT = pressRelease + timeTo(polyLen(pts), tProf);
        // he arrives at the catch point at the catch; if he would be early he throttles down (sits in the window)
        const scale = reachT < catchT - 0.05 ? 1 : 1;
        const run = reachT <= catchT ? runner(pts, pressRelease, tProf, 0, scale) : timed(pts, pressRelease, catchT);
        const L = polyLen(pts);
        ag[key].script = (t) => {
          if (t >= catchT) return null;
          const q = run(t);
          return dist(q, pts[0]) >= L && reachT <= catchT ? catchPt : q;
        };
        if (reachT < catchT) {
          // early: run the route, then settle at the catch point (hitch, comeback, curl) or keep the stem alive
          ag[key].script = (t) => (t >= catchT ? null : polyLen(pts) <= travel(t - pressRelease, tProf) ? catchPt : run(t));
        }
      } else {
        ag[key].script = (t) => {
          const q = runner(pts, 0.08 + r() * 0, ag[key].prof)(t);
          return t < (sack ? sackT : catchT) + 0.8 ? q : null;
        };
      }
    }

    // ---- the offensive line: a pocket, each man on his rusher
    const assign: Record<string, string> = { LT: 'd:EDGE1', LG: 'd:DL1', RG: 'd:DL2', RT: 'd:EDGE2', C: '' };
    const screen = design?.scheme === 'screen';
    for (const k of LINE) {
      const key = 'o:' + k;
      const s0 = start[key];
      const setPt: Pt = design?.scheme === 'quick' ? [s0[0], s0[1] - 0.5] : design?.scheme === 'boot' || design?.scheme === 'pa' ? [s0[0] + side * 1.2, s0[1] + 0.6] : [s0[0] + (s0[0] - CX) * 0.12, s0[1] - 1.2];
      ag[key].cap = 0.75;
      ag[key].goal = (t) => {
        if (screen && t > 0.9 && t > throwT - 0.6) return [CX + (tStart[0] - CX) * 0.6 + (s0[0] - CX) * 0.5, 3 + (s0[1] + 1.4) * 0];   // release to lead
        const rk2 = assign[k] ? ag[assign[k]] : null;
        if (t < 0.45 || !rk2) return setPt;
        if (t > throwT + 0.2) return null;              // the ball is gone: settle where he is
        // stay between the rusher and the quarterback
        const q = P('o:QB');
        const toQ = unit(sub(q, rk2.p));
        return add(rk2.p, mul(toQ, 0.95));
      };
      if (!screen) ag[key].stop = 0.1;
    }

    // ---- the pass rush: lanes to the quarterback, slowed by blockers; the winner (on a sack) gets home on time
    const sacker = sack ? (look === 'blitz' && r() < 0.35 ? 'd:LB1' : r() < 0.5 ? 'd:EDGE1' : 'd:EDGE2') : '';
    const rushers = [...FRONT.map((k) => 'd:' + k), ...(look === 'blitz' ? ['d:LB1', 'd:LB3'] : [])];
    const proUnit = pro, rushUnit = rush;
    const gain = clip(0.35 + (rushUnit - proUnit) * 0.02, 0.12, 0.8);   // yards per second a blocked rusher gains
    for (const key of rushers) {
      const lane0 = start[key];
      ag[key].goal = (t) => {
        const q = P('o:QB');
        if (t < 0.25) return [lane0[0], lane0[1] - 0.2];
        if (t > throwT + ag[key].prof.react && !sack) return null;     // after the throw: pursuit (set below)
        const toQ = unit(sub(q, P(key)));
        return add(P(key), mul(toQ, 3));
      };
      ag[key].cap = 0.6;
    }
    if (sacker) {
      // beaten blocker: the sacker sheds him and closes on the quarterback, arriving at the sack
      const shedT = Math.max(dropT * 0.6, sackT - 0.9);
      let from: Pt | null = null;
      ag[sacker].script = (t) => {
        if (t < shedT) return null;
        if (!from) from = ag[sacker].p;
        const hit = add(qbScript(Math.min(t, sackT)), [0.5, 0.6]);
        if (t >= sackT) return add(qbScript(t), [0.5, 0.6]);
        return lerpP(from, add(qbScript(sackT), [0.5, 0.6]), clip((t - shedT) / (sackT - shedT), 0, 1)) ?? hit;
      };
    }

    // ---- coverage
    const man = look === 'man' || look === 'blitz' || look === 'balanced' || look === 'load' || look === 'goal';
    const coverOf: Record<string, Rcv | null> = { 'd:CB1': 'WR1', 'd:CB2': 'WR2', 'd:LB1': look === 'blitz' ? null : 'WR3', 'd:LB3': look === 'blitz' ? null : 'TE', 'd:LB2': 'RB', 'd:S2': look === 'man' ? 'WR3' : null };
    const sepTarget = res.complete ? clip(1.3 + ((units.o?.rcv[tgt]?.sep ?? 80) - (units.d?.cov[tgt]?.coverage ?? 80)) * 0.04 + r() * 0.9, 1.0, 3.2) : res.intercepted ? 0 : clip(0.5 + r() * 0.6, 0.4, 1.1);
    const landmarks: Record<string, Pt> = look === 'prevent' || look === 'soft'
      ? { 'd:CB1': [8, 15], 'd:CB2': [W - 8, 15], 'd:S1': [CX - 9, 22], 'd:S2': [CX + 9, 22], 'd:LB1': [CX - 7, 9], 'd:LB2': [CX, 10], 'd:LB3': [CX + 7, 9] }
      : { 'd:CB1': [7, 12], 'd:CB2': [W - 7, 12], 'd:S1': [CX - 10, 16], 'd:S2': [CX + 10, 16], 'd:LB1': [CX - 7, 7], 'd:LB2': [CX, 8], 'd:LB3': [CX + 7, 7] };
    const recvPos = (rk: Rcv, t: number): Pt => ag['o:' + rk].keys.length ? (() => { const ks = ag['o:' + rk].keys; const i = Math.max(0, Math.min(ks.length - 1, Math.round(t / DT))); return [ks[i][1], ks[i][2]] as Pt; })() : P('o:' + rk);
    for (const key of [...DEF.map((k) => 'd:' + k)]) {
      if (rushers.includes(key)) continue;
      const rk = coverOf[key];
      const a = ag[key];
      const lead = rk === tgt ? sepTarget : 1.3;
      if (rk && (man || !landmarks[key])) {
        // man: trail his receiver, inside and a step deep, a reaction behind
        const lagT = clip(a.prof.react * 0.5 + (rk === tgt ? lead : 1) / Math.max(5, ag['o:' + rk].prof.vmax), 0.12, 0.4);
        a.goal = (t) => {
          const q = recvPos(rk, Math.max(0, t - lagT));
          return [q[0] + (q[0] < CX ? 0.6 : -0.6), q[1] + 0.8];
        };
        a.cap = 0.97;
      } else if (landmarks[key]) {
        // zone: drop to the landmark, leaning toward the nearest receiver in his area
        const lm = landmarks[key];
        a.goal = (t) => {
          if (t < a.prof.react) return null;
          let best: Pt | null = null, bd = 8;
          for (const k2 of RCV) { const q = P('o:' + k2); const dd = dist(q, lm); if (dd < bd) { bd = dd; best = q; } }
          return best ? lerpP(lm, [best[0], Math.max(best[1] + 1.5, 3)], 0.4) : lm;
        };
      } else {
        // safety with no man: hold the deep middle or his half
        const deep: Pt = key === 'd:S1' ? (look === 'man' ? [CX, 15] : [CX - 10, 15]) : [CX + 10, 15];
        a.goal = () => deep;
      }
    }

    // ---- after the throw: the ball and the reactions
    const thrower = qbA === 'lateral' ? 'o:WR2' : 'o:QB';
    if (qbA === 'lateral') {
      // the quarterback tosses back to the receiver, who throws
      const w0 = start['o:WR2'];
      const latPt: Pt = [CX + 6, -4.5];
      ag['o:WR2'].script = timed([w0, latPt], 0.1, 0.55);
      ag['o:WR2'].goal = () => latPt;
      events.push({ t: 0.6, kind: 'lateral', who: 'o:WR2' });
    }

    const result = { tEnd: 0, tackler: '' };
    // sacks end the play at the sack
    if (sack) {
      events.push({ t: sackT, kind: 'sack', who: sacker });
      result.tEnd = sackT + 0.35;
    } else if (scramble) {
      // computed by the QB script; tackled where he ends unless out of bounds or a score
      result.tEnd = 0;
    } else {
      events.push({ t: throwT, kind: 'throw', who: thrower });
      if (res.complete) events.push({ t: catchT, kind: 'catch', who: 'o:' + tgt, at: catchPt });
      else if (res.intercepted) events.push({ t: catchT, kind: 'int', who: 'd:' + res.carrier, at: catchPt });
      else events.push({ t: catchT, kind: 'incomplete', who: 'o:' + tgt, at: catchPt });
    }

    // the interceptor undercuts the route and arrives first; the return is his
    if (res.intercepted && !sack) {
      const ik = 'd:' + res.carrier;
      const back: Pt = res.touchback ? [catchPt[0], Math.min(catchPt[1], yt + 5)] : res.defTd ? [catchPt[0] + 3, -inp.yl0 - 1] : [clip(catchPt[0] + (r() - 0.5) * 8, 2, W - 2), catchPt[1] - (res.retYds ?? 0)];
      const retT = res.touchback ? 0.3 : timeTo(dist(catchPt, back), ag[ik].prof);
      let fromT: Pt | null = null;
      ag[ik].script = (t) => {
        if (t < throwT) return null;
        if (!fromT) fromT = ag[ik].p;
        if (t <= catchT) return lerpP(fromT, [catchPt[0] + 0.3, catchPt[1] + 0.4], (t - throwT) / (catchT - throwT));
        return lerpP([catchPt[0] + 0.3, catchPt[1] + 0.4], back, clip((t - catchT) / Math.max(0.2, retT), 0, 1));
      };
      result.tEnd = catchT + retT;
      carrier.push({ t: catchT, key: ik });
      if (res.defTd) events.push({ t: result.tEnd, kind: 'td', who: ik });
      else if (!res.touchback) {
        // the intended receiver turns tackler
        const tk = 'o:' + tgt;
        let from: Pt | null = null;
        ag[tk].script = (t) => {
          if (t < catchT) return null;
          if (!from) from = ag[tk].p;
          return lerpP(from, [back[0] - 0.7, back[1] - 0.6], clip((t - catchT) / Math.max(0.2, retT), 0, 1));
        };
        events.push({ t: result.tEnd, kind: 'tackle', who: tk });
        result.tackler = tk;
      }
    }

    // completed pass: the catch, then yards after the catch to the engine's spot
    let carrierPath: { pts: Pt[]; t0: number; key: string } | null = null;
    if (res.complete && !sack) {
      const fin: Pt = res.oob ? [catchPt[0] < CX ? 0.3 : W - 0.3, res.yards] : res.td ? [clip(catchPt[0] + (res.yards - depth) * 0.12, 3, W - 3), Math.max(res.yards, yt + 1.5)] : [clip(catchPt[0] + (res.yards - depth) * 0.15 * (catchPt[0] < CX ? 1 : -1), 1.5, W - 1.5), res.yards];
      carrierPath = { pts: [catchPt, fin], t0: catchT, key: 'o:' + tgt };
      carrier.push({ t: catchT, key: 'o:' + tgt });
    }
    if (scramble) {
      carrier.push({ t: 0.12, key: 'o:QB' });
      const outT = Math.min(pressureT, dropT + 1.0);
      const endP: Pt = [qbScript(99)[0], qbScript(99)[1]];
      carrierPath = { pts: [qbScript(outT + 0.35), endP], t0: outT + 0.35, key: 'o:QB' };
    }

    simulateAll(ag, { yt, throwT: sack ? 99 : throwT, catchT: sack ? 99 : catchT, sackT, isPass: true, look, carrierPath, res, r, events, result, qbKey: 'o:QB', sacker, rushers, gain });
    // the ball: snap to the passer, the throw (with height), then with whoever has it
    carrier.push({ t: 0.12, key: 'o:QB' });
    if (qbA === 'lateral') carrier.push({ t: 0.55, key: 'o:WR2' });
    carrier.sort((a, b) => a.t - b.t);
    buildBall(ball, ag, carrier, { snapTo: 'o:QB', throwT: sack ? undefined : throwT, catchT: sack ? undefined : catchT, catchPt, complete: !!res.complete, intercepted: !!res.intercepted, depth, end: result.tEnd, lateral: qbA === 'lateral' ? { t: 0.55, to: 'o:WR2' } : undefined, start: start['o:C'] });
    const decisive = sack ? sackT : res.complete || scramble ? result.tEnd : catchT;
    return finish(ag, ball, events, carrier, result, decisive, { throwT: sack ? undefined : throwT, catchT: sack ? undefined : catchT, pressureT });
  }

  // ======================================================================== running plays
  const d = design ?? DESIGN.inside_zone;
  const ck = 'o:' + (res.carrier === 'QB' ? 'QB' : res.carrier === 'WR2' ? 'WR2' : 'RB');
  const handT = d.develop;
  const holeX = clip(CX + side * (d.hole ?? 1.5), 2, W - 2);
  const hole: Pt = [holeX, -0.2];
  const qb0 = P('o:QB'), rb0 = P('o:RB');
  const mesh: Pt = d.qb === 'draw' ? [CX + side * 0.6, -6.6] : d.qb === 'sneak' ? qb0 : d.formation === 'gun' || d.formation === 'trips' ? [CX + side * 0.8, -4.4] : [CX + side * 1, -3.4];
  const wide = d.scheme === 'stretch' || d.scheme === 'pin' || ck === 'o:WR2';
  const fin: Pt = res.oob ? [side < 0 ? 0.3 : W - 0.3, res.yards] : res.td ? [clip(holeX + side * Math.min(8, res.yards * 0.2), 3, W - 3), Math.max(res.yards, yt + 1)]
    : res.yards <= 0 ? [clip(holeX - side * (wide ? 2 : 0.8), 2, W - 2), res.yards] : [clip(holeX + side * clip(res.yards * (d.scheme === 'stretch' || d.scheme === 'pin' ? 0.35 : 0.12), 0, 9) + (r() - 0.5) * 2, 1.5, W - 1.5), res.yards];

  // the carrier's path: to the mesh (or the pitch), to the hole, through it
  let path: Pt[];
  let tGet = handT;
  if (ck === 'o:QB') {
    path = d.qb === 'sneak' ? [qb0, fin] : [qb0, [CX + side * 1.2, -4.2], [CX + side * 6, -2], fin];   // option keep: around the end
    tGet = 0.12;
  } else if (ck === 'o:WR2') {
    // end-around: the receiver is in motion at the snap, takes it behind the back and runs the other way
    const w0 = P('o:WR2');
    path = [w0, [CX + 3, -4.2], [CX - 4, -3.8], [holeX, -0.5], fin];
    tGet = 0.9;
  } else if (d.qb === 'toss') {
    path = [rb0, [CX + side * 4, -6], [CX + side * 8.5, -3.5], [holeX, -0.5], fin];
    tGet = 0.45;
  } else if (d.scheme === 'counter') {
    path = [rb0, [rb0[0] - side * 1.4, rb0[1] + 0.2], mesh, hole, fin];
  } else if (res.call === 'direct') {
    path = [rb0, [rb0[0] + side * 1.5, -3], hole, fin];
    tGet = 0.15;
  } else {
    path = d.qb === 'draw' ? [rb0, [rb0[0], -6.2], mesh, hole, fin] : [rb0, mesh, hole, fin];
  }
  const cProf = ag[ck].prof;
  // ratings set the pace: the carrier runs at his speed (a draw waits for the rush to clear first; the end-around
  // receiver is already at speed from his motion)
  const waitT = d.qb === 'draw' ? 0.85 : 0;
  const warm = ck === 'o:WR2' ? 1.2 : 0;
  const runPath = path;
  let tEnd = waitT + timeTo(polyLen(runPath) + travel(warm, cProf), cProf) - warm;
  void tEnd;
  // a run stopped short: drop the part of the path he never reaches (the hole, when he is hit before it)
  if (res.yards <= 0 && !res.td && !res.oob) {
    const cut = runPath.findIndex((q, i) => i > 0 && q[1] >= res.yards - 0.01);
    if (cut > 0) runPath.splice(cut, runPath.length - cut, fin);
    tEnd = waitT + timeTo(polyLen(runPath) + travel(warm, cProf), cProf) - warm;
  }
  const carrierScript = runner(runPath, waitT, cProf, warm, 1, true);
  // the handoff: the quarterback opens to the back and gives it (or fakes and carries)
  if (ck !== 'o:QB') {
    const qbTo: Pt = d.qb === 'draw' ? [CX, -6.8] : d.qb === 'toss' ? [CX + side * 0.8, -2.6] : mesh;
    ag['o:QB'].script = timed([qb0, qbTo, [qbTo[0] - side * 1.5, qbTo[1] - 1.2]], 0.1, Math.max(0.4, handT) + 0.6);
    if (ck === 'o:WR2') ag['o:RB'].script = timed([rb0, mesh, [CX - side * 0, -4.6]], 0.1, 1.0);
  }
  events.push({ t: tGet, kind: d.qb === 'toss' ? 'pitch' : 'handoff', who: ck });
  carrier.push({ t: 0.12, key: 'o:QB' }, { t: tGet, key: ck });

  // the line: the play's scheme
  const pullers = d.scheme === 'gap' ? [side > 0 ? 'LG' : 'RG'] : d.scheme === 'counter' ? (side > 0 ? ['LG', 'LT'] : ['RG', 'RT']) : [];
  const runWin = res.yards >= 3;
  const front = FRONT.map((k) => 'd:' + k);
  for (const k of LINE) {
    const key = 'o:' + k;
    const s0 = start[key];
    ag[key].cap = 0.8;
    if (pullers.includes(k)) {
      // pull: flat down the line behind it, turn up into the hole
      const pullPts: Pt[] = [s0, [s0[0], -2.4], [holeX - side * 0.6, -2.2], [holeX + side * 0.4, 1.4]];
      ag[key].script = timed(pullPts, 0.15, handT + 0.9);
      continue;
    }
    const step: Pt = d.scheme === 'zone' ? [side * 1.2, 0.4] : d.scheme === 'stretch' || d.scheme === 'pin' ? [side * 2.4, 0.2] : d.scheme === 'wedge' ? [0, 0.6] : d.scheme === 'draw' ? [0, -1] : [-side * 0.6, 0.5];
    ag[key].goal = (t) => {
      if (t < 0.5 || (d.scheme === 'draw' && t < 0.9)) return add(s0, step);
      // engage the nearest defender in front; on a good run drive him off the ball, on a bad one he holds or loses
      let best = '', bd = 4;
      for (const dk of front) { const dd = dist(P(dk), P(key)); if (dd < bd) { bd = dd; best = dk; } }
      if (!best) return [P(key)[0], P(key)[1] + 0.5];
      const dir = unit(sub(P(best), hole));
      return runWin ? add(P(best), mul(dir, -0.9)) : add(P(best), mul(unit(sub(P(key), P(best))), 0.9));
    };
  }
  // receivers block on runs: stalk the man over them
  for (const rk of ['WR1', 'WR2', 'WR3', 'TE'] as Rcv[]) {
    const key = 'o:' + rk;
    if (key === ck) continue;
    const man = rk === 'WR1' ? 'd:CB1' : rk === 'WR2' ? 'd:CB2' : rk === 'WR3' ? 'd:LB1' : 'd:EDGE2';
    ag[key].goal = (t) => (t < 0.4 ? [P(key)[0], P(key)[1] + 2] : add(P(man), mul(unit(sub(P(key), P(man))), 0.95)));
    ag[key].cap = 0.7;
  }
  if (ck !== 'o:RB' && ag['o:RB'].script == null) ag['o:RB'].goal = (t) => (t < 1 ? [P('o:RB')[0] + side * 1, -2] : null);

  // the defense: front holds gaps, linebackers read and fit, safeties come down late, corners contain
  for (const k of DEF) {
    const key = 'd:' + k;
    const a = ag[key];
    const s0 = start[key];
    if (FRONT.includes(k)) {
      a.cap = 0.45;
      a.goal = (t) => (t < 0.3 ? [s0[0], s0[1] - 0.4] : [clip(lerpP(s0, P(ck), 0.25)[0], s0[0] - 1.5, s0[0] + 1.5), runWin ? 1.2 : -0.6]);
    } else if (k.startsWith('LB')) {
      // each linebacker fits his own gap, shaded toward the play side; nobody abandons his lane until the runner is through
      a.goal = (t) => (t < a.prof.react + 0.25 ? [s0[0], s0[1] - 0.3] : [clip(lerpP([s0[0], 0], [holeX, 0], 0.4)[0], s0[0] - 5, s0[0] + 5), clip(P(ck)[1] + 2.2, 1.2, s0[1])]);
    } else if (k.startsWith('S')) {
      // safeties keep their depth and come down only as the runner reaches them
      a.goal = (t) => (t < a.prof.react + 0.45 ? [s0[0], s0[1] + 0.4] : [lerpP(s0, P(ck), 0.3)[0], Math.max(P(ck)[1] + 6, 6)]);
    } else {
      const sameSide = (s0[0] < CX) === (side < 0);
      a.goal = (t) => (t < a.prof.react + 0.35 ? [s0[0], s0[1] + 0.6] : sameSide ? [clip(holeX + side * 4, 2, W - 2), Math.max(P(ck)[1] + 2.5, 2.5)] : [lerpP(s0, P(ck), 0.25)[0], Math.max(s0[1], P(ck)[1] + 5)]);
    }
  }

  const result = { tEnd, tackler: '' };
  const carrierPath = { pts: runPath, t0: waitT, key: ck, script: carrierScript, tEnd };
  simulateAll(ag, { yt, throwT: 99, catchT: 99, sackT: 0, isPass: false, look, carrierPath, res, r, events, result, qbKey: 'o:QB', sacker: '', rushers: [], gain: 0.4 });
  buildBall(ball, ag, carrier, { snapTo: ck === 'o:RB' && res.call === 'direct' ? 'o:RB' : 'o:QB', end: result.tEnd, start: start['o:C'] });
  return finish(ag, ball, events, carrier, result, result.tEnd, { pressureT });
}

interface SimCtx {
  yt: number; throwT: number; catchT: number; sackT: number; isPass: boolean; look: Look;
  carrierPath: { pts: Pt[]; t0: number; key: string; script?: (t: number) => Pt; tEnd?: number } | null;
  res: PlayResult; r: Rng; events: TEvent[]; result: { tEnd: number; tackler: string }; qbKey: string; sacker: string; rushers: string[];
  gain: number;          // yards per second a blocked rusher gains (rush vs protection)
}

/**
 * Step everyone at 20 Hz. Scripted players follow their scripts; the rest steer toward their assignment's goal
 * with their own acceleration and top speed, and keep a body's width apart. Pursuit starts for a reason (the throw
 * for coverage players, the catch or the runner crossing the line for everyone), each after his reaction time.
 */
function simulateAll(ag: Record<string, Agent>, c: SimCtx) {
  const keys = Object.keys(ag);
  const defense = keys.filter((k) => k.startsWith('d:'));
  let tackleSet = false;
  let breakT = Infinity;                 // when the ball carrier becomes a runner everyone chases
  let cScript: ((t: number) => Pt) | null = c.carrierPath?.script ?? null;
  let tEnd = c.result.tEnd || 0;
  const res = c.res;
  const wantTackle = !res.td && !res.oob && !(res.kind === 'pass' && !res.complete) && res.kind !== 'sack' && !res.defTd && !res.touchback && !res.intercepted;

  // completed pass / scramble: the carrier runs from the catch (or the escape) to the engine's spot
  if (c.carrierPath && !cScript) {
    const { pts, t0, key } = c.carrierPath;
    const p = ag[key].prof;
    const run = runner(pts, t0, p, 0.5, 1, true);
    const tRun = t0 + Math.max(0.25, timeTo(polyLen(pts) + travel(0.5, p), p) - 0.5);
    cScript = (t) => (t < t0 ? null as unknown as Pt : t <= tRun ? run(t) : pts[pts.length - 1]);
    tEnd = tRun;
    c.carrierPath.tEnd = tRun;
  }
  if (c.carrierPath) {
    const ck = c.carrierPath.key;
    const prev = ag[ck].script;
    const s = cScript!;
    ag[ck].script = (t) => (t >= c.carrierPath!.t0 ? s(t) : prev ? prev(t) : null);
    breakT = c.isPass ? c.carrierPath.t0 : c.carrierPath.t0 + 0.4;
  }
  const endFor = () => tEnd;
  const hardEnd = Math.max(tEnd || 0, c.isPass ? Math.min(c.catchT + 1.2, 6) : 2, c.sackT ? c.sackT + 0.4 : 0) + 0.6;

  // the tackle can extend the play after this starts, so the bound follows tEnd
  for (let t = 0; t <= Math.max(hardEnd, tEnd + 0.6) + 1e-9; t += DT) {
    const tt = Math.round(t * 1000) / 1000;
    // the tackle: once the runner is a runner, the defender who can reach his end spot first takes it
    if (!tackleSet && wantTackle && c.carrierPath && tt >= breakT) {
      tackleSet = true;
      const ck = c.carrierPath.key;
      const endP = c.carrierPath.pts[c.carrierPath.pts.length - 1];
      let best = '', bt = Infinity;
      for (const k of defense) {
        const a = ag[k];
        const at = tt + a.prof.react * 0.5 + timeTo(dist(a.p, endP), a.prof);
        if (at < bt) { bt = at; best = k; }
      }
      // the runner reaches the spot when the first man gets there (never before he could run it)
      const tRun = c.carrierPath.tEnd ?? tEnd;
      tEnd = clip(bt, tRun, tRun + 1.2);
      if (c.carrierPath.script && tEnd > tRun) {
        // he is slowed (fighting for the last yards) rather than waiting
        const s = c.carrierPath.script, t0 = c.carrierPath.t0;
        const k = (tRun - t0) / (tEnd - t0);
        ag[ck].script = (u) => (u < t0 ? s(u) : s(t0 + (u - t0) * k));
      } else if (!c.carrierPath.script && tEnd > tRun) {
        const s = ag[ck].script!, t0 = c.carrierPath.t0;
        const k = (tRun - t0) / (tEnd - t0);
        ag[ck].script = (u) => (u < t0 ? s(u) : s(t0 + (u - t0) * k));
      }
      const from = ag[best].p;
      const contact: Pt = [endP[0] + (endP[0] < CX ? 0.55 : -0.55), endP[1] + 0.75];
      const t0 = tt;
      ag[best].script = (u) => (u < t0 ? null : lerpP(from, contact, clip((u - t0) / Math.max(0.05, tEnd - t0), 0, 1)));
      c.result.tackler = best;
      c.events.push({ t: tEnd, kind: res.fumble ? 'fumble' : 'tackle', who: best, at: endP });
    }

    for (const k of keys) {
      const a = ag[k];
      const sp = a.script?.(tt);
      if (sp) { a.p = sp; a.v = 0; record(a, tt); continue; }
      let g = a.goal(tt);
      let cap = a.cap ?? 1;
      let stop = a.stop ?? 0.15;
      // pursuit, for a football reason and after this man's reaction time
      const carrierKey = c.carrierPath?.key;
      const isDef = k.startsWith('d:');
      if (isDef && carrierKey && tt >= breakT + a.prof.react) {
        const cp = ag[carrierKey].p;
        g = [cp[0], cp[1] + 0.8];
        cap = c.rushers.includes(k) || FRONT.includes(k.slice(2)) ? 0.7 : 1;
        const rank = defense.filter((o) => o !== k && dist(ag[o].p, cp) < dist(a.p, cp)).length;
        stop = rank < 3 ? 2.8 : 4.6;
      } else if (isDef && c.isPass && tt >= c.throwT + a.prof.react && tt < breakT && !c.rushers.includes(k)) {
        // ball in the air: the two defenders nearest the throw break on it; everyone else finishes his assignment
        const ev = c.events.find((e) => e.kind === 'catch' || e.kind === 'incomplete' || e.kind === 'int');
        if (ev?.at) {
          const rank = defense.filter((o) => o !== k && !c.rushers.includes(o) && dist(ag[o].p, ev.at!) < dist(a.p, ev.at!)).length;
          if (rank < 2) { g = ev.at; stop = res.complete ? 1.6 : 1.1; cap = 1; }
        }
      }
      if (!g) { a.v = Math.max(0, a.v - (a.prof.vmax / a.prof.tau) * DT * 1.5); record(a, tt); continue; }
      const to = sub(g, a.p);
      const d = len(to);
      if (d <= stop) { a.v = Math.max(0, a.v - (a.prof.vmax / a.prof.tau) * DT * 2); record(a, tt); continue; }
      let vmax = a.prof.vmax * cap;
      if (c.isPass && c.rushers.includes(k) && k !== c.sacker && tt < c.throwT) {
        const blocked = keys.some((o) => o.startsWith('o:') && dist(ag[o].p, a.p) < 1.4 && ['o:LT', 'o:LG', 'o:C', 'o:RG', 'o:RT', 'o:TE', 'o:RB'].includes(o));
        if (blocked) vmax = Math.min(vmax, c.gain);
      }
      const want = Math.min(vmax, (d - stop) / 0.25 + 0.5);
      a.v = a.v < want ? Math.min(want, a.v + (a.prof.vmax / a.prof.tau) * DT) : want;
      a.p = add(a.p, mul(unit(to), Math.min(d - stop, a.v * DT)));
      // a pass rusher on a non-sack play never gets closer than a body's length to the passer before the throw
      if (c.isPass && isDef && tt < c.throwT && k !== c.sacker) {
        const q = ag[c.qbKey].p;
        const dq = dist(a.p, q);
        if (dq < 2) a.p = add(q, mul(unit(sub(a.p, q)), 2));
      }
      a.p = onField(a.p, c.yt);
      record(a, tt);
    }
    // a body's width apart: nobody stands on anybody
    separate(ag, keys, c, tt, tEnd);
    if (c.isPass && tt < c.throwT) for (const k of defense) {
      if (k === c.sacker) continue;
      const a = ag[k], q = ag[c.qbKey].p, dq = dist(a.p, q);
      if (dq < 2.1) { a.p = add(q, mul(unit(sub(a.p, q)), 2.1)); const kk = a.keys[a.keys.length - 1]; if (kk && kk[0] === tt) { kk[1] = a.p[0]; kk[2] = a.p[1]; } }
    }
  }
  c.result.tEnd = tEnd || c.result.tEnd;
  if (wantTackle && !tackleSet && c.carrierPath) c.result.tEnd = tEnd;
  if (res.td) c.events.push({ t: c.result.tEnd || tEnd, kind: 'td', who: c.carrierPath?.key });
  else if (res.oob && c.carrierPath) c.events.push({ t: c.result.tEnd || tEnd, kind: 'oob', who: c.carrierPath.key });
  void endFor;
}

function separate(ag: Record<string, Agent>, keys: string[], c: SimCtx, t: number, tEnd: number) {
  const ck = c.carrierPath?.key, tk = c.result.tackler;
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const a = ag[keys[i]], b = ag[keys[j]];
      const pair = [a.key, b.key];
      if (pair.includes(ck ?? '') && pair.includes(tk) && t >= tEnd - 0.3) continue;      // the tackle
      if (pair.includes(c.sacker) && pair.includes(c.qbKey)) continue;                      // the sack
      const dd = dist(a.p, b.p);
      const min = a.key[0] !== b.key[0] ? 0.85 : 1.0;
      if (dd >= min || dd === 0) continue;
      const push = mul(unit(sub(a.p, b.p)), (min - dd) / 2);
      const aFixed = !!a.script?.(t), bFixed = !!b.script?.(t);
      if (aFixed && bFixed) continue;
      if (!aFixed) a.p = add(a.p, bFixed ? mul(push, 2) : push);
      if (!bFixed) b.p = sub(b.p, aFixed ? mul(push, 2) : push);
      const ka = a.keys[a.keys.length - 1], kb = b.keys[b.keys.length - 1];
      if (ka && ka[0] === t) { ka[1] = a.p[0]; ka[2] = a.p[1]; }
      if (kb && kb[0] === t) { kb[1] = b.p[0]; kb[2] = b.p[1]; }
    }
  }
}

function record(a: Agent, t: number) {
  const last = a.keys[a.keys.length - 1];
  if (!last || t - last[0] >= DT - 1e-6 || t === 0) a.keys.push([t, a.p[0], a.p[1]]);
}

function trackAt(a: Agent, t: number): Pt {
  const ks = a.keys;
  if (!ks.length) return a.p;
  if (t <= ks[0][0]) return [ks[0][1], ks[0][2]];
  for (let i = 1; i < ks.length; i++) if (t <= ks[i][0]) {
    const f = (t - ks[i - 1][0]) / (ks[i][0] - ks[i - 1][0] || 1);
    return [ks[i - 1][1] + (ks[i][1] - ks[i - 1][1]) * f, ks[i - 1][2] + (ks[i][2] - ks[i - 1][2]) * f];
  }
  const l = ks[ks.length - 1];
  return [l[1], l[2]];
}

function buildBall(ball: BallKey[], ag: Record<string, Agent>, carrier: Timeline['carrier'], o: {
  snapTo: string; throwT?: number; catchT?: number; catchPt?: Pt; complete?: boolean; intercepted?: boolean; depth?: number; end: number; lateral?: { t: number; to: string }; start: Pt;
}) {
  const sorted = [...carrier].sort((a, b) => a.t - b.t);
  const holder = (t: number) => { let k = sorted[0]?.key ?? o.snapTo; for (const c of sorted) if (c.t <= t) k = c.key; return k; };
  const end = Math.max(o.end, (o.catchT ?? 0) + 0.6);
  ball.push({ t: 0, x: o.start[0], dy: 0, h: 0 });
  for (let t = 0.1; t <= end + 1e-9; t = Math.round((t + 0.05) * 1000) / 1000) {
    if (o.throwT != null && o.catchT != null && t >= o.throwT && t <= o.catchT) {
      const from = trackAt(ag[o.lateral ? o.lateral.to : 'o:QB'], o.throwT);
      const f = (t - o.throwT) / (o.catchT - o.throwT);
      const p = lerpP(from, o.catchPt!, f);
      ball.push({ t, x: p[0], dy: p[1], h: Math.sin(f * Math.PI) * Math.min(7, 1 + Math.abs(o.depth ?? 8) * 0.22) });
      continue;
    }
    if (o.catchT != null && t > o.catchT && !o.complete && !o.intercepted) {
      // incomplete: the ball skips past and dies
      const f = clip((t - o.catchT) / 0.5, 0, 1);
      const p = add(o.catchPt!, [f * 1.2, f * 1.8]);
      ball.push({ t, x: p[0], dy: p[1], h: Math.max(0, 0.6 * (1 - f)) });
      continue;
    }
    const k = t < 0.12 ? 'o:C' : holder(t);
    const p = k === 'o:C' ? lerpP(o.start, trackAt(ag[o.snapTo], 0.12), clip(t / 0.12, 0, 1)) : trackAt(ag[k], t);
    ball.push({ t, x: p[0], dy: p[1], h: 0 });
  }
  // the last sample sits exactly where the play ended
  const kEnd = holder(end), pEnd = trackAt(ag[kEnd], end);
  if (!(o.catchT != null && !o.complete && !o.intercepted)) ball.push({ t: end, x: pEnd[0], dy: pEnd[1], h: 0 });
}

function finish(ag: Record<string, Agent>, ball: BallKey[], events: TEvent[], carrier: Timeline['carrier'], result: { tEnd: number; tackler: string }, decisive: number, extra: { throwT?: number; catchT?: number; pressureT?: number }): Timeline {
  const tracks: Record<string, Key[]> = {};
  for (const k in ag) tracks[k] = ag[k].keys;
  const end = Math.max(...Object.values(tracks).map((t) => t[t.length - 1]?.[0] ?? 0), ball[ball.length - 1]?.t ?? 0);
  events.sort((a, b) => a.t - b.t);
  return { tracks, ball, events, carrier, end, decisive: decisive || result.tEnd, tackler: result.tackler || undefined, ...extra };
}

/** Field goals, punts, kneels and spikes: the line holds, the ball goes. */
function special(inp: ChoreoInput, start: Record<string, Pt>, ag: Record<string, Agent>, events: TEvent[], carrier: Timeline['carrier']): Timeline {
  const res = inp.res, yt = 100 - inp.yl0;
  const ball: BallKey[] = [];
  let T = 1;
  if (res.kind === 'kneel' || res.kind === 'spike') {
    T = 1.1;
    const q0: Pt = [CX, -1.7];
    ag['o:QB'].keys = [[0, q0[0], q0[1]], [0.5, CX, res.kind === 'kneel' ? -2.4 : -1.9], [T, CX, res.kind === 'kneel' ? -2.4 : -1.9]];
    ball.push({ t: 0, x: CX, dy: 0, h: 0 }, { t: 0.2, x: CX, dy: -1.6, h: 0 }, { t: 0.5, x: CX, dy: res.kind === 'kneel' ? -2.3 : -1.3, h: 0 }, { t: T, x: CX, dy: res.kind === 'kneel' ? -2.3 : -1.3, h: 0 });
    events.push({ t: 0.5, kind: res.kind });
  } else {
    const fg = res.kind === 'fg';
    const fromDy = fg ? -7 : -14;
    const toDy = fg ? yt + 10 : Math.min(res.air ?? 40, yt + 10);
    T = fg ? 2.2 : 2.8;
    const wide = fg && !res.good && !res.blocked ? 4.5 : 0;
    if (res.blocked) ball.push({ t: 0, x: CX, dy: 0, h: 0 }, { t: 0.3, x: CX, dy: fromDy, h: 0 }, { t: 0.65, x: CX, dy: fromDy + 1.5, h: 1 }, { t: T, x: CX + 3, dy: fromDy - 3, h: 0 });
    else for (let t = 0; t <= T + 1e-9; t += 0.1) {
      if (t < 0.3) ball.push({ t, x: CX, dy: fromDy * (t / 0.3), h: 0 });
      else { const f = (t - 0.3) / (T - 0.3); ball.push({ t, x: CX + wide * f, dy: fromDy + (toDy - fromDy) * f, h: Math.sin(f * Math.PI) * (fg ? 9 : 14) }); }
    }
    events.push({ t: 0.3, kind: 'kick' });
  }
  for (const k in ag) if (!ag[k].keys.length) {
    const s = start[k];
    const step = k.startsWith('d:') && (res.kind === 'fg' || res.kind === 'punt') ? -1.2 : 0;
    ag[k].keys = [[0, s[0], s[1]], [0.5, s[0], s[1] + step], [T, s[0], s[1] + step]];
  }
  return finish(ag, ball, events, carrier, { tEnd: T, tackler: '' }, T, {});
}
