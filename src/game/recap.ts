/**
 * The game's key moments, for the review: your best call (one the AI coach would have missed, if there was one), your
 * costliest call, and the turning point (the play that swung your win chance the most).
 */
import { fmtClock } from './describe';
import type { Record_ } from './session';

export interface Moment { kind: 'best' | 'worst' | 'turn'; title: string; call: string; when: string; text: string }

const pct = (x: number) => `${Math.round(x * 100)}%`;

export function keyMoments(recs: Record_[]): Moment[] {
  const g = recs.filter((r) => r.grade);
  if (g.length < 2) return [];
  const out: Moment[] = [];
  const when = (r: Record_) => `${fmtClock(r.t)} · ${r.situation}`;
  const greens = g.filter((r) => r.grade!.lost < 0.5);
  const best = [...greens].sort((a, b) => b.grade!.aiLost - a.grade!.aiLost || b.grade!.score - a.grade!.score)[0];
  if (best) {
    const ai = best.grade!.aiLost;
    out.push({ kind: 'best', title: 'Best call', call: best.label, when: when(best), text: ai >= 0.5 ? `The AI coach would have called ${best.grade!.aiLabel} and given up ${ai.toFixed(1)} points of win chance. You found the better call.` : 'The best call on the board.' });
  }
  const worst = [...g].sort((a, b) => b.grade!.lost - a.grade!.lost)[0];
  if (worst.grade!.lost >= 1) out.push({ kind: 'worst', title: 'Costliest call', call: worst.label, when: when(worst), text: `${worst.grade!.bestLabel} was better, by ${worst.grade!.lost.toFixed(1)} points of win chance.` });
  let turn: { r: Record_; from: number; to: number } | null = null;
  for (let i = 0; i + 1 < g.length; i++) {
    const from = g[i].grade!.wp, to = g[i + 1].grade!.bestWp;
    if (!turn || Math.abs(to - from) > Math.abs(turn.to - turn.from)) turn = { r: g[i], from, to };
  }
  if (turn && Math.abs(turn.to - turn.from) >= 0.08) {
    out.push({ kind: 'turn', title: 'Turning point', call: turn.r.label, when: when(turn.r), text: `Your win chance went from ${pct(turn.from)} to ${pct(turn.to)} on this one.` });
  }
  return out;
}
