/**
 * The finer rules (types.ts `nr`), on from the OT_FROM daily and in Survivor, Practice and full games: an untimed down
 * after a defensive foul at 0:00, no try after a walk-off touchdown, a blocked punt fallen on in the end zone, a
 * kneel-out that counts the two-minute warning, and overtime ending when the second possession's score leaves it
 * behind. Older games (no flag) play as they did.
 */
import { describe, expect, it } from 'vitest';
import { advance, applySnap, canKneel, resolvePunt } from './sim';
import { customScenario, genScenario, type SpotParams } from './scenario';
import { kickoffState } from './game';
import type { PlayResult, State } from './types';

const params = (o: Partial<SpotParams> = {}): SpotParams => ({
  you: 'AUS', them: 'PDX', side: 'off', t: 100, lead: -3, yl: 40, down: 1, dist: 10, to: [2, 2], running: false, home: 0, ...o,
});
const spot = (o: Partial<SpotParams> = {}, nr = true): State => { const s = customScenario(params(o), 'test').start; if (nr) s.nr = true; else delete s.nr; return s; };
const res = (o: Partial<PlayResult>): PlayResult => ({
  kind: 'run', call: 'inside_zone', look: 'load', carrier: 'RB', yards: 0, oob: false, td: false, safety: false, turnover: false, dur: 5, side: 1, ...o,
});

describe('an untimed down after a defensive foul at 0:00', () => {
  it('extends the game by one snap, and the next play ends it', () => {
    const s = spot({ t: 4 });
    applySnap(s, res({ kind: 'pass', penalty: 'dpi', yards: 15, dur: 6 }));
    expect(s.t).toBe(0);
    expect(s.stage).toBe('pre');
    expect(s.running).toBe(false);
    advance(s, () => 0.5);          // the clock stage passes straight to the call (nothing to run off)
    expect(s.stage).toBe('call');
    applySnap(s, res({ yards: 3, dur: 4 }));
    expect(s.stage).toBe('over');
  });
  it('older games end on the foul, as they did', () => {
    const s = spot({ t: 4 }, false);
    applySnap(s, res({ kind: 'pass', penalty: 'dpi', yards: 15, dur: 6 }));
    expect(s.stage).toBe('over');
  });
});

describe('a walk-off touchdown skips the try', () => {
  it('ends the game on the spot when the touchdown decides it', () => {
    const s = spot({ t: 3, lead: -3, yl: 95 });
    applySnap(s, res({ yards: 5, td: true, dur: 5 }));
    expect(s.score[0] - s.score[1]).toBe(3);
    expect(s.stage).toBe('over');
  });
  it('plays the try when it can tie or win', () => {
    for (const lead of [-6, -7, -8]) {
      const s = spot({ t: 3, lead, yl: 95 });
      applySnap(s, res({ yards: 5, td: true, dur: 5 }));
      expect(s.stage, `down ${-lead}`).toBe('pat');
    }
  });
  it('a defensive score at 0:00 ends it the same way', () => {
    const s = spot({ t: 3, lead: 3, yl: 40 });
    applySnap(s, res({ kind: 'pass', yards: 10, turnover: true, intercepted: true, defTd: true, dur: 8 }));
    expect(s.score[1] - s.score[0]).toBe(3);
    expect(s.stage).toBe('over');
  });
  it('with time left, or on an older game, the try is played', () => {
    const a = spot({ t: 30, lead: -3, yl: 95 });
    applySnap(a, res({ yards: 5, td: true, dur: 5 }));
    expect(a.stage).toBe('pat');
    const b = spot({ t: 3, lead: -3, yl: 95 }, false);
    applySnap(b, res({ yards: 5, td: true, dur: 5 }));
    expect(b.stage).toBe('pat');
  });
});

