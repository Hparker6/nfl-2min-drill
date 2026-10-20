// Tuning for the Gridiron Challenge ladder: each rung's starting win chance (the AI coach from the spot), its teams'
// ratings and its legality. Copy the measured wp into src/game/ladder.ts. Run: npx vitest run --dir scripts ladder
import { it } from 'vitest';
import { LADDER, rungScenario } from '../src/game/ladder';
import { evaluate } from '../src/engine/evaluate';
import { checkSpot } from '../src/engine/scenario';
import { hash } from '../src/engine/rng';

it('ladder calibration', () => {
  for (const r of LADDER) {
    const sc = rungScenario(r, 0);
    const [st] = evaluate(sc.start, [{}], 6000, hash('ladder-cal', r.id));
    const [a, b] = sc.teams;
    console.log(`${r.id.padEnd(7)} wp ${(st.wp / st.n).toFixed(3)} | ${a.city} ${a.rat.ovr} (off ${a.rat.off} def ${a.rat.def} qb ${a.rat.qb} k ${a.rat.k}) vs ${b.city} ${b.rat.ovr} (off ${b.rat.off} def ${b.rat.def}) | dc ${sc.start.dc?.style} | ${checkSpot(sc.start).join(', ') || 'legal'}`);
  }
}, 600000);
