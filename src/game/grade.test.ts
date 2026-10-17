import { describe, expect, it } from 'vitest';
import { evaluate, evaluatePaired, emptyPairs, pairSe, type OptStat } from '../engine/evaluate';
import { customScenario } from '../engine/scenario';
import { Session } from './session';
import { NOISE_K, makeGrade, nearEdge } from './grade';

describe('paired noise', () => {
  it('pairSe is the standard error of the mean paired difference', () => {
    const a = [1, 0, 1, 1, 0, 1, 0, 1], b = [0, 0, 1, 0, 0, 1, 1, 0];
    const p = emptyPairs(2);
    a.forEach((x, i) => { const d = x - b[i]; p.d[1] += d; p.d2[1] += d * d; p.n++; });
    const diffs = a.map((x, i) => x - b[i]);
    const m = diffs.reduce((s, x) => s + x, 0) / diffs.length;
    const v = diffs.reduce((s, x) => s + x * x, 0) / diffs.length - m * m;
    expect(pairSe(p, 0, 1)).toBeCloseTo(Math.sqrt(v / diffs.length) * 100, 9);
    expect(pairSe(p, 1, 0)).toBeCloseTo(pairSe(p, 0, 1), 9);
    expect(pairSe(p, 0, 0)).toBe(0);
  });
  it('a paired evaluation runs exactly the same simulations as a plain one', () => {
    const s = customScenario({ you: 'KC', them: 'BUF', side: 'off', t: 100, lead: -3, yl: 40, down: 1, dist: 10, to: [2, 2], running: false, home: 0 }, 'pair').start;
    const ch = [{ play: 'slants' }, { play: 'inside_zone' }, { play: 'go' }];
    const plain = evaluate(s, ch, 200, 7, 50), paired = evaluatePaired(s, ch, 200, 7, 50);
    expect(paired.stats).toEqual(plain);
    expect(paired.pairs.n).toBe(200);
    // the mean paired difference is the difference of the means
    expect(paired.pairs.d[0 * 3 + 1] / 200).toBeCloseTo(plain[0].wp / 200 - plain[1].wp / 200, 9);
  });
});

describe('noise-aware grades', () => {
  const sc = customScenario({ you: 'KC', them: 'BUF', side: 'off', t: 100, lead: -3, yl: 40, down: 1, dist: 10, to: [2, 2], running: false, home: 0 }, 'grade');
  const ses = new Session(sc, []);
  let d = ses.decision();
  for (let i = 0; i < 10 && !d; i++) { ses.auto(); d = ses.decision(); }
  const dec = d!;
  const [best, mine] = dec.options;
  const st = (wp: number): OptStat => ({ n: 5000, wp: wp * 5000, succ: 2500, secs: 30000, give: 500, pts: 0 });
  const stats = new Map<string, OptStat>([[best.key, st(0.5)], [mine.key, st(0.49)]]);   // 1.0 point behind
  it('without noise, a call one point behind is Close', () => {
    expect(makeGrade(dec, mine, stats.get(mine.key)!, stats).g).toBe('y');
  });
  it('with that much noise in the comparison, it gets the benefit of the doubt', () => {
    const g = makeGrade(dec, mine, stats.get(mine.key)!, stats, () => 0.4);
    expect(NOISE_K * 0.4).toBeGreaterThan(1.0 - 0.75);
    expect(g.g).toBe('g');
    expect(g.lost).toBeCloseTo(1.0, 6);   // the card still shows the measured gap
    expect(g.se).toBe(0.4);
  });
  it('the best call has no noise to allow for', () => {
    expect(makeGrade(dec, best, stats.get(best.key)!, stats, () => 5).se).toBe(0);
  });
  it('calls near a boundary are flagged for more simulations; clear ones are not', () => {
    expect(nearEdge(1.0, 0.4)).toBe(true);
    expect(nearEdge(4.2, 0.4)).toBe(false);
    expect(nearEdge(1.0, 0)).toBe(false);
  });
});
