/**
 * Coverage realism: man coverage lives and dies by the matchup (it's the safer call against slow receivers, the
 * riskier one against fast ones), zone leans on the quarterback's read, and a blitz brings sacks at the price of big
 * plays. What the play card draws is what the field draws and what the animation runs.
 */
import { describe, expect, it } from 'vitest';
import { DEF_CALLS, DEF_PLAYS } from './defense';
import { resolveSnap } from './sim';
import { COV_FROM, customScenario, dailyKind, genScenario, type SpotParams } from './scenario';
import { hash, rng } from './rng';
import type { Look, Rcv, State } from './types';
import { defShapes } from '../ui/defShapes';

const RCV: Rcv[] = ['WR1', 'WR2', 'WR3', 'TE', 'RB'];
const spot = (o: Partial<SpotParams> = {}): State => ({
  ...customScenario({ you: 'KC', them: 'BUF', side: 'off', t: 400, lead: 0, yl: 35, down: 1, dist: 10, to: [3, 3], running: false, home: 0, ...o }, 'cov').start,
  stage: 'call',
});
/** The offense's receivers made fast and separating, or slow and easy to stay with, against an average secondary. */
function withReceivers(s: State, kind: 'fast' | 'slow'): State {
  const R = structuredClone(s.rat[0]), D = structuredClone(s.rat[1]);
  for (const r of RCV) Object.assign(R.units!.rcv[r], kind === 'fast' ? { sep: 93, speed: 95 } : { sep: 66, speed: 70 });
  for (const r of RCV) Object.assign(D.units!.cov[r], { coverage: 80, speed: 85, ballSkills: 75, reaction: 80 });
  return { ...s, rat: [R, D] };
}
function compRate(s: State, play: string, look: Look, n = 5000) {
  let att = 0, comp = 0;
  for (let i = 0; i < n; i++) {
    const res = resolveSnap(s, play, look, rng(hash('cov', i)));
    if (res.kind === 'pass') { att++; if (res.complete) comp++; }
  }
  return comp / att;
}

describe('man and zone', () => {
  const base = spot();
  it('man is the safer call against slow receivers and the riskier one against fast receivers', () => {
    for (const play of ['slants', 'go']) {
      const slow = withReceivers(base, 'slow'), fast = withReceivers(base, 'fast');
      const slowGap = compRate(slow, play, 'man') - compRate(slow, play, 'zone');
      const fastGap = compRate(fast, play, 'man') - compRate(fast, play, 'zone');
      expect(fastGap - slowGap, play).toBeGreaterThan(0.06);
    }
    // against slow receivers, man allows fewer completions than zone
    expect(compRate(withReceivers(base, 'slow'), 'slants', 'man')).toBeLessThan(compRate(withReceivers(base, 'slow'), 'slants', 'zone'));
  });
  it('without the coverage flag (older dailies), the scheme changes nothing about the matchup', () => {
    const off = { ...withReceivers(base, 'fast'), cov: undefined };
    const fastNoCov = compRate(off, 'slants', 'man') - compRate(off, 'slants', 'zone');
    const slowNoCov = compRate({ ...withReceivers(base, 'slow'), cov: undefined }, 'slants', 'man') - compRate({ ...withReceivers(base, 'slow'), cov: undefined }, 'slants', 'zone');
    expect(Math.abs(fastNoCov - slowNoCov)).toBeLessThan(0.03);
  });
  it('dailies get the coverage flag from COV_FROM on, and never before', () => {
    expect(genScenario('daily:2026-10-17:0', 'daily', { kind: dailyKind('2026-10-17') }).start.cov).toBeUndefined();
    expect(genScenario(`daily:${COV_FROM}:0`, 'daily', { kind: dailyKind(COV_FROM) }).start.cov).toBe(true);
    expect(genScenario('surv:1:0', 'survivor').start.cov).toBe(true);
  });
});

describe('the blitz: sacks, at a price', () => {
  // your defense (dx applies when they have the ball)
  const s = { ...customScenario({ you: 'KC', them: 'BUF', side: 'def', t: 400, lead: 0, yl: 35, down: 2, dist: 8, to: [3, 3], running: false, home: 0 }, 'blitz').start, stage: 'call' as const };
  const rates = (play: string, look: Look, n = 5000) => {
    let sacks = 0, big = 0, yards = 0;
    for (let i = 0; i < n; i++) {
      const r = resolveSnap(s, play, look, rng(hash('blitz', i)));
      if (r.kind === 'sack') sacks++;
      if (!r.turnover && r.yards >= 20) big++;
      if (!r.turnover) yards += r.yards;
    }
    return { sack: sacks / n, big: big / n, ypp: yards / n };
  };
  it('against a long-developing throw, a blitz gets home far more often than zone', () => {
    expect(rates('deep_post', 'blitz').sack).toBeGreaterThan(rates('deep_post', 'zone').sack * 2);
  });
  it('against a quick throw or a screen, the blitz gives up more', () => {
    expect(rates('screen', 'blitz').ypp).toBeGreaterThan(rates('screen', 'zone').ypp);
    expect(rates('slants', 'blitz').big).toBeGreaterThanOrEqual(rates('slants', 'zone').big);
  });
});

describe('what you see is what happens', () => {
  it('the drawn blitzers are the call\'s rushers, and nobody both rushes and covers', () => {
    for (const k of DEF_CALLS) {
      const sh = defShapes(k);
      expect(sh.rush, k).toEqual(DEF_PLAYS[k].rush ?? []);
      for (const z of sh.zones) expect(sh.rush, `${k} zone ${z}`).not.toContain(z);
      for (const [d] of sh.man) expect(sh.rush, `${k} man ${d}`).not.toContain(d);
    }
  });
  it('every blitz call sends at least one extra rusher; zone calls other than the fire zone send none', () => {
    for (const k of DEF_CALLS) {
      if (DEF_PLAYS[k].cat === 'blitz') expect(defShapes(k).rush.length, k).toBeGreaterThan(0);
      if (DEF_PLAYS[k].cat === 'zone') expect(defShapes(k).rush.length, k).toBe(0);
    }
  });
});
