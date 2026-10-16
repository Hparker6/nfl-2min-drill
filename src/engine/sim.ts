/**
 * The game engine: resolves snaps, kicks and conversions, runs the clock by the late-game rules, and holds the AI
 * coaches that call both sides whenever the player is not deciding. Everything is pure state-in/state-out with a
 * seeded Rng, so a game can be replayed exactly and simulated thousands of times to value a decision.
 *
 * Clock rules modeled: the clock stops on incompletions, scores, changes of possession, timeouts and spikes; on
 * plays out of bounds only inside the final two minutes (before that it restarts, with a shorter runoff); the
 * two-minute warning stops it once. Pre-snap runoff depends on the tempo the offense chooses.
 */
import { CALL, DROPS, ROUTES, TEMPO, type Call, type DropId } from './data';
import { clip, gauss, pickWeighted, type Rng } from './rng';
import { BASE_CALLS, DEF_CALLS, DEF_PLAYS, defFx, famOf, goalLineSituation } from './defense';
import { passMods, runMods } from './attributes';

/**
 * Weather, as it changes a play. Snow: the ball is hard to hold (catches down, fumbles way up, footing costs runs).
 * Rain: hard to throw far and to hold on (deep catches down, interceptions and fumbles up). Wind: kicks and deep
 * throws suffer (a field goal plays like one from several yards further out; punts die; deep balls sail).
 */
export const WEATHER: Record<Weather, { catch: number; deepCatch: number; fumble: number; int: number; run: number; yac: number; fgYards: number; punt: number; name: string; blurb: string }> = {
  clear: { catch: 0, deepCatch: 0, fumble: 1, int: 1, run: 0, yac: 1, fgYards: 0, punt: 0, name: 'Clear', blurb: '' },
  rain: { catch: -0.02, deepCatch: -0.08, fumble: 1.6, int: 1.15, run: 0, yac: 0.95, fgYards: 2, punt: -2, name: 'Rain', blurb: 'Wet ball: deep throws are hard, and so is holding on.' },
  snow: { catch: -0.06, deepCatch: -0.06, fumble: 2.5, int: 1.05, run: -0.4, yac: 0.85, fgYards: 4, punt: -3, name: 'Snow', blurb: 'Snow: catches are hard, fumbles are easy, footing is bad.' },
  wind: { catch: 0, deepCatch: -0.05, fumble: 1, int: 1.1, run: 0, yac: 1, fgYards: 8, punt: -6, name: 'Wind', blurb: 'Gusting wind: field goals and deep balls are a gamble.' },
};
const wx = (s: State) => WEATHER[s.weather ?? 'clear'];
import type { Choice, DefClock, Ev, KickChoice, Look, OffClock, PassMods, PatChoice, PlayResult, Rcv, RouteId, State, StChoice, Team, Weather } from './types';

export const ytg = (s: State) => 100 - s.yl;
export const leadOf = (s: State, team: Team) => s.score[team] - s.score[1 - team];
export const fgDist = (s: State) => 100 - s.yl + 17;
export function fgProb(dist: number, k: number): number {
  if (dist > 66) return 0;
  return 0.985 / (1 + Math.exp((dist - 58 - (k - 80) * 0.15) / 5));
}
/** Seconds the ball is in the air for a throw of this depth. */
export const flight = (air: number) => (Math.abs(air) + 7) / (22 - 0.08 * clip(air, 0, 60));
export const other = (t: Team): Team => (t === 0 ? 1 : 0);

export function clone(s: State): State {
  return { ...s, score: [s.score[0], s.score[1]], to: [s.to[0], s.to[1]] };
}

// what each defensive call does to runs and passes: see defense.ts

function base(kind: PlayResult['kind'], call: string, look: Look | null): PlayResult {
  return { kind, call, look, carrier: 'QB', yards: 0, oob: false, td: false, safety: false, turnover: false, dur: 0, side: 1 };
}

// ------------------------------------------------------------------ snaps ---

