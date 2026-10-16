/**
 * Generates src/data/percentiles.json: the Performance scores of a population of simulated play-callers on a spread
 * of daily-style spots, so the game can say "better than X% of simulated play-callers" without a server.
 *
 * The population: coaches of varying quality. Each decision, a coach of quality q picks the best-graded option with
 * probability q, otherwise a random one. q is spread evenly from 0.25 (near-random) to 0.95 (near-optimal).
 *
 * Run:  npm run percentiles      (a few minutes; not part of the normal test run)
 */
import { writeFileSync } from 'fs';
import { it } from 'vitest';
import { evaluate, type OptStat } from '../src/engine/evaluate';
import { DAILY_KINDS, genScenario, type DailyKind } from '../src/engine/scenario';
import { hash, rng } from '../src/engine/rng';
import { makeGrade } from '../src/game/grade';
import { rateSpot, spotResult } from '../src/game/rating';
import { Session } from '../src/game/session';

it('builds the percentile table', () => {
  const kinds = Object.keys(DAILY_KINDS) as DailyKind[];
  const scores: number[] = [];
  const SPOTS = 42, COACHES = 5, SIMS = 120;
  for (let i = 0; i < SPOTS; i++) {
    const sc = genScenario(`pct:${i}`, 'daily', { kind: kinds[i % kinds.length] });
    for (let c = 0; c < COACHES; c++) {
      const q = 0.25 + (0.7 * c) / (COACHES - 1);
      const r = rng(hash('coach', i, c));
      const ses = new Session(sc);
      for (let g = 0; g < 400 && !ses.over; g++) {
        const d = ses.decision();
        if (!d) { ses.auto(); continue; }
        const raw = evaluate(d.state, d.options.map((o) => o.choice), SIMS, hash('pct', i, c, g));
        const stats = new Map<string, OptStat>(d.options.map((o, k) => [o.key, raw[k]]));
        const order = [...d.options].sort((a, b) => stats.get(b.key)!.wp - stats.get(a.key)!.wp);
        const pick = r() < q ? order[0] : order[Math.floor(r() * order.length)];
        ses.choose(pick, makeGrade(d, pick, stats.get(pick.key)!, stats));
      }
      scores.push(rateSpot(spotResult(ses, '2026-01-01')).performance);
    }
  }
  scores.sort((a, b) => a - b);
  writeFileSync('src/data/percentiles.json', JSON.stringify({ built: new Date().toISOString().slice(0, 10), population: 'simulated play-callers of mixed quality on daily-style spots', n: scores.length, scores }));
  const q = (p: number) => scores[Math.floor(p * (scores.length - 1))];
  console.log(`n=${scores.length} p10=${q(0.1)} p25=${q(0.25)} median=${q(0.5)} p75=${q(0.75)} p90=${q(0.9)} max=${scores[scores.length - 1]}`);
}, 1_800_000);
