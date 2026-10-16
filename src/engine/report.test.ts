/**
 * The realism batch: seeded plays across all five categories, every defensive call, both sides of the ball and three
 * rating profiles. It prints the distributions so suspicious ones can be seen, and asserts only the hard rules
 * (results in range, timelines coherent). Run with: npx vitest run src/engine/report.test.ts
 */
import { describe, expect, it } from 'vitest';
import { CALLS } from './data';
import { DEF_CALLS } from './defense';
import { NFL_IDS, realTeam } from './nfl';
import { customScenario } from './scenario';
import { resolveSnap } from './sim';
import { hash, rng } from './rng';
import { choreograph } from './timeline';
import type { Look, State } from './types';

const TAB: Record<string, string> = { run: 'Run', rpo: 'RPO', trick: 'Trick' };
const tabOf = (id: string) => CALLS.find((c) => c.id === id)!.fam === 'pass' ? (['quick_out', 'slants', 'screen', 'mesh', 'boot'].includes(id) ? 'Short Pass' : 'Deep Pass') : TAB[CALLS.find((c) => c.id === id)!.fam];

function spot(you: string, them: string, side: 'off' | 'def'): State {
  const s = customScenario({ you, them, side, t: 300, lead: 0, yl: 35, down: 1, dist: 10, to: [3, 3], running: false, home: 0 }, 'report').start;
  const Y = realTeam(you), T = realTeam(them);
  return { ...s, stage: 'call', rat: side === 'off' ? [Y.rat, T.rat] : [T.rat, Y.rat] };
}

// three profiles: the strongest offense vs the weakest defense, even, and the reverse (by the roster set's own ratings)
const byOff = [...NFL_IDS].sort((a, b) => realTeam(b).rat.off - realTeam(a).rat.off);
const byDef = [...NFL_IDS].sort((a, b) => realTeam(b).rat.def - realTeam(a).rat.def);
const PROFILES = [
  { name: 'top offense vs weak defense', you: byOff[0], them: byDef[byDef.length - 1] },
  { name: 'even', you: byOff[15], them: byDef[16] },
  { name: 'weak offense vs top defense', you: byOff[byOff.length - 1], them: byDef[0] },
];

describe('realism batch', () => {
  it('prints yards, outcomes and timing by category, defense and profile; flags anything out of range', () => {
    const rows: Record<string, { n: number; ypp: number; sack: number; int: number; td: number; big: number; neg: number; secs: number }> = {};
    const flags: string[] = [];
    const N = 120;
    for (const prof of PROFILES) {
      const s = spot(prof.you, prof.them, 'off');
      for (const c of CALLS) for (const look of DEF_CALLS as Look[]) {
        const key = `${prof.name} | ${tabOf(c.id)} | ${look}`;
        const row = (rows[key] ??= { n: 0, ypp: 0, sack: 0, int: 0, td: 0, big: 0, neg: 0, secs: 0 });
        for (let i = 0; i < N / 7; i++) {
          const seed = hash(prof.name, c.id, look, i);
          const res = resolveSnap(s, c.id, look, rng(seed));
          const tl = choreograph({ res, yl0: s.yl, off: s.rat[0], def: s.rat[1], seed });
          row.n++;
          if (!res.turnover) row.ypp += res.yards;
          if (res.kind === 'sack') row.sack++;
          if (res.intercepted) row.int++;
          if (res.td) row.td++;
          if (res.yards >= 20 && !res.turnover) row.big++;
          if (res.yards < 0 && !res.turnover) row.neg++;
          row.secs += tl.end;
          // hard rules
          if (tl.end <= 0 || tl.end > 20) flags.push(`${key}: play lasted ${tl.end.toFixed(1)}s (longer than any real play)`);
          if (Math.abs(res.yards) > 100) flags.push(`${key}: ${res.yards} yards`);
          const ts = tl.events.map((e) => e.t);
          if (ts.some((t, j) => j && t < ts[j - 1] - 1e-9)) flags.push(`${key}: events out of order`);
          if (res.kind === 'pass' && !res.penalty && !tl.events.some((e) => ['catch', 'incomplete', 'int'].includes(e.kind))) flags.push(`${key}: pass with no resolution event`);
        }
      }
    }
    const table = Object.entries(rows).map(([k, r]) => ({ case: k, n: r.n, 'yds/play': +(r.ypp / r.n).toFixed(1), 'sack%': +((r.sack / r.n) * 100).toFixed(1), 'int%': +((r.int / r.n) * 100).toFixed(1), 'td%': +((r.td / r.n) * 100).toFixed(1), '20+%': +((r.big / r.n) * 100).toFixed(1), 'loss%': +((r.neg / r.n) * 100).toFixed(1), secs: +(r.secs / r.n).toFixed(2) }));
    console.table(table);
    // soft checks worth reporting: a category that never loses yards, or a profile that never fails, would be suspicious
    for (const t of table) {
      if (t['yds/play'] > 15) flags.push(`SUSPICIOUS ${t.case}: ${t['yds/play']} yards per play`);
      if (t['td%'] > 25) flags.push(`SUSPICIOUS ${t.case}: ${t['td%']}% touchdowns from the 35`);
      if (t.case.includes('Deep Pass') && t['sack%'] === 0) flags.push(`SUSPICIOUS ${t.case}: no sacks on deep passes`);
    }
    const prof = (name: string) => table.filter((t) => t.case.startsWith(name)).reduce((a, t) => a + t['yds/play'], 0) / table.filter((t) => t.case.startsWith(name)).length;
    console.log('yards per play by profile:', PROFILES.map((p) => `${p.name} (${p.you} vs ${p.them}): ${prof(p.name).toFixed(2)}`).join(' | '));
    console.log(flags.length ? 'FLAGS:\n' + flags.join('\n') : 'no flags');
    expect(flags.filter((f) => !f.startsWith('SUSPICIOUS'))).toEqual([]);
    expect(prof(PROFILES[0].name)).toBeGreaterThan(prof(PROFILES[2].name));
  }, 300_000);

  it('on defense: the same offense against each of your calls, with the AI picking its plays', () => {
    const s = spot('CHI', 'ATL', 'def');
    const rows: Record<string, { n: number; ypp: number; first: number; sack: number; int: number }> = {};
    for (const look of DEF_CALLS as Look[]) {
      const row = (rows[look] = { n: 0, ypp: 0, first: 0, sack: 0, int: 0 });
      for (let i = 0; i < 400; i++) {
        const r = rng(hash('def-report', look, i));
        const plays = CALLS.filter((c) => c.id !== 'hail').map((c) => c.id);
        const play = plays[Math.floor(r() * plays.length)];
        const res = resolveSnap(s, play, look, r);
        row.n++;
        if (!res.turnover) row.ypp += res.yards;
        if (res.yards >= 10) row.first++;
        if (res.kind === 'sack') row.sack++;
        if (res.intercepted) row.int++;
      }
    }
    console.table(Object.entries(rows).map(([k, r]) => ({ defense: k, 'yds allowed/play': +(r.ypp / r.n).toFixed(1), '10+ %': +((r.first / r.n) * 100).toFixed(1), 'sack%': +((r.sack / r.n) * 100).toFixed(1), 'int%': +((r.int / r.n) * 100).toFixed(1) })));
    const ypp = Object.values(rows).map((r) => r.ypp / r.n);
    expect(Math.max(...ypp) - Math.min(...ypp)).toBeGreaterThan(0.4);   // the calls are not interchangeable
  });
});
