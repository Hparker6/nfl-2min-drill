import { describe, expect, it } from 'vitest';
import { advance, applySnap, clone, simulate, value0 } from './sim';
import { evaluate, mean } from './evaluate';
import { customScenario, dailyScenarios, genScenario, type SpotParams } from './scenario';
import { rng } from './rng';
import type { PlayResult, State } from './types';

const params = (o: Partial<SpotParams> = {}): SpotParams => ({
  you: 'AUS', them: 'PDX', side: 'off', t: 100, lead: -3, yl: 40, down: 1, dist: 10, to: [2, 2], running: false, home: 0, ...o,
});
const spot = (o: Partial<SpotParams> = {}) => customScenario(params(o), 'test').start;
const res = (o: Partial<PlayResult>): PlayResult => ({
  kind: 'run', call: 'inside_zone', look: 'load', carrier: 'RB', yards: 0, oob: false, td: false, safety: false, turnover: false,
  dur: 5, side: 1, ...o,
});

describe('state transitions', () => {
  it('short gain on 3rd and long is not a first down', () => {
    const s = spot({ down: 3, dist: 9 });
    applySnap(s, res({ yards: 4 }));
    expect(s.down).toBe(4);
    expect(s.dist).toBe(5);
    expect(s.yl).toBe(44);
    expect(s.off).toBe(0);
  });
  it('gain past the sticks is a first down and keeps the clock running', () => {
    const s = spot({ down: 2, dist: 6 });
    const first = applySnap(s, res({ yards: 8 }));
    expect(first).toBe(true);
    expect(s.down).toBe(1);
    expect(s.dist).toBe(10);
    expect(s.running).toBe(true);
  });
  it('failed 4th down turns it over at the spot', () => {
    const s = spot({ down: 4, dist: 3, yl: 60 });
    applySnap(s, res({ yards: 1 }));
    expect(s.off).toBe(1);
    expect(s.yl).toBe(39);
    expect(s.down).toBe(1);
  });
  it('touchdown scores six and goes to the try', () => {
    const s = spot({ yl: 95 });
    const before = s.score[0];
    applySnap(s, res({ yards: 5, td: true }));
    expect(s.score[0]).toBe(before + 6);
    expect(s.stage).toBe('pat');
  });
  it('interception changes possession at the return spot', () => {
    const s = spot({ yl: 40 });
    applySnap(s, res({ kind: 'pass', yards: 20, turnover: true, intercepted: true, retYds: 5 }));
    expect(s.off).toBe(1);
    expect(s.yl).toBe(100 - (40 + 20 - 5));
  });
  it('incompletion stops the clock, out of bounds stops it only late (inside 5:00 of the fourth quarter)', () => {
    const a = spot({ t: 300 });
    applySnap(a, res({ kind: 'pass', complete: false }));
    expect(a.running).toBe(false);
    const b = spot({ t: 400 });
    applySnap(b, res({ yards: 5, oob: true }));
    expect(b.running).toBe(true);
    const c = spot({ t: 90 });
    applySnap(c, res({ yards: 5, oob: true }));
    expect(c.running).toBe(false);
  });
  it('two-minute warning stops the clock at 2:00', () => {
    const s = spot({ t: 124 });
    applySnap(s, res({ yards: 3, dur: 8 }));
    expect(s.t).toBe(120);
    expect(s.warned).toBe(true);
    expect(s.running).toBe(false);
  });
  it('a play crossing 2:00 stops the clock and announces the warning', () => {
    const s = { ...spot({ t: 126, lead: -3 }), stage: 'call' } as State;
    let seen = false;
    for (let i = 0; i < 50 && !seen; i++) {
      const c = clone(s);
      const ev: import('./types').Ev[] = [];
      advance(c, rng(i), { play: 'inside_zone' }, ev);
      if (c.warned) {
        expect(c.t).toBe(120);
        expect(c.running).toBe(false);
        expect(ev.some((e) => e.type === 'warning')).toBe(true);
        // no runoff before the next snap: the clock waits for the snap
        advance(c, rng(i), { offClock: 'milk' });
        expect(c.t).toBe(120);
        seen = true;
      }
    }
    expect(seen).toBe(true);
  });
  it('pre-snap runoff stops at the two-minute warning', () => {
    const s = spot({ t: 135, lead: 3, running: true, to: [3, 0] });
    const ev: import('./types').Ev[] = [];
    advance(s, rng(1), { offClock: 'milk' }, ev);
    expect(s.t).toBe(120);
    expect(s.running).toBe(false);
    expect(ev[0].type).toBe('warning');
  });
  it('safety gives the defense two and a free kick', () => {
    const s = spot({ yl: 2 });
    applySnap(s, res({ yards: -2, safety: true }));
    expect(s.score[1]).toBe(spot().score[1] + 2);
    expect(s.stage).toBe('kick');
    expect(s.safetyKick).toBe(true);
  });
});