function resolveRun(s: State, c: Call, look: Look, r: Rng, bonus = 0, side?: 1 | -1): PlayResult {
  const R = s.rat[s.off], D = s.rat[other(s.off)];
  const F = defFx(look, s), L = F.run;
  const P = runMods(R, D, c.carrier ?? 'RB');
  const Wx = wx(s);
  let m = c.ypc! + bonus + P.m + L.m + Wx.run;
  const sd = c.sd!;
  let big = c.big! * L.big * P.bigMul;
  let stuff = c.stuff! + L.stuff + P.stuff;
  // the side: strong (the tight end's) has the extra blocker; weak is where the box is thinner when it is loaded
  if (side) {
    if (famOf(look) === 'load' || famOf(look) === 'goal') m += side === -1 ? 0.6 : -0.2;
    else m += side === 1 ? 0.3 : -0.1;
    if (c.lane === 'out' && side === -1) { big *= 1.25; stuff += 0.03; }
  }
  if (c.draw) { m += F.draw; if (F.draw > 1) big *= 1.3; }
  if (c.option) m += F.option;
  if (c.trick) { m += F.trick; if (F.trick >= 1) big *= 1.4; }
  if (c.short && s.dist <= 2) stuff -= 0.05;
  const yt = ytg(s);
  if (yt <= 5) { m *= 0.75; big = 0; }

  let y: number;
  if (r() < stuff) y = Math.floor(r() * 3) - 2;
  else if (r() < big) y = 12 + Math.round(-Math.log(1 - r()) * 14);
  else y = Math.round(m + sd * gauss(r));
  if (c.id === 'sneak') y = clip(y, -1, 5);

  const res = base('run', c.id, look);
  res.carrier = c.carrier || (c.option && r() < 0.4 ? 'QB' : 'RB');
  res.lane = c.lane;
  res.side = side ?? (r() < 0.5 ? -1 : 1);
  if (s.yl + y <= 0) { res.safety = true; res.yards = -s.yl; res.dur = 4; return res; }
  y = Math.min(y, yt);
  res.yards = y;
  res.td = y >= yt;
  if (!res.td && r() < (c.trick ? 0.02 : 0.009) * Wx.fumble) { res.fumble = true; res.turnover = true; }
  res.oob = !res.td && !res.turnover && r() < c.oob! * (y > 8 ? 1.3 : 1);
  res.dur = c.id === 'sneak' ? 2.5 : 3.8 + Math.min(Math.abs(y), 50) / 7 + r() * 1.2;
  return res;
}

function resolvePass(s: State, c: Call, look: Look, r: Rng, tgt: Rcv, route: RouteId, dropId: DropId, mods: PassMods = {}, routes?: Partial<Record<Rcv, RouteId>>): PlayResult {
  const R = s.rat[s.off], D = s.rat[other(s.off)];
  const drop = DROPS[dropId], RT = ROUTES[route], F = defFx(look, s), L = F.pass;
  const yt = ytg(s);
  const res = base('pass', c.id, look);
  res.target = tgt;
  res.route = route;
  if (routes) res.routes = routes;
  if (mods.pa || mods.roll || mods.oob) res.mods = mods;
  const Wx = wx(s);
  res.carrier = 'QB';
  res.side = tgt === 'WR1' || tgt === 'WR3' ? -1 : 1;

  if (r() < 0.022) { res.penalty = 'hold'; res.dur = drop.release + 1.5; return res; }

  const PM = passMods(R, D, tgt, RT.depth >= 15);
  // play action holds the ball longer; a roll-out gets the quarterback away from the rush
  const ps = drop.sack * L.sack * PM.sackMul * (mods.pa && !c.pa ? 1.15 : 1) * (mods.roll ? 0.8 : 1);
  if (r() < ps) {
    res.kind = 'sack';
    res.dur = 4 + r();
    const y = -(4 + Math.floor(r() * 6));
    if (s.yl + y <= 0) { res.safety = true; res.yards = -s.yl; return res; }
    res.yards = y;
    if (r() < 0.07) { res.fumble = true; res.turnover = true; }
    return res;
  }
  if (dropId !== 'quick' && dropId !== 'screen' && dropId !== 'hail' && r() < 0.03) {
    res.kind = 'scramble';
    const y = clip(Math.round(4 + PM.scramble + gauss(r) * 4), -3, yt);
    res.yards = y;
    res.td = y >= yt;
    res.oob = !res.td && r() < 0.4;
    res.dur = 5 + r();
    return res;
  }

  let depth = RT.depth;
  let rzPen = 0;
  if (route === 'hail') depth = Math.min(yt + 3, 62);
  else if (depth > 0 && depth >= yt - 1) { depth = Math.min(depth, yt + 4); rzPen = yt < 12 ? -0.08 : -0.03; }
  const deep = RT.depth >= 15;
  let comp = RT.comp + (c.adj || 0) + PM.comp + rzPen;
  comp += route === 'screen' || route === 'flat' ? L.screen : deep ? L.deep : L.short;
  if (dropId === 'quick' || dropId === 'screen') comp += L.quick;
  comp += F.routes[route] ?? 0;
  if (c.pa || mods.pa) comp += F.pa;
  if (mods.roll) comp += deep ? -0.03 : 0.02;
  comp += deep ? Wx.deepCatch : Wx.catch;
  if (dropId === 'flea') comp += F.flea;
  if (route === 'hail') comp = yt + 3 > 62 ? 0.01 : clip(0.17 - (yt - 30) * 0.004, 0.04, 0.2);
  comp = clip(comp, 0.02, 0.95);
  const fl = flight(depth);
  res.air = depth;

  const pint = RT.int * L.int * PM.intMul * (c.trick ? 1.4 : 1) * Wx.int * (s.q != null ? FULL_GAME_INT : 1);
  if (r() < pint) {
    res.intercepted = true;
    res.turnover = true;
    res.carrier = tgt === 'WR2' ? 'CB2' : tgt === 'WR1' ? 'CB1' : 'S1';
    res.dur = drop.release + fl + 2;
    if (depth >= yt) { res.touchback = true; res.yards = yt; return res; }
    res.yards = Math.max(depth, 0);
    const ret = Math.max(0, Math.round(6 + gauss(r) * 9));
    res.retYds = ret;
    if (s.yl + res.yards - ret <= 0 || r() < 0.03) { res.defTd = true; res.retYds = s.yl + res.yards; }
    return res;
  }
  if (deep && r() < 0.045) {
    res.penalty = 'dpi';
    // spot of the foul, but never past the 1: from the 1 itself it is a first down with the ball where it is
    res.yards = Math.max(0, Math.min(depth, yt - 1));
    res.dur = drop.release + fl;
    return res;
  }
  if (r() < comp) {
    res.complete = true;
    res.carrier = tgt;
    let catchY = depth <= 0 ? depth : Math.round(depth * (0.8 + r() * 0.4));
    if (route === 'hail') catchY = depth;
    catchY = Math.min(catchY, yt + 9);
    res.air = catchY;
    if (catchY >= yt) { res.td = true; res.yards = yt; res.dur = drop.release + fl + 0.5; return res; }
    let yac = Math.round(-Math.log(1 - r() * 0.999) * RT.yac * L.yac * PM.yacMul * Wx.yac * (mods.oob ? 0.55 : 1));
    if (r() < 0.018 * PM.bigYac) yac += 12 + Math.round(r() * 30);
    if (route === 'screen' && famOf(look) === 'blitz') yac += 2;
    let y = catchY + yac;
    if (s.yl + y <= 0) y = 1 - s.yl;
    y = Math.min(y, yt);
    res.yards = y;
    res.td = y >= yt;
    if (!res.td && r() < 0.006 * Wx.fumble) { res.fumble = true; res.turnover = true; }
    // working the sideline: he gets out most of the time, for fewer yards
    res.oob = !res.td && !res.turnover && r() < (mods.oob ? 0.85 : RT.oob);
    res.dur = drop.release + fl + Math.max(yac, 0) / 6 + 0.8;
    return res;
  }
  res.complete = false;
  res.dur = drop.release + fl;
  return res;
}

