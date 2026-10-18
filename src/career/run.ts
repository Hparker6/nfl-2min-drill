/**
 * Your games: the engine state for a game of yours (your team is always side 0), the moments when the game hands
 * you the ball, the AI steps between them, and what a finished game turns into (stats, XP, the week moving on).
 */
import { kickoffState, playOut, step } from '../engine/game';
import { riskWins } from './risk';
import { evaluate } from '../engine/evaluate';
import { clip, hash, rng } from '../engine/rng';
import { SLOTS, type Attr } from '../engine/roster';
import { clone, leadOf } from '../engine/sim';
import type { Ev, Ratings, State, Team, TeamInfo } from '../engine/types';
import type { Scenario } from '../engine/scenario';
import { boxScore, type Box, type Line } from './box';
import {
  awardXp, COLLEGES, draftStock, makeDraft, weeklyGoals, youPlayer, type Career,
} from './career';
import { genPlayer, nameMaker, teamById, teamInfo, teamRatings } from './league';
import { advanceWeek, gameSeed, gameWeather, recordGame, simWeek, withHome, WEEK_NAME, draftOrderFor, REG_WEEKS } from './season';
import type { CPlayer, Game, LiveGame } from './types';

export const COLLEGE_GAME: Game = { id: 'college', week: 0, kind: 'reg', home: 'COLA', away: 'COLB' };

/** The two college teams of your one college game: generated, a level below the league. */
function collegeTeams(c: Career): [TeamInfo, TeamInfo] {
  const r = rng(hash(c.seed, 'college'));
  const used = new Set<string>([c.you.name]);
  const name = nameMaker(rng(hash(c.seed, 'college-names')), used);
  const mk = (id: string, i: number, base: number, you: boolean): TeamInfo => {
    const col = COLLEGES.find((x) => x[0] === (i === 0 ? c.college.you : c.college.them))!;
    const p: Record<string, CPlayer> = {};
    SLOTS.forEach((slot, n) => {
      p[slot] = slot === 'QB' && you ? youPlayer(c) : genPlayer(`${id}-${slot}`, slot, base + (r() - 0.5) * 8, r, name(), 10 + n, null);
    });
    return { id: col[4], city: col[0], name: col[1], color: col[2], color2: col[3], rat: teamRatings(p), players: p };
  };
  return [mk('COLA', 0, 72, true), mk('COLB', 1, 73, false)];
}

/** The teams of one of your games, yours first. */
export function liveTeams(c: Career, g: Game): [TeamInfo, TeamInfo] {
  if (g.id === 'college') return collegeTeams(c);
  const mine = youPlayer(c).team!;
  return [teamInfo(c.league, teamById(c.league, mine)), teamInfo(c.league, teamById(c.league, g.home === mine ? g.away : g.home))];
}

const bump = (rat: Ratings, f: (u: NonNullable<Ratings['units']>) => void): Ratings => {
  if (!rat.units) return rat;
  const u = structuredClone(rat.units);
  f(u);
  return { ...rat, units: u };
};

/** Your abilities and the difficulty, applied to the two sides' ratings. `clutch` adds the late-game boost. */
export function liveRatings(c: Career, g: Game, teams: [TeamInfo, TeamInfo], clutch: boolean): [Ratings, Ratings] {
  const mine = g.id === 'college' ? 'COLA' : youPlayer(c).team;
  const home = g.kind !== 'final' && g.id !== 'college' && g.home === mine;
  const away = g.kind !== 'final' && g.id !== 'college' && g.home !== mine;
  let a = home ? withHome(teams[0].rat) : teams[0].rat;
  let b = away ? withHome(teams[1].rat) : teams[1].rat;
  const ab = c.you.abilities;
  a = bump(a, (u) => {
    if (ab.includes('release')) u.passPro += 4;
    if (ab.includes('escape')) u.qb.mobility += 6;
    if (ab.includes('deep')) u.qb.arm += 5;
    if (clutch && ab.includes('clutch')) { u.qb.accuracy += 5; u.qb.decision += 5; }
  });
  const d = c.settings.diff === 'rookie' ? -3 : c.settings.diff === 'allpro' ? 3 : 0;
  if (d) b = bump(b, (u) => { u.passPro += d; u.runBlock += d; u.passRush += d; u.runDef += d; u.tackling += d; u.pursuit += d; u.qb.accuracy += d; });
  return [a, b];
}

