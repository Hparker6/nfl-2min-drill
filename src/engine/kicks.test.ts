import { describe, expect, it } from 'vitest';
import { fieldGoalTimeline, kickoffTimeline, patTimeline } from './kicks';
import { realTeam } from './nfl';
import type { Ev } from './types';

const A = realTeam('ATL').rat, B = realTeam('CHI').rat;
const kinds = (tl: { events: { kind: string }[] }) => tl.events.map((e) => e.kind);
const ordered = (tl: { events: { t: number }[] }) => tl.events.every((e, i) => !i || e.t >= tl.events[i - 1].t - 1e-9);

describe('field goals and tries', () => {
  it('a good kick: snap, hold, kick, then through the uprights', () => {
    for (let yt = 5; yt <= 45; yt += 10) {
      const tl = fieldGoalTimeline({ good: true, blocked: false, yt, off: A, def: B, seed: yt });
      expect(kinds(tl)).toEqual(['snap', 'kick', 'good']);
      expect(ordered(tl)).toBe(true);
      const last = tl.ball[tl.ball.length - 1];
      expect(last.dy).toBeGreaterThan(yt + 9);          // past the goal line, at the posts
      expect(Math.abs(last.x - 53.33 / 2)).toBeLessThan(2);
      expect(tl.decisive).toBeLessThanOrEqual(tl.end);
      // the kicker is the one who meets the ball; the holder stays put
      const kickEv = tl.events.find((e) => e.kind === 'kick')!;
      expect(kickEv.who).toBe('o:RB');
    }
  });
  it('a miss sails wide; a block never gets past the line', () => {
    const miss = fieldGoalTimeline({ good: false, blocked: false, yt: 30, off: A, def: B, seed: 1 });
    expect(kinds(miss)).toEqual(['snap', 'kick', 'nogood']);
    expect(Math.abs(miss.ball[miss.ball.length - 1].x - 53.33 / 2)).toBeGreaterThan(3);
    const blk = fieldGoalTimeline({ good: false, blocked: true, yt: 30, off: A, def: B, seed: 2 });
    expect(kinds(blk)).toEqual(['snap', 'kick', 'blocked']);
    expect(Math.max(...blk.ball.map((b) => b.dy))).toBeLessThan(1);
    // the blocker got into the backfield before the kick
    const bk = Object.entries(blk.tracks).find(([k, tr]) => k.startsWith('d:') && tr.some(([t, , dy]) => t <= 1.3 && dy < -4));
    expect(bk).toBeTruthy();
  });
  it('tries: an extra point is a kick from the 15; a two-point try is a snap from the 2 with a good/no-good story', () => {
    const xp = patTimeline({ type: 'pat', off: 0, two: false, good: true, t: 100 }, A, B, 5);
    expect(xp.yl0).toBe(85);
    expect(kinds(xp.tl)).toContain('good');
    for (const good of [true, false]) {
      const two = patTimeline({ type: 'pat', off: 0, two: true, good, t: 100 }, A, B, 7);
      expect(two.yl0).toBe(98);
      const k = kinds(two.tl);
      expect(k).toContain(good ? 'good' : 'nogood');
      expect(k).not.toContain('tackle');
      expect(k).not.toContain('td');
    }
  });
});

describe('kickoffs', () => {
  const ev = (o: Partial<Extract<Ev, { type: 'kick' }>>): Extract<Ev, { type: 'kick' }> => ({ type: 'kick', kind: 'kickoff', kicker: 0, recover: 1, touchback: false, td: false, yl: 28, t: 90, ...o });
  it('a return ends on the engine spot, with the returner carrying and one coverage man making the stop', () => {
    for (const yl of [15, 28, 45]) {
      const { tl, res } = kickoffTimeline(ev({ yl }), A, B, yl);
      expect(kinds(tl)).toEqual(['snap', 'kick', 'catch', 'return']);
      const last = tl.ball[tl.ball.length - 1];
      expect(Math.abs(last.dy - (65 - yl))).toBeLessThan(0.6);    // the receiving team's yard line, in the kicker's frame
      expect(tl.carrier[tl.carrier.length - 1].key).toBe('d:S1');
      expect(res.retYds).toBeGreaterThan(0);
      // the coverage reaches the spot; the return team's blockers stay in front of the runner
      const closers = Object.entries(tl.tracks).filter(([k, tr]) => k.startsWith('o:') && Math.hypot(tr[tr.length - 1][1] - last.x, tr[tr.length - 1][2] - last.dy) < 2.5);
      expect(closers.length).toBeGreaterThanOrEqual(1);
      expect(closers.length).toBeLessThanOrEqual(3);
    }
  });
  it('a touchback is caught in the end zone and kneeled; a free kick starts from the 20', () => {
    const tb = kickoffTimeline(ev({ touchback: true, yl: 35 }), A, B, 3);
    expect(kinds(tb.tl)).toEqual(['snap', 'kick', 'catch', 'touchback']);
    expect(tb.tl.ball[tb.tl.ball.length - 1].dy).toBeGreaterThan(65);
    const fk = kickoffTimeline(ev({ kind: 'free', yl: 40 }), A, B, 4);
    expect(fk.yl0).toBe(20);
    expect(Math.abs(fk.tl.ball[fk.tl.ball.length - 1].dy - (80 - 40))).toBeLessThan(0.6);
  });
  it('an onside kick travels about ten yards and ends with the recovering side on the ball', () => {
    for (const recover of [0, 1] as const) {
      const { tl } = kickoffTimeline(ev({ kind: 'onside', recover, yl: recover === 0 ? 47 : 53 }), A, B, 9);
      expect(kinds(tl)).toEqual(['snap', 'kick', 'recover']);
      const last = tl.ball[tl.ball.length - 1];
      expect(last.dy).toBeGreaterThan(9);
      expect(last.dy).toBeLessThan(14);
      expect(tl.carrier[tl.carrier.length - 1].key.startsWith(recover === 0 ? 'o:' : 'd:')).toBe(true);
    }
  });
  it('a return touchdown goes the distance', () => {
    const { tl } = kickoffTimeline(ev({ td: true, yl: 100 }), A, B, 11);
    expect(kinds(tl)).toEqual(['snap', 'kick', 'catch', 'td']);
    expect(tl.ball[tl.ball.length - 1].dy).toBeLessThan(-34);
  });
});
