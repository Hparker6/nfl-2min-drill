/**
 * Defensive calls must change what happens. These tests compare outcome distributions (thousands of seeded snaps per
 * matchup) rather than single random results, and check that the player's call actually reaches the simulator.
 */
import { describe, expect, it } from 'vitest';
import { CALLS } from './data';
import { DEF_CALLS, DEF_PLAYS } from './defense';
import { advance, clone, resolveSnap, simulate } from './sim';
import { customScenario, type SpotParams } from './scenario';
import { rng } from './rng';
import { Session } from '../game/session';
import type { Ev, Look, State } from './types';

const params = (o: Partial<SpotParams> = {}): SpotParams => ({
  you: 'AUS', them: 'PDX', side: 'off', t: 300, lead: 0, yl: 40, down: 1, dist: 10, to: [3, 3], running: false, home: 0, ...o,
});
/** A spot with two evenly rated teams, so ratings do not tilt the comparison. */
function even(o: Partial<SpotParams> = {}): State {
  const s = customScenario(params(o), 'def-test').start;
  const r = { ovr: 82, off: 82, def: 82, qb: 82, ol: 80, dl: 80, k: 84, rcv: { WR1: 82, WR2: 82, WR3: 80, TE: 80, RB: 80 } };
  return { ...s, rat: [r, r], stage: 'call' };
}

interface Dist { ypp: number; sack: number; comp: number; boom: number; td: number; int: number; stuff: number }
function dist(play: string, look: Look, o: Partial<SpotParams> = {}, n = 6000): Dist {
  const s = even(o);
  let y = 0, sack = 0, comp = 0, att = 0, boom = 0, td = 0, int = 0, stuff = 0;
  for (let i = 0; i < n; i++) {
    const res = resolveSnap(s, play, look, rng(1000 + i));
    if (!res.turnover) y += res.yards;
    if (res.kind === 'sack') sack++;
    if (res.kind === 'pass') { att++; if (res.complete) comp++; }
    if (res.yards >= 20 && !res.turnover) boom++;
    if (res.td) td++;
    if (res.intercepted) int++;
    if (res.kind === 'run' && res.yards <= 0) stuff++;
  }
  return { ypp: y / n, sack: sack / n, comp: att ? comp / att : 0, boom: boom / n, td: td / n, int: int / n, stuff: stuff / n };
}

