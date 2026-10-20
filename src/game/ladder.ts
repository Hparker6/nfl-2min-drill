/**
 * The Gridiron Challenge ladder (Coach's Edition): eight hand-built spots between the game's own fictional teams,
 * each testing one late-game skill, harder as you climb. A rung opens once the one below it has a star.
 *
 * Stars reward the calls, not the bounces: a win earns the first, and the other two come from Decisions, the same
 * number every game's review shows (100 = you never gave up win chance against the best call):
 *   ★     win
 *   ★★    win with Decisions 75+ (about 11 points of win chance given up, in all)
 *   ★★★   win with Decisions 90+ (about 4 points)
 * Coach mode's win chances stay off on the ladder: reading them would hand you the stars.
 *
 * Each spot's teams, score and clock are fixed; every attempt draws new bounces (its own seed), so a rung can't be
 * learned by heart. `wp` is the spot's measured start: how often the AI coach wins it from there (ladder.test.ts
 * re-measures it, and keeps every spot legal and in doubt).
 */
import { decisionQuality } from './rating';
import { hash } from '../engine/rng';
import { DEF_AMP } from '../engine/defense';
import { dcFor, makeTeam, stateFrom, type Scenario, type SpotParams } from '../engine/scenario';
import type { Team, TeamInfo, Weather } from '../engine/types';

export type Tier = 'Rookie' | 'Starter' | 'Pro' | 'Legend';

export interface Rung {
  id: string;
  title: string;
  tier: Tier;
  /** the skill it tests, in a line */
  lesson: string;
  /** the situation, as the brief tells it */
  brief: string;
  you: string;
  them: string;
  home: Team;
  side: 'off' | 'def';
  t: number;
  score: [number, number];   // [you, them]
  yl: number;                // the offense's yard line, from its own goal
  down: number;
  dist: number;
  to: [number, number];      // [yours, theirs]
  running: boolean;
  weather?: Weather;
  /** how often the AI coach wins from here (measured; see the file comment) */
  wp: number;
}

export const LADDER: Rung[] = [
  {
    id: 'bleed', title: 'Bleed it dry', tier: 'Rookie', lesson: 'Clock management with a lead',
    brief: 'Up three with the ball and the two-minute warning still to come. They have two timeouts. Make them use them, and don’t hand it back with time to spare.',
    you: 'PDX', them: 'ORL', home: 0, side: 'off', t: 140, score: [20, 17], yl: 38, down: 1, dist: 10, to: [2, 2], running: true, wp: 0.76,
  },
  {
    id: 'range', title: 'Get in range', tier: 'Rookie', lesson: 'Field-goal range, timeouts and the sideline',
    brief: 'Tied with a minute left and two timeouts, at your own 25. A field goal wins it. Get into range without throwing it away or running out of time.',
    you: 'AUS', them: 'TOR', home: 0, side: 'off', t: 62, score: [17, 17], yl: 25, down: 1, dist: 10, to: [2, 1], running: false, wp: 0.70,
  },
  {
    id: 'fourth', title: 'Fourth and two', tier: 'Starter', lesson: 'The fourth-down call',
    brief: 'Tied, fourth and two at their 35 with three minutes left. A long field goal takes the lead but leaves them time, a punt pins them deep, a conversion keeps the ball and the clock. Your call.',
    you: 'BKN', them: 'SAT', home: 1, side: 'off', t: 185, score: [20, 20], yl: 65, down: 4, dist: 2, to: [3, 2], running: false, wp: 0.48,
  },
  {
    id: 'stand', title: 'Hold the line', tier: 'Starter', lesson: 'Red-zone defense against the clock',
    brief: 'You lead by four. They have first and goal at your 6 with 52 seconds and a timeout. A field goal does them no good. Four stops wins it.',
    you: 'STL', them: 'LOU', home: 0, side: 'def', t: 52, score: [24, 20], yl: 94, down: 1, dist: 6, to: [2, 1], running: false, wp: 0.55,
  },
  {
    id: 'snow', title: 'Snow globe', tier: 'Pro', lesson: 'Calling plays for the weather',
    brief: 'Tied in a snowstorm against a better team. The deep ball floats and the footing is a gamble. A minute and a half to get into range from your own 35.',
    you: 'SLC', them: 'OMA', home: 0, side: 'off', t: 95, score: [10, 10], yl: 35, down: 1, dist: 10, to: [2, 2], running: false, weather: 'snow', wp: 0.49,
  },
  {
    id: 'drill', title: 'Two-minute drill', tier: 'Pro', lesson: 'A full drive with one timeout',
    brief: 'Down three on the road at your own 25, 1:48 left, one timeout, against a better team. Tie it or win it: your choice when you get there.',
    you: 'SAC', them: 'SDT', home: 1, side: 'off', t: 108, score: [21, 24], yl: 25, down: 1, dist: 10, to: [1, 2], running: false, wp: 0.26,
  },
  {
    id: 'long', title: 'The long field', tier: 'Legend', lesson: 'Touchdown or nothing, into the wind',
    brief: 'Down four at your own 15 with 58 seconds, one timeout and a wind in your face. A field goal loses. Only a touchdown wins.',
    you: 'ABQ', them: 'VAB', home: 1, side: 'off', t: 58, score: [27, 31], yl: 15, down: 1, dist: 10, to: [1, 2], running: false, weather: 'wind', wp: 0.19,
  },
  {
    id: 'eight', title: 'Two scores in one', tier: 'Legend', lesson: 'Down eight: the touchdown, the two-point try, then overtime',
    brief: 'Down eight with 2:45 and all three timeouts. You need a touchdown and a two-point conversion just to reach overtime, and then you have to win that.',
    you: 'RAL', them: 'BHM', home: 1, side: 'off', t: 165, score: [16, 24], yl: 30, down: 1, dist: 10, to: [3, 2], running: false, wp: 0.13,
  },
];

