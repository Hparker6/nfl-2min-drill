/**
 * The Coach's Playbook, balanced: each play's average yards and turnover rate next to the base playbook, and how often
 * a playbook play is the best call on the board (it should be the best sometimes, not most of the time).
 *   npx vitest run --dir scripts playbook --silent=false
 */
import { it } from 'vitest';
import { customScenario, genScenario } from '../src/engine/scenario';
import { resolveSnap, clone } from '../src/engine/sim';
import { evaluate } from '../src/engine/evaluate';
import { hash, rng } from '../src/engine/rng';
import { Session } from '../src/game/session';

it('the playbook plays, next to the base ones', () => {
  const s0 = customScenario({ you: 'KC', them: 'BUF', side: 'off', t: 300, lead: 0, yl: 45, down: 1, dist: 10, to: [3, 3], running: false, home: 0 }, 'pb:bal').start;
  const plays = ['slants', 'dig', 'screen', 'outside_zone', 'reverse', 'wr_pass', 'flea', 'hook_ladder', 'statue', 'hb_pass', 'fake_punt'];
  const looks = ['balanced', 'zone', 'man', 'blitz', 'cover4', 'prevent'] as const;
  const rows: string[] = [];
  for (const play of plays) {
    let yd = 0, to = 0, big = 0, n = 0;
    for (let i = 0; i < 6000; i++) {
      const s = clone(s0); if (play === 'fake_punt') { s.down = 4; s.dist = 3; }
      const r = rng(hash('pb', play, i));
      const res = resolveSnap(s, play, looks[i % looks.length], r);
      n++; if (res.turnover) to++; else if (!res.penalty) { yd += res.yards; if (res.yards >= 20) big++; }
    }
    rows.push(`${play.padEnd(13)} ${(yd / n).toFixed(1).padStart(5)} yd/play  ${(100 * to / n).toFixed(1).padStart(4)}% turnovers  ${(100 * big / n).toFixed(1).padStart(4)}% 20+`);
  }
  console.log(rows.join('\n'));
});

it('how often a playbook play is the best call', () => {
  let best = 0, spots = 0;
  for (let i = 0; i < 60; i++) {
    const sc = genScenario(`pb:best:${i}`, 'practice');
    if (sc.start.off !== 0) continue;
    const start = { ...clone(sc.start), pb: true };
    const ses = new Session({ ...sc, start }, []);
    let d = ses.decision();
    // past the tempo call (a huddle) to the play itself
    for (let k = 0; k < 3 && d && d.step !== 'play'; k++) { const o = d.options.find((x) => x.key === 'huddle') ?? d.options[0]; ses.choose(o); d = ses.decision(); }
    const dec = d && d.step === 'play' ? d : null;
    if (!dec) continue;
    const st = evaluate(dec.state, dec.options.map((o) => o.choice), 120, hash('pbbest', i));
    let bi = 0; st.forEach((x, k) => { if (x.wp / x.n > st[bi].wp / st[bi].n) bi = k; });
    spots++; if (dec.options[bi].premium) best++;
  }
  process.stdout.write(`playbook play best in ${best} of ${spots} spots (${Math.round(100 * best / Math.max(1, spots))}%)
`);
}, 600_000);