/** The fourth quarter or overtime of a one-score game: when Clutch kicks in. */
export const clutchTime = (s: State) => (s.q ?? 4) >= 4 && Math.abs(leadOf(s, 0)) <= 8;

/** Swap in the clutch ratings when the game gets there (and back out of them if it gets away). */
export function applyClutch(c: Career, live: LiveGame, s: State) {
  if (!c.you.abilities.includes('clutch')) return;
  const g = gameOf(c, live.gameId);
  const teams = liveTeams(c, g);
  s.rat = liveRatings(c, g, teams, clutchTime(s));
}

export const gameOf = (c: Career, id: string): Game => (id === 'college' ? COLLEGE_GAME : c.season.games.find((x) => x.id === id)!);

/** Start one of your games. */
export function startLive(c: Career, g: Game, mode: 'moments' | 'full'): LiveGame {
  const teams = liveTeams(c, g);
  const seed = g.id === 'college' ? hash(c.seed, 'college-game') : gameSeed(c.seed, g);
  const s = kickoffState(liveRatings(c, g, teams, false), {
    seed, qLen: mode === 'full' ? c.settings.qLen : 900, po: g.kind !== 'reg', weather: g.id === 'college' ? 'clear' : gameWeather(g.home, g.week, c.seed), toss: true,
  });
  const live: LiveGame = { gameId: g.id, seed, mode, youAre: 0, s, ev: [] };
  c.live = live;
  return live;
}

/** Is it a moment: does the game hand you the ball here? (Only ever on your offense: you're the quarterback.) */
export function isMoment(c: Career, s: State, mode: 'moments' | 'full'): boolean {
  if (s.off !== 0 || (s.stage !== 'pre' && s.stage !== 'call')) return false;
  if (mode === 'full') return true;
  const q = s.q ?? 4, t = s.t, l = leadOf(s, 0), close = Math.abs(l) <= 8;
  const level = c.settings.moments;
  if (q >= 5) return true;
  if (q === 4 && t <= 180 && l >= -8 && l <= 3) return true;           // the final drive
  if (level === 'few') return false;
  if (q === 2 && t <= 120) return true;                                // the two-minute drill before the half
  if (q === 4 && t <= 420 && close) return true;
  if (q >= 3 && s.yl >= 80 && close) return true;                      // a red-zone trip in a close second half
  if (s.down === 4 && s.yl >= 55 && q >= 2 && Math.abs(l) <= 14) return true;   // fourth down past midfield
  if (level === 'normal') return false;
  if (q >= 3 && Math.abs(l) <= 14) return true;
  return s.yl >= 80;
}

/** A moment lasts until your possession is over: a score's kickoff, a change of possession, overtime's coin toss, or the end of the game. */
export const driveOver = (s: State) => s.stage === 'over' || s.stage === 'kick' || s.stage === 'toss' || ((s.stage === 'pre' || s.stage === 'call') && s.off !== 0);

/** AI steps until a moment (or the end). Returns the events. `max` caps the steps (the tracker plays a few at a time). */
export function simUntilMoment(c: Career, live: LiveGame, max = 4000): Ev[] {
  const out: Ev[] = [];
  const s = live.s;
  for (let i = 0; i < max && s.stage !== 'over'; i++) {
    if (isMoment(c, s, live.mode)) break;
    applyClutch(c, live, s);
    step(live.seed, s, out);
  }
  live.ev.push(...out);
  return out;
}

/** The engine-facing scenario for a moment: GameScreen plays it until your drive is over. */
export function momentScenario(c: Career, live: LiveGame): Scenario {
  const g = gameOf(c, live.gameId);
  const teams = liveTeams(c, g);
  const s = clone(live.seg?.start ?? live.s);
  applyClutch(c, live, s);
  const [st] = evaluate(s, [{}], 120, hash(live.seed, s.k, 'wp'));
  const mine = g.id === 'college' ? 'COLA' : youPlayer(c).team;
  return {
    id: `${live.gameId}:${s.k}`, seed: live.seed, mode: 'career', teams, home: g.home === mine || g.id === 'college' ? 0 : 1, start: s,
    baseWp: st.wp / st.n, until: driveOver, control: (_s, stp) => stp === 'offClock' || stp === 'play' || stp === 'pat' || stp === 'kick',
    readAcc: c.you.abilities.includes('film') ? 0.85 : undefined,
  };
}

