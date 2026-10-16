/**
 * The real-team roster set built by scripts/build-rosters.mjs from nflverse data (CC-BY 4.0). Names, jersey numbers
 * and positions are the season's real ones; the 0-100 ratings are this game's own estimates derived from that
 * season's statistics (the formulas are in the build script). Nothing here is an official rating.
 */
import rosters from '../data/nfl-rosters.json';
import { units, validateRoster, type RosterMeta, type RosterPlayer } from './roster';
import type { Ratings, TeamInfo } from './types';

interface Data {
  season: string;
  built: string;
  source: { name: string; url: string; license: string; season: string };
  teams: Record<string, { id: string; city: string; name: string; color: string; color2: string; players: Record<string, RosterPlayer & { id?: string }> }>;
}
const DATA = rosters as unknown as Data;

export const NFL_SEASON = DATA.season;
export const NFL_SOURCE = DATA.source;
export const NFL_META: RosterMeta = { season: DATA.season, sourceName: DATA.source.name, sourceUrl: DATA.source.url, license: DATA.source.license };
export const NFL_IDS = Object.keys(DATA.teams).sort();

export const hasRealTeam = (id: string) => id in DATA.teams;

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const cache = new Map<string, TeamInfo>();

/** A real team as the engine sees it. The same every day: the ratings come from the season's stats, not a seed. */
export function realTeam(id: string): TeamInfo {
  const hit = cache.get(id);
  if (hit) return hit;
  const t = DATA.teams[id];
  if (!t) throw new Error(`no roster for ${id}`);
  const p = t.players;
  const u = units(p);
  const r = (slot: string) => p[slot]?.rating ?? 70;
  const off = Math.round(avg([r('QB'), r('RB'), r('WR1'), r('WR2'), r('WR3'), r('TE'), u.passPro, u.runBlock]));
  const def = Math.round(avg([u.passRush, u.runDef, u.tackling, r('LB1'), r('LB2'), r('CB1'), r('CB2'), r('S1'), r('S2')]));
  const rat: Ratings = {
    ovr: Math.round((off + def) / 2), off, def,
    qb: r('QB'), ol: Math.round(u.passPro), dl: Math.round(u.passRush), k: Math.round(avg(Object.values(p.K?.attrs ?? { a: 80 }) as number[])),
    rcv: { WR1: r('WR1'), WR2: r('WR2'), WR3: r('WR3'), TE: r('TE'), RB: r('RB') },
    units: u,
  };
  const info: TeamInfo = { id: t.id, city: t.city, name: t.name, color: t.color, color2: t.color2, rat, players: p };
  cache.set(id, info);
  return info;
}

/** Validation problems across the whole set; empty when every team is usable. */
export function validateAll(): string[] {
  const out: string[] = [];
  for (const id of NFL_IDS) out.push(...validateRoster(id, DATA.teams[id].players, NFL_META));
  return out;
}
