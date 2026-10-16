import { it } from 'vitest';
import { newCareer, joinTeam, yourGameThisWeek, youPlayer, upgrade, levelOf } from '../src/career/career';
import { closeWeek, finishLive, simYourGame, startLive, COLLEGE_GAME } from '../src/career/run';
import { step } from '../src/engine/game';
import { standings } from '../src/career/standings';
import { passerRating } from '../src/career/box';
import { leaders } from '../src/career/season';
import { teamInfo } from '../src/career/league';
it('career', () => {
  for (const seed of [1, 2, 3]) {
    const c = newCareer({ name: 'Test Passer', number: 7, arch: (['pocket','gunslinger','dual'] as const)[seed-1], college: seed, seed });
    startLive(c, COLLEGE_GAME, 'moments');
    const live = c.live!;
    for (let i = 0; i < 5000 && live.s.stage !== 'over'; i++) step(live.seed, live.s, live.ev);
    finishLive(c, 'sim');
    const cr = c.college.result!;
    console.log(`college ${cr.score} stock ${cr.stock} line`, JSON.stringify(cr.line), 'pick', c.draft!.yourPick);
    joinTeam(c);
    const team = youPlayer(c).team!;
    console.log('team', team, 'ovr', teamInfo(c.league, c.league.teams.find(t=>t.id===team)!).rat.ovr);
    for (let w = 1; w <= 22; w++) {
      const g = yourGameThisWeek(c);
      if (g && !g.score) simYourGame(c, g);
      closeWeek(c);
      // spend points greedily on accuracy/decision
      for (let k = 0; k < 50; k++) if (!upgrade(c, k % 2 ? 'accuracy' : 'decision')) break;
    }
    const st = standings(c.league.teams, c.season.games)[team];
    const me = c.season.stats[c.you.pid];
    console.log(`record ${st.w}-${st.l}-${st.t} line comp ${me.pc}/${me.pa} ${me.py} yds ${me.ptd} td ${me.pint} int rating ${passerRating(me)} | xp ${c.you.xp} lvl ${levelOf(c.you.xp)} ovr ${youPlayer(c).rating}`, JSON.stringify(youPlayer(c).attrs), 'champ', c.season.champion);
    const top = leaders(c.league, c.season, 'py', 3).map((x) => `${c.league.players[x.id].name}:${x.v}`);
    console.log('py leaders', top.join(', '), '| sacks', leaders(c.league, c.season, 'sck', 1)[0].v, '| tk', leaders(c.league, c.season, 'tk', 1)[0].v, '| int', leaders(c.league, c.season, 'int', 1)[0].v, '| ry', leaders(c.league, c.season, 'ry', 1)[0].v);
  }
}, 600000);