/** Resolve one offensive snap of a call (or kneel/spike) against a look. */
export function resolveSnap(s: State, play: string, look: Look, r: Rng, ch?: Choice | null): PlayResult {
  if (play === 'kneel') {
    const res = base('kneel', 'kneel', look);
    res.yards = s.yl > 1 ? -1 : 0;
    res.dur = 2;
    return res;
  }
  if (play === 'spike') {
    const res = base('spike', 'spike', look);
    res.complete = false;
    res.dur = 1;
    return res;
  }
  const c = CALL[play];
  if (c.kind === 'run') return resolveRun(s, c, look, r, 0, ch?.side);
  if (c.kind === 'rpo') {
    // the QB reads the defense: a loaded box or a blitz means throw the quick route, otherwise hand it off.
    // He misreads it one time in four.
    const throwIt = defFx(look, s).rpoThrow;
    if (throwIt !== r() < 0.25) {
      const tgt = c.tgt!;
      const res = resolvePass(s, c, look, r, tgt, c.routes![tgt], 'screen');
      return res;
    }
    const res = resolveRun(s, CALL[c.run!], look, r, 0, ch?.side);
    res.call = c.id;
    return res;
  }
  const tgt = ch?.target ?? c.tgt!;
  const route = ch?.routes?.[tgt] ?? ch?.route ?? c.routes![tgt];
  return resolvePass(s, c, look, r, tgt, route, c.drop!, ch?.mods, ch?.routes);
}

export function resolveFG(s: State, st: StChoice, r: Rng): PlayResult {
  const R = s.rat[s.off];
  const res = base('fg', 'fg', null);
  res.dur = 5;
  res.air = fgDist(s);
  const rough = st === 'block' ? 0.03 : 0.004;
  const blk = st === 'block' ? 0.06 : 0.015;
  if (r() < rough) { res.penalty = 'rough'; res.yards = Math.min(15, Math.floor(ytg(s) / 2)); return res; }
  if (r() < blk) { res.blocked = true; res.turnover = true; res.yards = -7; return res; }
  res.good = r() < fgProb(fgDist(s) + wx(s).fgYards, R.k);
  if (!res.good) { res.turnover = true; res.yards = -7; }
  return res;
}

export function resolvePunt(s: State, st: StChoice, r: Rng): PlayResult {
  const res = base('punt', 'punt', null);
  res.dur = 7;
  res.turnover = true;
  if (st === 'rush') {
    if (r() < 0.03) { res.blocked = true; res.yards = -8; return res; }
    if (r() < 0.025) { res.penalty = 'rough'; res.turnover = false; res.yards = Math.min(15, Math.floor(ytg(s) / 2)); return res; }
  }
  const gross = Math.round(45 + wx(s).punt + gauss(r) * 7);
  res.air = gross;
  if (s.yl + gross >= 100) { res.touchback = true; res.yards = 80 - s.yl; return res; }
  const ret = st === 'return' ? Math.max(0, Math.round(8 + gauss(r) * 6)) : Math.max(0, Math.round(3 + gauss(r) * 3));
  if (st === 'return' && r() < 0.005) { res.defTd = true; }
  res.yards = gross;
  res.retYds = ret;
  return res;
}

// ------------------------------------------------------------ transitions ---

