/**
 * Defensive calls and what each one does to the offense, as explicit numbers.
 *
 * Every call trades something: none is best against everything (tests in defense.test.ts check that each call is
 * beaten by some offensive call, and that each beats balanced against some). The offense never sees the call; it
 * picks its play on its own, and the engine resolves the two together.
 *
 * Units:
 *   run.m      yards added to a run's mean gain          run.big   multiplier on the chance of a breakaway run
 *   run.stuff  added chance a run is stopped at or behind the line
 *   pass.sack  multiplier on the sack rate               pass.int  multiplier on the interception rate
 *   pass.short / deep / screen   catch-rate shift for short routes, deep routes (15+ yards), and screens/flats
 *   pass.quick catch-rate shift for quick-release throws (quick game, screens, RPO throws)
 *   pass.yac   multiplier on yards after the catch
 *   routes     catch-rate shift for specific routes (coverage-beating concepts)
 *   pa / flea  catch-rate shift for play-action and the flea-flicker
 *   draw / trick / option   yards added to draws, misdirection runs (end-around, direct snap), the read option
 *   rpoThrow   whether a run-pass option reads this look as "throw it" (crowded box or pressure)
 */
import type { Look, LookFam, RouteId, State } from './types';

export interface DefFx {
  run: { m: number; big: number; stuff: number };
  pass: { sack: number; short: number; deep: number; screen: number; quick: number; yac: number; int: number };
  routes: Partial<Record<RouteId, number>>;
  pa: number;
  flea: number;
  draw: number;
  trick: number;
  option: number;
  rpoThrow: boolean;
}

export const DEF_FX: Record<'balanced' | 'blitz' | 'load' | 'zone' | 'man' | 'prevent' | 'goal' | 'goalFar', DefFx> = {
  // base 4-3, nothing taken away and nothing given away
  balanced: {
    run: { m: 0, big: 1, stuff: 0 },
    pass: { sack: 1, short: 0, deep: 0, screen: 0, quick: 0, yac: 1, int: 1 },
    routes: {}, pa: 0.04, flea: 0.05, draw: 0, trick: 0, option: 0, rpoThrow: false,
  },
  // six or seven rushers: sacks and hurried throws on anything that takes time, but hot routes and screens run
  // into open grass behind the rush
  blitz: {
    run: { m: -0.3, big: 1.6, stuff: 0.07 },
    pass: { sack: 1.75, short: -0.04, deep: -0.02, screen: 0.08, quick: 0.08, yac: 1.2, int: 1.1 },
    routes: {}, pa: 0, flea: 0.1, draw: 1.6, trick: 0.5, option: 0, rpoThrow: true,
  },
  // eight in the box: runs go nowhere, but coverage is thin and play-action is deadly
  load: {
    run: { m: -1.1, big: 0.6, stuff: 0.08 },
    pass: { sack: 1.1, short: -0.02, deep: 0.06, screen: 0, quick: 0, yac: 1.15, int: 1 },
    routes: {}, pa: 0.09, flea: 0.1, draw: -0.3, trick: 1.5, option: 0.6, rpoThrow: true,
  },
  // spot drop: rallies to the ball and reads the quarterback (more picks), but leaves holes at 12-18 yards
  zone: {
    run: { m: 0.3, big: 0.9, stuff: -0.02 },
    pass: { sack: 0.95, short: 0.03, deep: -0.05, screen: -0.02, quick: 0, yac: 0.85, int: 1.25 },
    routes: { dig: 0.05, seam: 0.1, hitch: 0.03, corner: 0.03, slant: -0.04, cross: -0.04, wheel: -0.03 },
    pa: 0, flea: -0.06, draw: 0.3, trick: -0.3, option: 0, rpoThrow: false,
  },
  // tight on every receiver: no easy throws underneath, but crossers and rubs get separation and backs are turned
  man: {
    run: { m: 0.2, big: 1.15, stuff: 0 },
    pass: { sack: 1.05, short: 0, deep: 0.02, screen: -0.03, quick: 0, yac: 1.2, int: 0.9 },
    routes: { slant: 0.05, cross: 0.06, out: 0.04, wheel: 0.06, hitch: -0.03, dig: -0.04, seam: -0.03, comeback: -0.02 },
    pa: 0.03, flea: 0.08, draw: 0, trick: 0.6, option: 0, rpoThrow: false,
  },
  // everyone deep: nothing over the top, everything underneath
  prevent: {
    run: { m: 1.0, big: 0.8, stuff: -0.07 },
    pass: { sack: 0.7, short: 0.07, deep: -0.13, screen: -0.02, quick: 0, yac: 0.75, int: 1.25 },
    routes: {}, pa: -0.03, flea: -0.06, draw: 0.6, trick: -0.8, option: 0, rpoThrow: false,
  },
  // goal-line front at the goal line or on short yardage: a wall against runs, tight windows for throws
  goal: {
    run: { m: -1.6, big: 0.5, stuff: 0.14 },
    pass: { sack: 1.2, short: -0.06, deep: 0.04, screen: -0.05, quick: 0, yac: 1.3, int: 1 },
    routes: {}, pa: 0.09, flea: 0.1, draw: -0.4, trick: 1.0, option: 0.6, rpoThrow: true,
  },
  // the same front with room behind it: one missed tackle or one route past it goes a long way
  goalFar: {
    run: { m: -0.7, big: 1.7, stuff: 0.08 },
    pass: { sack: 1.2, short: -0.03, deep: 0.12, screen: -0.02, quick: 0, yac: 1.4, int: 0.9 },
    routes: {}, pa: 0.12, flea: 0.12, draw: -0.2, trick: 1.5, option: 0.6, rpoThrow: true,
  },
};