describe('a blocked punt in the end zone', () => {
  it('is a touchdown for the defense', () => {
    const s = spot({ down: 4, dist: 5, yl: 5, lead: 3 });
    const r = resolvePunt(s, 'rush', () => 0);   // the first roll: blocked
    expect(r.blocked).toBe(true);
    expect(r.defTd).toBe(true);
    applySnap(s, r);
    expect(s.score[1] - s.score[0]).toBe(3);
    expect(s.stage).toBe('pat');
    expect(s.off).toBe(1);
  });
  it('from midfield it is a loss of yards, not a score', () => {
    const s = spot({ down: 4, dist: 5, yl: 50 });
    const r = resolvePunt(s, 'rush', () => 0);
    expect(r.blocked).toBe(true);
    expect(r.defTd).toBeUndefined();
    applySnap(s, r);
    expect(s.off).toBe(1);
    expect(s.yl).toBe(100 - 42);
  });
});

describe('the kneel-out and the two-minute warning', () => {
  it('counts the warning to come as one more stoppage', () => {
    const s = spot({ t: 150, lead: 3, down: 1, to: [0, 0], running: true });
    s.warned = false;
    expect(canKneel(s)).toBe(false);          // 2:30 left: four kneels and the warning stop short
    s.warned = true;
    expect(canKneel(s)).toBe(true);           // past the warning: 4 × 40 covers 2:30
  });
  it('older games count as they did', () => {
    const s = spot({ t: 150, lead: 3, down: 1, to: [0, 0], running: true }, false);
    s.warned = false;
    expect(canKneel(s)).toBe(true);
  });
});

describe('overtime: the second possession scores but stays behind', () => {
  it('ends on the missed try, with no kickoff', () => {
    const rat = genScenario('rules:ot', 'practice').start.rat;
    const s = kickoffState(rat, { seed: 1, qLen: 120, toss: true });
    // the first possession (team 1) scored seven; team 0 has just scored six
    Object.assign(s, { q: 5, t: 300, otp: 2, otOwn: 0, otS: [0, 7], score: [6, 7], off: 0, stage: 'pat', running: false });
    advance(s, () => 0.999, { pat: 'xp' });   // the kick misses
    expect(s.score).toEqual([6, 7]);
    expect(s.stage).toBe('over');
  });
  it('a made try that ties plays on; one that leads ends it', () => {
    const rat = genScenario('rules:ot', 'practice').start.rat;
    const tie = kickoffState(rat, { seed: 1, qLen: 120, toss: true });
    Object.assign(tie, { q: 5, t: 300, otp: 2, otOwn: 0, otS: [0, 7], score: [6, 7], off: 0, stage: 'pat', running: false });
    advance(tie, () => 0, { pat: 'xp' });
    expect(tie.score).toEqual([7, 7]);
    expect(tie.stage).toBe('kick');
    const win = kickoffState(rat, { seed: 1, qLen: 120, toss: true });
    Object.assign(win, { q: 5, t: 300, otp: 2, otOwn: 0, otS: [0, 6], score: [6, 6], off: 0, stage: 'pat', running: false });
    advance(win, () => 0, { pat: 'xp' });
    expect(win.score).toEqual([7, 6]);
    expect(win.stage).toBe('over');
  });
});

describe('when the finer rules start', () => {
  it('dailies before NR_FROM play by the old rules; from it on, and in Survivor and Practice, by the new ones', async () => {
    const { NR_FROM, dailyScenarios, survivorScenario } = await import('./scenario');
    const day = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
    expect(dailyScenarios(day(NR_FROM, -1))[0].start.nr).toBeUndefined();
    expect(dailyScenarios('2026-10-22')[0].start.nr).toBeUndefined();   // live on the site before this shipped
    expect(dailyScenarios(NR_FROM)[0].start.nr).toBe(true);
    expect(survivorScenario(1, 0).start.nr).toBe(true);
    expect(NR_FROM > '2026-10-31').toBe(true);
  });
});

describe('out of bounds late in the fourth quarter', () => {
  it('stops the clock inside 5:00 with the finer rules, and only inside 2:00 without', () => {
    const a = spot({ t: 250 });
    applySnap(a, res({ yards: 6, oob: true, dur: 5 }));
    expect(a.running).toBe(false);
    const b = spot({ t: 250 }, false);
    applySnap(b, res({ yards: 6, oob: true, dur: 5 }));
    expect(b.running).toBe(true);
    const c = spot({ t: 320 });
    applySnap(c, res({ yards: 6, oob: true, dur: 5 }));
    expect(c.running).toBe(true);   // outside 5:00 the clock restarts
  });
});
