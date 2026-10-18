/**
 * AI rivals: a cast of computer play-callers on every Daily's board, so there is always somebody good to chase. They
 * are always labeled as AI (never mixed into the human count, rank or histogram), and their scores are honest: each
 * is a Performance score from the game's own simulated play-callers (src/data/percentiles.json, made by
 * scripts/percentiles.gen.test.ts), drawn at the rival's skill level with that rival's day-to-day swing. A different
 * group shows up each day, and the same date gives everyone the same rivals and scores.
 */
import PCT from '../data/percentiles.json';
import { hash, rng } from '../engine/rng';

export interface Rival { id: string; name: string; style: string; score: number }

/** skill: where in the simulated population the rival plays (0-1); swing: how much a day can move that. */
const ROSTER: { id: string; name: string; style: string; skill: number; swing: number }[] = [
  { id: 'prof', name: 'The Professor', style: 'Never wastes a second', skill: 0.95, swing: 0.04 },
  { id: 'surgeon', name: 'Clock Surgeon', style: 'Timeouts like a scalpel', skill: 0.9, swing: 0.06 },
  { id: 'film', name: 'Film Room Fiona', style: 'Reads it before the snap', skill: 0.86, swing: 0.07 },
  { id: 'river', name: 'Riverboat Ray', style: 'Goes for it on fourth', skill: 0.8, swing: 0.18 },
  { id: 'tess', name: 'Two-Minute Tess', style: 'Lives on the sideline routes', skill: 0.76, swing: 0.08 },
  { id: 'blitz', name: 'Blitz Betty', style: 'Sends everybody', skill: 0.66, swing: 0.2 },
  { id: 'eddie', name: 'Steady Eddie', style: 'Takes the easy throw', skill: 0.62, swing: 0.04 },
  { id: 'gus', name: 'Gunslinger Gus', style: 'Every snap is a shot', skill: 0.58, swing: 0.24 },
  { id: 'pete', name: 'Prevent Pete', style: 'Keeps it in front, mostly', skill: 0.5, swing: 0.08 },
  { id: 'earl', name: 'Old School Earl', style: 'Runs it, runs it again', skill: 0.45, swing: 0.1 },
  { id: 'rick', name: 'Rookie Rick', style: 'Still learning the clock', skill: 0.3, swing: 0.12 },
  { id: 'carl', name: 'Coin Flip Carl', style: 'Calls whatever', skill: 0.18, swing: 0.15 },
];

const SCORES = [...(PCT as { scores: number[] }).scores].sort((a, b) => a - b);
const quantile = (q: number) => SCORES[Math.min(SCORES.length - 1, Math.max(0, Math.round(q * (SCORES.length - 1))))];

/** How many rivals play a given day: most of the cast, never all, so the board changes. */
export const RIVALS_PER_DAY = 8;

/** The day's AI rivals, best score first. Always includes one of the top three, so there's a high bar to chase. */
export function rivalsFor(date: string): Rival[] {
  const r = rng(hash('rivals', date));
  const order = ROSTER.map((x) => ({ x, k: r() })).sort((a, b) => a.k - b.k).map((o) => o.x);
  const picked = order.slice(0, RIVALS_PER_DAY);
  if (!picked.some((x) => x.skill >= 0.86)) picked[RIVALS_PER_DAY - 1] = ROSTER[Math.floor(r() * 3)];
  return picked
    .map((x) => {
      const day = rng(hash('rival', x.id, date));
      const q = Math.max(0, Math.min(1, x.skill + (day() * 2 - 1) * x.swing));
      return { id: x.id, name: x.name, style: x.style, score: quantile(q) };
    })
    .sort((a, b) => b.score - a.score);
}

/** How a score did against the day's rivals: how many it beat (ties don't count). */
export function versusRivals(score: number, rivals: Rival[]): { beat: number; of: number } {
  return { beat: rivals.filter((x) => score > x.score).length, of: rivals.length };
}
