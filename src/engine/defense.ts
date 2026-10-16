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
import type { Look, RouteId, State } from './types';

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

/** The calls offered to the player, in display order. ('soft' is the old name of 'prevent', kept for saved games.) */
export const DEF_CALLS: Exclude<Look, 'soft'>[] = ['balanced', 'blitz', 'load', 'zone', 'man', 'prevent', 'goal'];

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

/** Goal-line defense is built for the last five yards or a yard or two to go. */
export const goalLineSituation = (s: State) => 100 - s.yl <= 5 || s.dist <= 2;

/** The effects of a call in this situation. */
export function defFx(look: Look, s: State): DefFx {
  if (look === 'soft') return DEF_FX.prevent;
  if (look === 'goal') return goalLineSituation(s) ? DEF_FX.goal : DEF_FX.goalFar;
  return DEF_FX[look];
}