/** Run the clock during a play. Returns true when the two-minute warning stopped it. */
function tick(s: State, secs: number): boolean {
  const t0 = s.t;
  s.t = Math.max(0, s.t - secs);
  if (!s.warned && t0 > 120 && s.t <= 120) { s.t = 120; s.warned = true; return true; }
  return false;
}

function endCheck(s: State) {
  if (s.t <= 0 && (s.stage === 'pre' || s.stage === 'call' || s.stage === 'kick')) expire(s);
}

/** The clock hit 0:00. A late-game spot is over; a full game moves on to the next period (or ends). */
function expire(s: State) {
  if (s.q == null) { s.stage = 'over'; return; }
  s.held = s.stage;
  s.stage = 'over';
  endPeriod(s);
}

/** Overtime's length: 10 minutes of a 15-minute-quarter game in the regular season, a full quarter in the playoffs. */
export const otLen = (s: State) => Math.round((s.qLen ?? 900) * (s.po ? 1 : 2 / 3));

/**
 * Full games, at 0:00 of a period: the next quarter (same ball, same down), halftime (timeouts back, the second-half
 * kickoff to the team that kicked first), overtime on a tie after the fourth (a seeded toss, two timeouts each) or the
 * final. Regular-season overtime can end tied; in the playoffs it repeats until someone wins.
 */
function endPeriod(s: State) {
  const q = s.q!, len = s.qLen ?? 900, held = s.held ?? 'pre';
  s.held = undefined;
  s.running = false;
  s.pendLook = s.shownLook = s.pendPlay = null;
  s.adj = 0;
  const tied = s.score[0] === s.score[1];
  if (q >= 4 && (!tied || (q >= 5 && !s.po))) { s.stage = 'over'; s.brk = 0; return; }
  s.q = q + 1;
  s.brk = s.q;
  if (q === 2) {
    s.t = len; s.to = [3, 3]; s.warned = true;
    s.kicker = s.rec ?? 0; s.safetyKick = false; s.stage = 'kick';
    return;
  }
  if (q === 4) {
    s.t = otLen(s); s.to = [2, 2]; s.warned = s.t <= 120;
    // the toss: seeded by the game so far, so a replay gets the same one
    const recv = ((s.k + s.score[0] * 7 + s.score[1] * 13) & 1) as Team;
    s.kicker = other(recv); s.safetyKick = false; s.stage = 'kick';
    s.otOwn = recv; s.otp = 1; s.otS = [s.score[0], s.score[1]];
    return;
  }
  if (q >= 5) {
    // another playoff overtime period: play on from where the ball is
    s.t = otLen(s); s.to = [2, 2]; s.warned = s.t <= 120;
    s.stage = held === 'kick' ? 'kick' : 'pre';
    return;
  }
  // end of the first or third quarter: switch ends, same ball and down
  s.t = len;
  s.warned = s.q === 3 || len <= 120;
  s.stage = held === 'kick' ? 'kick' : 'pre';
}

/**
 * Overtime by the NFL's current rules: both teams get the ball once. The defense scoring on the first possession
 * ends it; on the second, the game ends as soon as the second team leads, or when its possession ends with anyone
 * ahead. After that, the next score wins.
 */
function otCheck(s: State) {
  if (s.stage === 'over' || s.stage === 'pat' || s.otp == null) return;
  const S = s.otS ?? [s.score[0], s.score[1]];
  const scorer: Team | -1 = s.score[0] > S[0] ? 0 : s.score[1] > S[1] ? 1 : -1;
  s.otS = [s.score[0], s.score[1]];
  const unequal = s.score[0] !== s.score[1];
  const end = () => { s.stage = 'over'; s.brk = 0; };
  if (scorer !== -1) {
    if (s.otp === 1 && scorer !== s.otOwn) return end();
    if (s.otp === 2 && unequal && (scorer !== s.otOwn || leadOf(s, s.otOwn!) > 0)) return end();
    if (s.otp >= 3 && unequal) return end();
  }
  if ((s.stage === 'pre' || s.stage === 'call') && s.off !== s.otOwn) {
    if (s.otp === 2 && unequal) return end();
    s.otp++;
    s.otOwn = s.off;
  }
}

function changePoss(s: State, yl: number) {
  s.off = other(s.off);
  s.yl = clip(Math.round(yl), 1, 99);
  s.down = 1;
  s.dist = Math.min(10, 100 - s.yl);
  s.running = false;
  s.stage = 'pre';
  endCheck(s);
}