describe('simulation', () => {
  it('always plays to the end of regulation: the final, or a tie’s overtime coin toss (where a rollout stops)', () => {
    for (let i = 0; i < 200; i++) {
      const s = clone(spot({ t: 240, lead: -7 }));
      simulate(s, rng(i));
      if (s.stage === 'toss') expect([s.q, s.score[0] - s.score[1]]).toEqual([5, 0]);
      else { expect(s.stage).toBe('over'); expect(s.t).toBe(0); }
    }
  });
  it('is deterministic for a seed', () => {
    const a = clone(spot()), b = clone(spot());
    simulate(a, rng(42));
    simulate(b, rng(42));
    expect(a.score).toEqual(b.score);
  });
  it('kneeling out a lead beats a deep shot', () => {
    const s = spot({ t: 70, lead: 4, running: true, to: [3, 0] });
    const [kneel, deep] = evaluate(s, [{ offClock: 'kneel' }, { offClock: 'nohuddle' }], 300, 1);
    expect(mean(kneel, 'wp')).toBeGreaterThan(0.97);
    expect(mean(kneel, 'wp')).toBeGreaterThanOrEqual(mean(deep, 'wp'));
  });
  it('down 3 on the last play: kick it rather than run', () => {
    const s = { ...spot({ t: 4, lead: -3, yl: 75, running: false }), stage: 'call' } as State;
    const [fg, run] = evaluate(s, [{ play: 'fg' }, { play: 'inside_zone' }], 400, 2);
    expect(mean(fg, 'wp')).toBeGreaterThan(mean(run, 'wp') + 0.2);
  });
  it('a game ends with someone ahead or at overtime odds', () => {
    const s = clone(spot());
    simulate(s, rng(7));
    const v = value0(s);
    expect(v >= 0 && v <= 1).toBe(true);
  });
  it('kickoff after a score hands the ball over', () => {
    const s = { ...spot(), stage: 'kick', kicker: 0 } as State;
    advance(s, rng(3));
    expect(s.stage === 'pre' || s.stage === 'over' || s.stage === 'pat').toBe(true);
  });
});

describe('scenarios', () => {
  it('daily spots are the same for the same date and differ across dates', () => {
    const a = dailyScenarios('2026-10-15'), b = dailyScenarios('2026-10-15'), c = dailyScenarios('2026-10-16');
    expect(a.map((x) => x.start)).toEqual(b.map((x) => x.start));
    expect(JSON.stringify(a.map((x) => x.start))).not.toEqual(JSON.stringify(c.map((x) => x.start)));
  });
  it('spots are in doubt', () => {
    let ok = 0;
    for (let i = 0; i < 20; i++) {
      const sc = genScenario('t' + i, 'survivor');
      if (sc.baseWp >= 0.08 && sc.baseWp <= 0.88) ok++;
    }
    expect(ok).toBeGreaterThanOrEqual(17);
  });
  it('evaluates a full call sheet fast enough', () => {
    const s = { ...spot({ t: 110 }), stage: 'call' } as State;
    const choices = ['inside_zone', 'quick_out', 'go', 'dig', 'screen', 'comeback'].map((play) => ({ play }));
    const t0 = performance.now();
    evaluate(s, choices, 300, 9);
    const ms = performance.now() - t0;
    // 1800 games; report so tuning sample sizes is easy
    console.log(`1800 simulated games in ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(4000);
  });
});