/** A moment finished in GameScreen: carry its state and events back into the game. */
export function endMoment(live: LiveGame, s: State, evs: Ev[], scores: number[]) {
  live.s = s;
  live.ev.push(...evs);
  live.scores = [...(live.scores ?? []), ...scores];
  live.risks = [...(live.risks ?? []), ...riskWins(evs)];
  live.seg = undefined;
}

/** Sim the whole game for you (the "Sim" button): no moments, the AI calls your plays too. */
export function simYourGame(c: Career, g: Game): { box: Box; teams: [TeamInfo, TeamInfo] } {
  const live = startLive(c, g, 'moments');
  const s = live.s, out: Ev[] = [];
  for (let i = 0; i < 4000 && s.stage !== 'over'; i++) { applyClutch(c, live, s); step(live.seed, s, out); }
  live.ev = out;
  live.mode = 'moments';
  return finishLive(c, 'sim');
}

/** Box score of a live game. */
export function liveBox(c: Career, live: LiveGame): { box: Box; teams: [TeamInfo, TeamInfo] } {
  const g = gameOf(c, live.gameId);
  const teams = liveTeams(c, g);
  const pid = (side: Team, slot: string) => {
    if (g.id === 'college') return side === 0 && slot === 'QB' ? c.you.pid : `col${side}:${slot}`;
    return teamById(c.league, teams[side].id).roster[slot] ?? `${teams[side].id}:${slot}`;
  };
  return { box: boxScore(live.ev, teams, live.seed, pid), teams };
}

/**
 * The game is over: the box score, the stats, XP, the rest of the week simmed, the week moved on. The college game
 * sets the draft instead.
 */
export function finishLive(c: Career, how: 'sim' | 'moments' | 'full'): { box: Box; teams: [TeamInfo, TeamInfo] } {
  const live = c.live!;
  const g = gameOf(c, live.gameId);
  const { box, teams } = liveBox(c, live);
  const line: Line = box.players[c.you.pid] ?? {};
  const win = box.final[0] > box.final[1];
  const scores = how === 'sim' ? [] : live.scores ?? [];
  const risks = how === 'sim' ? [] : live.risks ?? [];
  if (g.id === 'college') {
    awardXp(c, 'college', line, win, how, scores, 'reg', risks);
    const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
    const stock = draftStock(line, win, avg);
    c.college.result = { score: [box.final[0], box.final[1]], line, stock, grades: scores };
    c.boxes.college = box;
    c.draft = makeDraft(c, draftOrderFor(c.league, c.season, c.seed), stock);
    c.phase = 'draft';
    c.live = undefined;
    return { box, teams };
  }
  recordGame(c.season, g, box, teams, how, c.league);
  c.boxes[g.id] = box;
  awardXp(c, g.id, line, win, how, scores, g.kind, risks);
  const opp = teams[1];
  const big = line.ptd && line.ptd >= 3 ? `, ${line.ptd} touchdown passes` : '';
  c.news.unshift({ week: c.season.week, year: c.season.year, text: `${WEEK_NAME(c.season.week)}: ${teams[0].name} ${win ? 'beat' : box.final[0] === box.final[1] ? 'tie' : 'lose to'} the ${opp.name} ${box.final[0]}-${box.final[1]}${big}.`, tone: win ? 'good' : 'bad' });
  c.live = undefined;
  return { box, teams };
}

/** After your game (or a bye): sim the rest of the week, move on, set new goals. */
export function closeWeek(c: Career) {
  const s = c.season;
  simWeek(c.league, s, c.seed);
  advanceWeek(c.league, s, c.seed);
  c.goals = weeklyGoals(c);
  if (s.week === REG_WEEKS + 1) c.news.unshift({ week: s.week, year: s.year, text: 'The regular season is over. The playoff field is set.', tone: 'neutral' });
  c.news = c.news.slice(0, 60);
}

/** A quick sim of the rest of a live game (leaving in the middle of one). */
export function simRest(c: Career) {
  const live = c.live!;
  playOut(live.seed, live.s, live.ev);
}

export const clampAttr = (v: number) => clip(Math.round(v), 30, 99);
export type { Attr };