/** A change to a family's effects: added to the shifts, multiplied into the multipliers, routes added on top. */
interface Tweak {
  run?: Partial<DefFx['run']>;
  pass?: Partial<DefFx['pass']>;
  routes?: Partial<Record<RouteId, number>>;
  pa?: number; flea?: number; draw?: number; trick?: number; option?: number;
}
const MULT = new Set(['big', 'sack', 'yac', 'int']);
function tweak(base: DefFx, t: Tweak): DefFx {
  const mix = <T extends object>(b: T, d: Partial<T> = {}): T => {
    const o = { ...b } as Record<string, number>;
    for (const [k, v] of Object.entries(d) as [string, number | undefined][]) if (v != null) o[k] = MULT.has(k) ? o[k] * v : o[k] + v;
    return o as T;
  };
  const routes = { ...base.routes };
  for (const [k, v] of Object.entries(t.routes ?? {}) as [RouteId, number][]) routes[k] = (routes[k] ?? 0) + v;
  return {
    ...base, run: mix(base.run, t.run), pass: mix(base.pass, t.pass), routes,
    pa: base.pa + (t.pa ?? 0), flea: base.flea + (t.flea ?? 0), draw: base.draw + (t.draw ?? 0), trick: base.trick + (t.trick ?? 0), option: base.option + (t.option ?? 0),
  };
}
/** A goal-line front away from the goal line: the same shift the base goal-line call has (goal to goalFar). */
const farOf = (fx: DefFx): DefFx => tweak(fx, {
  run: { m: 0.9, big: 3.4, stuff: -0.06 }, pass: { short: 0.03, deep: 0.08, screen: 0.03, yac: 1.4 / 1.3, int: 0.9 },
  pa: 0.03, flea: 0.02, draw: 0.2, trick: 0.5,
});

export type DefCat = 'zone' | 'man' | 'blitz' | 'goal';
export interface DefPlay {
  cat: DefCat;           // the tab it is in
  fam: LookFam;          // alignment and movement on the field
  fx: DefFx;
  goalOnly?: boolean;    // offered only near the goal line or on short yardage
  rush?: string[];       // who comes after the quarterback, for the play card
}
const F = DEF_FX;
/**
 * Every defensive play, in display order within its tab. The seven base calls keep their ids (saved games replay);
 * the rest are built on one of them and change specific numbers, each for a football reason.
 */
