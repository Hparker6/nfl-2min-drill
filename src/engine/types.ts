/** Core models shared by the engine, the evaluator worker and the UI. Team 0 is always the player ("you"). */
export type Team = 0 | 1;
/** The seven defensive families: each has its own alignment and its own way of moving on the field. */
export type LookFam = 'balanced' | 'blitz' | 'load' | 'zone' | 'man' | 'prevent' | 'goal';
/**
 * Defensive calls: the seven families' base calls plus the plays built on them (see DEF_PLAYS in defense.ts).
 * 'soft' is the old name of 'prevent', kept so saved games replay.
 */
export type Look = LookFam | 'soft'
  | 'cover4' | 'tampa2'
  | 'twoman' | 'press' | 'robber'
  | 'firezone' | 'mike' | 'cblitz' | 'sblitz'
  | 'glblitz' | 'glman' | 'runblitz';
export type Stage = 'pre' | 'call' | 'pat' | 'kick' | 'over';
export type Rcv = 'WR1' | 'WR2' | 'WR3' | 'TE' | 'RB';
export type RouteId =
  | 'screen' | 'flat' | 'angle' | 'hitch' | 'slant' | 'out' | 'cross' | 'dig' | 'comeback' | 'seam' | 'post' | 'corner' | 'go' | 'wheel' | 'hail';
export type OffClock = 'nohuddle' | 'huddle' | 'milk' | 'timeout' | 'spike' | 'kneel' | 'drain';
export type DefClock = 'timeout' | 'let';
export type Special = 'kneel' | 'fg' | 'punt' | 'spike';
export type StChoice = 'block' | 'safe' | 'return' | 'rush';
export type PatChoice = 'xp' | 'two';
export type KickChoice = 'deep' | 'onside';
/** Weather. Rare on purpose: most games are clear. See sim.ts WEATHER for what each one does. */
export type Weather = 'clear' | 'rain' | 'snow' | 'wind';
/** Ways to adjust a pass call: fake the run first, roll the quarterback out, or work the sideline. */
export interface PassMods { pa?: boolean; roll?: boolean; oob?: boolean }

import type { Attr, RatingSource, Units } from './roster';

/** A player: name, jersey number, overall game rating and per-attribute game ratings (0-100). See roster.ts. */
export interface Player { name: string; rating: number; number?: number; attrs?: Partial<Record<Attr, number>>; source?: RatingSource }

export interface Ratings {
  ovr: number;
  off: number;
  def: number;
  qb: number;
  ol: number;
  dl: number;
  k: number;
  rcv: Record<Rcv, number>;
  units?: Units;          // player-level matchups (roster.ts); absent on old saves and in some tests
}

export interface TeamInfo {
  id: string;
  city: string;
  name: string;
  color: string;
  color2: string;
  rat: Ratings;
  players: Record<string, Player>;
}

export interface State {
  t: number;              // seconds left in the game (4th quarter)
  off: Team;              // team with the ball (or kicking/scoring team for kick/pat stages)
  score: [number, number];
  to: [number, number];   // timeouts left
  down: number;
  dist: number;
  yl: number;             // yards from the offense's own goal line (1..99)
  running: boolean;       // clock running after the last play
  stage: Stage;
  warned: boolean;        // two-minute warning used
  adj: number;            // runoff adjustment for the next snap (out of bounds before 2:00)
  kicker: Team;
  safetyKick: boolean;
  pendLook: Look | null;  // the defense's look this snap, drawn before the offense calls
  shownLook: Look | null; // what the offense sees pre-snap (right most of the time)
  pendPlay: string | null;// the offense's call, drawn before the defense calls
  k: number;              // snap counter: seeds the real game's draws
  weather?: Weather;
  mix?: boolean;          // the AI defense calls the full playbook (Tampa 2, fire zone…), not only the seven base calls
  dx?: number;            // your defensive calls count this much more (defense.ts DEF_AMP); absent on older dailies
  rat: [Ratings, Ratings];
  // ---- full games (career mode). All absent on a late-game spot, which plays as the fourth quarter as it always has.
  q?: number;             // the period: 1-4, 5 and up overtime. When set, t is the seconds left in this period
  qLen?: number;          // seconds in a quarter
  po?: boolean;           // a playoff game: overtime repeats until someone wins
  rec?: Team;             // the team that received the opening kickoff (the other one receives the second half's)
  held?: Stage;           // the stage the period ended on, carried into the next period
  brk?: number;           // a period just started (or 0: the game just ended); reported as an event by advance()
  otOwn?: Team;           // overtime: whose possession it is, by the overtime rules
  otp?: number;           // overtime: possessions so far (1 = the first team's, 2 = the second's, 3+ sudden death)
  otS?: [number, number]; // overtime: the score when last checked
}

/** A decision. Only the fields for the stage being decided are read; the rest fall to the AI. */
export interface Choice {
  offClock?: OffClock;
  defClock?: DefClock;
  play?: string;          // call id or a Special
  target?: Rcv;
  route?: RouteId;
  routes?: Partial<Record<Rcv, RouteId>>;   // every receiver's edited route (the target's is also in route)
  side?: 1 | -1;          // runs: strong side (+1, the tight end's) or weak side (-1)
  mods?: PassMods;
  look?: Look;
  st?: StChoice;
  pat?: PatChoice;
  kick?: KickChoice;
}

export type ResultKind = 'run' | 'pass' | 'sack' | 'scramble' | 'kneel' | 'spike' | 'fg' | 'punt' | 'kickoff' | 'pat' | 'none';

export interface PlayResult {
  kind: ResultKind;
  call: string;
  look: Look | null;
  carrier: string;        // position key of who had the ball at the end
  target?: Rcv;
  route?: RouteId;
  yards: number;          // net yards from the line (for turnovers: where possession changed, relative to the line)
  air?: number;           // catch depth for passes
  complete?: boolean;
  intercepted?: boolean;
  fumble?: boolean;
  oob: boolean;
  td: boolean;
  defTd?: boolean;
  safety: boolean;
  turnover: boolean;
  touchback?: boolean;
  retYds?: number;
  penalty?: 'hold' | 'dpi' | 'rough';
  good?: boolean;         // kicks, conversions
  blocked?: boolean;
  dur: number;            // seconds the play took
  lane?: 'in' | 'out';
  side: -1 | 1;           // which way a run or route bends, from the offense's view (-1 left, 1 right)
  routes?: Partial<Record<Rcv, RouteId>>;   // the routes as called, when the player edited them
  mods?: PassMods;
}

/** What happened, for the play-by-play and the field animation. t is the clock after the event. */
export type Ev =
  | { type: 'timeout'; team: Team; t: number; left: number }
  | { type: 'warning'; t: number }
  | { type: 'expire'; t: number }
  | { type: 'snap'; off: Team; yl0: number; down0: number; dist0: number; t0: number; t: number; res: PlayResult; first: boolean }
  | { type: 'kick'; kind: 'kickoff' | 'onside' | 'free'; kicker: Team; recover: Team; touchback: boolean; td: boolean; yl: number; t: number }
  | { type: 'pat'; off: Team; two: boolean; good: boolean; t: number }
  | { type: 'period'; q: number; t: number }       // full games: a new quarter, halftime (q 3) or overtime (q 5+)
  | { type: 'final'; t: number; ot: boolean };     // full games: the game is over
