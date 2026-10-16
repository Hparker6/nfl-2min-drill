/**
 * A season: the schedule, simming games around the league, the stats they add up to, the playoffs and the awards.
 */
import { kickoffState, playOut } from '../engine/game';
import { hash, pickWeighted, rng } from '../engine/rng';
import type { Ev, Ratings, State, Team, TeamInfo, Weather } from '../engine/types';
import { addLine, boxScore, passerRating, type Box, type Line } from './box';
import { teamById, teamInfo, type League } from './league';
import { makeSchedule } from './schedule';
import { finalMvp } from './awards';
import { divisionOrder, draftOrder, playoffRound } from './standings';
import type { CTeam, Game, GameKind, Season } from './types';

export const REG_WEEKS = 18;
export const ROUND_WEEK: Record<Exclude<GameKind, 'reg'>, number> = { wc: 19, div: 20, conf: 21, final: 22 };
export const WEEK_NAME = (w: number) => (w <= REG_WEEKS ? `Week ${w}` : ['Wild Card', 'Divisional', 'Conference Championships', 'The Final'][w - 19] ?? 'Offseason');

const COLD = new Set(['BKN', 'TOR', 'MTL', 'HFD', 'STL', 'OMA', 'DSM', 'COL', 'SPK', 'ANC', 'BOI', 'SLC', 'VAN', 'PDX', 'LOU']);
const WET = new Set(['PDX', 'VAN', 'SPK', 'SEA', 'RAL', 'RIC', 'VAB', 'ORL', 'HON', 'OAK']);

/** The weather for a game: by the home city and the time of year. Most games are clear. */
export function gameWeather(home: string, week: number, seed: number): Weather {
  const r = rng(hash(seed, home, week, 'wx'));
  const late = week >= 12;
  return pickWeighted<Weather>(r, {
    clear: 1,
    rain: WET.has(home) ? 0.08 : 0.04,
    wind: 0.035,
    snow: COLD.has(home) && late ? (week >= 15 ? 0.14 : 0.07) : 0,
  });
}

/**
 * Home field: worth about a field goal's edge over a season in the NFL (a bit under 55% of games). Modeled as the
 * home team's units playing a point and a half better (the crowd on the opponent's snap count, familiarity).
 */
export function withHome(rat: Ratings): Ratings {
  const u = rat.units;
  if (!u) return rat;
  const b = 1.5;
  return {
    ...rat, units: {
      ...u, passPro: u.passPro + b, runBlock: u.runBlock + b, passRush: u.passRush + b, runDef: u.runDef + b, tackling: u.tackling + b,
      pursuit: u.pursuit + b, qb: { ...u.qb, accuracy: u.qb.accuracy + b, decision: u.qb.decision + b },
    },
  };
}

/** The seed for a game, from the career and the game. */
export const gameSeed = (seed: number, g: Game) => hash(seed, g.id);

/**
 * A game's engine state at kickoff. Team 0 is `first` (the player's team in their games, the home team otherwise);
 * home field goes to the home team, except in the final (a neutral site).
 */
export function startGame(lg: League, g: Game, seed: number, first: string, qLen = 900): { s: State; teams: [TeamInfo, TeamInfo] } {
  const a = teamInfo(lg, teamById(lg, first));
  const b = teamInfo(lg, teamById(lg, first === g.home ? g.away : g.home));
  const neutral = g.kind === 'final';
  const ra = !neutral && first === g.home ? withHome(a.rat) : a.rat;
  const rb = !neutral && first !== g.home ? withHome(b.rat) : b.rat;
  const s = kickoffState([ra, rb], { seed: gameSeed(seed, g), qLen, po: g.kind !== 'reg', weather: gameWeather(g.home, g.week, seed) });
  return { s, teams: [a, b] };
}

/** Player ids by side of the engine state, for the box score. */
export const pidFor = (lg: League, teams: [TeamInfo, TeamInfo]) => (side: Team, slot: string) => teamById(lg, teams[side].id).roster[slot] ?? `${teams[side].id}:${slot}`;

/** Sim a game with the AI on both sides. */
export function simGame(lg: League, g: Game, seed: number): { box: Box; teams: [TeamInfo, TeamInfo]; ev: Ev[] } {
  const { s, teams } = startGame(lg, g, seed, g.home);
  const { ev } = playOut(gameSeed(seed, g), s);
  return { box: boxScore(ev, teams, gameSeed(seed, g), pidFor(lg, teams)), teams, ev };
}

