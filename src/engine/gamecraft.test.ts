/**
 * The game within the game: their coordinator's tendency, his adjustment to a call you keep running, momentum and
 * what it does to your read, the road crowd, the clutch snap, and the scouting notes that tell you about all of it.
 */
import { describe, expect, it } from 'vitest';
import { advance, aiDefLook, clone, counterOf } from './sim';
import { customScenario, type SpotParams } from './scenario';
import { famOf } from './defense';
import { rng } from './rng';
import { Session, isClutch, readChance } from '../game/session';
import { scoutNotes } from '../game/scout';
import type { Ev, LookFam, State } from './types';

const params = (o: Partial<SpotParams> = {}): SpotParams => ({
  you: 'AUS', them: 'PDX', side: 'off', t: 150, lead: -3, yl: 40, down: 1, dist: 10, to: [2, 2], running: false, home: 0, ...o,
});
const spot = (o: Partial<SpotParams> = {}) => customScenario(params(o), 'craft').start;
const share = (s: State, fam: LookFam, n = 4000) => { let k = 0; const r = rng(7); for (let i = 0; i < n; i++) if (famOf(aiDefLook(s, r)) === fam) k++; return k / n; };

describe('their coordinator', () => {
  it('leans on his family in his spot, and only there', () => {
    const s = spot({ down: 3, dist: 8 });
    s.dc = { style: 'blitz', k: 2 };
    const plain = clone(s); delete plain.dc;
    expect(share(s, 'blitz')).toBeGreaterThan(share(plain, 'blitz') * 1.4);
    // first and ten is not his spot: no lean
    const early = spot({ down: 1, dist: 10 }); early.dc = { style: 'blitz', k: 2 };
    const earlyPlain = clone(early); delete earlyPlain.dc;
    expect(Math.abs(share(early, 'blitz') - share(earlyPlain, 'blitz'))).toBeLessThan(0.03);
  });
  it('adjusts after three of the same call in a row, says so once, and counters it', () => {
    const s = spot();
    expect(s.dc).toBeTruthy();
    const ev: Ev[] = [];
    for (let i = 0; i < 3; i++) {
      s.stage = 'call'; s.running = false; s.off = 0; s.down = 1; s.dist = 10; s.yl = 40;
      advance(s, rng(100 + i), { play: 'inside_zone', look: 'balanced' }, ev);
    }
    expect(s.rep).toEqual({ call: 'inside_zone', n: 3 });
    expect(ev.filter((e) => e.type === 'adjust')).toHaveLength(1);
    expect(counterOf('inside_zone')).toBe('load');
    const fresh = clone(s); fresh.rep = undefined;
    Object.assign(s, { stage: 'call', down: 1, dist: 10, yl: 40, off: 0 });
    Object.assign(fresh, { stage: 'call', down: 1, dist: 10, yl: 40, off: 0 });
    expect(share(s, 'load')).toBeGreaterThan(share(fresh, 'load') * 1.5);
  });
  it('a different call resets the count', () => {
    const s = spot();
    for (const play of ['inside_zone', 'inside_zone', 'slants']) {
      Object.assign(s, { stage: 'call', running: false, off: 0, down: 1, dist: 10, yl: 40 });
      advance(s, rng(5), { play, look: 'balanced' });
    }
    expect(s.rep).toEqual({ call: 'slants', n: 1 });
  });
});

