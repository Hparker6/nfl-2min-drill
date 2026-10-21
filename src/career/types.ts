/**
 * Career mode's data: a fictional 32-team league, its seasons, and the player's quarterback. Everything is plain
 * JSON so a career saves to the browser as one object.
 */
import type { RosterPlayer } from '../engine/roster';
import type { Ev, State } from '../engine/types';
import type { Pick } from '../game/session';
import type { Line, TeamLine } from './box';
import type { RiskWin } from './risk';

export type Conf = 0 | 1;          // the league's two conferences
export type Div = 0 | 1 | 2 | 3;   // four divisions per conference: North, South, East, West

/** A team in the league. `roster` maps each starting slot (QB, RB, WR1 … K, P) to a player id. */
export interface CTeam {
  id: string;
  city: string;
  name: string;
  color: string;
  color2: string;
  conf: Conf;
  div: Div;
  roster: Record<string, string>;
}

/** A league player: a generated roster player with an id, an age and a team (null: a free agent or retired). */
export interface CPlayer extends RosterPlayer {
  id: string;
  slot: string;
  age: number;
  team: string | null;
  exp: number;          // seasons played in the league
  pot?: number;         // how good he can get (progression ceiling)
  retired?: boolean;
}

export type GameKind = 'reg' | 'wc' | 'div' | 'conf' | 'final';

/** One game on the schedule. A played game has its final score; the player's own games keep a box score. */
export interface Game {
  id: string;
  week: number;            // 1-18 regular season; 19 wild card, 20 divisional, 21 conference, 22 the final
  kind: GameKind;
  home: string;
  away: string;
  score?: [number, number]; // [home, away]
  ot?: boolean;
  played?: 'sim' | 'moments' | 'full';
}

export interface StandingRow {
  team: string;
  w: number; l: number; t: number;
  pct: number;
  pf: number; pa: number;
  divW: number; divL: number; divT: number;
  confW: number; confL: number; confT: number;
  homeW: number; homeL: number; awayW: number; awayL: number;
  streak: string;          // "W3", "L1"
  seed?: number;           // 1-7 when in the playoff picture
  clinch?: 'z' | 'y' | 'x' | 'e';   // z: the bye, y: the division, x: a playoff spot, e: eliminated
}

export interface Season {
  year: number;
  week: number;            // the next week to play (1-18, then 19-22 playoffs; 23: the season is over)
  games: Game[];
  /** player id → season stats */
  stats: Record<string, Line>;
  /** player id → playoff stats (kept apart, the way the NFL keeps them) */
  poStats?: Record<string, Line>;
  /** team id → season team totals */
  teamStats: Record<string, TeamLine & { g: number }>;
  champion?: string;
  finalMvp?: string;
  awards?: Award[];
}

export interface Award { key: string; name: string; player?: string; team?: string; you?: boolean }

/** A game being played (moments or full): the live state and its events so far, so it survives a refresh. */
export interface LiveGame {
  gameId: string;
  seed: number;
  mode: 'moments' | 'full';
  youAre: 0 | 1;           // which side of the engine state is the player's team (always 0: see career/run.ts)
  s: State;
  ev: Ev[];
  /** call grades (0-100) from the moments you played, for XP */
  scores?: number[];
  /** risks that paid off in the moments you played (career/risk.ts), for XP and attribute boosts */
  risks?: RiskWin[];
  /** a moment in progress: where it started and the calls so far (GameScreen replays them after a refresh) */
  seg?: { start: State; picks: Pick[]; taken?: boolean };   // taken false: the prompt is up, not yet taken over
  /** you took over at least one drive (or played every snap): a game you only simmed to the end earns sim XP */
  played?: boolean;
}