/** Put a finished game into the season: the score, every player's stats, the team totals. */
export function recordGame(season: Season, g: Game, box: Box, teams: [TeamInfo, TeamInfo], how: Game['played'] = 'sim', lg?: League) {
  const homeSide: Team = teams[0].id === g.home ? 0 : 1;
  g.score = homeSide === 0 ? [box.final[0], box.final[1]] : [box.final[1], box.final[0]];
  g.ot = box.ot;
  g.played = how;
  if (g.kind === 'final' && lg) season.finalMvp = finalMvp(lg, box, g.score[0] > g.score[1] ? g.home : g.away);
  const into = g.kind === 'reg' ? season.stats : (season.poStats ??= {});
  for (const id in box.players) addLine((into[id] ??= {}), box.players[id]);
  if (g.kind !== 'reg') return;
  for (const side of [0, 1] as Team[]) {
    const T = (season.teamStats[teams[side].id] ??= { pts: 0, yds: 0, py: 0, ry: 0, plays: 0, fd: 0, to: 0, td3: 0, att3: 0, pen: 0, top: 0, sacks: 0, g: 0 });
    const L = box.team[side];
    T.g++;
    for (const k of Object.keys(L) as (keyof typeof L)[]) T[k] += L[k];
    // points allowed rides along in the team line as the opponent's points
  }
}

export function newSeason(lg: League, year: number, places: Record<string, number>, seed: number): Season {
  return { year, week: 1, games: makeSchedule(lg.teams, places, year, hash(seed, year, 'sched')), stats: {}, teamStats: {} };
}

/** Last season's division finishes (0 = first), for the schedule's same-place games. */
export function placesFrom(lg: League, games: Game[], seed: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const conf of [0, 1] as const) for (const div of [0, 1, 2, 3] as const) {
    divisionOrder(lg.teams, games, conf, div, seed).forEach((id, i) => { out[id] = i; });
  }
  return out;
}

/** The games of a week. */
export const weekGames = (season: Season, week: number) => season.games.filter((g) => g.week === week);

/** Sim every unplayed game of the current week except `skip` (the player's own). */
export function simWeek(lg: League, season: Season, seed: number, skip?: string) {
  for (const g of weekGames(season, season.week)) {
    if (g.score || g.id === skip) continue;
    const { box, teams } = simGame(lg, g, seed);
    recordGame(season, g, box, teams, 'sim', lg);
  }
}

/** After the last regular-season week and each playoff round: the next round's games. */
export function schedulePlayoffs(lg: League, season: Season, seed: number) {
  const round = (['wc', 'div', 'conf', 'final'] as const).find((k) => ROUND_WEEK[k] === season.week);
  if (!round || season.games.some((g) => g.kind === round)) return;
  const pairs = playoffRound(lg.teams, season.games, round, seed);
  pairs.forEach((p, i) => season.games.push({ id: `${season.year}-${round}-${i}`, week: season.week, kind: round, home: p.home, away: p.away }));
}

/** Is the week done (every game has a score)? */
export const weekDone = (season: Season) => weekGames(season, season.week).every((g) => g.score);

/** Move on once the week is done: next week, the playoffs, the champion. */
export function advanceWeek(lg: League, season: Season, seed: number) {
  if (!weekDone(season)) return;
  if (season.week === ROUND_WEEK.final) {
    const f = weekGames(season, season.week)[0];
    if (f?.score) season.champion = f.score[0] > f.score[1] ? f.home : f.away;
  }
  season.week++;
  schedulePlayoffs(lg, season, seed);
}

/** Is a team still alive in the playoffs (or in the regular season)? */
export function alive(season: Season, team: string): boolean {
  if (season.week <= REG_WEEKS + 1) return true;
  const po = season.games.filter((g) => g.kind !== 'reg' && g.score);
  return !po.some((g) => (g.home === team && g.score![0] < g.score![1]) || (g.away === team && g.score![1] < g.score![0]));
}

/** League leaders for a stat (top n), with a minimum so a one-game wonder doesn't lead in an average. */
export function leaders(lg: League, season: Season, key: string, n = 10): { id: string; v: number; line: Line }[] {
  const rows: { id: string; v: number; line: Line }[] = [];
  for (const id in season.stats) {
    const l = season.stats[id];
    if (!lg.players[id]) continue;
    const v = statValue(l, key);
    if (v == null) continue;
    rows.push({ id, v, line: l });
  }
  return rows.sort((a, b) => b.v - a.v).slice(0, n);
}

/** A stat from a line, or null when the player doesn't qualify for it. */
export function statValue(l: Line, key: string): number | null {
  switch (key) {
    case 'rating': return (l.pa ?? 0) >= 14 * (l.gp ?? 1) ? passerRating(l) : null;
    case 'ypc': return (l.ra ?? 0) >= 6 * (l.gp ?? 1) ? Math.round(((l.ry ?? 0) / (l.ra ?? 1)) * 10) / 10 : null;
    default: { const v = l[key as keyof Line]; return v ? v : null; }
  }
}

/** The order of the draft that follows this season. */
export const draftOrderFor = (lg: League, season: Season, seed: number) => draftOrder(lg.teams, season.games, seed);

export type { CTeam };
