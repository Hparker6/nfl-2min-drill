import { it } from 'vitest';
import { FRANCHISES } from '../src/engine/data';
import { makeTeam } from '../src/engine/scenario';
import { kickoffState, playOut } from '../src/engine/game';
import { boxScore, passerRating, addLine, type Line } from '../src/career/box';

it('calibration', () => {
  const ids = FRANCHISES.map((f) => f[0]);
  const N = Number(process.env.N || 400);
  const tot: Record<string, number> = {};
  const addT = (k: string, v: number) => (tot[k] = (tot[k] || 0) + v);
  const qbAll: Line = {};
  let ties = 0, ots = 0, steps = 0;
  const t0 = Date.now();
  for (let g = 0; g < N; g++) {
    const a = makeTeam(ids[g % ids.length], 's'), b = makeTeam(ids[(g * 7 + 3) % ids.length], 's');
    const s0 = kickoffState([a.rat, b.rat], { seed: g, qLen: Number(process.env.Q || 900) });
    const { s, ev } = playOut(g, s0);
    steps += s.k;
    const box = boxScore(ev, [a, b], g, (t, slot) => `${t}:${slot}`);
    if (box.final[0] === box.final[1]) ties++;
    if (box.ot) ots++;
    for (const t of [0, 1] as const) {
      const T = box.team[t];
      addT('pts', T.pts); addT('yds', T.yds); addT('py', T.py); addT('ry', T.ry); addT('plays', T.plays); addT('to', T.to); addT('sacks', T.sacks); addT('top', T.top);
      addT('att3', T.att3); addT('td3', T.td3); addT('fd', T.fd);
      const qb = box.players[`${t}:QB`]; addLine(qbAll, qb);
      const k = box.players[`${t}:K`]; addT('fga', k.fga || 0); addT('fgm', k.fgm || 0);
      const p = box.players[`${t}:P`]; addT('pn', p.pn || 0);
      addT('rb_ry', box.players[`${t}:RB`].ry || 0);
      let tk = 0; for (const id in box.players) if (id.startsWith(`${t}:`)) tk += box.players[id].tk || 0; addT('tk', tk);
    }
  }
  const per = (k: string) => (tot[k] / (2 * N)).toFixed(1);
  console.log(`games ${N} in ${Date.now() - t0}ms, steps/game ${(steps / N).toFixed(0)}`);
  console.log(`per team: pts ${per('pts')} yds ${per('yds')} pass ${per('py')} rush ${per('ry')} plays ${per('plays')} TO ${per('to')} sacks ${per('sacks')} 1st downs ${per('fd')} TOP ${(tot.top / 2 / N / 60).toFixed(1)}m`);
  console.log(`3rd down ${(tot.td3 / tot.att3 * 100).toFixed(0)}% FG ${(tot.fgm / tot.fga * 100).toFixed(0)}% (${per('fga')} att) punts ${per('pn')} RB rush ${per('rb_ry')} tackles ${per('tk')}`);
  console.log(`QB: comp ${(qbAll.pc! / qbAll.pa! * 100).toFixed(1)}% att/g ${(qbAll.pa! / 2 / N).toFixed(1)} ypa ${(qbAll.py! / qbAll.pa!).toFixed(2)} td/g ${(qbAll.ptd! / 2 / N).toFixed(2)} int/g ${(qbAll.pint! / 2 / N).toFixed(2)} rating ${passerRating(qbAll)}`);
  console.log(`ties ${ties} ot ${ots}`);
}, 600000);