export const DEF_PLAYS: Record<Exclude<Look, 'soft'>, DefPlay> = {
  // ---- zone
  balanced: { cat: 'zone', fam: 'balanced', fx: F.balanced },
  zone: { cat: 'zone', fam: 'zone', fx: F.zone },
  // four deep, each with a quarter: nothing over the top, but the underneath defenders are spread thin
  cover4: { cat: 'zone', fam: 'zone', fx: tweak(F.zone, {
    run: { m: -0.1 }, pass: { short: 0.04, deep: -0.05, screen: 0.03, int: 0.92, yac: 1.06 },
    routes: { post: -0.06, go: -0.05, seam: -0.08, corner: -0.03, flat: 0.05, out: 0.05, hitch: 0.04, slant: 0.06 }, pa: -0.02,
  }) },
  // the middle linebacker runs the deep middle: the seam and the dig close, the sideline opens, the box is light
  tampa2: { cat: 'zone', fam: 'zone', fx: tweak(F.zone, {
    run: { m: 0.3, big: 1.1 }, routes: { seam: -0.12, dig: -0.06, post: -0.05, corner: 0.06, out: 0.05, comeback: 0.05 }, draw: 0.3,
  }) },
  prevent: { cat: 'zone', fam: 'prevent', fx: F.prevent },
  // ---- man
  man: { cat: 'man', fam: 'man', fx: F.man },
  // man underneath, two safeties over the top: the deep ball is gone, but only six are left for the run
  twoman: { cat: 'man', fam: 'man', fx: tweak(F.man, {
    run: { m: 0.5, big: 0.85 }, pass: { deep: -0.08, short: -0.02, sack: 0.92 }, routes: { go: -0.04, post: -0.04, corner: -0.03 }, draw: 0.4, option: 0.4,
  }) },
  // jam at the line: timing throws are late, but a receiver who beats the jam is gone
  press: { cat: 'man', fam: 'man', fx: tweak(F.man, {
    pass: { quick: -0.06, short: -0.03, screen: -0.02, deep: 0.05, yac: 1.1 }, routes: { go: 0.05, slant: -0.03, hitch: -0.04, out: -0.02 },
  }) },
  // a safety lurks in the middle: crossers and digs run into him, the deep outside is single coverage
  robber: { cat: 'man', fam: 'man', fx: tweak(F.man, {
    pass: { int: 1.2, deep: 0.03 }, routes: { cross: -0.08, dig: -0.04, slant: -0.07, corner: 0.04, go: 0.03 },
  }) },
  // ---- blitz
  blitz: { cat: 'blitz', fam: 'blitz', fx: F.blitz, rush: ['LB1', 'LB3', 'CB1'] },
  // five rush and a lineman drops into a zone: fewer sacks, but the hot throw runs into a defender
  firezone: { cat: 'blitz', fam: 'blitz', rush: ['LB1', 'LB3'], fx: tweak(F.blitz, {
    run: { big: 0.75, stuff: -0.02 }, pass: { sack: 0.78, screen: -0.06, quick: -0.05, short: 0.04, deep: -0.04, int: 1.15, yac: 0.85 }, routes: { seam: 0.05, dig: 0.04 }, draw: -0.8,
  }) },
  // the middle linebacker through the A-gap: inside runs and long drops die, the middle of the field is empty
  mike: { cat: 'blitz', fam: 'blitz', rush: ['LB2'], fx: tweak(F.blitz, {
    run: { m: -0.5, stuff: 0.04, big: 0.8 }, pass: { sack: 0.8, screen: -0.02 }, routes: { cross: 0.04, dig: 0.04 }, draw: 0.2,
  }) },
  // a corner off the edge: screens and outside runs to his side are dead, the receiver he left is alone
  cblitz: { cat: 'blitz', fam: 'blitz', rush: ['CB1'], fx: tweak(F.blitz, {
    run: { m: 0.1 }, pass: { sack: 0.85, screen: -0.06, quick: -0.03 }, routes: { out: 0.06, hitch: 0.05, go: 0.05, corner: 0.05, comeback: 0.04 },
  }) },
  // a safety downhill: runs and play-action meet an extra man, the deep middle is open
  sblitz: { cat: 'blitz', fam: 'blitz', rush: ['S1'], fx: tweak(F.blitz, {
    run: { stuff: 0.03 }, pass: { sack: 0.82, deep: 0.05, int: 0.9 }, routes: { seam: 0.07, post: 0.06 }, pa: -0.04, draw: -0.4,
  }) },
  // ---- goal line and run stop
  goal: { cat: 'goal', fam: 'goal', fx: F.goal, goalOnly: true, rush: ['LB1', 'LB2', 'LB3'] },
  // everyone through a gap at the snap: a wall for runs, nobody left for the quick throw
  glblitz: { cat: 'goal', fam: 'goal', goalOnly: true, rush: ['LB1', 'LB2', 'LB3', 'S1'], fx: tweak(F.goal, {
    run: { m: -0.3, stuff: 0.05 }, pass: { sack: 1.25, quick: 0.05, screen: 0.05, short: 0.02 }, pa: 0.03,
  }) },
  // goal-line front with every receiver covered: play-action and fades are gone, rubs and crossers are not
  glman: { cat: 'goal', fam: 'goal', goalOnly: true, rush: ['LB2'], fx: tweak(F.goal, {
    run: { m: 0.5, stuff: -0.04 }, pass: { int: 0.9 }, routes: { slant: 0.05, cross: 0.06, out: 0.04, corner: -0.05, hitch: -0.04 }, pa: -0.05, flea: -0.04,
  }) },
  load: { cat: 'goal', fam: 'load', fx: F.load, rush: ['LB2'] },
  // the box shoots its gaps: runs die at the line, but a missed gap goes a long way and screens are open
  runblitz: { cat: 'goal', fam: 'load', rush: ['LB1', 'LB2', 'LB3'], fx: tweak(F.load, {
    run: { m: -0.3, stuff: 0.06, big: 1.6 }, pass: { sack: 1.1, deep: 0.03, screen: 0.05 }, pa: 0.05, draw: -0.2,
  }) },
};

