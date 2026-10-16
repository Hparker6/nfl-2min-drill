import { it } from 'vitest';
import { CALLS } from './data';
import { DEF_CALLS } from './defense';
import { customScenario } from './scenario';
import { resolveSnap } from './sim';
import { rng } from './rng';
import { choreograph } from './timeline';
it('dbg', () => {
  const s = { ...customScenario({ you: 'AUS', them: 'PDX', side: 'off', t: 300, lead: 0, yl: 35, down: 1, dist: 10, to: [3, 3], running: false, home: 0 }, 'tl').start, stage: 'call' as const };
  let sacks = 0, sackEvents = 0;
  const bad: Record<string, number> = {};
  for (const c of CALLS) for (let i = 0; i < 30; i++) {
    const res = resolveSnap(s, c.id, DEF_CALLS[i % 7], rng(8000 + i));
    const tl = choreograph({ res, yl0: s.yl, off: s.rat[0], def: s.rat[1], seed: 8000 + i });
    if (res.kind === 'sack') { sacks++; if (tl.events.some((e) => e.kind === 'sack')) sackEvents++; }
    const kinds = tl.events.map((e) => e.kind);
    const last = tl.ball[tl.ball.length - 1];
    const key = (m: string) => { bad[m] = (bad[m] || 0) + 1; };
    if (res.kind === 'run' && !res.safety && !res.td && !res.oob && !res.fumble && !kinds.includes('tackle')) key(`run no tackle ${c.id}`);
    if (res.kind === 'run' && !res.td && Math.abs(last.dy - res.yards) > 0.8) key(`run end mismatch ${c.id} ${last.dy.toFixed(1)} vs ${res.yards}`);
    if (res.kind === 'pass' && res.complete && !res.td && !res.turnover && Math.abs(last.dy - res.yards) > 0.8) key(`catch end mismatch ${c.id} ${last.dy.toFixed(1)} vs ${res.yards} kinds ${kinds.join(',')}`);
    if (res.kind === 'pass' && res.complete && !res.td && !res.oob && !res.fumble && !kinds.includes('tackle')) key(`catch no tackle ${c.id}`);
  }
  console.log({ sacks, sackEvents });
  console.log(Object.entries(bad).slice(0, 25));
});