/** Apply a resolved snap to the state. Returns whether it moved the chains. */
export function applySnap(s: State, res: PlayResult): boolean {
  const o = s.off, d = other(o);
  const warn = tick(s, res.dur);
  s.adj = 0;
  s.pendLook = null;
  s.shownLook = null;
  s.pendPlay = null;

  if (res.penalty === 'hold') {
    const back = s.yl <= 20 ? Math.ceil(s.yl / 2) : 10;
    s.yl -= back;
    s.dist += back;
    s.running = false;
    s.stage = 'pre';
    endCheck(s);
    return false;
  }
  if (res.penalty === 'dpi' || res.penalty === 'rough') {
    s.yl += res.yards;
    s.down = 1;
    s.dist = Math.min(10, 100 - s.yl);
    s.running = false;
    s.stage = 'pre';
    endCheck(s);
    return true;
  }
  if (res.safety) {
    s.score[d] += 2;
    s.stage = 'kick';
    s.kicker = o;
    s.safetyKick = true;
    s.running = false;
    endCheck(s);
    return false;
  }
  if (res.kind === 'fg' && res.good) {
    s.score[o] += 3;
    s.stage = 'kick';
    s.kicker = o;
    s.running = false;
    endCheck(s);
    return false;
  }
  if (res.turnover) {
    if (res.defTd) {
      s.score[d] += 6;
      s.off = d;
      s.stage = 'pat';
      s.running = false;
      return false;
    }
    let newYl: number;
    if (res.touchback) newYl = 20;
    else if (res.kind === 'fg') newYl = Math.max(100 - (s.yl - 7), 20);
    else newYl = 100 - (s.yl + res.yards - (res.retYds || 0));
    changePoss(s, newYl);
    return false;
  }
  if (res.td) {
    s.score[o] += 6;
    s.stage = 'pat';
    s.running = false;
    return true;
  }
  const inc = (res.kind === 'pass' && !res.complete) || res.kind === 'spike';
  s.yl += res.yards;
  let first = false;
  if (!inc && res.yards >= s.dist) {
    s.down = 1;
    s.dist = Math.min(10, 100 - s.yl);
    first = true;
  } else {
    s.down++;
    if (!inc) s.dist -= res.yards;
  }
  if (s.down > 4) { changePoss(s, 100 - s.yl); return false; }
  // out of bounds stops the clock only late in a half (the fourth quarter's rule for a late-game spot)
  const late = s.t <= 120 && (s.q == null || s.q === 2 || s.q >= 4);
  s.running = !(inc || warn || (res.oob && late));
  if (res.oob && !late) s.adj = -7;
  s.stage = 'pre';
  endCheck(s);
  return first;
}

/**
 * Full games: a normal huddle runs the play clock down further than the late-game huddle (the NFL averages about 33
 * seconds from whistle to snap), and passes are picked off at the NFL's full-game rate rather than the late-game one.
 * Tuned against NFL season averages (see career/calibrate.test.ts).
 */
export const fullGamePace = (oc: OffClock) => (oc === 'huddle' ? FULL_GAME_HUDDLE : 0);
export const FULL_GAME_HUDDLE = 11;
const FULL_GAME_INT = 0.8;

/** Pre-snap runoff with the clock running. Returns true when the two-minute warning stopped it. */
function runoff(s: State, secs: number): boolean {
  const t0 = s.t;
  s.t = Math.max(0, s.t - Math.max(0, secs));
  if (!s.warned && t0 > 120 && s.t <= 120) { s.t = 120; s.warned = true; s.running = false; return true; }
  return false;
}

function snap(s: State, r: Rng, play: string, look: Look, ch: Choice | null | undefined, ev?: Ev[]) {
  const before = { off: s.off, yl0: s.yl, down0: s.down, dist0: s.dist, t0: s.t };
  let res: PlayResult;
  if (play === 'fg') res = resolveFG(s, ch?.st ?? 'safe', r);
  else if (play === 'punt') res = resolvePunt(s, ch?.st ?? 'return', r);
  else res = resolveSnap(s, play, look, r, ch);
  const warned = s.warned;
  const first = applySnap(s, res);
  ev?.push({ type: 'snap', ...before, t: s.t, res, first });
  // the play crossed 2:00: the clock stops dead for the two-minute warning
  if (!warned && s.warned) ev?.push({ type: 'warning', t: s.t });
}

/** Stage 'pre': the clock decision between snaps (tempo, timeout, spike, kneel) for both sides. */
function clockStage(s: State, r: Rng, ch: Choice | null | undefined, ev?: Ev[]) {
  const o = s.off, d = other(o);
  if (!s.running) { s.stage = 'call'; return; }
  let oc: OffClock = ch?.offClock ?? aiOffClock(s, r);
  if ((oc === 'timeout' || oc === 'drain') && s.to[o] === 0) oc = 'nohuddle';
  if (oc === 'timeout') {
    s.to[o]--;
    s.running = false;
    s.stage = 'call';
    ev?.push({ type: 'timeout', team: o, t: s.t, left: s.to[o] });
    return;
  }
  if (oc === 'drain') {
    if (runoff(s, s.t - 3)) { ev?.push({ type: 'warning', t: s.t }); s.stage = 'call'; return; }
    s.to[o]--;
    s.running = false;
    s.stage = 'call';
    ev?.push({ type: 'timeout', team: o, t: s.t, left: s.to[o] });
    return;
  }
  const dc: DefClock = ch?.defClock ?? aiDefClock(s, r);
  if (dc === 'timeout' && s.to[d] > 0) {
    s.to[d]--;
    s.running = false;
    ev?.push({ type: 'timeout', team: d, t: s.t, left: s.to[d] });
    if (oc === 'kneel') snap(s, r, 'kneel', 'balanced', null, ev);
    else s.stage = 'call';
    return;
  }
  if (oc === 'spike' || oc === 'kneel') {
    if (runoff(s, oc === 'spike' ? 3 + r() * 2 : 38)) { ev?.push({ type: 'warning', t: s.t }); s.stage = 'call'; return; }
    if (s.t <= 0) { if (s.q == null) ev?.push({ type: 'expire', t: 0 }); expire(s); return; }
    snap(s, r, oc, 'balanced', null, ev);
    return;
  }
  const T = TEMPO[oc];
  const secs = Math.max(3, T.secs + T.sd * gauss(r) + s.adj + (s.q != null ? fullGamePace(oc) : 0));
  s.adj = 0;
  if (runoff(s, secs)) { ev?.push({ type: 'warning', t: s.t }); s.stage = 'call'; return; }
  if (s.t <= 0) { if (s.q == null) ev?.push({ type: 'expire', t: 0 }); expire(s); return; }
  s.stage = 'call';
}

