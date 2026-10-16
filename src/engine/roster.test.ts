/**
 * Rosters: every team must pass validation (so a future real-data import is checked the same way), and players'
 * game ratings must move plays the way attributes.ts documents, without making anyone unbeatable.
 */
import { describe, expect, it } from 'vitest';
import { FRANCHISES } from './data';
import { FICTIONAL_ROSTER, makeTeam } from './scenario';
import { GROUP_ATTRS, SLOTS, SLOT_GROUP, units, validateRoster, type Attr, type RosterPlayer } from './roster';
import { passMods } from './attributes';
import { resolveSnap } from './sim';
import { customScenario } from './scenario';
import { rng } from './rng';
import type { Ratings, State } from './types';

describe('roster validation', () => {
  it('every fictional team has a complete, valid roster on any day', () => {
    for (const [id] of FRANCHISES) for (const seed of ['2026-10-16', '2027-01-01', 'surv:7:3']) {
      const t = makeTeam(id, seed);
      expect(validateRoster(id, t.players as Record<string, RosterPlayer>, FICTIONAL_ROSTER)).toEqual([]);
    }
  });
  it('names and numbers stay the same from day to day; ratings may move', () => {
    const a = makeTeam('PDX', '2026-10-16'), b = makeTeam('PDX', '2026-10-17');
    for (const s of SLOTS) { expect(a.players[s].name).toBe(b.players[s].name); expect(a.players[s].number).toBe(b.players[s].number); }
  });
  it('catches missing players, duplicate or illegal numbers, missing or out-of-range ratings, and stats with no season', () => {
    const good = makeTeam('AUS', 'x').players as Record<string, RosterPlayer>;
    const bad: Record<string, RosterPlayer | undefined> = { ...good };
    bad.RB = undefined;                                                      // missing player
    bad.WR2 = { ...good.WR2, number: good.WR1.number };                     // duplicate number
    bad.LT = { ...good.LT, number: 12 };                                    // a lineman wearing 12
    bad.QB = { ...good.QB, attrs: { ...good.QB.attrs, arm: undefined } };   // missing attribute
    bad.CB1 = { ...good.CB1, attrs: { ...good.CB1.attrs, coverage: 140 } }; // out of range
    bad.S1 = { ...good.S1, source: 'stats' };                               // stat-derived, but the roster has no season
    const issues = validateRoster('AUS', bad, FICTIONAL_ROSTER).join('\n');
    expect(issues).toMatch(/RB: missing player/);
    expect(issues).toMatch(/WR2: number \d+ also worn by WR1/);
    expect(issues).toMatch(/LT: number 12 not allowed for OL/);
    expect(issues).toMatch(/QB: missing arm/);
    expect(issues).toMatch(/CB1: coverage 140 outside 0-100/);
    expect(issues).toMatch(/S1: stat-derived ratings with no season/);
  });
});

/** A roster where everyone is exactly average (80) at everything, to change one thing at a time. */
function average(): Record<string, RosterPlayer> {
  const r: Record<string, RosterPlayer> = {};
  SLOTS.forEach((s, i) => {
    const attrs: Partial<Record<Attr, number>> = {};
    for (const a of GROUP_ATTRS[SLOT_GROUP[s]]) attrs[a] = 80;
    r[s] = { name: s, number: i, rating: 80, attrs, source: 'generated' };
  });
  return r;
}
function tweak(r: Record<string, RosterPlayer>, slots: string[], attrs: Partial<Record<Attr, number>>) {
  const out = { ...r };
  for (const s of slots) out[s] = { ...r[s], attrs: { ...r[s].attrs, ...Object.fromEntries(Object.entries(attrs).filter(([a]) => GROUP_ATTRS[SLOT_GROUP[s]].includes(a as Attr))) } };
  return out;
}
const base = (): Ratings => ({ ovr: 80, off: 80, def: 80, qb: 80, ol: 80, dl: 80, k: 80, rcv: { WR1: 80, WR2: 80, WR3: 80, TE: 80, RB: 80 } });
function spot(off: Record<string, RosterPlayer>, def: Record<string, RosterPlayer>, o: { yl?: number } = {}): State {
  const s = customScenario({ you: 'AUS', them: 'PDX', side: 'off', t: 300, lead: 0, yl: o.yl ?? 40, down: 1, dist: 10, to: [3, 3], running: false, home: 0 }, 'attr').start;
  return { ...s, stage: 'call', rat: [{ ...base(), units: units(off) }, { ...base(), units: units(def) }] };
}
function dist(s: State, play: string, n = 6000) {
  let y = 0, comp = 0, att = 0, sack = 0, boom = 0, int = 0, stuff = 0, inc = 0;
  for (let i = 0; i < n; i++) {
    const res = resolveSnap(s, play, 'balanced', rng(500 + i));
    if (!res.turnover) y += res.yards;
    if (res.kind === 'pass') { att++; if (res.complete) comp++; else if (!res.intercepted && !res.penalty) inc++; }
    if (res.kind === 'sack') sack++;
    if (res.intercepted) int++;
    if (res.yards >= 20) boom++;
    if (res.kind === 'run' && res.yards <= 0) stuff++;
  }
  return { ypp: y / n, comp: comp / Math.max(1, att), sack: sack / n, boom: boom / n, int: int / n, stuff: stuff / n, inc: inc / n };
}

