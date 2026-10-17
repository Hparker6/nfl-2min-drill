/**
 * Media day before the draft (Madden's Superstar mode has its own version): three game-situation questions at the
 * podium. Each right answer lifts your draft stock, each wrong one lowers it, so draft night starts with something you
 * did rather than something that happened to you.
 */
import { clip, hash, rng } from '../engine/rng';
import { makeDraft, type Career } from './career';

export interface MediaQ { q: string; a: string[]; right: number; why: string }

/** Situations the game itself models (the clock, fourth downs, reading the defense). The right answer is listed first. */
export const MEDIA_QS: MediaQ[] = [
  { q: 'Down 2, 0:35 left, no timeouts. Your receiver is tackled in bounds at their 22. What now?', a: ['Spike it to stop the clock', 'Huddle up and call a run', 'Take a knee'], right: 0, why: 'No timeouts and the clock running: a spike stops it for the price of a down, and a field goal wins it.' },
  { q: 'Up 4, 1:50 left, they have no timeouts, your ball. How do you finish it?', a: ['Run it and stay in bounds', 'Take a shot deep', 'Spike it'], right: 0, why: 'Every snap that stays in bounds burns about 40 seconds. Kneel or run, and give them nothing.' },
  { q: 'Tied, 0:06 left, ball at their 18, one timeout. The call?', a: ['Kick the field goal', 'Throw to the end zone', 'Run it up the middle'], right: 0, why: 'A 35-yard try wins it; a throw risks a pick or the clock running out.' },
  { q: '4th & 1 at midfield, down 5, 3:00 left, one timeout. Punt, kick or go?', a: ['Go for it', 'Punt it away', 'Try a 67-yard field goal'], right: 0, why: 'Down five you need a touchdown, and a punt may never get the ball back with enough time.' },
  { q: 'Inside the last two minutes, which of these stops the clock?', a: ['An incomplete pass', 'A first down', 'A run that stays in bounds'], right: 0, why: 'In the pros a first down no longer stops the clock; an incompletion or getting out of bounds does.' },
  { q: 'Cover 0: everyone rushing, nobody deep. Where does the ball go?', a: ['A quick throw to the open receiver', 'A seven-step drop and a deep shot', 'A handoff up the middle'], right: 0, why: 'Six or seven rushers means somebody is uncovered: get it out before the rush gets home.' },
  { q: 'Down 3, 0:45 left, your own 25, two timeouts. What are you playing for?', a: ['Field-goal range', 'A touchdown or nothing', 'Overtime: kneel and see'], right: 0, why: 'A field goal ties it. Get to the opponent’s 35 and keep a timeout for the kick.' },
  { q: 'Eight defenders crowd the line before the snap. Best answer?', a: ['Play-action or a throw', 'Run it straight at them', 'A quarterback sneak'], right: 0, why: 'A loaded box stops the run and leaves fewer defenders in coverage.' },
];

export const MEDIA_RIGHT = 3, MEDIA_WRONG = -2;

/** This career's three questions, with the answers in a shuffled order (still the same questions after a reload). */
export function mediaQuestions(seed: number): MediaQ[] {
  const r = rng(hash(seed, 'media'));
  const pool = [...MEDIA_QS];
  const out: MediaQ[] = [];
  while (out.length < 3) {
    const q = pool.splice(Math.floor(r() * pool.length), 1)[0];
    const order = q.a.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    out.push({ ...q, a: order.map((i) => q.a[i]), right: order.indexOf(q.right) });
  }
  return out;
}

/** Media day is done: the stock moves and the board is redrawn from the new stock (before any pick is shown). */
export function finishMediaDay(c: Career, right: number, wrong: number) {
  const d = c.draft!;
  if (d.media != null) return;
  const base = d.stock ?? c.college.result?.stock ?? 50;
  const delta = right * MEDIA_RIGHT + wrong * MEDIA_WRONG;
  const stock = clip(base + delta, 2, 99);
  c.draft = { ...makeDraft(c, d.order, stock), media: delta };
  if (c.college.result) c.college.result.stock = stock;
}
