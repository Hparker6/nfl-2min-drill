import { describe, expect, it } from 'vitest';
import PCT from '../data/percentiles.json';
import { RIVALS_PER_DAY, rivalsFor, versusRivals } from './rivals';

const days = Array.from({ length: 60 }, (_, i) => new Date(Date.parse('2026-10-18T00:00:00Z') + i * 864e5).toISOString().slice(0, 10));

describe('AI rivals', () => {
  it('the same date gives everyone the same rivals and scores', () => {
    expect(rivalsFor('2026-10-20')).toEqual(rivalsFor('2026-10-20'));
  });
  it('a full board every day, best first, with a top rival to chase', () => {
    for (const d of days) {
      const r = rivalsFor(d);
      expect(r).toHaveLength(RIVALS_PER_DAY);
      expect(new Set(r.map((x) => x.id)).size).toBe(RIVALS_PER_DAY);
      for (let i = 1; i < r.length; i++) expect(r[i - 1].score).toBeGreaterThanOrEqual(r[i].score);
      expect(r[0].score, d).toBeGreaterThanOrEqual(75);
    }
  });
  it('every score is one the simulated play-callers actually posted', () => {
    const real = new Set((PCT as { scores: number[] }).scores);
    for (const d of days) for (const x of rivalsFor(d)) expect(real.has(x.score)).toBe(true);
  });
  it('the board changes from day to day', () => {
    const casts = new Set(days.map((d) => rivalsFor(d).map((x) => x.id).sort().join()));
    expect(casts.size).toBeGreaterThan(20);
  });
  it('counts how many rivals a score beat (ties don\'t count)', () => {
    const r = [{ id: 'a', name: 'A', style: '', score: 80 }, { id: 'b', name: 'B', style: '', score: 60 }];
    expect(versusRivals(70, r)).toEqual({ beat: 1, of: 2 });
    expect(versusRivals(80, r)).toEqual({ beat: 1, of: 2 });
    expect(versusRivals(95, r)).toEqual({ beat: 2, of: 2 });
  });
});
