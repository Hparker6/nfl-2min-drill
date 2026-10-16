/**
 * Full games (career mode): four quarters, halftime, overtime by the NFL's rules, the AI coaches calling everything
 * the player does not. The same engine as the late-game spots (sim.ts): a full game is a State with q and qLen set.
 */
import { advance, clone, other } from './sim';
import { hash, rng } from './rng';
import type { Ev, Ratings, State, Team, Weather } from './types';

export interface GameOpts {
  seed: number;
  qLen?: number;        // seconds per quarter (900 for a real game)
  po?: boolean;         // playoffs: no ties
  weather?: Weather;
}

/** The opening kickoff: a seeded toss decides who receives. Team 0 and team 1 are whoever the caller says. */
export function kickoffState(rat: [Ratings, Ratings], o: GameOpts): State {
  const qLen = o.qLen ?? 900;
  const rec: Team = rng(hash(o.seed, 'toss'))() < 0.5 ? 0 : 1;
  return {
    t: qLen, off: rec, score: [0, 0], to: [3, 3], down: 1, dist: 10, yl: 25, running: false, stage: 'kick', warned: true,
    adj: 0, kicker: other(rec), safetyKick: false, pendLook: null, shownLook: null, pendPlay: null, k: 0,
    rat, weather: o.weather ?? 'clear', mix: true, q: 1, qLen, po: !!o.po, rec,
  };
}

/** The randomness for one step of a full game: by snap counter, so a game resumed from any point plays the same. */
export const stepRng = (seed: number, s: State) => rng(hash(seed, s.k, 'g'));

/** Advance one step with the AI (or `ch`), keeping the snap counter. */
export function step(seed: number, s: State, ev: Ev[]) {
  advance(s, stepRng(seed, s), null, ev);
  s.k++;
}

/** Play a whole game (or the rest of one) with the AI on both sides. */
export function playOut(seed: number, from: State, ev: Ev[] = []): { s: State; ev: Ev[] } {
  const s = clone(from);
  for (let i = 0; i < 4000 && s.stage !== 'over'; i++) step(seed, s, ev);
  return { s, ev };
}
