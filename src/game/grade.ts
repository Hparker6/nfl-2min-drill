/**
 * Grading a call: compare the player's option with the best option on the board, both valued by simulating the
 * rest of the game. A good call that fails is still a good call. Explanations come from the same simulations: how
 * often each option moved the chains, how much clock it used, how often it gave the ball away.
 */
import { clip } from '../engine/rng';
import { leadOf } from '../engine/sim';
import { mean, type OptStat } from '../engine/evaluate';
import type { Decision, Opt } from './session';

export type GradeKey = 'g' | 'y' | 'o' | 'r';
export const GRADE_INFO: Record<GradeKey, { word: string; emoji: string; glyph: string }> = {
  g: { word: 'Great call', emoji: '🟩', glyph: '✓' },
  y: { word: 'Close', emoji: '🟨', glyph: '≈' },
  o: { word: 'Costly', emoji: '🟧', glyph: '!' },
  r: { word: 'Big miss', emoji: '🟥', glyph: '✗' },
};

/** Points of win chance given up versus the best option. */
export function gradeOf(lost: number): GradeKey {
  return lost <= 0.75 ? 'g' : lost <= 2.5 ? 'y' : lost <= 6 ? 'o' : 'r';
}
/** A 0-100 score for one call. */
export const callScore = (lost: number) => clip(Math.round(100 - lost * 7), 0, 100);

export interface Summary { wp: number; succ: number; secs: number; give: number; pts: number; n: number }
export interface Grade {
  g: GradeKey;
  lost: number;
  score: number;
  wp: number;
  bestWp: number;
  bestKey: string;
  bestLabel: string;
  aiKey: string;
  aiLabel: string;
  aiLost: number;
  why: string[];
  ranked: { key: string; label: string; wp: number }[];  // top options, for the review
}

export const summarize = (s: OptStat): Summary => ({
  wp: mean(s, 'wp'), succ: mean(s, 'succ'), secs: mean(s, 'secs'), give: mean(s, 'give'), pts: mean(s, 'pts'), n: s.n,
});

const pct = (x: number) => `${Math.round(x * 100)}%`;
const secs = (x: number) => `${Math.round(x)}s`;

export function makeGrade(dec: Decision, mine: Opt, mineStat: OptStat, stats: Map<string, OptStat>): Grade {
  const sums = new Map<string, Summary>();
  stats.forEach((v, k) => sums.set(k, summarize(v)));
  const m = summarize(mineStat);
  // the best option, judged on the options with the most simulations (the refined ones) so noise does not pick it
  let bestKey = mine.key, best = m;
  const maxN = Math.max(...[...sums.values()].map((x) => x.n));
  sums.forEach((v, k) => {
    if (v.n >= maxN * 0.9 && v.wp > best.wp) { best = v; bestKey = k; }
  });
  if (m.wp > best.wp) { best = m; bestKey = mine.key; }
  const label = (k: string) => dec.options.find((o) => o.key === k)?.label ?? k;
  const lost = Math.max(0, (best.wp - m.wp) * 100);
  const ai = sums.get(dec.aiKey);
  const aiLost = ai ? Math.max(0, (best.wp - ai.wp) * 100) : 0;
  const ranked = [...sums.entries()]
    .filter(([, v]) => v.n >= maxN * 0.9)
    .sort((a, b) => b[1].wp - a[1].wp)
    .slice(0, 5)
    .map(([k, v]) => ({ key: k, label: label(k), wp: v.wp }));
  const g = gradeOf(lost);
  return {
    g, lost, score: callScore(lost), wp: m.wp, bestWp: best.wp, bestKey, bestLabel: label(bestKey),
    aiKey: dec.aiKey, aiLabel: label(dec.aiKey), aiLost, ranked,
    why: explain(dec, mine.label, label(bestKey), m, best, lost),
  };
}

function explain(dec: Decision, mineL: string, bestL: string, m: Summary, b: Summary, lost: number): string[] {
  const s = dec.state;
  const out: string[] = [];
  const isBest = lost < 0.05;
  const trailing = leadOf(s, 0) <= 0;
  if (dec.step === 'play') {
    if (isBest) {
      out.push(`Best call on the board.`);
      out.push(`It moves the chains or scores ${pct(m.succ)} of the time and uses about ${secs(m.secs)}.`);
      if (m.give >= 0.03) out.push(`It does give the ball away ${pct(m.give)} of the time; the payoff is worth it here.`);
      return out;
    }
    if (b.succ - m.succ >= 0.06) out.push(`${bestL} moves the chains or scores ${pct(b.succ)} of the time; ${mineL} ${pct(m.succ)}.`);
    if (trailing && m.secs - b.secs >= 4) out.push(`${mineL} uses about ${secs(m.secs)} of clock to ${secs(b.secs)} for ${bestL}, and time is what you are short on.`);
    if (!trailing && b.secs - m.secs >= 4) out.push(`${bestL} keeps the clock moving (about ${secs(b.secs)} off it, to ${secs(m.secs)}).`);
    if (m.give - b.give >= 0.015) out.push(`${mineL} gives the ball away ${pct(m.give)} of the time, to ${pct(b.give)}.`);
    if (b.pts - m.pts >= 0.3) out.push(`${bestL} puts more points on the board right away.`);
    if (!out.length) out.push(`The two look alike on this snap; ${bestL} leaves you in a better spot for what comes after.`);
    return out;
  }
  if (dec.step === 'offClock') {
    if (isBest) { out.push('Right way to handle the clock.'); return out; }
    if (trailing && m.secs - b.secs >= 4) out.push(`${mineL} lets about ${secs(m.secs)} run before the next snap is done, to ${secs(b.secs)} with ${bestL}.`);
    else if (!trailing && b.secs - m.secs >= 4) out.push(`${bestL} drains about ${secs(b.secs)} to your ${secs(m.secs)}: every second is one they don't get.`);
    else out.push(`${bestL} spends your clock and timeouts better from here.`);
    return out;
  }
  if (dec.step === 'look') {
    if (isBest) { out.push(`Best look for this spot. They convert ${pct(m.succ)} against it.`); return out; }
    if (m.succ - b.succ >= 0.04) out.push(`They move the chains or score ${pct(m.succ)} of the time against ${mineL}, ${pct(b.succ)} against ${bestL}.`);
    if (b.give - m.give >= 0.01) out.push(`${bestL} forces more turnovers (${pct(b.give)} to ${pct(m.give)}).`);
    if (!out.length) out.push(`${bestL} keeps them further from scoring range.`);
    return out;
  }
  if (isBest) out.push('Best choice here.');
  else out.push(`Over the rest of the game, ${bestL} wins ${pct(b.wp)} of the time; ${mineL} ${pct(m.wp)}.`);
  return out;
}