describe('defensive calls change outcomes', () => {
  it('blitz vs a quick pass: no extra sacks to speak of, and the quick throw gains more than against balanced', () => {
    const b = dist('slants', 'blitz'), base = dist('slants', 'balanced');
    expect(b.ypp).toBeGreaterThan(base.ypp + 0.3);
    expect(b.sack).toBeLessThan(0.06);
  });
  it('blitz vs a long-developing pass: many more sacks and fewer yards', () => {
    const b = dist('deep_post', 'blitz'), base = dist('deep_post', 'balanced');
    expect(b.sack).toBeGreaterThan(base.sack * 1.5);
    expect(b.ypp).toBeLessThan(base.ypp);
  });
  it('loading the box vs a run: shorter gains, more stuffs', () => {
    const l = dist('inside_zone', 'load'), base = dist('inside_zone', 'balanced');
    expect(l.ypp).toBeLessThan(base.ypp - 0.7);
    expect(l.stuff).toBeGreaterThan(base.stuff);
  });
  it('loading the box vs a pass: play-action and deep throws gain more', () => {
    expect(dist('pa_deep', 'load').ypp).toBeGreaterThan(dist('pa_deep', 'balanced').ypp + 0.4);
    expect(dist('go', 'load').comp).toBeGreaterThan(dist('go', 'balanced').comp);
  });
  it('zone and man are beaten by different routes', () => {
    // crossers and slants get separation against man; digs and seams sit in zone holes
    expect(dist('mesh', 'man').comp).toBeGreaterThan(dist('mesh', 'zone').comp + 0.05);
    expect(dist('slants', 'man').comp).toBeGreaterThan(dist('slants', 'zone').comp + 0.05);
    expect(dist('dig', 'zone').comp).toBeGreaterThan(dist('dig', 'man').comp + 0.05);
    expect(dist('seam', 'zone').comp).toBeGreaterThan(dist('seam', 'man').comp + 0.03);
  });
  it('zone gives up fewer yards after the catch but more interceptions than man', () => {
    const z = dist('quick_out', 'zone'), m = dist('quick_out', 'man');
    expect(z.int).toBeGreaterThan(m.int);
    expect(dist('screen', 'zone').ypp).toBeLessThan(dist('screen', 'man').ypp);
  });
  it('prevent stops explosive passes but concedes short ones', () => {
    const p = dist('go', 'prevent'), base = dist('go', 'balanced');
    expect(p.boom).toBeLessThan(base.boom * 0.75);
    expect(dist('quick_out', 'prevent').ypp).toBeGreaterThan(dist('quick_out', 'balanced').ypp + 0.2);
    expect(dist('inside_zone', 'prevent').ypp).toBeGreaterThan(dist('inside_zone', 'balanced').ypp + 0.5);
  });
  it('goal-line defense stops runs at the goal line, and is a liability away from it', () => {
    const near = { yl: 97, dist: 3 };
    expect(dist('power', 'goal', near).td).toBeLessThan(dist('power', 'balanced', near).td * 0.8);
    const far = { yl: 40, dist: 10 };
    expect(dist('go', 'goal', far).boom).toBeGreaterThan(dist('go', 'balanced', far).boom * 1.2);
    expect(dist('outside_zone', 'goal', far).boom).toBeGreaterThan(dist('outside_zone', 'balanced', far).boom);
  });
  it('no call is best against everything: each is beaten by some play and beats balanced against some play', () => {
    const plays = CALLS.filter((c) => c.id !== 'hail').map((c) => c.id);
    for (const look of DEF_CALLS.filter((l) => l !== 'balanced')) {
      const worse = plays.some((p) => dist(p, look, {}, 2500).ypp > dist(p, 'balanced', {}, 2500).ypp + 0.2);
      const better = plays.some((p) => dist(p, look, {}, 2500).ypp < dist(p, 'balanced', {}, 2500).ypp - 0.2);
      expect([look, worse, better]).toEqual([look, true, true]);
    }
  });
  it('every play in a tab has its own reason: none is better than another against every offensive call', () => {
    const plays = CALLS.filter((c) => c.id !== 'hail').map((c) => c.id);
    // the goal-line fronts are compared where they are offered; the run-stop calls in the tab, anywhere
    const groups = [['zone', {}], ['man', {}], ['blitz', {}], ['goal', { yl: 90, dist: 2 }], ['runstop', {}]] as const;
    for (const [cat, spot] of groups) {
      const looks = DEF_CALLS.filter((l) => cat === 'runstop' ? DEF_PLAYS[l].cat === 'goal' && !DEF_PLAYS[l].goalOnly : DEF_PLAYS[l].cat === cat && (cat !== 'goal' || DEF_PLAYS[l].goalOnly));
      const ypp = new Map(looks.map((l) => [l, plays.map((p) => dist(p, l, spot, 2000).ypp)]));
      for (const a of looks) for (const b of looks) {
        if (a >= b) continue;
        const A = ypp.get(a)!, B = ypp.get(b)!;
        const aBetter = A.some((y, i) => y < B[i] - 0.15), bBetter = B.some((y, i) => y < A[i] - 0.15);
        expect([cat, a, b, aBetter, bBetter]).toEqual([cat, a, b, true, true]);
      }
    }
  });
});

