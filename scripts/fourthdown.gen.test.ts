/**
 * Fourth-down decisions, graded the way the game grades them: for a grid of spots (score, distance, field position)
 * with 2:00 left and two timeouts each, the win chance of kicking, punting and the best play, from the engine's own
 * evaluate(). Produces the "Fourth down: kick, punt or go?" table in the how-to-play guide.
 *   N=3000 FD_OUT=<dir> npx vitest run --dir scripts fourthdown --silent=false --reporter=verbose
 */
import { it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { customScenario, type SpotParams } from '../src/engine/scenario';
import { evaluate } from '../src/engine/evaluate';
import { Session } from '../src/game/session';

const LEADS = [{ lead: -3, name: 'Down 3' }, { lead: 0, name: 'Tied' }, { lead: -7, name: 'Down 7' }];
const DISTS = [1, 2, 3, 5, 7, 10];
// yl: yards from your own goal line. 40 = own 40, 50 = midfield, 65 = their 35, 80 = their 20, 97 = their 3
const SPOTS = [{ yl: 40, name: 'Own 40' }, { yl: 50, name: 'Midfield' }, { yl: 65, name: 'Their 35' }, { yl: 80, name: 'Their 20' }, { yl: 97, name: 'Their 3' }];

it('fourth down grid', () => {
  const N = Number(process.env.N || 3000);
  const out: object[] = [];
  for (const L of LEADS) for (const S of SPOTS) for (const dist of DISTS) {
    if (S.yl + dist > 100) continue;
    const p: SpotParams = { you: 'ATL', them: 'CHI', side: 'off', t: 120, lead: L.lead, yl: S.yl, down: 4, dist, to: [2, 2], running: false, home: 0 };
    const sc = customScenario(p, `guide:4th:${L.lead}:${S.yl}:${dist}`);
    const ses = new Session(sc);
    let d = ses.decision();
    if (!d) { ses.auto(); d = ses.decision(); }
    if (!d || d.step !== 'play') { out.push({ lead: L.name, spot: S.name, dist, step: d?.step ?? 'none', note: 'no play decision first' }); continue; }
    const stats = evaluate(d.state, d.options.map((o) => o.choice), N, 11);
    const wps = stats.map((s) => (s.n ? s.wp / s.n : 0));
    const by = (k: string) => { const i = d!.options.findIndex((o) => o.key === k); return i < 0 ? null : +(wps[i] * 100).toFixed(1); };
    const plays = d.options.map((o, i) => ({ o, wp: wps[i] })).filter((x) => !['fg', 'punt', 'kneel', 'spike'].includes(x.o.key));
    const bestPlay = plays.reduce((b, x) => (x.wp > b.wp ? x : b), plays[0]);
    out.push({ lead: L.name, spot: S.name, dist, fg: by('fg'), punt: by('punt'), go: +(bestPlay.wp * 100).toFixed(1), goPlay: bestPlay.o.label, keys: d.options.map((o) => o.key).filter((k) => ['fg', 'punt', 'kneel', 'spike'].includes(k)) });
    const r = out[out.length - 1] as any;
    console.log(`${L.name.padEnd(7)} ${S.name.padEnd(9)} 4th&${String(dist).padEnd(2)} | FG ${r.fg ?? '-'} | punt ${r.punt ?? '-'} | go ${r.go} (${r.goPlay})`);
  }
  const file = join(process.env.FD_OUT || tmpdir(), 'fourthdown.json');
  writeFileSync(file, JSON.stringify(out, null, 1));
  console.log('wrote', file, out.length, 'spots');
}, 3_600_000);