/** Stage 'call': the snap itself. */
function callStage(s: State, r: Rng, ch: Choice | null | undefined, ev?: Ev[]) {
  const play = ch?.play ?? s.pendPlay ?? aiOffPlay(s, r);
  const look = ch?.look ?? s.pendLook ?? aiDefLook(s, r);
  snap(s, r, play, look, ch, ev);
}

function patStage(s: State, r: Rng, ch: Choice | null | undefined, ev?: Ev[]) {
  const two = (ch?.pat ?? aiPat(s)) === 'two';
  const R = s.rat[s.off], D = s.rat[other(s.off)];
  const p = two ? clip(0.47 + (R.off - D.def) * 0.006, 0.3, 0.65) : clip(0.94 + (R.k - 80) * 0.003, 0.85, 0.99);
  const good = r() < p;
  if (good) s.score[s.off] += two ? 2 : 1;
  s.stage = 'kick';
  s.kicker = s.off;
  ev?.push({ type: 'pat', off: s.off, two, good, t: s.t });
  endCheck(s);
}

function kickStage(s: State, r: Rng, ch: Choice | null | undefined, ev?: Ev[]) {
  const k = s.kicker, rcv = other(k);
  let recover: Team = rcv, yl: number, dur: number, touchback = false, td = false;
  let kind: 'kickoff' | 'onside' | 'free';
  if (s.safetyKick) {
    kind = 'free';
    s.safetyKick = false;
    yl = clip(Math.round(40 + gauss(r) * 6), 20, 60);
    dur = 6;
  } else if ((ch?.kick ?? aiKick(s)) === 'onside') {
    kind = 'onside';
    dur = 3;
    if (r() < 0.12) { recover = k; yl = 47; } else yl = 53;
  } else {
    kind = 'kickoff';
    if (r() < 0.58) { touchback = true; yl = 35; dur = 0; } else {
      yl = clip(Math.round(28 + gauss(r) * 7), 8, 70);
      dur = 6;
      if (r() < 0.004) td = true;
    }
  }
  const warned = s.warned;
  tick(s, dur);
  s.off = recover;
  s.pendLook = s.shownLook = s.pendPlay = null;
  s.running = false;
  if (td) {
    s.score[rcv] += 6;
    s.stage = 'pat';
  } else {
    s.yl = yl;
    s.down = 1;
    s.dist = 10;
    s.stage = 'pre';
    endCheck(s);
  }
  ev?.push({ type: 'kick', kind, kicker: k, recover, touchback, td, yl, t: s.t });
  if (!warned && s.warned) ev?.push({ type: 'warning', t: s.t });
}

/** Advance the game one stage. `ch` carries the player's decision for this stage; anything missing is the AI's. */
export function advance(s: State, r: Rng, ch?: Choice | null, ev?: Ev[]) {
  switch (s.stage) {
    case 'pre': clockStage(s, r, ch, ev); break;
    case 'call': callStage(s, r, ch, ev); break;
    case 'pat': patStage(s, r, ch, ev); break;
    case 'kick': kickStage(s, r, ch, ev); break;
    default: break;
  }
  if (s.q == null) return;
  if ((s.q ?? 0) >= 5) otCheck(s);
  if (s.brk != null) {
    ev?.push(s.brk === 0 ? { type: 'final', t: s.t, ot: (s.q ?? 4) >= 5 } : { type: 'period', q: s.brk, t: s.t });
    s.brk = undefined;
  }
}

/** Play the rest of the game with the AI on both sides. */
export function simulate(s: State, r: Rng, maxSteps = 500) {
  for (let i = 0; i < maxSteps && s.stage !== 'over'; i++) advance(s, r);
}

/** Overtime, not played out: a coin flip tilted by team strength. */
export const otProb = (s: State) => clip(0.5 + (s.rat[0].ovr - s.rat[1].ovr) * 0.012, 0.3, 0.7);

/** Team 0's result of a finished game: 1 win, 0 loss, overtime odds on a tie. */
export function value0(s: State): number {
  const l = leadOf(s, 0);
  return l > 0 ? 1 : l < 0 ? 0 : otProb(s);
}

// ------------------------------------------------------------- AI coaches ---

/** Can the offense kneel out the clock from here? */
export function canKneel(s: State): boolean {
  if (leadOf(s, s.off) <= 0) return false;
  let tos = s.to[other(s.off)];
  let burn = 0;
  const n = 4 - s.down + 1;
  for (let k = 0; k < n; k++) {
    if (k > 0 || s.running) { if (tos > 0) tos--; else burn += 38; }
    burn += 2;
  }
  return s.t <= burn;
}