/** The seven family calls in their original order: what the AI calls, and what a wrong pre-snap read can show. */
export const BASE_CALLS: Exclude<LookFam, never>[] = ['balanced', 'blitz', 'load', 'zone', 'man', 'prevent', 'goal'];

/** The calls offered to the player, tab by tab. ('soft' is the old name of 'prevent', kept for saved games.) */
export const DEF_CALLS = Object.keys(DEF_PLAYS) as Exclude<Look, 'soft'>[];

/** The family a call belongs to: how it lines up and moves. */
export const famOf = (look: Look): LookFam => (look === 'soft' ? 'prevent' : DEF_PLAYS[look].fam);

/** Goal-line defense is built for the last five yards or a yard or two to go. */
export const goalLineSituation = (s: State) => 100 - s.yl <= 5 || s.dist <= 2;

const FAR: Partial<Record<Look, DefFx>> = Object.fromEntries(DEF_CALLS.filter((k) => DEF_PLAYS[k].goalOnly && k !== 'goal').map((k) => [k, farOf(DEF_PLAYS[k].fx)]));

/** The effects of a call in this situation. */
export function defFx(look: Look, s: State): DefFx {
  if (look === 'soft') return DEF_FX.prevent;
  if (look === 'goal') return goalLineSituation(s) ? DEF_FX.goal : DEF_FX.goalFar;
  const p = DEF_PLAYS[look];
  return p.goalOnly && !goalLineSituation(s) ? FAR[look]! : p.fx;
}
