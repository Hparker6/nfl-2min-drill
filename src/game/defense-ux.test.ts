/**
 * The defense's explanations must tell the truth about the simulator: the scouting hint reads the AI offense's real
 * play mix (never the play it already picked), the after-snap verdict matches how the call fares against the play,
 * and no defensive call is the answer everywhere.
 */
import { describe, expect, it } from 'vitest';
import { CALL, LOOK_USE, LOOKS } from '../engine/data';
import { DEF_CALLS, DEF_PLAYS, goalLineSituation } from '../engine/defense';
import { aiOffWeights, resolveSnap, ytg } from '../engine/sim';
import { customScenario, type SpotParams } from '../engine/scenario';
import { hash, rng } from '../engine/rng';
import type { Ev, Look, PlayResult, State } from '../engine/types';
import { defenseVerdict, scouting, tendency } from './describe';
import { chipInk } from '../ui/Scoreboard';

/** Their ball (you are on defense), from the defense's spot-builder. */
const theirBall = (o: Partial<SpotParams> = {}): State => ({
  ...customScenario({ you: 'KC', them: 'BUF', side: 'def', t: 200, lead: 3, yl: 40, down: 1, dist: 10, to: [2, 2], running: false, home: 0, ...o }, 'def-ux').start,
  stage: 'call',
});
const snapEv = (pre: State, play: string, look: Look, res: Partial<PlayResult> = {}): Ev => ({
  type: 'snap', off: 1, yl0: pre.yl, down0: pre.down, dist0: pre.dist, t0: pre.t, t: pre.t - 6, first: false,
  res: { kind: CALL[play].kind === 'run' ? 'run' : 'pass', call: play, look, carrier: 'RB', yards: 4, oob: false, td: false, safety: false, turnover: false, dur: 5, side: 1, ...res },
});
const legal = (s: State) => DEF_CALLS.filter((k) => !DEF_PLAYS[k].goalOnly || goalLineSituation(s) || ytg(s) <= 10) as Look[];
function value(s: State, play: string, look: Look, n = 160) {
  let v = 0;
  for (let i = 0; i < n; i++) {
    const res = resolveSnap(s, play, look, rng(hash('ux', i)));
    v += res.td ? 7 : res.turnover ? -5 : res.yards >= s.dist ? 1.5 + res.yards * 0.1 : res.yards * 0.12 - (res.kind === 'sack' ? 0.5 : 0);
  }
  return v / n;
}
/** The offense's expected value against a call, over the AI's own play mix from this spot. */
function vsMix(s: State, look: Look) {
  const w = aiOffWeights(s);
  const tot = Object.values(w).reduce((a, b) => a + b, 0);
  return Object.entries(w).reduce((a, [p, x]) => a + (x / tot) * value(s, p, look), 0);
}

describe('scouting hint', () => {
  it('is the AI offense\'s own mix: shares add up to one and follow its weights', () => {
    const late = theirBall({ lead: -4, t: 90 });       // they lead late: runs
    const hurry = theirBall({ lead: 4, t: 90, to: [2, 0] });   // they trail late, no timeouts: sideline throws
    const a = scouting(late), b = scouting(hurry);
    for (const x of [a, b]) expect(x.run + x.short + x.deep).toBeCloseTo(1, 6);
    expect(a.run).toBeGreaterThan(0.6);
    expect(b.run).toBeLessThan(0.15);
    expect(b.note).toMatch(/sideline/);
  });
  it('never depends on the play the AI already picked for this snap', () => {
    const s = theirBall();
    const t1 = tendency({ ...s, pendPlay: 'inside_zone' }), t2 = tendency({ ...s, pendPlay: 'go' }), t3 = tendency({ ...s, pendPlay: null });
    expect(t1).toBe(t2);
    expect(t1).toBe(t3);
  });
  it('makes no claim the AI does not act on (it does not throw more on 3rd and long)', () => {
    expect(tendency(theirBall({ down: 3, dist: 10, lead: 0, t: 400 }))).not.toMatch(/past the sticks/);
  });
  it('flags short yardage and a Hail Mary', () => {
    expect(scouting(theirBall({ dist: 1, yl: 60, lead: 0, t: 400 })).note).toMatch(/Short yardage/);
    // trailing in a hurry the AI still throws on short yardage, and the hint doesn't pretend otherwise
    expect(scouting(theirBall({ dist: 1, yl: 60, lead: 3, t: 200 })).note).not.toMatch(/Short yardage/);
    expect(scouting(theirBall({ lead: 4, t: 5, yl: 45, running: false })).note).toMatch(/Hail Mary/);
  });
});

