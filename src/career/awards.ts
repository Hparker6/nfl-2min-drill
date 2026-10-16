/**
 * End-of-season awards: MVP, Offensive and Defensive Player of the Year, the rookies of the year, the Pro Bowl
 * quarterbacks, and the final's MVP. Each is a value score over the regular season's stats and the team's record.
 */
import { SLOT_GROUP } from '../engine/roster';
import { passerRating, type Box, type Line } from './box';
import type { League } from './league';
import { standings } from './standings';
import type { Award, Season } from './types';

const OFF = new Set(['QB', 'RB', 'WR', 'TE']);
const DEF = new Set(['DL', 'LB', 'CB', 'S']);

/** How much a season was worth, by position. Wins count: MVPs come from good teams. */
export function value(l: Line, group: string, wins: number): number {
  const gp = Math.max(1, l.gp ?? 1);
  if (group === 'QB') {
    if ((l.pa ?? 0) < 10 * gp) return 0;
    return (l.py ?? 0) / 25 + (l.ptd ?? 0) * 4 - (l.pint ?? 0) * 3 + (l.ry ?? 0) / 10 + (l.rtd ?? 0) * 6 + (passerRating(l) - 85) * 1.2 + wins * 6;
  }
  if (OFF.has(group)) return (l.ry ?? 0) / 10 + (l.rtd ?? 0) * 6 + (l.rcy ?? 0) / 10 + (l.rctd ?? 0) * 6 - (l.fum ?? 0) * 3 + wins * 2.5;
  if (DEF.has(group)) return (l.sck ?? 0) * 5 + (l.int ?? 0) * 6 + (l.tk ?? 0) * 0.35 + (l.tfl ?? 0) * 1.5 + (l.ff ?? 0) * 4 + (l.pd ?? 0) * 1 + (l.dtd ?? 0) * 8 + wins * 2;
  return 0;
}

export function seasonAwards(lg: League, season: Season, youId: string): Award[] {
  const st = standings(lg.teams, season.games);
  const rows = Object.entries(season.stats).map(([id, l]) => {
    const p = lg.players[id];
    if (!p) return null;
    const group = SLOT_GROUP[p.slot];
    const wins = p.team && st[p.team] ? st[p.team].w + st[p.team].t / 2 : 0;
    return { id, p, group, v: value(l, group, wins), rookie: p.exp === 0 };
  }).filter((x): x is NonNullable<typeof x> => !!x && x.v > 0);
  const best = (f: (r: (typeof rows)[number]) => boolean, not: string[] = []) => rows.filter((r) => f(r) && !not.includes(r.id)).sort((a, b) => b.v - a.v)[0];
  const out: Award[] = [];
  const give = (key: string, name: string, r?: (typeof rows)[number]) => { if (r) out.push({ key, name, player: r.id, team: r.p.team ?? undefined, you: r.id === youId }); };
  const mvp = best((r) => OFF.has(r.group));
  give('mvp', 'Most Valuable Player', mvp);
  give('opoy', 'Offensive Player of the Year', best((r) => OFF.has(r.group), mvp ? [mvp.id] : []));
  give('dpoy', 'Defensive Player of the Year', best((r) => DEF.has(r.group)));
  give('oroy', 'Offensive Rookie of the Year', best((r) => r.rookie && OFF.has(r.group)));
  give('droy', 'Defensive Rookie of the Year', best((r) => r.rookie && DEF.has(r.group)));
  // the Pro Bowl: the conference's three best quarterbacks each
  for (const conf of [0, 1] as const) {
    rows.filter((r) => r.group === 'QB' && lg.teams.find((t) => t.id === r.p.team)?.conf === conf).sort((a, b) => b.v - a.v).slice(0, 3)
      .forEach((r) => give('pro', 'Pro Bowl', r));
  }
  if (season.finalMvp) out.push({ key: 'fmvp', name: 'Gridiron Bowl MVP', player: season.finalMvp, team: lg.players[season.finalMvp]?.team ?? undefined, you: season.finalMvp === youId });
  return out;
}

/** The final's MVP: the winning side's best game. */
export function finalMvp(lg: League, box: Box, winner: string): string | undefined {
  let top: { id: string; v: number } | undefined;
  for (const id in box.players) {
    const p = lg.players[id];
    if (!p || p.team !== winner) continue;
    const v = value({ ...box.players[id], gp: 1 }, SLOT_GROUP[p.slot], 0) * (SLOT_GROUP[p.slot] === 'QB' ? 1 : 1.2);
    if (!top || v > top.v) top = { id, v };
  }
  return top?.id;
}

/** The race: the current top five for an award, for the season screen. */
export function race(lg: League, season: Season, key: 'mvp' | 'oroy' | 'dpoy', n = 5): { id: string; v: number }[] {
  const st = standings(lg.teams, season.games);
  return Object.entries(season.stats).map(([id, l]) => {
    const p = lg.players[id];
    if (!p) return null;
    const g = SLOT_GROUP[p.slot];
    const ok = key === 'dpoy' ? DEF.has(g) : OFF.has(g) && (key !== 'oroy' || p.exp === 0);
    if (!ok) return null;
    const wins = p.team && st[p.team] ? st[p.team].w + st[p.team].t / 2 : 0;
    return { id, v: Math.round(value(l, g, wins)) };
  }).filter((x): x is { id: string; v: number } => !!x && x.v > 0).sort((a, b) => b.v - a.v).slice(0, n);
}
