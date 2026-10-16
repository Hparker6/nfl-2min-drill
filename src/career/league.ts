/**
 * The league: 32 fictional teams in two conferences of four divisions, every player generated. No real team or
 * player names anywhere in career mode.
 */
import { FIRST, LAST } from '../engine/data';
import { clip, gauss, hash, rng, type Rng } from '../engine/rng';
import { GROUP_ATTRS, SLOT_GROUP, SLOTS, units, type Attr, type PosGroup, type RosterPlayer } from '../engine/roster';
import type { Ratings, TeamInfo } from '../engine/types';
import type { Conf, CPlayer, CTeam, Div } from './types';

export const LEAGUE_NAME = 'Gridiron League';
export const FINAL_NAME = 'Gridiron Bowl';
export const CONF_NAME = ['Eastern', 'Western'] as const;
export const CONF_SHORT = ['EC', 'WC'] as const;
export const DIV_NAME = ['North', 'South', 'East', 'West'] as const;

/** id, city, name, colors, conference, division */
const TEAMS: [string, string, string, string, string, Conf, Div][] = [
  ['BKN', 'Brooklyn', 'Kings', '#1F2937', '#F59E0B', 0, 0],
  ['TOR', 'Toronto', 'Northmen', '#B91C1C', '#F8FAFC', 0, 0],
  ['MTL', 'Montreal', 'Voyageurs', '#1E3A8A', '#DC2626', 0, 0],
  ['HFD', 'Hartford', 'Stags', '#1E293B', '#60A5FA', 0, 0],
  ['ORL', 'Orlando', 'Comets', '#5B21B6', '#22D3EE', 0, 1],
  ['BHM', 'Birmingham', 'Ironclads', '#9A3412', '#FED7AA', 0, 1],
  ['MEM', 'Memphis', 'Blues', '#1E3A8A', '#93C5FD', 0, 1],
  ['LOU', 'Louisville', 'Colonels', '#9F1239', '#F1F5F9', 0, 1],
  ['RAL', 'Raleigh', 'Oaks', '#166534', '#F5F5F4', 0, 2],
  ['VAB', 'Virginia', 'Admirals', '#0F172A', '#38BDF8', 0, 2],
  ['RIC', 'Richmond', 'Riverhawks', '#4C1D95', '#FBBF24', 0, 2],
  ['COL', 'Columbus', 'Foundry', '#111827', '#EAB308', 0, 2],
  ['STL', 'St. Louis', 'Ironmen', '#374151', '#DC2626', 0, 3],
  ['OMA', 'Omaha', 'Stampede', '#78350F', '#FBBF24', 0, 3],
  ['DSM', 'Des Moines', 'Harvest', '#A16207', '#14532D', 0, 3],
  ['TUL', 'Tulsa', 'Roughnecks', '#7C2D12', '#FCD34D', 0, 3],
  ['PDX', 'Portland', 'Lumberjacks', '#14532D', '#FACC15', 1, 0],
  ['VAN', 'Vancouver', 'Orcas', '#0C4A6E', '#A7F3D0', 1, 0],
  ['SPK', 'Spokane', 'Falls', '#1D4ED8', '#E5E7EB', 1, 0],
  ['ANC', 'Anchorage', 'Frost', '#0F766E', '#F8FAFC', 1, 0],
  ['AUS', 'Austin', 'Outlaws', '#BF5700', '#1B1B1B', 1, 1],
  ['SAT', 'San Antonio', 'Marshals', '#7F1D1D', '#E5E7EB', 1, 1],
  ['ELP', 'El Paso', 'Scorpions', '#B45309', '#1C1917', 1, 1],
  ['MEX', 'Mexico City', 'Aztecas', '#065F46', '#DC2626', 1, 1],
  ['OKC', 'Oklahoma City', 'Twisters', '#0E7490', '#F97316', 1, 2],
  ['ABQ', 'Albuquerque', 'Roadrunners', '#EA580C', '#134E4A', 1, 2],
  ['SLC', 'Salt Lake', 'Summit', '#1D4ED8', '#F1F5F9', 1, 2],
  ['BOI', 'Boise', 'Bison', '#1E40AF', '#F97316', 1, 2],
  ['SAC', 'Sacramento', 'Gold Rush', '#A16207', '#1C1917', 1, 3],
  ['OAK', 'Oakland', 'Redwoods', '#14532D', '#FDE68A', 1, 3],
  ['SDT', 'San Diego', 'Tritons', '#0369A1', '#FDE047', 1, 3],
  ['HON', 'Honolulu', 'Waves', '#0284C7', '#ECFEFF', 1, 3],
];

export interface League { teams: CTeam[]; players: Record<string, CPlayer> }

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Numbers each position usually wears. */
const NUMBERS: Record<PosGroup, number[]> = {
  QB: span(1, 19), RB: [...span(20, 39), ...span(2, 9)], WR: [...span(10, 19), ...span(80, 89), ...span(1, 9)],
  TE: [...span(80, 89), ...span(40, 49)], OL: [...span(60, 79), ...span(50, 59)], DL: [...span(90, 99), ...span(50, 59)],
  LB: [...span(40, 59), ...span(90, 99)], CB: [...span(20, 39), ...span(1, 9)], S: [...span(20, 49)],
  K: span(1, 19), P: span(1, 19),
};
function span(a: number, b: number) { return Array.from({ length: b - a + 1 }, (_, i) => a + i); }