describe('after-snap verdict', () => {
  const s = theirBall({ lead: 0, t: 400 });
  const fit = (play: string, look: Look) => defenseVerdict(s, snapEv(s, play, look))!.fit;
  it('matches the trade-offs the engine is built on', () => {
    expect(fit('slants', 'blitz')).toBe('bad');        // quick throws beat the blitz
    expect(fit('deep_post', 'blitz')).toBe('good');    // a long drop meets the rush
    expect(fit('inside_zone', 'load')).toBe('good');   // eight in the box
    expect(fit('go', 'prevent')).toBe('good');         // nothing over the top
    expect(fit('inside_zone', 'prevent')).toBe('bad'); // light box: runs go
  });
  it('calls the base defense even, and says so plainly', () => {
    const v = defenseVerdict(s, snapEv(s, 'slants', 'balanced'))!;
    expect(v.fit).toBe('even');
    expect(v.text).toMatch(/Cover 3/);
  });
  it('separates the call from the result: a good fit that gave up yards says so', () => {
    const v = defenseVerdict(s, snapEv(s, 'deep_post', 'blitz', { yards: 25, complete: true }))!;
    expect(v.fit).toBe('good');
    expect(v.text).toMatch(/made the play anyway/);
    const w = defenseVerdict(s, snapEv(s, 'slants', 'blitz', { yards: 0, complete: false }))!;
    expect(w.text).toMatch(/got away with it/);
  });
  it('only speaks to your defensive snaps, not your offense or kicks', () => {
    expect(defenseVerdict(s, { ...snapEv(s, 'slants', 'blitz'), off: 0 } as Ev)).toBeNull();
    expect(defenseVerdict(s, { type: 'timeout', team: 0, t: 100, left: 1 })).toBeNull();
  });
});

describe('defensive calls matter, and none is the answer everywhere', () => {
  const spots: [string, State][] = [
    ['they trail late, throwing', theirBall({ lead: 4, t: 90, to: [2, 1] })],
    ['they lead late, running', theirBall({ lead: -4, t: 200 })],
    ['short yardage', theirBall({ lead: 0, t: 400, down: 3, dist: 1, yl: 55 })],
  ];
  const best = spots.map(([name, s]) => {
    const vals = legal(s).map((k) => [k, vsMix(s, k)] as const).sort((a, b) => a[1] - b[1]);
    return { name, s, vals };
  });
  it('the call changes the offense\'s expected result by a real margin in every spot', () => {
    for (const b of best) expect(b.vals[b.vals.length - 1][1] - b.vals[0][1], b.name).toBeGreaterThan(0.25);
  });
  it('the best call against the AI\'s own mix is not the same in every spot', () => {
    expect(new Set(best.map((b) => b.vals[0][0])).size).toBeGreaterThan(1);
  });
  it('every call has a stated use, and its stops and risks are filled in', () => {
    for (const k of DEF_CALLS) {
      expect(LOOK_USE[k], k).toBeTruthy();
      expect(LOOKS[k].stops, k).toBeTruthy();
      expect(LOOKS[k].risk, k).toBeTruthy();
    }
  });
});

describe('scoreboard chip text', () => {
  it('keeps a team\'s second color when it reads, and falls back to white or black when it doesn\'t', () => {
    expect(chipInk('#101820', '#FFB612')).toBe('#FFB612');   // gold on near-black reads
    expect(chipInk('#00338D', '#C60C30')).toBe('#ffffff');   // red on blue does not
    expect(chipInk('#FFB612', '#FFFFFF')).toBe('#0a0e0c');   // white on gold does not
  });
});
