import { describe, expect, it } from 'vitest';
import { newCareer, joinTeam, yourGameThisWeek, youPlayer } from './career';
import { closeWeek, finishLive, simYourGame, startLive, COLLEGE_GAME } from './run';
import { endSeason, offers, runOffseason, signWith, startNextSeason, tradeTargets } from './offseason';
import { teamInfo } from './league';
import { SLOTS } from '../engine/roster';
import { step } from '../engine/game';

function playSeason(c: ReturnType<typeof newCareer>) {
  for (let w = 1; w <= 22; w++) {
    const g = yourGameThisWeek(c);
    if (g && !g.score) simYourGame(c, g);
    closeWeek(c);
  }
}

describe('seasons in a row', () => {
  it('ages the league, fills every roster, keeps team strength steady, and handles your contract', () => {
    const c = newCareer({ name: 'Long Career', number: 12, arch: 'general', college: 2, seed: 7 });
    startLive(c, COLLEGE_GAME, 'moments');
    for (let i = 0; i < 5000 && c.live!.s.stage !== 'over'; i++) step(c.live!.seed, c.live!.s, c.live!.ev);
    finishLive(c, 'sim');
    joinTeam(c);
    const avgOvr = () => c.league.teams.reduce((a, t) => a + teamInfo(c.league, t).rat.ovr, 0) / 32;
    const first = avgOvr();
    for (let yr = 0; yr < 4; yr++) {
      playSeason(c);
      endSeason(c);
      expect(c.season.awards!.find((a) => a.key === 'mvp')).toBeTruthy();
      runOffseason(c);
      for (const t of c.league.teams) for (const slot of SLOTS) expect(c.league.players[t.roster[slot]]?.team).toBe(t.id);
      if (c.you.contract!.years === 0) {
        const o = offers(c);
        expect(o.length).toBeGreaterThan(0);
        signWith(c, o[0].team, o[0].years, o[0].salary);
      }
      startNextSeason(c);
      expect(youPlayer(c).team).toBeTruthy();
      expect(c.league.teams.find((t) => t.id === youPlayer(c).team)!.roster.QB).toBe('you');
    }
    expect(c.history.length).toBe(4);
    expect(Math.abs(avgOvr() - first)).toBeLessThan(4);
    // a trade, when someone would take him
    const targets = tradeTargets(c);
    if (targets.length) {
      const before = youPlayer(c).team;
      signWith(c, targets[0], c.you.contract!.years, c.you.contract!.salary, true);
      expect(youPlayer(c).team).toBe(targets[0]);
      expect(c.league.teams.find((t) => t.id === before)!.roster.QB).not.toBe('you');
    }
  });
});