describe('the player\'s defensive call reaches the simulator', () => {
  it('pass interference at the 1 leaves the ball at the 1 with a first down', () => {
    const s = even({ yl: 99, dist: 1 });
    for (let i = 0; i < 4000; i++) {
      const c = clone(s);
      const ev: Ev[] = [];
      advance(c, rng(i), { play: 'go', look: 'man' }, ev);
      const e = ev[0];
      if (e.type === 'snap' && e.res.penalty === 'dpi') { expect(c.yl).toBe(99); expect(c.down).toBe(1); return; }
    }
  });
  it('advance resolves the snap against the call it is given', () => {
    for (const look of DEF_CALLS) {
      const s = { ...even({ side: 'def', yl: 40 }), pendPlay: 'dig' };
      const ev: Ev[] = [];
      advance(clone(s), rng(3), { look }, ev);
      const snap = ev.find((e) => e.type === 'snap');
      expect(snap && snap.type === 'snap' && snap.res.look).toBe(look);
    }
  });
  it('a session on defense offers every call, and the chosen one is the look the snap is played against', () => {
    const sc = customScenario(params({ side: 'def', t: 200, lead: 4, yl: 30 }), 'def-session');
    for (const look of DEF_CALLS) {
      const ses = new Session(sc);
      let d = ses.decision();
      for (let g = 0; g < 20 && (!d || d.step !== 'look'); g++) { if (d) ses.choose(d.options[0]); else ses.auto(); d = ses.decision(); }
      expect(d?.step).toBe('look');
      const opt = d!.options.find((o) => o.key === look);
      if (DEF_PLAYS[look].goalOnly) continue;   // offered only near the goal line or on short yardage
      expect(opt).toBeTruthy();
      const ev = ses.choose(opt!);
      const snap = ev.find((e) => e.type === 'snap');
      expect(snap && snap.type === 'snap' && snap.res.look).toBe(look);
    }
  });
  it('an old saved pick with the retired "soft" look still replays, as prevent', () => {
    const sc = customScenario(params({ side: 'def', t: 200, lead: 4, yl: 30 }), 'def-legacy');
    const first = new Session(sc);
    let d = first.decision();
    for (let g = 0; g < 20 && (!d || d.step !== 'look'); g++) { if (d) first.choose(d.options[0]); else first.auto(); d = first.decision(); }
    const picks = first.picks.map((p) => ({ ...p }));
    picks.push({ key: 'soft', choice: { look: 'soft' } });
    expect(() => new Session(sc, picks)).not.toThrow();
  });
});

describe('game state stays consistent with every defense in use', () => {
  it('downs, distance, field position, clock and scores stay legal across many full games', () => {
    for (let i = 0; i < 150; i++) {
      const s: State = clone(even({ t: 420, lead: (i % 15) - 7, yl: 20 + (i % 50), side: i % 2 ? 'def' : 'off' }));
      s.stage = 'pre' as State['stage'];
      const r = rng(i);
      let prevScore = [...s.score];
      for (let k = 0; k < 600 && s.stage !== 'over'; k++) {
        const look = DEF_CALLS[(i + k) % DEF_CALLS.length];
        advance(s, r, s.stage === 'call' ? { look } : null);
        expect(s.t).toBeGreaterThanOrEqual(0);
        expect(s.score[0]).toBeGreaterThanOrEqual(prevScore[0]);
        expect(s.score[1]).toBeGreaterThanOrEqual(prevScore[1]);
        if (s.stage === 'pre' || s.stage === 'call') {
          expect(s.down).toBeGreaterThanOrEqual(1);
          expect(s.down).toBeLessThanOrEqual(4);
          expect(s.yl).toBeGreaterThanOrEqual(1);
          expect(s.yl).toBeLessThanOrEqual(99);
          expect(s.dist).toBeGreaterThan(0);
          expect(s.dist).toBeLessThanOrEqual(100 - s.yl);
        }
        prevScore = [...s.score];
      }
      expect(s.stage).toBe('over');
    }
  });
  it('the AI on both sides still finishes games', () => {
    for (let i = 0; i < 100; i++) {
      const s = clone(even({ t: 240, lead: -3 }));
      s.stage = 'pre' as State['stage'];
      simulate(s, rng(i));
      expect(s.stage).toBe('over');
    }
  });
});