/** A full game before the fourth quarter: the late-game logic (kneel it out, hurry when behind) waits until then. */
const early = (s: State) => s.q != null && s.q < 4;
/** The last two minutes of the first half. */
const halfEnd = (s: State) => s.q === 2 && s.t <= 120;

export function aiOffClock(s: State, r: Rng): OffClock {
  if (early(s)) return earlyOffClock(s, r);
  const o = s.off, d = leadOf(s, o), t = s.t;
  if (d > 0) return canKneel(s) ? 'kneel' : 'milk';
  const fgOk = fgDist(s) <= 55;
  if (t <= 40 && t > 3 && fgOk && s.to[o] > 0 && (d >= -2 || (d === -3 && t <= 12))) return 'drain';
  const hurry = t <= 150 || d <= -9 || (d < 0 && t <= 270);
  if (!hurry) return 'huddle';
  if (s.to[o] > 0 && t <= 75 && r() < 0.8) return 'timeout';
  if (s.to[o] === 0 && s.down < 4 && t <= 40 && r() < 0.6) return 'spike';
  return 'nohuddle';
}

function earlyOffClock(s: State, r: Rng): OffClock {
  const o = s.off, t = s.t;
  if (!halfEnd(s)) return leadOf(s, o) >= 17 && s.q === 3 ? 'milk' : 'huddle';
  // backed up with little time: let the half run out
  if (s.yl < 35 && t <= 40) return 'milk';
  if (s.to[o] > 0 && t <= 60 && r() < 0.7) return 'timeout';
  if (s.to[o] === 0 && s.down < 4 && t <= 25 && r() < 0.6) return 'spike';
  return 'nohuddle';
}

export function aiDefClock(s: State, r: Rng): DefClock {
  if (early(s)) {
    // late in the half, against an offense in its own end: stop the clock to get the ball back with time
    return halfEnd(s) && s.to[other(s.off)] > 0 && s.yl < 45 && s.t > 30 && r() < 0.5 ? 'timeout' : 'let';
  }
  const dd = other(s.off);
  if (s.to[dd] === 0) return 'let';
  const l = leadOf(s, dd);
  if (l < 0 && s.t <= 240) return 'timeout';
  if (l === 0 && s.t <= 120 && r() < 0.8) return 'timeout';
  return 'let';
}

export function aiOffPlay(s: State, r: Rng, normalOnly = false): string {
  const o = s.off, d = leadOf(s, o), t = s.t, yt = ytg(s), fd = fgDist(s);
  const fgWins = d >= -3 && d <= 0;
  const E = early(s);
  if (E && !normalOnly) { const x = earlySpecial(s, r); if (x) return x; }
  if (!E && !normalOnly) {
    if (d > 0 && canKneel(s)) return 'kneel';
    if (t <= 6 && fd <= 60 && fgWins) return 'fg';
    if (s.down === 4) {
      if (fd <= 57 && d >= -3) return 'fg';
      const must = d < 0 && (t < 300 || d < -8);
      const shortGo = s.dist <= 1 && s.yl >= 45 && r() < 0.6;
      if (!must && !shortGo) return 'punt';
    }
  }
  if (!E && t <= 8 && yt >= 25 && !(fd <= 60 && fgWins)) return 'hail';
  const w: Record<string, number> = {};
  const add = (k: string, v: number) => (w[k] = (w[k] || 0) + v);
  const hurry = E ? halfEnd(s) : d < 0 ? t <= 300 : d === 0 ? t <= 150 : false;
  if (!E && d > 0 && t < 360) {
    add('inside_zone', 3); add('power', 3); add('counter', 1.2); add('read_option', 1); add('outside_zone', 0.6);
    add('slants', 0.5); add('mesh', 0.4); add('boot', 0.3);
  } else if (hurry) {
    const side = s.to[o] === 0 ? 1.5 : 1, mid = s.to[o] === 0 ? 0.6 : 1;
    add('quick_out', 3 * side); add('comeback', 2.5 * side); add('dig', 2 * mid); add('slants', 1.5 * mid); add('mesh', 1.2 * mid);
    add('seam', 1 * mid); add('deep_post', 1); add('go', 1 * side); add('deep_corner', 1 * side); add('screen', 0.6); add('draw', 0.3);
  } else {
    add('inside_zone', 2); add('power', 1.5); add('outside_zone', 1); add('counter', 0.8); add('draw', 0.5); add('read_option', 0.5);
    add('slants', 1.2); add('quick_out', 1); add('mesh', 1.2); add('dig', 1.2); add('comeback', 0.8); add('seam', 0.6);
    add('deep_post', 0.6); add('go', 0.5); add('pa_deep', 0.6); add('boot', 0.6); add('screen', 0.7); add('rpo_bubble', 0.6);
    add('rpo_slant', 0.6); add('flea', 0.05); add('reverse', 0.05);
    // a full game's early downs: closer to the NFL's run/pass balance than the late-game mix
    if (s.q != null) { add('inside_zone', 1); add('power', 0.8); add('outside_zone', 0.6); add('counter', 0.3); }
  }
  if (s.dist <= 2) { add('power', 2.5); add('inside_zone', 1); if (s.dist <= 1) add('sneak', 2.5); }
  if (yt <= 20) {
    add('deep_corner', 1.2); add('slants', 1.2); add('mesh', 1); add('boot', 0.8);
    w.go = (w.go || 0) * 0.3; w.deep_post = (w.deep_post || 0) * 0.4; w.pa_deep = (w.pa_deep || 0) * 0.3;
  }
  return pickWeighted(r, w);
}

