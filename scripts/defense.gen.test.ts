import { it } from 'vitest';
import { genScenario } from '../src/engine/scenario';
import { advance, aiDefLook, aiOffPlay, clone, resolveSnap } from '../src/engine/sim';
import { DEF_CALLS, DEF_PLAYS, goalLineSituation } from '../src/engine/defense';
import { hash, rng } from '../src/engine/rng';
import { ytg } from '../src/engine/sim';
import type { Look, State } from '../src/engine/types';

const legal = (s: State) => DEF_CALLS.filter((k) => !DEF_PLAYS[k].goalOnly || goalLineSituation(s) || ytg(s) <= 10) as Look[];
function snapValue(s: State, play: string, look: Look, n: number, seed: number) {
  let v = 0;
  for (let i = 0; i < n; i++) {
    const r = rng(hash(seed, i));
    const res = resolveSnap(s, play, look, r);
    v += res.td ? 7 : res.turnover ? -5 : res.yards >= s.dist ? 1.5 + res.yards * 0.1 : res.yards * 0.12 - (res.kind === 'sack' ? 0.5 : 0);
  }
  return v / n;
}
it('defense', () => {
  const N = Number(process.env.N || 300);
  for (const pol of ['ai', 'random', 'oracle', 'oracle70'] as const) {
    let scores = 0, stops = 0, td = 0;
    for (let g = 0; g < N; g++) {
      const sc = genScenario(`dtest:${g}`, 'practice', { kind: 'stand' });
      const s = clone(sc.start);
      if (process.env.DX) s.dx = Number(process.env.DX);
      const r = rng(hash(g, 'drive'));
      const s0 = [...s.score];
      for (let i = 0; i < 200 && s.stage !== 'over'; i++) {
        if (s.off === 0 && (s.stage === 'pre' || s.stage === 'call')) break; // possession changed
        if (s.stage === 'kick' || s.stage === 'pat') break;
        let look: Look | undefined;
        if (s.stage === 'call' && s.off === 1) {
          if (!s.pendPlay) s.pendPlay = aiOffPlay(s, r);
          const play = s.pendPlay;
          if (play !== 'fg' && play !== 'punt' && play !== 'kneel' && play !== 'spike') {
            const L = legal(s);
            if (pol === 'ai') look = aiDefLook(s, r);
            else if (pol === 'random') look = L[Math.floor(r() * L.length)];
            else {
              const know = pol === 'oracle' || r() < 0.7;
              const p = know ? play : aiOffPlay(s, r);
              look = L.reduce((b, k) => (snapValue(s, p, k, 30, i) < snapValue(s, p, b, 30, i) ? k : b), L[0]);
            }
          }
        }
        advance(s, r, look ? { look } : null);
      }
      const d = s.score[1] - s0[1];
      if (d > 0) scores++; else stops++;
      if (d >= 6) td++;
    }
    console.log(`${pol}: offense scores ${(scores / N * 100).toFixed(0)}% (TD ${(td / N * 100).toFixed(0)}%), stops ${(stops / N * 100).toFixed(0)}%`);
  }
}, 600000);