/** A generated name, never one already in use. */
export function nameMaker(r: Rng, used: Set<string>) {
  return () => {
    for (let i = 0; i < 500; i++) {
      const n = `${FIRST[Math.floor(r() * FIRST.length)]} ${LAST[Math.floor(r() * LAST.length)]}`;
      if (!used.has(n)) { used.add(n); return n; }
    }
    const n = `${FIRST[Math.floor(r() * FIRST.length)]} ${LAST[Math.floor(r() * LAST.length)]} ${used.size}`;
    used.add(n);
    return n;
  };
}

/** Attributes around a level: each spreads up to 7 either side, so two players of one rating still differ. */
export function genAttrs(group: PosGroup, level: number, r: Rng): Partial<Record<Attr, number>> {
  const out: Partial<Record<Attr, number>> = {};
  for (const a of GROUP_ATTRS[group]) out[a] = clip(Math.round(level + (r() * 2 - 1) * 7), 35, 99);
  return out;
}

export const overall = (attrs: Partial<Record<Attr, number>>) => {
  const v = Object.values(attrs) as number[];
  return Math.round(avg(v));
};

/** A league player's age when generated: mostly mid-20s, a few veterans. Quarterbacks and kickers last longer. */
function genAge(group: PosGroup, r: Rng): number {
  const top = group === 'QB' || group === 'K' || group === 'P' ? 37 : 33;
  return clip(Math.round(26 + gauss(r) * 3.2), 22, top);
}

/** One player for a slot at a given level. */
export function genPlayer(id: string, slot: string, level: number, r: Rng, name: string, number: number, team: string | null): CPlayer {
  const group = SLOT_GROUP[slot];
  const attrs = genAttrs(group, level, r);
  const age = genAge(group, r);
  return {
    id, slot, name, number, attrs, rating: overall(attrs), source: 'generated', age, team, exp: Math.max(0, age - 22),
    pot: clip(Math.round(overall(attrs) + Math.max(0, 27 - age) * 2.2 + r() * 4), 50, 99),
  };
}

/**
 * A new league. Team strength varies the way a real league does: a few strong teams, a few weak ones, most in
 * between. Each unit has its own level, so a team can have a great defense and a poor line.
 */
export function newLeague(seed: number): League {
  const r = rng(hash(seed, 'league'));
  const used = new Set<string>();
  const name = nameMaker(rng(hash(seed, 'names')), used);
  const teams: CTeam[] = [];
  const players: Record<string, CPlayer> = {};
  let n = 0;
  for (const [id, city, nick, color, color2, conf, div] of TEAMS) {
    const base = clip(79 + gauss(r) * 4.5, 68, 91);
    const lvl: Record<string, number> = {
      QB: base + gauss(r) * 6, RB: base + gauss(r) * 4, WR: base + gauss(r) * 4, TE: base + gauss(r) * 4,
      OL: base + gauss(r) * 4, DL: base + gauss(r) * 4, LB: base + gauss(r) * 4, CB: base + gauss(r) * 4,
      S: base + gauss(r) * 4, K: 80 + gauss(r) * 6, P: 78 + gauss(r) * 6,
    };
    const roster: Record<string, string> = {};
    const taken = new Set<number>();
    for (const slot of SLOTS) {
      const g = SLOT_GROUP[slot];
      // the depth chart: WR1 is the best receiver, WR3 the third
      const dep = slot === 'WR2' ? -3 : slot === 'WR3' ? -6 : slot === 'LB3' ? -4 : slot === 'CB2' ? -3 : 0;
      const level = clip(lvl[g] + dep + gauss(r) * 3, 50, 97);
      const pool = NUMBERS[g].filter((x) => !taken.has(x));
      const number = pool[Math.floor(r() * Math.min(pool.length, 8))];
      taken.add(number);
      const pid = `p${seed.toString(36)}-${(n++).toString(36)}`;
      players[pid] = genPlayer(pid, slot, level, r, name(), number, id);
      roster[slot] = pid;
    }
    teams.push({ id, city, name: nick, color, color2, conf, div, roster });
  }
  return { teams, players };
}

/** A team's ratings as the engine reads them, from its players (the same roll-up as the real-team rosters). */
export function teamRatings(p: Record<string, RosterPlayer>): Ratings {
  const u = units(p);
  const r = (slot: string) => p[slot]?.rating ?? 70;
  const off = Math.round(avg([r('QB'), r('RB'), r('WR1'), r('WR2'), r('WR3'), r('TE'), u.passPro, u.runBlock]));
  const def = Math.round(avg([u.passRush, u.runDef, u.tackling, r('LB1'), r('LB2'), r('CB1'), r('CB2'), r('S1'), r('S2')]));
  return {
    ovr: Math.round((off + def) / 2), off, def,
    qb: r('QB'), ol: Math.round(u.passPro), dl: Math.round(u.passRush), k: Math.round(avg(Object.values(p.K?.attrs ?? { a: 80 }) as number[])),
    rcv: { WR1: r('WR1'), WR2: r('WR2'), WR3: r('WR3'), TE: r('TE'), RB: r('RB') },
    units: u,
  };
}

/** A team as the engine sees it. */
export function teamInfo(lg: League, t: CTeam): TeamInfo {
  const p: Record<string, CPlayer> = {};
  for (const slot of SLOTS) { const id = t.roster[slot]; if (id && lg.players[id]) p[slot] = lg.players[id]; }
  return { id: t.id, city: t.city, name: t.name, color: t.color, color2: t.color2, rat: teamRatings(p), players: p };
}

export const teamById = (lg: League, id: string) => lg.teams.find((t) => t.id === id)!;

/** Offense, defense and overall, 0-99, for team cards and the power rankings. */
export function unitGrades(info: TeamInfo): { ovr: number; off: number; def: number } {
  const { off, def } = info.rat;
  return { off, def, ovr: Math.round((off + def) / 2) };
}
