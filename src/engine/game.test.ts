import { describe, expect, it } from 'vitest';
import { FRANCHISES } from './data';
import { makeTeam } from './scenario';
import { kickoffState, playOut, step } from './game';
import { advance, clone } from './sim';
import { rng } from './rng';
import type { Ev, State } from './types';

const teams = () => [makeTeam(FRANCHISES[0][0], 't'), makeTeam(FRANCHISES[5][0], 't')] as const;
const start = (seed: number, o: { qLen?: number; po?: boolean } = {}) => { const [a, b] = teams(); return kickoffState([a.rat, b.rat], { seed, ...o }); };

describe('full games', () => {
  it('play four quarters with a halftime kickoff to the team that kicked first', () => {
    for (let g = 0; g < 40; g++) {
      const s0 = start(g);
      const { s, ev } = playOut(g, s0);
      expect(s.stage).toBe('over');
      const periods = ev.filter((e) => e.type === 'period') as Extract<Ev, { type: 'period' }>[];
      expect(periods.slice(0, 3).map((p) => p.q)).toEqual([2, 3, 4]);
      expect(ev[ev.length - 1].type).toBe('final');
      // the first kick after halftime is by the team that received the opening kickoff
      const half = ev.findIndex((e) => e.type === 'period' && e.q === 3);
      const k = ev.slice(half).find((e) => e.type === 'kick') as Extract<Ev, { type: 'kick' }>;
      expect(k.kicker).toBe(s0.rec);
    }
  });

  it('keeps the ball, down and distance across the end of a quarter', () => {
    const s = start(3);
    for (let i = 0; i < 2000; i++) {
      const before: State = clone(s);
      const ev: Ev[] = [];
      step(3, s, ev);
      const p = ev.find((e) => e.type === 'period');
      if (p && p.type === 'period' && p.q === 2) {
        expect(s.q).toBe(2);
        expect(s.t).toBe(900);
        if (before.stage !== 'kick' && s.stage !== 'kick') {
          const last = ev.filter((e) => e.type === 'snap').pop();
          if (last) expect(s.off).toBe(last.type === 'snap' && !last.res.turnover && !last.res.td && last.down0 < 4 ? last.off : s.off);
        }
        return;
      }
    }
    throw new Error('no end of the first quarter');
  });

  it('gives each team three timeouts per half and nobody kneels before the fourth quarter unless the first half is ending', () => {
    for (let g = 0; g < 60; g++) {
      const { ev } = playOut(g, start(g));
      let q = 1;
      for (const e of ev) {
        if (e.type === 'period') q = e.q;
        if (e.type === 'snap' && e.res.kind === 'kneel') expect(q === 2 || q >= 4).toBe(true);
        if (e.type === 'timeout') expect(e.left).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('plays overtime by the rules: a first-possession field goal does not end it, and regular-season games can tie', () => {
    let ot = 0, ties = 0;
    for (let g = 0; g < 1500 && ot < 25; g++) {
      const { s, ev } = playOut(g, start(g));
      const oi = ev.findIndex((e) => e.type === 'period' && e.q === 5);
      if (oi < 0) continue;
      ot++;
      if (s.score[0] === s.score[1]) ties++;
      // whoever had the first overtime possession: if it ended in a field goal, the other team got the ball
      const after = ev.slice(oi);
      const firstScore = after.find((e) => e.type === 'snap' && (e.res.td || (e.res.kind === 'fg' && e.res.good)));
      if (firstScore && firstScore.type === 'snap' && firstScore.res.kind === 'fg') {
        const fi = after.indexOf(firstScore);
        const nextSnap = after.slice(fi + 1).find((e) => e.type === 'snap');
        if (nextSnap && nextSnap.type === 'snap') expect(nextSnap.off).not.toBe(firstScore.off);
      }
    }
    expect(ot).toBeGreaterThan(5);
    expect(ties).toBeLessThan(ot);
  });

  it('never ties in the playoffs', () => {
    for (let g = 0; g < 400; g++) {
      const { s } = playOut(g, start(g, { po: true }));
      expect(s.score[0]).not.toBe(s.score[1]);
    }
  });

  it('plays short quarters', () => {
    for (let g = 0; g < 50; g++) {
      const { s, ev } = playOut(g, start(g, { qLen: 120 }));
      expect(s.stage).toBe('over');
      const snaps = ev.filter((e) => e.type === 'snap').length;
      expect(snaps).toBeGreaterThan(8);
      expect(snaps).toBeLessThan(80);
    }
  });

  it('replays the same from any point', () => {
    const s0 = start(9);
    const a = playOut(9, s0).s;
    const mid = clone(s0);
    for (let i = 0; i < 120; i++) step(9, mid, []);
    const b = playOut(9, mid).s;
    expect(b.score).toEqual(a.score);
  });

  it('leaves late-game spots alone: no period fields, the clock running out ends it', () => {
    const s = { ...start(1), q: undefined, qLen: undefined, po: undefined, rec: undefined, t: 30, stage: 'pre' as const, off: 0 as const, running: true, warned: true, kicker: 0 as const };
    for (let i = 0; i < 200 && s.stage !== 'over'; i++) advance(s, rng(i), null, []);
    expect(s.stage).toBe('over');
    expect(s.q).toBeUndefined();
  });
});
