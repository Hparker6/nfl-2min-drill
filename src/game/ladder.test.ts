/**
 * The Gridiron Challenge ladder: every spot legal, fictional, in doubt and as hard as its place says; the stars follow
 * their rules; progress only goes up.
 */
import { describe, expect, it } from 'vitest';
import {
  LADDER, MAX_STARS, STAR_MARKS, recordAttempt, rungScenario, starsFor, starsOf, totalStars, unlocked, type LadderProgress,
} from './ladder';
import { decisionQuality, DECISION_SCALE } from './rating';
import { checkSpot, FAIR_WP } from '../engine/scenario';
import { hasRealTeam } from '../engine/nfl';
import { FRANCHISES } from '../engine/data';
import { evaluate } from '../engine/evaluate';
import { hash } from '../engine/rng';

/** Points of win chance given up that leave Decisions at exactly `d`. */
const lostFor = (d: number) => -DECISION_SCALE * Math.log(d / 100);

describe('the spots', () => {
  it('eight rungs, two per tier, in order, with unique ids', () => {
    expect(LADDER.length).toBe(8);
    expect(MAX_STARS).toBe(24);
    expect(new Set(LADDER.map((r) => r.id)).size).toBe(8);
    expect(LADDER.map((r) => r.tier)).toEqual(['Rookie', 'Rookie', 'Starter', 'Starter', 'Pro', 'Pro', 'Legend', 'Legend']);
  });

  it('only the game’s own fictional teams: no real team anywhere', () => {
    for (const r of LADDER) {
      for (const id of [r.you, r.them]) {
        expect(hasRealTeam(id)).toBe(false);
        expect(FRANCHISES.some((f) => f[0] === id)).toBe(true);
      }
      const sc = rungScenario(r, 1);
      expect(sc.teams.every((t) => Object.values(t.players).every((p) => p.source === 'generated'))).toBe(true);
    }
  });

  it('every spot is a legal game state with the score, clock and ball it says', () => {
    for (const r of LADDER) {
      const s = rungScenario(r, 1).start;
      expect(checkSpot(s), r.id).toEqual([]);
      expect(s.score).toEqual(r.score);
      expect(s.t).toBe(r.t);
      expect(s.off).toBe(r.side === 'off' ? 0 : 1);
      expect(s.weather).toBe(r.weather ?? 'clear');
      expect(s.otPlay && s.twoPlay && s.toss).toBe(true);
    }
  });

  it('the spot is the same every attempt; the bounces are not', () => {
    for (const r of LADDER) {
      const a = rungScenario(r, 1), b = rungScenario(r, 2);
      expect(b.start).toEqual(a.start);
      expect(b.teams).toEqual(a.teams);
      expect(b.seed).not.toBe(a.seed);
      expect(rungScenario(r, 1).seed).toBe(a.seed);
    }
  });

  it('every spot is in doubt, and its measured start matches what it claims', () => {
    for (const r of LADDER) {
      expect(r.wp).toBeGreaterThanOrEqual(FAIR_WP[0]);
      expect(r.wp).toBeLessThanOrEqual(FAIR_WP[1]);
      const sc = rungScenario(r, 0);
      const [st] = evaluate(sc.start, [{}], 1500, hash('ladder-test', r.id));
      expect(Math.abs(st.wp / st.n - r.wp), `${r.id}: measured ${(st.wp / st.n).toFixed(3)}, claims ${r.wp}`).toBeLessThan(0.06);
    }
  });

  it('harder as you climb: each tier starts no easier than the one below it', () => {
    const tierWp = ['Rookie', 'Starter', 'Pro', 'Legend'].map((t) => Math.max(...LADDER.filter((r) => r.tier === t).map((r) => r.wp)));
    for (let i = 1; i < tierWp.length; i++) expect(tierWp[i]).toBeLessThanOrEqual(tierWp[i - 1]);
    expect(LADDER[LADDER.length - 1].wp).toBeLessThan(LADDER[0].wp / 3);
  });
});

describe('stars', () => {
  it('a loss earns none, however good the calls', () => {
    expect(starsFor(false, 0)).toBe(0);
  });
  it('a win earns one; Decisions 75+ two; 90+ three', () => {
    expect(starsFor(true, 0)).toBe(3);
    expect(starsFor(true, lostFor(90) - 0.01)).toBe(3);
    expect(starsFor(true, lostFor(89.4))).toBe(2);
    expect(starsFor(true, lostFor(STAR_MARKS[0]) - 0.01)).toBe(2);
    expect(starsFor(true, lostFor(74.4))).toBe(1);
    expect(starsFor(true, 200)).toBe(1);
  });
  it('the marks are the Decisions number the review shows (rounded the same way)', () => {
    for (let lost = 0; lost < 30; lost += 0.25) {
      const d = Math.round(decisionQuality(lost));
      expect(starsFor(true, lost)).toBe(d >= 90 ? 3 : d >= 75 ? 2 : 1);
    }
  });
});

describe('progress', () => {
  it('only rung 1 is open at the start; a star opens the next', () => {
    const p: LadderProgress = {};
    expect(LADDER.map((_, i) => unlocked(p, i))).toEqual([true, false, false, false, false, false, false, false]);
    recordAttempt(p, 'bleed', false, 0, '2026-10-20');
    expect(unlocked(p, 1)).toBe(false);
    recordAttempt(p, 'bleed', true, 30, '2026-10-20');
    expect(unlocked(p, 1)).toBe(true);
    expect(unlocked(p, 2)).toBe(false);
  });

  it('keeps the best: a worse attempt never lowers the stars', () => {
    const p: LadderProgress = {};
    expect(recordAttempt(p, 'range', true, 0, 'd1')).toEqual({ stars: 3, prev: 0, better: true });
    expect(recordAttempt(p, 'range', true, 40, 'd2')).toEqual({ stars: 1, prev: 3, better: false });
    expect(recordAttempt(p, 'range', false, 0, 'd3')).toEqual({ stars: 0, prev: 3, better: false });
    expect(p.range).toMatchObject({ stars: 3, best: 100, tries: 3, wins: 2, last: 'd3' });
    expect(starsOf(p, 'range')).toBe(3);
    expect(totalStars(p)).toBe(3);
    expect(totalStars(undefined)).toBe(0);
  });
});
