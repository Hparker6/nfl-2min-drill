/**
 * Daily fairness (scenario.ts FAIR_FROM): every daily from that date starts with at least a minute, inside its kind's
 * clock range, as a legal and consistent game state, with a realistic path to the points it needs, and in doubt.
 * Dailies before that date, Survivor, Practice and the AI offense are pinned by fingerprints, so the change can't leak
 * into them. (If the rosters are rebuilt, the Survivor and Practice fingerprints can change legitimately: regenerate.)
 */
import { describe, expect, it } from 'vitest';
import { advance, aiOffPlay, clone } from './sim';
import { evaluate } from './evaluate';
import { hash, rng } from './rng';
import {
  DAILY_KINDS, DAILY_MIN_SECONDS, dayNumber, FAIR_CLOCK, FAIR_FROM, FAIR_WP, checkSpot, customScenario, dailyKind, dailyScenarios,
  drivePace, genScenario, survivorScenario, type DailyKind, type Scenario, type SpotParams,
} from './scenario';
import type { State } from './types';

const fp = (x: unknown) => hash(JSON.stringify(x)).toString(16);
const shape = (sc: Scenario) => { const s = sc.start; return fp([s.t, s.score, s.yl, s.down, s.dist, s.to, s.running, s.off, s.weather ?? 'clear', sc.teams.map((t) => t.id), sc.kind ?? null, sc.home]); };
const addDays = (date: string, n: number) => new Date(Date.parse(date + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const daily = (date: string) => genScenario(`daily:${date}:0`, 'daily', { kind: dailyKind(date) });
const lead = (s: State) => s.score[0] - s.score[1];

// recorded from the generator as it was before the fairness change. Survivor 2:2 and 2:4 and the AI-offense sample
// were re-recorded when coverage schemes arrived (scenario.ts COV_FROM): Survivor and Practice spots are picked by
// win chance, which the coverage scheme changes. Dailies before COV_FROM are untouched. Survivor 2:4 and the AI-offense
// sample were re-recorded again with the 2026 rosters (nfl.ts ROSTERS_FROM); dailies before that keep the 2025 set.
const BEFORE: Record<string, string> = {
  'daily 2026-10-01': '3636b6fa', 'daily 2026-10-02': 'a0077643', 'daily 2026-10-03': 'b27bd7e7', 'daily 2026-10-04': '19f7aae2', 'daily 2026-10-05': '2dac63bb',
  'daily 2026-10-06': '76ad971c', 'daily 2026-10-07': 'beaeed7e', 'daily 2026-10-08': '7a2c96d3', 'daily 2026-10-09': 'e0b5dbdd', 'daily 2026-10-10': '8f4c1f01',
  'daily 2026-10-11': '101bd793', 'daily 2026-10-12': '8b4cee70', 'daily 2026-10-13': 'c5d35d8a', 'daily 2026-10-14': '898cb334', 'daily 2026-10-15': '8211b3a5',
  'daily 2026-10-16': 'df9d034f', 'daily 2026-10-17': '9257d987', 'daily 2026-10-18': 'cfa383fa', 'surv 1:0': 'bed0058c', 'surv 1:1': 'a6ec6ba0',
  'surv 1:2': '2b49b538', 'surv 1:3': 'fa8e3604', 'surv 1:4': 'bdbc5961', 'surv 1:5': '78624373', 'surv 1:6': 'fab59852',
  'surv 1:7': 'e7d9ecf2', 'surv 2:0': '2bfc88aa', 'surv 2:1': '50a9323f', 'surv 2:2': 'c9107cc6', 'surv 2:3': '18a8ed1',
  'surv 2:4': 'cfd1575f', 'surv 2:5': '5e8845d6', 'surv 2:6': '19b95a93', 'surv 2:7': '53265770', 'surv 3:0': '3448e85c',
  'surv 3:1': 'e0e13832', 'surv 3:2': '39bfd6f4', 'surv 3:3': '5d96c198', 'surv 3:4': 'e1538da', 'surv 3:5': '9117e81',
  'surv 3:6': '28270c53', 'surv 3:7': 'bef6d5a4', 'practice rand 0': '7ca907ca', 'practice rand 1': '671c61ad', 'practice rand 2': 'e964c193',
  'practice rand 3': 'b2e67022', 'practice rand 4': '804f0fd8', 'practice rand 5': '79281c22', custom: '3dc4c014', aiOffPlay: 'd71b2ad1',
};

describe('modes the fairness change must not touch', () => {
  it('dailies before FAIR_FROM, Survivor, Practice and the AI offense are exactly as before', () => {
    const now: Record<string, string> = {};
    for (let d = 1; d <= 18; d++) { const date = `2026-10-${String(d).padStart(2, '0')}`; now[`daily ${date}`] = shape(daily(date)); }
    for (let run = 1; run <= 3; run++) for (let g = 0; g < 8; g++) now[`surv ${run}:${g}`] = shape(survivorScenario(run, g));
    for (let i = 0; i < 6; i++) now[`practice rand ${i}`] = shape(genScenario(`practice:rand:${i}`, 'practice'));
    now.custom = shape(customScenario({ you: 'KC', them: 'BUF', side: 'off', t: 90, lead: -3, yl: 30, down: 1, dist: 10, to: [2, 1], running: true, home: 0 }, 'practice:1'));
    const picks: string[] = [];
    for (let i = 0; i < 300; i++) {
      const s = clone(genScenario(`aioff:${i}`, 'practice').start); s.stage = 'call';
      const r = rng(hash('aioff', i));
      for (let j = 0; j < 5; j++) picks.push(aiOffPlay(s, r));
    }
    now.aiOffPlay = fp(picks);
    expect(now).toEqual(BEFORE);
  });
  it('FAIR_FROM is after the last recorded daily', () => {
    expect(FAIR_FROM > '2026-10-18').toBe(true);
  });
});

describe('fair dailies', () => {
  const DAYS = 3 * 365;
  const all: { date: string; kind: DailyKind; sc: Scenario }[] = [];
  for (let i = 0; i < DAYS; i++) { const date = addDays(FAIR_FROM, i); all.push({ date, kind: dailyKind(date), sc: daily(date) }); }

  it('every daily for three years starts with at least a minute, inside its kind\'s clock range', () => {
    for (const { date, kind, sc } of all) {
      const [lo, hi] = FAIR_CLOCK[kind];
      expect(sc.start.t, `${date} ${kind}`).toBeGreaterThanOrEqual(DAILY_MIN_SECONDS);
      expect(sc.start.t, `${date} ${kind}`).toBeGreaterThanOrEqual(lo);
      expect(sc.start.t, `${date} ${kind}`).toBeLessThanOrEqual(hi);
    }
  });
  it('typical comebacks (two-minute drill, tied, fourth down) center on 90-120 seconds', () => {
    for (const k of ['drill', 'tied', 'fourthdown'] as DailyKind[]) {
      const ts = all.filter((x) => x.kind === k).map((x) => x.sc.start.t).sort((a, b) => a - b);
      const median = ts[Math.floor(ts.length / 2)];
      expect(median, k).toBeGreaterThanOrEqual(90);
      expect(median, k).toBeLessThanOrEqual(120);
    }
  });
  it('every daily is a legal, consistent state with a realistic drive, and in doubt', () => {
    for (const { date, kind, sc } of all) {
      expect(checkSpot(sc.start, { daily: true }), `${date} ${kind}`).toEqual([]);
      expect(sc.baseWp, `${date} ${kind}`).toBeGreaterThanOrEqual(FAIR_WP[0]);
      expect(sc.baseWp, `${date} ${kind}`).toBeLessThanOrEqual(FAIR_WP[1]);
    }
  });
  it('each kind keeps its shape: who has the ball, the score, the field and the down', () => {
    for (const { date, kind, sc } of all) {
      const s = sc.start, l = lead(s), m = `${date} ${kind}`;
      expect(sc.kind).toBe(kind);
      if (kind === 'stand') { expect(s.off, m).toBe(1); expect(l, m).toBeGreaterThanOrEqual(1); expect(l, m).toBeLessThanOrEqual(7); }
      else expect(s.off, m).toBe(0);
      if (kind === 'drill') { expect(l, m).toBeGreaterThanOrEqual(-3); expect(l, m).toBeLessThanOrEqual(-1); expect(s.yl, m).toBeGreaterThanOrEqual(20); }
      if (kind === 'hole') { expect(l, m).toBeGreaterThanOrEqual(-8); expect(l, m).toBeLessThanOrEqual(-4); expect(s.yl, m).toBeGreaterThanOrEqual(20); }
      if (kind === 'tied') { expect(l, m).toBe(0); expect(s.yl, m).toBeGreaterThanOrEqual(20); }
      if (kind === 'closeout') expect(l, m).toBeGreaterThanOrEqual(1);
      if (kind === 'goalline') { expect(s.yl, m).toBeGreaterThanOrEqual(88); expect(s.dist, m).toBeLessThanOrEqual(100 - s.yl); }
      if (kind === 'fourthdown') { expect(s.down, m).toBe(4); expect(s.dist, m).toBeLessThanOrEqual(6); expect(s.yl, m).toBeGreaterThanOrEqual(50); }
    }
  });
  it('every kind turns up, and the rotation still never repeats a kind on consecutive days', () => {
    const kinds = new Set(all.map((x) => x.kind));
    expect([...kinds].sort()).toEqual((Object.keys(DAILY_KINDS) as DailyKind[]).sort());
    const week = (date: string) => Math.floor((dayNumber(date) - 1) / 7);
    for (let i = 1; i < all.length; i++) if (week(all[i].date) === week(all[i - 1].date)) expect(all[i].kind).not.toBe(all[i - 1].kind);
  });
  it('the objective is reachable: a second, independent simulation of the coach also wins some', () => {
    // a different seed and more games than the generator used, on a sample of days of every kind
    for (const { date, kind, sc } of all.filter((_, i) => i % 15 === 0)) {
      const [st] = evaluate(sc.start, [{}], 400, hash('recheck', date));
      expect(st.wp / st.n, `${date} ${kind}`).toBeGreaterThan(0.05);
    }
  });
  it('the app\'s dailies (which also avoid yesterday\'s teams) pass the same rules', () => {
    for (let i = 0; i < 60; i++) {
      const date = addDays(FAIR_FROM, i);
      const sc = dailyScenarios(date)[0];
      expect(checkSpot(sc.start, { daily: true }), date).toEqual([]);
      expect(sc.start.t, date).toBeGreaterThanOrEqual(FAIR_CLOCK[dailyKind(date)][0]);
      expect(sc.baseWp, date).toBeGreaterThanOrEqual(FAIR_WP[0]);
      expect(sc.baseWp, date).toBeLessThanOrEqual(FAIR_WP[1]);
    }
  });
});

describe('checkSpot catches broken spots', () => {
  const base = (o: Partial<SpotParams> = {}) => customScenario({ you: 'KC', them: 'BUF', side: 'off', t: 100, lead: -3, yl: 30, down: 1, dist: 10, to: [2, 2], running: false, home: 0, ...o }, 'check').start;
  it('a sound two-minute drill passes', () => {
    expect(checkSpot(base(), { daily: true })).toEqual([]);
  });
  it('under a minute fails a daily (but is legal outside one)', () => {
    const s = base({ t: 45, yl: 92, dist: 8 });
    expect(checkSpot(s, { daily: true }).join()).toMatch(/45 s/);
    expect(checkSpot(s)).toEqual([]);
  });
  it('contradictory states fail: a fifth down, distance past the goal line, four timeouts, a wrong warning flag', () => {
    expect(checkSpot({ ...base(), down: 5 }).join()).toMatch(/down 5/);
    expect(checkSpot({ ...base(), yl: 95, dist: 10 }).join()).toMatch(/distance/);
    expect(checkSpot({ ...base(), to: [4, 2] }).join()).toMatch(/timeouts/);
    expect(checkSpot({ ...base(), warned: false, t: 100 }).join()).toMatch(/two-minute warning/);
    expect(checkSpot({ ...base(), stage: 'call' }).join()).toMatch(/stage/);
  });
  it('an impossible objective fails: a touchdown from the 5 with 61 seconds and no timeouts', () => {
    const s = base({ t: 61, lead: -6, yl: 5, to: [0, 3] });
    expect(checkSpot(s, { daily: true }).join()).toMatch(/the drive needs/);
  });
  it('more than one score down fails a daily', () => {
    expect(checkSpot(base({ lead: -11, t: 200 }), { daily: true }).join()).toMatch(/one score/);
  });
});

describe('drivePace', () => {
  const s = (o: Partial<SpotParams>) => customScenario({ you: 'KC', them: 'BUF', side: 'off', t: 100, lead: -3, yl: 25, down: 1, dist: 10, to: [0, 0], running: true, home: 0, ...o }, 'pace').start;
  it('is null when the offense leads', () => {
    expect(drivePace(s({ lead: 4 }))).toBeNull();
  });
  it('needs more time for a touchdown than for a field goal, and less with timeouts', () => {
    expect(drivePace(s({ lead: -6 }))!).toBeGreaterThan(drivePace(s({ lead: -3 }))!);
    expect(drivePace(s({ to: [3, 0] }))!).toBeLessThan(drivePace(s({ to: [0, 0] }))!);
  });
  it('counts the two-minute warning as a stop only when it is still ahead', () => {
    expect(drivePace(s({ t: 150, lead: -6 }))!).toBeLessThanOrEqual(drivePace(s({ t: 110, lead: -6 }))!);
  });
});

describe('clock rules the fair clock relies on', () => {
  const spot = (o: Partial<SpotParams> = {}) => customScenario({ you: 'AUS', them: 'PDX', side: 'off', t: 100, lead: -3, yl: 40, down: 1, dist: 10, to: [2, 2], running: true, home: 0, ...o }, 'clock').start;
  it('a timeout stops a running clock, costs one timeout and no time', () => {
    const s = spot();
    advance(s, rng(1), { offClock: 'timeout' });
    expect(s.running).toBe(false);
    expect(s.to[0]).toBe(1);
    expect(s.t).toBe(100);
  });
  it('a spike stops the clock for a few seconds and costs a down', () => {
    const s = spot();
    advance(s, rng(2), { offClock: 'spike' });
    expect(s.running).toBe(false);
    expect(s.down).toBe(2);
    expect(s.t).toBeGreaterThanOrEqual(94);
    expect(s.t).toBeLessThan(100);
  });
  it('with no timeouts left, a timeout call falls back to the no-huddle', () => {
    const s = spot({ to: [0, 2] });
    advance(s, rng(3), { offClock: 'timeout' });
    expect(s.to[0]).toBe(0);
    expect(s.t).toBeLessThan(100);
  });
});
