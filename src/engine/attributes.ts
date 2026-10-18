/**
 * How players' game ratings move a play. Every effect is a shift away from an average player (80, or the opposing
 * unit), clamped, so no player or unit can push a play to a sure thing: incompletions, sacks, stuffs and
 * interceptions always stay possible, and the call, the defense, down and distance still decide most of it.
 *
 * Passing (receiver = the targeted man, defender = whoever covers him; see roster.ts COVERS):
 *   catch rate   +0.005 per point of separation over the defender's coverage
 *                +0.002 per point of receiver hands over 80, +0.004 per point of quarterback accuracy over 80
 *                deep throws also: +0.003 per point of arm over 80, +0.002 per point of contested catch over coverage,
 *                -0.002 per point of safety coverage over 80 (help over the top)
 *   sacks        x (1 + 0.025 per point of pass rush over pass protection), clamped to 0.5-2
 *   picks        x (1 + 0.03 per point of the defender's ball skills over the quarterback's decision-making), 0.5-2
 *   after catch  x (1 + 0.02 per point of receiver run-after-catch over the defense's tackling), 0.6-1.5
 *   breakaway    the chance of a long run after the catch x (1 + 0.04 per point of receiver speed over pursuit), 0.5-2
 * Running (carrier = the running back, or the quarterback/receiver on keepers and end-arounds):
 *   yards        +0.04 per point of run blocking over run defense, +0.01 per point of carrier power over 80
 *   breakaway    x (1 + 0.03 per point of carrier speed over pursuit - 0.01 per point of defensive tackling over 80), 0.4-2.2
 *   stuffed      +0.003 per point of run defense over run blocking, -0.002 per point of carrier agility over 80, -0.06 to +0.08
 *   scrambles    +0.05 yards per point of quarterback mobility over 75
 *
 * Coverage scheme (when the game state has `cov`): in man coverage the receiver-defender matchup counts almost twice
 * as much (+0.009 per point of separation over coverage) and on deep throws his speed over the defender's adds
 * +0.003 a point; in zone it counts for less (+0.003) and the quarterback's read adds +0.002 per point of
 * decision-making over 80. So man is the safer call against slow receivers, zone against fast ones.
 *
 * Teams without unit ratings (old saves, tests) fall back to the team-level formula the game used before.
 */
import { clip } from './rng';
import type { Ratings, Rcv } from './types';

export interface PassMods { sackMul: number; comp: number; intMul: number; yacMul: number; bigYac: number; scramble: number }
export interface RunMods { m: number; bigMul: number; stuff: number }

export function passMods(R: Ratings, D: Ratings, tgt: Rcv, deep: boolean, cov?: 'man' | 'zone'): PassMods {
  const O = R.units, X = D.units;
  if (!O || !X) {
    return {
      sackMul: 1 + (D.dl - R.ol) * 0.025, comp: (R.rcv[tgt] - 80) * 0.006 + (R.qb - D.def) * 0.004,
      intMul: 1 + (D.def - R.qb) * 0.03, yacMul: 1 + (R.rcv[tgt] - 80) * 0.02, bigYac: 1, scramble: 0,
    };
  }
  const rc = O.rcv[tgt], cv = X.cov[tgt], q = O.qb;
  const match = cov === 'man' ? 0.009 : cov === 'zone' ? 0.003 : 0.005;
  let comp = (rc.sep - cv.coverage) * match + (rc.hands - 80) * 0.002 + (q.accuracy - 80) * 0.004;
  if (cov === 'man' && deep) comp += (rc.speed - cv.speed) * 0.003;
  if (cov === 'zone') comp += (q.decision - 80) * 0.002;
  // deep throws: arm and contested catches help; good safeties take some away (help over the top)
  if (deep) comp += (q.arm - 80) * 0.003 + (rc.contested - cv.coverage) * 0.002 - ((X.safety?.coverage ?? 80) - 80) * 0.002;
  return {
    sackMul: clip(1 + (X.passRush - O.passPro) * 0.025, 0.5, 2),
    comp: clip(comp, -0.15, 0.15),
    intMul: clip(1 + (cv.ballSkills - q.decision) * 0.03, 0.5, 2),
    yacMul: clip(1 + (rc.yac - X.tackling) * 0.02, 0.6, 1.5),
    // a long run after the catch needs the receiver to outrun pursuit, and fast safeties close the gap
    bigYac: clip(1 + (rc.speed - X.pursuit) * 0.04, 0.5, 2) * clip(1 - ((X.safety?.speed ?? 80) - 80) * 0.02, 0.6, 1.4),
    scramble: (q.mobility - 75) * 0.05,
  };
}

export function runMods(R: Ratings, D: Ratings, carrier: string): RunMods {
  const O = R.units, X = D.units;
  if (!O || !X) return { m: (R.off - D.def) * 0.05, bigMul: 1, stuff: 0 };
  const speed = carrier === 'QB' ? O.qb.mobility : carrier === 'WR2' ? O.rcv.WR2.speed : O.rb.speed;
  const agility = carrier === 'QB' ? O.qb.mobility : carrier === 'WR2' ? O.rcv.WR2.yac : O.rb.agility;
  const power = carrier === 'RB' ? O.rb.power : 75;
  return {
    m: (O.runBlock - X.runDef) * 0.04 + (power - 80) * 0.01,
    bigMul: clip(1 + (speed - X.pursuit) * 0.03 - (X.tackling - 80) * 0.01, 0.4, 2.2),
    stuff: clip((X.runDef - O.runBlock) * 0.003 - (agility - 80) * 0.002, -0.06, 0.08),
  };
}