describe('momentum', () => {
  it('starts even, rises with your big plays, falls with theirs, fades, and stays within ±3', () => {
    const s = spot();
    expect(s.mo).toBe(0);
    let seen = false;
    for (let i = 0; i < 400 && !seen; i++) {
      const c = clone(s);
      Object.assign(c, { stage: 'call', off: 0, yl: 92, down: 1, dist: 8 });
      const ev: Ev[] = [];
      advance(c, rng(i), { play: 'power', look: 'balanced' }, ev);
      const snap = ev.find((e) => e.type === 'snap');
      if (snap && snap.type === 'snap' && snap.res.td) { expect(c.mo).toBe(2); seen = true; }
    }
    expect(seen).toBe(true);
    for (let i = 0; i < 300; i++) {
      const c = clone(s); c.mo = 2.9;
      Object.assign(c, { stage: 'call', off: 0, yl: 92, down: 1, dist: 8 });
      advance(c, rng(i), { play: 'power', look: 'balanced' });
      expect(Math.abs(c.mo!)).toBeLessThanOrEqual(3);
    }
  });
  it('sharpens your read when it is yours, and a road crowd on third down clouds it', () => {
    const sc = customScenario(params({ down: 3, dist: 6 }), 'craft-read');
    const s = clone(sc.start);
    expect(readChance(sc, s).p).toBeCloseTo(0.7);
    s.mo = 2;
    expect(readChance(sc, s).p).toBeCloseTo(0.76);
    const road = { ...sc, home: 1 as const };
    expect(readChance(road, s)).toEqual({ p: expect.closeTo(0.68), crowd: true });
    s.down = 1;
    expect(readChance(road, s).crowd).toBe(false);
    const old = clone(s); delete old.mo;
    expect(readChance(road, old)).toEqual({ p: 0.7, crowd: false });   // older games are untouched
  });
});

describe('the game on the line', () => {
  it('is the last two minutes of a one-score game on third or fourth down, the final 40 seconds, or overtime', () => {
    expect(isClutch({ ...spot({ t: 90, down: 3, dist: 5 }), stage: 'call' })).toBe(true);
    expect(isClutch({ ...spot({ t: 90, down: 1 }), stage: 'call' })).toBe(false);
    expect(isClutch({ ...spot({ t: 30, down: 1 }), stage: 'call' })).toBe(true);
    expect(isClutch({ ...spot({ t: 90, down: 4, lead: -14 }), stage: 'call' })).toBe(false);
    expect(isClutch({ ...spot({ t: 200, down: 3 }), stage: 'call' })).toBe(false);
    expect(isClutch({ ...spot({ t: 400, down: 1 }), stage: 'call', q: 5 })).toBe(true);
  });
  it('a call made then is marked on the record', () => {
    const sc = customScenario(params({ t: 30, down: 3, dist: 4 }), 'craft-clutch');
    const ses = new Session(sc);
    let d = ses.decision();
    for (let g = 0; g < 8 && d?.step !== 'play'; g++) { if (d) ses.choose(d.options[0]); else ses.auto(); d = ses.decision(); }
    ses.choose(d!.options[0]);
    expect(ses.records[ses.records.length - 1].clutch).toBe(true);
  });
});

describe('scouting notes', () => {
  const snap = (down0: number, dist0: number, look: string): Ev => ({ type: 'snap', off: 0, yl0: 40, down0, dist0, t0: 100, t: 95, first: false, res: { kind: 'pass', call: 'slants', look: look as never, carrier: 'WR1', yards: 3, oob: false, td: false, safety: false, turnover: false, dur: 5, side: 1 } });
  it('reports what they have done in this kind of spot, once there are two to go on', () => {
    const s = { ...spot({ down: 3, dist: 8 }), stage: 'call' as const };
    s.dc = { style: 'zone', k: 2 };
    expect(scoutNotes(s, [snap(3, 9, 'blitz')]).some((n) => n.kind === 'record')).toBe(false);
    const notes = scoutNotes(s, [snap(3, 9, 'blitz'), snap(3, 6, 'firezone'), snap(1, 10, 'zone')]);
    expect(notes.find((n) => n.kind === 'record')?.text).toBe("On third and fourth down they've blitzed 2 of 2 times.");
  });
  it('shows the scouting report in his spot, and warns when he has adjusted', () => {
    const s = { ...spot({ down: 3, dist: 8 }), stage: 'call' as const };
    s.dc = { style: 'blitz', k: 2 };
    s.rep = { call: 'slants', n: 3 };
    const kinds = scoutNotes(s, []).map((n) => n.kind);
    expect(kinds).toContain('report');
    expect(kinds).toContain('adjust');
    expect(scoutNotes({ ...s, down: 1, dist: 10, rep: undefined }, [])).toEqual([]);
  });
});
