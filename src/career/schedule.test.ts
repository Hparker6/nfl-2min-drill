import { describe, it, expect } from 'vitest';
import { makeSchedule } from './schedule';
import type { CTeam, Conf, Div, Game } from './types';
import { rng } from '../engine/rng';

const teams: CTeam[] = Array.from({ length: 32 }, (_, i) => ({
  id: `T${i}`, city: `City ${i}`, name: `Team ${i}`, color: '#000000', color2: '#ffffff',
  conf: Math.floor(i / 16) as Conf, div: (Math.floor(i / 4) % 4) as Div, roster: {},
}));
const byId = new Map(teams.map(t => [t.id, t]));

/** A shuffled 0-3 finish in each division. */
function makePlaces(seed: number): Record<string, number> {
  const r = rng(seed);
  const places: Record<string, number> = {};
  for (let d = 0; d < 8; d++) {
    const p = [0, 1, 2, 3];
    for (let i = 3; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
    for (let k = 0; k < 4; k++) places[`T${d * 4 + k}`] = p[k];
  }
  return places;
}

const cases: [number, number][] = [];
for (let y = 2026; y < 2038; y++) for (const s of [1, 7, 12345]) cases.push([y, s * 31 + y]);

function check(games: Game[], places: Record<string, number>) {
  expect(games).toHaveLength(272);
  expect(new Set(games.map(g => g.id)).size).toBe(272);
  const weeks = new Map<string, Set<number>>();
  const home = new Map<string, number>();
  const vs = new Map<string, Game[]>();
  for (const g of games) {
    expect(g.kind).toBe('reg');
    expect(g.week).toBeGreaterThanOrEqual(1);
    expect(g.week).toBeLessThanOrEqual(18);
    expect(g.home).not.toBe(g.away);
    expect(g.id).toBe(`${g.id.split('-')[0]}-w${g.week}-${g.away}-${g.home}`);
    for (const t of [g.home, g.away]) {
      const w = weeks.get(t) ?? new Set<number>();
      expect(w.has(g.week)).toBe(false);   // never twice in a week
      w.add(g.week);
      weeks.set(t, w);
    }
    home.set(g.home, (home.get(g.home) ?? 0) + 1);
    const key = [g.home, g.away].sort().join('|');
    vs.set(key, [...(vs.get(key) ?? []), g]);
  }
  for (const t of teams) {
    const w = weeks.get(t.id) as Set<number>;
    expect(w.size).toBe(17);
    const bye = [...Array(18)].map((_, i) => i + 1).filter(x => !w.has(x));
    expect(bye).toHaveLength(1);
    expect(bye[0]).toBeGreaterThanOrEqual(5);
    expect(bye[0]).toBeLessThanOrEqual(14);
    const h = home.get(t.id) ?? 0;
    expect(h === 8 || h === 9).toBe(true);
  }
  // Pairings: division rivals twice with homes swapped, everyone else at most once.
  for (const [key, gs] of vs) {
    const [a, b] = key.split('|').map(id => byId.get(id) as CTeam);
    if (a.conf === b.conf && a.div === b.div) {
      expect(gs).toHaveLength(2);
      expect(gs[0].home).toBe(gs[1].away);
    } else {
      expect(gs).toHaveLength(1);
    }
  }
  // The formula: per team, opponents by category, and the division pairings symmetric across the league.
  const sameConfDiv = new Map<string, number>();
  const crossDiv = new Map<string, number>();
  for (const t of teams) {
    const opps = games.filter(g => g.home === t.id || g.away === t.id)
      .map(g => byId.get(g.home === t.id ? g.away : g.home) as CTeam);
    const div = opps.filter(o => o.conf === t.conf && o.div === t.div);
    expect(div).toHaveLength(6);
    const conf = opps.filter(o => o.conf === t.conf && o.div !== t.div);
    const other = opps.filter(o => o.conf !== t.conf);
    expect(conf).toHaveLength(6);
    expect(other).toHaveLength(5);
    // Same conference: one division all four, the other two only the same-place team.
    const confBy = count(conf.map(o => o.div));
    const full = [...confBy].filter(([, n]) => n === 4).map(([d]) => d);
    expect(full).toHaveLength(1);
    expect([...confBy].filter(([, n]) => n === 1)).toHaveLength(2);
    for (const o of conf) if (o.div !== full[0]) expect(places[o.id]).toBe(places[t.id]);
    sameConfDiv.set(`${t.conf}-${t.div}`, full[0]);
    // Other conference: one division all four, plus one same-place team from another.
    const otherBy = count(other.map(o => o.div));
    const fullX = [...otherBy].filter(([, n]) => n === 4).map(([d]) => d);
    expect(fullX).toHaveLength(1);
    const lone = other.filter(o => o.div !== fullX[0]);
    expect(lone).toHaveLength(1);
    expect(places[lone[0].id]).toBe(places[t.id]);
    crossDiv.set(`${t.conf}-${t.div}`, fullX[0]);
  }
  for (const [k, d] of sameConfDiv) {
    const c = k.split('-')[0];
    expect(sameConfDiv.get(`${c}-${d}`)).toBe(Number(k.split('-')[1]));
  }
  for (const [k, d] of crossDiv) {
    const [c, me] = k.split('-').map(Number);
    expect(crossDiv.get(`${1 - c}-${d}`)).toBe(me);
  }
}

function count(xs: number[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return m;
}

describe('makeSchedule', () => {
  it('follows the formula and the calendar rules across many years and seeds', () => {
    for (const [year, seed] of cases) {
      const places = makePlaces(seed);
      check(makeSchedule(teams, places, year, seed), places);
    }
  });

  it('rotates the division pairings by year', () => {
    const places = makePlaces(1);
    const confPartners = new Set<string>();
    const crossPartners = new Set<string>();
    for (let year = 2026; year < 2038; year++) {
      const games = makeSchedule(teams, places, year, 9);
      const t0 = games.filter(g => g.home === 'T0' || g.away === 'T0').map(g => (g.home === 'T0' ? g.away : g.home));
      const divs = count(t0.map(id => byId.get(id) as CTeam).map(o => o.conf * 4 + o.div));
      for (const [d, n] of divs) if (n === 4) (d < 4 ? confPartners : crossPartners).add(`${d}`);
    }
    expect(confPartners.size).toBe(3);
    expect(crossPartners.size).toBe(4);
  });

  it('is deterministic', () => {
    const places = makePlaces(3);
    expect(makeSchedule(teams, places, 2030, 42)).toEqual(makeSchedule(teams, places, 2030, 42));
    expect(makeSchedule(teams, places, 2030, 42)).not.toEqual(makeSchedule(teams, places, 2030, 43));
  });

  it('keeps rivals apart in back-to-back weeks and loads the late weeks with division games', () => {
    let backToBack = 0, late = 0;
    for (const [year, seed] of cases) {
      const games = makeSchedule(teams, makePlaces(seed), year, seed);
      const div = games.filter(g => (byId.get(g.home) as CTeam).conf * 4 + (byId.get(g.home) as CTeam).div
        === (byId.get(g.away) as CTeam).conf * 4 + (byId.get(g.away) as CTeam).div);
      const byPair = new Map<string, number[]>();
      for (const g of div) {
        const k = [g.home, g.away].sort().join('|');
        byPair.set(k, [...(byPair.get(k) ?? []), g.week]);
      }
      for (const [a, b] of byPair.values()) if (Math.abs(a - b) === 1) backToBack++;
      late += div.filter(g => g.week >= 15).length;
    }
    expect(backToBack).toBe(0);
    // 96 division games a year; at least half land in weeks 15-18 (week 18 alone holds 16).
    expect(late / cases.length).toBeGreaterThanOrEqual(48);
  });

  it('is fast', () => {
    const places = makePlaces(5);
    let worst = 0;
    for (let s = 0; s < 40; s++) {
      const t0 = performance.now();
      makeSchedule(teams, places, 2026 + (s % 7), 1000 + s);
      worst = Math.max(worst, performance.now() - t0);
    }
    expect(worst).toBeLessThan(200);
  });
});
