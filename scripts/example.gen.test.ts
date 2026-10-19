/**
 * Plays one Practice spot the way the AI coach would and grades every call against every option, the same way the
 * game does (evaluate from the decision's state), to produce the worked example in the how-to-play guide.
 *   npx vitest run --dir scripts example --silent=false --reporter=verbose
 * Writes example.json next to this file's output in EXAMPLE_OUT (default: the OS temp dir).
 */
import { it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { customScenario, type SpotParams } from '../src/engine/scenario';
import { evaluate } from '../src/engine/evaluate';
import { Session } from '../src/game/session';
import { gradeOf, GRADE_INFO } from '../src/game/grade';
import { tell, headline, fmtClock } from '../src/game/describe';

const SPOT: SpotParams = { you: 'ATL', them: 'CHI', side: 'off', t: 105, lead: -3, yl: 25, down: 1, dist: 10, to: [2, 2], running: false, home: 0 };

it('worked example', () => {
  const N = Number(process.env.N || 3000);
  const sc = customScenario(SPOT, 'guide:example:1');
  const ses = new Session(sc);
  const rows: object[] = [];
  for (let i = 0; i < 40; i++) {
    let d = ses.decision();
    if (!d) { ses.auto(); d = ses.decision(); }   // the game plays its own snaps (the other team's, kicks) until a call is yours
    if (!d) { if (ses.s.stage === 'over') break; continue; }
    const stats = evaluate(d.state, d.options.map((o) => o.choice), N, 7 + i);
    const wps = stats.map((s) => (s.n ? s.wp / s.n : 0));
    const best = Math.max(...wps);
    const pick = d.options.find((o) => o.key === d.aiKey) ?? d.options[0];
    const pi = d.options.indexOf(pick);
    const lost = (best - wps[pi]) * 100;
    const before = { t: fmtClock(d.state.t), down: d.state.down, dist: d.state.dist, yl: d.state.yl, score: [...d.state.score], to: [...d.state.to], head: headline(d.state) };
    const evs = ses.choose(pick);
    const told = evs.map((e) => tell(e, sc.teams)).filter((x) => x.text).map((x) => x.text);
    const ranked = d.options.map((o, k) => ({ key: o.key, label: o.label, wp: +(wps[k] * 100).toFixed(1) })).sort((a, b) => b.wp - a.wp);
    rows.push({ step: d.step, title: d.title, before, call: pick.label, key: pick.key, wp: +(wps[pi] * 100).toFixed(1), best: +(best * 100).toFixed(1), bestCall: ranked[0].label, lost: +lost.toFixed(1), grade: GRADE_INFO[gradeOf(lost)].word, top3: ranked.slice(0, 3), result: told });
    if (ses.s.stage === 'over') break;
  }
  const out = { spot: SPOT, final: ses.result(), rows };
  const file = join(process.env.EXAMPLE_OUT || tmpdir(), 'example.json');
  writeFileSync(file, JSON.stringify(out, null, 1));
  console.log('wrote', file, rows.length, 'decisions, final', JSON.stringify(out.final));
  for (const r of rows as any[]) console.log(`${r.before.t} ${r.before.down}&${r.before.dist} @${r.before.yl} | ${r.call} -> ${r.wp}% (best ${r.bestCall} ${r.best}%) ${r.grade} | ${r.result.join(' / ')}`);
}, 900000);