export const MAX_STARS = LADDER.length * 3;

/** The two Decisions marks for the second and third stars. */
export const STAR_MARKS: [number, number] = [75, 90];

export const STAR_RULES: [number, string][] = [
  [1, 'Win'],
  [2, `Win with Decisions ${STAR_MARKS[0]}+`],
  [3, `Win with Decisions ${STAR_MARKS[1]}+`],
];

export type Stars = 0 | 1 | 2 | 3;

/** Stars for a finished attempt. `lost`: points of win chance given up across the calls (as every review shows). */
export function starsFor(win: boolean, lost: number): Stars {
  if (!win) return 0;
  const d = Math.round(decisionQuality(lost));
  return d >= STAR_MARKS[1] ? 3 : d >= STAR_MARKS[0] ? 2 : 1;
}

export const rungTeams = (r: Rung): [TeamInfo, TeamInfo] => {
  const seed = `ladder:${r.id}`;
  return [makeTeam(r.you, seed), makeTeam(r.them, seed)];
};

export function rungParams(r: Rung): SpotParams {
  return { you: r.you, them: r.them, side: r.side, t: r.t, lead: r.score[0] - r.score[1], yl: r.yl, down: r.down, dist: r.dist, to: r.to, running: r.running, home: r.home, weather: r.weather };
}

/**
 * A rung as a game. `attempt` picks the bounces; the spot itself (teams, score, clock, their coordinator) never
 * changes. Everything the newest games play with is on: played overtime and two-point tries, coverage schemes and a
 * defensive coordinator with a tendency.
 */
export function rungScenario(r: Rung, attempt: number): Scenario {
  const seed = `ladder:${r.id}`;
  const teams = rungTeams(r);
  const s = stateFrom(rungParams(r), teams);
  s.score = [r.score[0], r.score[1]];
  s.mix = true;
  s.dx = DEF_AMP;
  s.cov = true;
  s.otPlay = true;
  s.toss = true;
  s.twoPlay = true;
  s.dc = dcFor(seed);
  s.mo = 0;
  return { id: `${seed}:${attempt}`, seed: hash(seed, attempt), mode: 'ladder', teams, home: r.home, start: s, baseWp: r.wp };
}

/** What the ladder keeps for a rung. */
export interface RungRecord {
  stars: Stars;     // best
  best: number;     // best Decisions in a win (0 until one)
  tries: number;
  wins: number;
  last: string;     // date of the last attempt
}

export type LadderProgress = Record<string, RungRecord>;

export const starsOf = (p: LadderProgress | undefined, id: string | undefined): Stars => (id && p?.[id]?.stars) || 0;
export const unlocked = (p: LadderProgress | undefined, i: number) => i === 0 || starsOf(p, LADDER[i - 1]?.id) >= 1;
export const totalStars = (p: LadderProgress | undefined) => LADDER.reduce((a, r) => a + starsOf(p, r.id), 0);

/** Record an attempt. Returns the stars it earned, the rung's best before it, and whether it beat that. */
export function recordAttempt(p: LadderProgress, id: string, win: boolean, lost: number, date: string): { stars: Stars; prev: Stars; better: boolean } {
  const prev = starsOf(p, id);
  const stars = starsFor(win, lost);
  const rec = (p[id] ??= { stars: 0, best: 0, tries: 0, wins: 0, last: date });
  rec.tries++;
  rec.last = date;
  if (win) {
    rec.wins++;
    rec.best = Math.max(rec.best, Math.round(decisionQuality(lost)));
  }
  if (stars > rec.stars) rec.stars = stars;
  return { stars, prev, better: stars > prev };
}
