/**
 * Valuing a decision: for every option, play the rest of the game out many times with the AI coaches and count how
 * often the player's team wins. Each simulation index uses the same seed for every option (common random numbers),
 * so the comparison between options is much less noisy than the raw win rates.
 *
 * What the player could not know is re-drawn per simulation: the defense's real look (the pre-snap read is right
 * about 70% of the time) and, when the player is on defense, the offense's call.
 */
import { advance, aiDefLook, aiOffPlay, clone, simulate, value0 } from './sim';
import { hash, rng, type Rng } from './rng';
import type { Choice, State } from './types';

export const READ_ACCURACY = 0.7;

/** Running sums for one option; divide by n for means. */
export interface OptStat {
  n: number;
  wp: number;    // wins (overtime counted at its odds)
  succ: number;  // the snap moved the chains or scored
  secs: number;  // seconds the decision and its snap used
  give: number;  // possession lost without scoring (not counting punts)
  pts: number;   // immediate net points
}
export const emptyStat = (): OptStat => ({ n: 0, wp: 0, succ: 0, secs: 0, give: 0, pts: 0 });
export function addStat(a: OptStat, b: OptStat): OptStat {
  return { n: a.n + b.n, wp: a.wp + b.wp, succ: a.succ + b.succ, secs: a.secs + b.secs, give: a.give + b.give, pts: a.pts + b.pts };
}
export const mean = (s: OptStat, k: keyof OptStat) => (s.n ? (s[k] as number) / s.n : 0);

export function prepHidden(c: State, s: State, r: Rng) {
  if (s.stage !== 'call') return;
  if (s.off === 0 && s.pendLook) c.pendLook = s.shownLook && r() < READ_ACCURACY ? s.shownLook : aiDefLook(c, r);
  if (s.off === 1 && s.pendPlay && s.pendPlay !== 'fg' && s.pendPlay !== 'punt') c.pendPlay = aiOffPlay(c, r, true);
}

/** Evaluate `choices` at state `s`, simulations `from`..`from + n - 1` of `seed`. */
export function evaluate(s: State, choices: Choice[], n: number, seed: number, from = 0): OptStat[] {
  const out = choices.map(emptyStat);
  const o = s.off;
  const measure = s.stage === 'pre' || s.stage === 'call';
  for (let i = from; i < from + n; i++) {
    const simSeed = hash(seed, i);
    for (let j = 0; j < choices.length; j++) {
      const r = rng(simSeed);
      const c = clone(s);
      prepHidden(c, s, r);
      advance(c, r, choices[j]);
      if (c.stage === 'call' && s.stage === 'pre') advance(c, r);
      const st = out[j];
      if (measure) {
        const scored = c.score[o] - s.score[o];
        st.succ += scored > 0 || (c.off === o && c.down === 1 && c.yl !== s.yl) ? 1 : 0;
        st.secs += s.t - c.t;
        st.give += c.off !== o && scored === 0 && choices[j].play !== 'punt' && c.stage !== 'over' ? 1 : 0;
        st.pts += scored - (c.score[1 - o] - s.score[1 - o]);
      }
      simulate(c, r);
      st.wp += value0(c);
      st.n++;
    }
  }
  return out;
}
