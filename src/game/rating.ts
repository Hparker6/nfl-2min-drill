/**
 * How a spot (one game) is rated. Three separate numbers, never mixed up:
 *
 *   Call grade (0-100, per decision): 100 - 7 x the points of win chance given up versus the best option on the board.
 *     Shown on each result card. It says how good that one call was, not how the game went.
 *
 *   Decisions (0-100, per spot): 100 x e^(-L / 40), where L is the total win chance given up across every call in the
 *     spot, in percentage points. A spot of near-best calls (L about 3) scores about 93; giving up 20 points in total
 *     scores 61. Using the total rather than the average means one catastrophic call is not diluted by fifteen routine
 *     ones: a late throw that gives up 14 points of win chance costs as much here as it cost on the field.
 *
 *   Result (0-100, per spot): a win scores 75-100, a loss 0-25. Inside each band, harder spots score higher:
 *     win = 75 + 25 x (1 - p), loss = 25 x (1 - p), where p is how often the simulated coach wins from the starting
 *     spot. Losing a spot you were 20% to win scores 20; losing one you were 85% to win scores about 4.
 *
 *   Performance (0-100, per spot) = 0.55 x Decisions + 0.45 x Result. Decisions carry slightly more weight because
 *     they are what the player controls. The result weight is large enough that a loss tops out at 66 (perfect calls on
 *     a nearly hopeless spot) and a win never falls below 34, and that at equal decision quality every win outscores
 *     every loss by at least 22 points. An interception counts once: through the win chance it gave up (in Decisions)
 *     and, if it cost the game, through the result. There is no separate interception penalty.
 *
 * A Daily's performance is the plain average of its three spots' performance; its Decisions number is the average of
 * the spots' Decisions. Survivor runs are summarized the same way.
 */
import type { Session } from './session';
import type { SpotResult } from './storage';
import type { GameFacts } from './badges';
import type { Ev } from '../engine/types';
import { tagsOf } from './share';

export const DECISION_SCALE = 40;   // points of total win chance given up that cut Decisions to 1/e (37)
export const W_DECISIONS = 0.55;
export const W_RESULT = 0.45;
export const RESULT_BAND = 25;      // width of the win band (75-100) and the loss band (0-25)

const clamp = (x: number) => Math.max(0, Math.min(100, x));

export function decisionQuality(lostTotal: number): number {
  return clamp(100 * Math.exp(-Math.max(0, lostTotal) / DECISION_SCALE));
}

export function resultScore(win: boolean, startWp: number): number {
  const p = Math.max(0, Math.min(1, startWp));
  return win ? 100 - RESULT_BAND * p : RESULT_BAND * (1 - p);
}

export interface Rating { decisions: number; result: number; performance: number }

/** A spot's three numbers. Old saved results have no starting win chance; they are rated as even (0.5). */
export function rateSpot(r: Pick<SpotResult, 'win' | 'lost'> & { baseWp?: number }): Rating {
  const decisions = decisionQuality(r.lost);
  const result = resultScore(r.win, r.baseWp ?? 0.5);
  return {
    decisions: Math.round(decisions),
    result: Math.round(result),
    performance: Math.round(clamp(W_DECISIONS * decisions + W_RESULT * result)),
  };
}

/** Several spots (a Daily, a Survivor run, all-time stats): the average of each number. */
export function rateSpots(spots: (Pick<SpotResult, 'win' | 'lost'> & { baseWp?: number })[]): Rating {
  if (!spots.length) return { decisions: 0, result: 0, performance: 0 };
  const all = spots.map(rateSpot);
  const avg = (k: keyof Rating) => Math.round(all.reduce((a, x) => a + x[k], 0) / all.length);
  return { decisions: avg('decisions'), result: avg('result'), performance: avg('performance') };
}

/** The saved record of a finished spot, built from the session. This is what every screen rates. */
export function spotResult(session: Session, date: string): SpotResult {
  const sc = session.sc;
  const r = session.result();
  const recs = session.records.filter((x) => x.grade);
  return {
    id: sc.id, mode: sc.mode, date, teams: [sc.teams[0].id, sc.teams[1].id], win: r.win, ot: r.ot, score: r.score,
    grades: recs.map((x) => x.grade!.g), scores: recs.map((x) => x.grade!.score),
    lost: recs.reduce((a, x) => a + x.grade!.lost, 0), aiLost: recs.reduce((a, x) => a + x.grade!.aiLost, 0),
    tags: tagsOf(session.records),
    baseWp: sc.baseWp,
    facts: factsOf(session),
  };
}

/** The facts of a finished game that badges read. */
export function factsOf(session: Session): GameFacts {
  const st = session.sc.start;
  const evs = session.log.map((l) => l.ev);
  const snaps = evs.filter((e): e is Extract<Ev, { type: 'snap' }> => e.type === 'snap' && !e.try);
  const recs = session.records.filter((x) => x.grade);
  return {
    lead0: st.score[0] - st.score[1],
    t0: st.t,
    perfect: recs.length >= 3 && recs.every((x) => x.grade!.g === 'g'),
    fourth: snaps.filter((e) => e.off === 0 && e.down0 === 4 && (e.first || e.res.td) && e.res.kind !== 'fg' && e.res.kind !== 'punt' && !e.res.penalty).length,
    two: evs.filter((e) => e.type === 'pat' && e.off === 0 && e.two && e.good).length,
    takeaways: snaps.filter((e) => e.off === 1 && e.res.turnover && e.res.kind !== 'punt').length,
    long: Math.max(0, ...snaps.filter((e) => e.off === 0 && !e.res.penalty && !e.res.turnover && (e.res.kind !== 'pass' || e.res.complete)).map((e) => e.res.yards)),
    clutchGreen: recs.some((x) => x.clutch && x.grade!.g === 'g'),
  };
}
