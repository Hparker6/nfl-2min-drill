import { describe, expect, it } from 'vitest';
import { newCareer, joinTeam, yourGameThisWeek, youPlayer } from './career';
import { newLeague, teamInfo } from './league';
import { newSeason, leaders, REG_WEEKS } from './season';
import { standings } from './standings';
import { closeWeek, finishLive, simYourGame, startLive, simUntilMoment, COLLEGE_GAME } from './run';
import { playWholeSeason } from './career';
import { step } from '../engine/game';

describe('a league season', () => {
  it('plays 272 games, the playoffs and a champion, with NFL-like spreads', () => {
    const lg = newLeague(42);
    const s = newSeason(lg, 2026, Object.fromEntries(lg.teams.map((t, i) => [t.id, i % 4])), 42);
    const t0 = Date.now();
    playWholeSeason(lg, s, 42);
    const ms = Date.now() - t0;
    expect(s.games.filter((g) => g.kind === 'reg').length).toBe(272);
    expect(s.games.filter((g) => g.kind !== 'reg').length).toBe(13);
    expect(s.champion).toBeTruthy();
    const st = standings(lg.teams, s.games);
    const wins = Object.values(st).map((r) => r.w + r.t / 2).sort((a, b) => a - b);
    // a real spread: someone around 13+ wins, someone at 4 or fewer
    expect(wins[wins.length - 1]).toBeGreaterThanOrEqual(12);
    expect(wins[0]).toBeLessThanOrEqual(5);
    // better teams win more
    const ovr = Object.fromEntries(lg.teams.map((t) => [t.id, teamInfo(lg, t).rat.ovr]));
    const ids = lg.teams.map((t) => t.id).sort((a, b) => ovr[b] - ovr[a]);
    const top = ids.slice(0, 8).reduce((a, id) => a + st[id].w, 0), bot = ids.slice(-8).reduce((a, id) => a + st[id].w, 0);
    expect(top).toBeGreaterThan(bot + 15);
    // the passing leader looks like one: 3,500-5,500 yards
    const py = leaders(lg, s, 'py', 1)[0];
    expect(py.v).toBeGreaterThan(3200);
    expect(py.v).toBeLessThan(6000);
    expect(ms).toBeLessThan(5000);
  });
});

describe('a career', () => {
  it('goes from the college game to the draft to a full season', () => {
    const c = newCareer({ name: 'Test Passer', number: 7, arch: 'pocket', college: 0, seed: 99 });
    expect(c.phase).toBe('college');
    // the college game, simmed
    startLive(c, COLLEGE_GAME, 'moments');
    simUntilMoment(c, c.live!);
    // finish it with the AI calling everything
    const live = c.live!;
    for (let i = 0; i < 5000 && live.s.stage !== 'over'; i++) step(live.seed, live.s, live.ev);
    finishLive(c, 'sim');
    expect(c.phase).toBe('draft');
    expect(c.draft!.yourPick).toBeGreaterThanOrEqual(1);
    joinTeam(c);
    expect(c.phase).toBe('season');
    expect(youPlayer(c).team).toBeTruthy();
    for (let w = 1; w <= 22; w++) {
      const g = yourGameThisWeek(c);
      if (g && !g.score) simYourGame(c, g);
      closeWeek(c);
    }
    expect(c.season.week).toBeGreaterThan(REG_WEEKS);
    expect(c.season.champion).toBeTruthy();
    const me = c.season.stats[c.you.pid];
    expect(me.gp).toBeGreaterThanOrEqual(17);
    expect(me.pa).toBeGreaterThan(300);
    expect(c.you.xp).toBeGreaterThan(2000);
  });
});