/** Kicks, punts and fourth downs before the fourth quarter, and the end of the first half. */
function earlySpecial(s: State, r: Rng): string | null {
  const t = s.t, yt = ytg(s), fd = fgDist(s), d = leadOf(s, s.off);
  if (s.q === 2) {
    if (t <= 6) return fd <= 58 ? 'fg' : yt <= 60 && r() < 0.6 ? 'hail' : 'kneel';
    if (t <= 35 && s.yl < 35 && s.down < 4) return 'kneel';
  }
  if (s.down !== 4) return null;
  // modern fourth downs: short yardage past midfield is often a go; otherwise kick when in range, punt when not
  const go = (s.dist <= 1 && s.yl >= 40 && r() < 0.45) || (s.dist <= 3 && s.yl >= 58 && fd > 54 && r() < 0.4)
    || (s.dist <= 2 && yt <= 3 && r() < 0.5) || (s.q === 3 && d <= -17 && s.dist <= 5 && s.yl >= 40);
  if (go) return null;
  return fd <= 54 ? 'fg' : 'punt';
}

/** Within the family the AI picked, which play: base calls most often, the rest for variety. */
const AI_VARIANTS: Partial<Record<Look, Partial<Record<Look, number>>>> = {
  balanced: { balanced: 0.6, cover4: 0.4 },
  zone: { zone: 0.5, tampa2: 0.3, cover4: 0.2 },
  man: { man: 0.4, twoman: 0.25, press: 0.2, robber: 0.15 },
  blitz: { blitz: 0.3, firezone: 0.3, mike: 0.2, cblitz: 0.1, sblitz: 0.1 },
  load: { load: 0.6, runblitz: 0.4 },
  goal: { goal: 0.5, glblitz: 0.25, glman: 0.25 },
};

/** The AI defensive coordinator: calls what the situation suggests, with enough mix not to be predictable. */
export function aiDefLook(s: State, r: Rng): Look {
  const base = aiBaseLook(s, r);
  if (!s.mix) return base;
  const v = AI_VARIANTS[base];
  if (!v || (base === 'goal' && !goalLineSituation(s))) return base;
  return pickWeighted<Look>(r, v as Record<Look, number>);
}

function aiBaseLook(s: State, r: Rng): Look {
  const od = leadOf(s, s.off), E = early(s);
  if (100 - s.yl <= 5) return pickWeighted<Look>(r, { goal: 0.4, man: 0.25, blitz: 0.15, zone: 0.1, load: 0.1 });
  const runish = E ? s.dist <= 2 || (od >= 14 && s.q === 3) : od > 0 || (s.dist <= 2 && s.t > 60);
  const passish = E ? halfEnd(s) || (s.down >= 3 && s.dist >= 7) || od <= -14 : od < 0 && s.t <= 300;
  if (runish) return pickWeighted<Look>(r, goalLineSituation(s) ? { goal: 0.3, load: 0.35, blitz: 0.2, man: 0.15 } : { load: 0.45, blitz: 0.2, balanced: 0.15, man: 0.1, zone: 0.1 });
  if (passish) return pickWeighted<Look>(r, { prevent: 0.3, zone: 0.25, man: 0.15, blitz: 0.2, balanced: 0.1 });
  return pickWeighted<Look>(r, { balanced: 0.25, zone: 0.2, man: 0.15, blitz: 0.15, load: 0.15, prevent: 0.1 });
}

export function aiPat(s: State): PatChoice {
  if (early(s)) return 'xp';
  const l = leadOf(s, s.off);
  return [-5, -2, 1, 5].includes(l) ? 'two' : 'xp';
}

export function aiKick(s: State): KickChoice {
  if (early(s)) return 'deep';
  const l = leadOf(s, s.kicker);
  if (l >= 0) return 'deep';
  return s.t <= 75 || (s.t <= 150 && s.to[s.kicker] < 2) || (l <= -9 && s.t <= 300) ? 'onside' : 'deep';
}

export const aiST = (play: string): StChoice => (play === 'fg' ? 'safe' : 'return');

// --------------------------------------------------------- helpers for UI ---

export function lookOther(look: Look, r: Rng, mix = false): Look {
  // a wrong read shows another family; with the full playbook in use it can name any of its plays
  const pool: Look[] = mix ? DEF_CALLS.filter((x) => !DEF_PLAYS[x].goalOnly) : BASE_CALLS.filter((x) => x !== 'goal');
  const rest = pool.filter((x) => famOf(x) !== famOf(look));
  return rest[Math.floor(r() * rest.length)];
}