describe('players move plays', () => {
  const avg = average();
  it('an elite receiver separates and catches more, and gains more', () => {
    const elite = tweak(avg, ['WR1'], { routeRunning: 96, release: 95, speed: 95, acceleration: 94, hands: 95, contested: 94 });
    const a = dist(spot(avg, avg), 'dig'), e = dist(spot(elite, avg), 'dig');
    expect(e.comp).toBeGreaterThan(a.comp + 0.05);
    expect(e.ypp).toBeGreaterThan(a.ypp + 0.6);
  });
  it('a fast running back turns more openings into long runs', () => {
    const fast = tweak(avg, ['RB'], { speed: 97, acceleration: 95, agility: 92 });
    const slow = tweak(avg, ['RB'], { speed: 68, acceleration: 70, agility: 70 });
    expect(dist(spot(fast, avg), 'outside_zone').boom).toBeGreaterThan(dist(spot(slow, avg), 'outside_zone').boom * 1.4);
  });
  it('strong pass protection cuts sacks', () => {
    const wall = tweak(avg, ['LT', 'LG', 'C', 'RG', 'RT', 'TE'], { passPro: 95 });
    const sieve = tweak(avg, ['LT', 'LG', 'C', 'RG', 'RT', 'TE'], { passPro: 65 });
    expect(dist(spot(wall, avg), 'deep_post').sack).toBeLessThan(dist(spot(sieve, avg), 'deep_post').sack * 0.6);
  });
  it('a lockdown corner takes away his receiver', () => {
    const lock = tweak(avg, ['CB1'], { coverage: 95, reaction: 93, ballSkills: 92 });
    const weak = tweak(avg, ['CB1'], { coverage: 65, reaction: 66, ballSkills: 60 });
    const vsLock = dist(spot(avg, lock), 'dig'), vsWeak = dist(spot(avg, weak), 'dig');
    expect(vsLock.comp).toBeLessThan(vsWeak.comp - 0.08);
    expect(vsLock.int).toBeGreaterThan(vsWeak.int);
  });
  it('poor run blocking makes runs less attractive', () => {
    const poor = tweak(avg, ['LT', 'LG', 'C', 'RG', 'RT', 'TE'], { runBlock: 62 });
    const a = dist(spot(avg, avg), 'inside_zone'), p = dist(spot(poor, avg), 'inside_zone');
    expect(p.ypp).toBeLessThan(a.ypp - 0.5);
    expect(p.stuff).toBeGreaterThan(a.stuff);
  });
  it('a strong quarterback completes more but still throws interceptions', () => {
    const ace = tweak(avg, ['QB'], { accuracy: 96, arm: 95, decision: 94 });
    const a = dist(spot(avg, avg), 'deep_post'), q = dist(spot(ace, avg), 'deep_post');
    expect(q.comp).toBeGreaterThan(a.comp + 0.05);
    expect(q.int).toBeGreaterThan(0.005);
  });
  it('nobody is unbeatable: an elite offense against a weak defense still sees incompletions, sacks, stuffs and picks', () => {
    const allElite = (r: Record<string, RosterPlayer>) => {
      const out = { ...r };
      for (const s of SLOTS) out[s] = { ...r[s], attrs: Object.fromEntries(Object.keys(r[s].attrs).map((a) => [a, 98])) };
      return out;
    };
    const weakDef = (r: Record<string, RosterPlayer>) => {
      const out = { ...r };
      for (const s of SLOTS) out[s] = { ...r[s], attrs: Object.fromEntries(Object.keys(r[s].attrs).map((a) => [a, 55])) };
      return out;
    };
    const s = spot(allElite(avg), weakDef(avg));
    const pass = dist(s, 'deep_post'), run = dist(s, 'inside_zone');
    expect(pass.inc).toBeGreaterThan(0.15);
    expect(pass.sack).toBeGreaterThan(0.01);
    expect(pass.int).toBeGreaterThan(0.005);
    expect(run.stuff).toBeGreaterThan(0.03);
  });
  it('teams without player ratings use the old team-level formula unchanged', () => {
    const R = base(), D = { ...base(), def: 90, dl: 85 };
    const m = passMods(R, D, 'WR1', false);
    expect(m.sackMul).toBeCloseTo(1 + (85 - 80) * 0.025);
    expect(m.comp).toBeCloseTo((80 - 80) * 0.006 + (80 - 90) * 0.004);
  });
});
