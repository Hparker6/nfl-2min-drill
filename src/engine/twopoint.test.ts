/** Going for two is a play you call: a snap from the 2, in for two or nothing, no clock. */
import { describe, expect, it } from 'vitest';
import { advance, applySnap } from './sim';
import { customScenario, type SpotParams } from './scenario';
import { rng } from './rng';
import { Session } from '../game/session';
import type { Ev, PlayResult, State } from './types';

const params = (o: Partial<SpotParams> = {}): SpotParams => ({
  you: 'AUS', them: 'PDX', side: 'off', t: 90, lead: -6, yl: 99, down: 1, dist: 1, to: [2, 2], running: false, home: 0, ...o,
});
const res = (o: Partial<PlayResult>): PlayResult => ({
  kind: 'run', call: 'power', look: 'goal', carrier: 'RB', yards: 0, oob: false, td: false, safety: false, turnover: false, dur: 4, side: 1, ...o,
});
/** Your touchdown is in; the try is next. */
const atTry = (): State => {
  const s = customScenario(params(), 'two').start;
  s.score = [20, 20]; s.stage = 'pat'; s.off = 0; s.t = 75;
  return s;
};
/** Going for two: the snap from the 2 is set. */
const going = (): State => { const s = atTry(); advance(s, rng(1), { pat: 'two' }); return s; };

describe('a two-point try', () => {
  it('going for two sets up a snap from the 2, with no clock', () => {
    const s = atTry(), ev: Ev[] = [];
    advance(s, rng(1), { pat: 'two' }, ev);
    expect([s.stage, s.tryTwo, s.yl, s.dist, s.off, s.t]).toEqual(['call', true, 98, 2, 0, 75]);
    expect(ev.map((e) => e.type)).toEqual(['twotry']);
  });
  it('in the end zone is two points, then the kickoff; a stop is nothing; the clock never moves', () => {
    const s = going();
    applySnap(s, res({ td: true, yards: 2, dur: 6 }));
    expect([s.score[0], s.stage, s.kicker, s.tryTwo, s.t]).toEqual([22, 'kick', 0, undefined, 75]);
    const f = going();
    applySnap(f, res({ yards: 1, dur: 6 }));
    expect([f.score[0], f.score[1], f.stage, f.t]).toEqual([20, 20, 'kick', 75]);
  });
  it('a turnover returned all the way is two for the defense', () => {
    const s = going();
    applySnap(s, res({ kind: 'pass', turnover: true, intercepted: true, defTd: true, yards: 0 }));
    expect([s.score[0], s.score[1], s.stage, s.kicker]).toEqual([20, 22, 'kick', 0]);
  });
  it('a defensive penalty replays it half the distance closer; a hold, ten yards back', () => {
    const s = going();
    applySnap(s, res({ penalty: 'dpi', yards: 1 }));
    expect([s.stage, s.tryTwo, s.yl]).toEqual(['call', true, 99]);
    const h = going();
    applySnap(h, res({ penalty: 'hold', yards: -10 }));
    expect([h.stage, h.tryTwo, h.yl]).toEqual(['call', true, 88]);
  });
  it('the player calls it: plays from the 2 only (no field goal, punt or kneel); the verdict comes as the try', () => {
    const sc = customScenario(params(), 'two-session');
    sc.start.score = [20, 26]; sc.start.stage = 'pat'; sc.start.off = 0;
    const ses = new Session(sc);
    const pat = ses.decision()!;
    expect(pat.step).toBe('pat');
    ses.choose(pat.options.find((o) => o.key === 'two')!);
    const d = ses.decision()!;
    expect(d.step).toBe('play');
    expect(d.title).toMatch(/Two-point try/);
    expect(d.options.map((o) => o.key)).not.toContain('fg');
    expect(d.options.map((o) => o.key)).not.toContain('kneel');
    expect(d.options.map((o) => o.key)).not.toContain('punt');
    const ev = ses.choose(d.options[0]);
    const snap = ev.find((e) => e.type === 'snap');
    expect(snap && snap.type === 'snap' && snap.try).toBe(true);
    expect(ev.some((e) => e.type === 'pat' && e.two && e.played)).toBe(true);
    expect(ses.s.stage === 'kick' || ses.s.stage === 'over').toBe(true);
  });
  it('an older game (no played try) still settles it with the weighted coin', () => {
    const s = atTry();
    delete s.twoPlay;
    const ev: Ev[] = [];
    advance(s, rng(1), { pat: 'two' }, ev);
    expect(s.stage).toBe('kick');
    expect(ev.map((e) => e.type)).toEqual(['pat']);
  });
});
