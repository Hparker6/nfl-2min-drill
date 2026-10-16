/**
 * The rating must reflect both how the game went and how good the calls were. The first block checks the seven
 * scenarios with representative inputs; the second plays real games through the same Session -> spotResult ->
 * rateSpot path the review and summary screens use, with every decision graded by simulation.
 */
import { describe, expect, it } from 'vitest';
import { decisionQuality, rateSpot, rateSpots, resultScore, spotResult } from './rating';
import { Session } from './session';
import { makeGrade } from './grade';
import { evaluate, type OptStat } from '../engine/evaluate';
import { genScenario } from '../engine/scenario';
import { hash } from '../engine/rng';

// total win chance given up over a spot (percentage points). A sound spot of ~15 calls gives up ~2-5;
// a careless one 25-40. A late interception thrown on a bad call gives up ~10-15 by itself.
const spot = (win: boolean, lost: number, baseWp = 0.4) => ({ win, lost, baseWp });

describe('rating formula', () => {
  const cases = {
    winExcellent: rateSpot(spot(true, 3)),
    winPoor: rateSpot(spot(true, 35)),
    lossExcellent: rateSpot(spot(false, 3)),
    lossPoor: rateSpot(spot(false, 35)),
    lossLateInt: rateSpot(spot(false, 4 + 14)),             // sound game, then a costly late throw
    closeLossSound: rateSpot(spot(false, 5, 0.55)),         // close game, slightly favored, sound calls
  };

  it('prints the scenario table', () => {
    console.table(Object.fromEntries(Object.entries(cases).map(([k, v]) => [k, v])));
  });

  it('stays within 0-100', () => {
    for (const lost of [0, 1, 5, 20, 80, 500]) for (const win of [true, false]) for (const p of [0, 0.2, 0.5, 0.9, 1]) {
      const r = rateSpot(spot(win, lost, p));
      for (const v of Object.values(r)) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(100); }
    }
  });

  it('orders the scenarios sensibly', () => {
    const c = cases;
    expect(c.winExcellent.performance).toBeGreaterThan(c.winPoor.performance);
    expect(c.winPoor.performance).toBeGreaterThan(c.lossExcellent.performance);
    expect(c.lossExcellent.performance).toBeGreaterThan(c.closeLossSound.performance - 6);   // both sound losses: close together
    expect(c.lossExcellent.performance).toBeGreaterThan(c.lossLateInt.performance);
    expect(c.lossLateInt.performance).toBeGreaterThan(c.lossPoor.performance);
    expect(c.winExcellent.performance).toBeGreaterThanOrEqual(85);
    expect(c.lossPoor.performance).toBeLessThanOrEqual(35);
  });

  it('a loss never reaches 86, however good the calls; good calls in a loss still show as good Decisions', () => {
    for (const p of [0, 0.3, 0.6, 1]) {
      const r = rateSpot(spot(false, 0, p));
      expect(r.performance).toBeLessThanOrEqual(67);
      expect(r.decisions).toBe(100);
    }
  });

  it('at equal decision quality, a win always outscores a loss by a wide margin', () => {
    for (const lost of [0, 5, 20, 60]) {
      expect(rateSpot(spot(true, lost, 0.9)).performance - rateSpot(spot(false, lost, 0.1)).performance).toBeGreaterThanOrEqual(22);
    }
  });

  it('a costly mistake counts in full: one 14-point call is not averaged away', () => {
    expect(decisionQuality(4) - decisionQuality(18)).toBeGreaterThan(20);
  });

  it('harder spots earn more for the same result', () => {
    expect(resultScore(true, 0.2)).toBeGreaterThan(resultScore(true, 0.8));
    expect(resultScore(false, 0.2)).toBeGreaterThan(resultScore(false, 0.8));
    expect(resultScore(false, 0)).toBeLessThan(resultScore(true, 1));
  });

  it('a Daily is the average of its spots, mixing wins, losses and decision quality', () => {
    const day = [spot(true, 3), spot(false, 30), spot(true, 15, 0.7)];
    const each = day.map(rateSpot);
    const d = rateSpots(day);
    expect(d.performance).toBe(Math.round(each.reduce((a, r) => a + r.performance, 0) / 3));
    expect(d.decisions).toBe(Math.round(each.reduce((a, r) => a + r.decisions, 0) / 3));
    console.log('daily example', each.map((r) => r.performance), '->', d);
    // two wins and a careless loss sit between the best and worst single spots
    expect(d.performance).toBeLessThan(Math.max(...each.map((r) => r.performance)));
    expect(d.performance).toBeGreaterThan(Math.min(...each.map((r) => r.performance)));
  });

  it('old saved results without a starting win chance are rated as an even spot', () => {
    expect(rateSpot({ win: false, lost: 3 })).toEqual(rateSpot(spot(false, 3, 0.5)));
  });
});

describe('rating end to end: real games, real grades, the function the screens use', () => {
  /** Play a spot through Session, grading every decision by simulation, always taking the best or the worst call. */
  function play(seed: string, policy: 'best' | 'worst') {
    const sc = genScenario(seed, 'survivor');
    const ses = new Session(sc);
    for (let g = 0; g < 400 && !ses.over; g++) {
      const d = ses.decision();
      if (!d) { ses.auto(); continue; }
      const raw = evaluate(d.state, d.options.map((o) => o.choice), 80, hash(seed, g));
      const stats = new Map<string, OptStat>(d.options.map((o, i) => [o.key, raw[i]]));
      const order = [...d.options].sort((a, b) => stats.get(b.key)!.wp - stats.get(a.key)!.wp);
      const pick = policy === 'best' ? order[0] : order[order.length - 1];
      ses.choose(pick, makeGrade(d, pick, stats.get(pick.key)!, stats));
    }
    const res = spotResult(ses, '2026-10-16');
    const ints = ses.log.filter((l) => l.ev.type === 'snap' && l.ev.off === 0 && l.ev.res.intercepted).length;
    return { res, rating: rateSpot(res), ints };
  }

  it('best calls beat worst calls, losses stay below 67, and everything stays in range', () => {
    const rows: { seed: string; policy: string; win: boolean; lost: number; ints: number; performance: number; decisions: number }[] = [];
    for (let i = 0; i < 8; i++) for (const policy of ['best', 'worst'] as const) {
      const { res, rating, ints } = play(`rate-e2e:${i}`, policy);
      rows.push({ seed: `rate-e2e:${i}`, policy, win: res.win, lost: +res.lost.toFixed(1), ints, performance: rating.performance, decisions: rating.decisions });
      for (const v of Object.values(rating)) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(100); }
      if (!res.win) expect(rating.performance).toBeLessThanOrEqual(67);
      if (res.win) expect(rating.performance).toBeGreaterThanOrEqual(34);
    }
    console.table(rows);
    const best = rows.filter((r) => r.policy === 'best'), worst = rows.filter((r) => r.policy === 'worst');
    const avg = (xs: typeof rows, k: 'performance' | 'decisions') => xs.reduce((a, r) => a + r[k], 0) / xs.length;
    expect(avg(best, 'decisions')).toBeGreaterThan(avg(worst, 'decisions') + 25);
    expect(avg(best, 'performance')).toBeGreaterThan(avg(worst, 'performance') + 15);
    // the same spot, played well and played badly: the well-played one never rates lower when the results match
    for (let i = 0; i < 8; i++) {
      const b = best[i], w = worst[i];
      if (b.win === w.win) expect(b.performance).toBeGreaterThanOrEqual(w.performance);
    }
  }, 240_000);
});
