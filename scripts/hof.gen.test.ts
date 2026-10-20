// Calibration for Career Legacy: save size by season, and simmed career totals (for the Hall of Fame thresholds).
// Run: npx vitest run --dir scripts hof
import { it } from 'vitest';
import { newCareer, joinTeam, yourGameThisWeek, upgrade } from '../src/career/career';
import { closeWeek, finishLive, simYourGame, startLive, COLLEGE_GAME } from '../src/career/run';
import { endSeason, runOffseason, startNextSeason, offers, signWith } from '../src/career/offseason';
import { step } from '../src/engine/game';
import { passerRating } from '../src/career/box';

it('legacy calibration', () => {
  for (const seed of [11, 12, 13]) {
    const c = newCareer({ name: 'Test Passer', number: 7, arch: (['pocket', 'gunslinger', 'dual'] as const)[seed % 3], college: seed % 8, seed });
    startLive(c, COLLEGE_GAME, 'moments');
    const live = c.live!;
    for (let i = 0; i < 5000 && live.s.stage !== 'over'; i++) step(live.seed, live.s, live.ev);
    finishLive(c, 'sim');
    joinTeam(c);
    const sizes: string[] = [];
    for (let yr = 0; yr < 15; yr++) {
      for (let w = 1; w <= 22; w++) {
        const g = yourGameThisWeek(c);
        if (g && !g.score) simYourGame(c, g);
        closeWeek(c);
        for (let k = 0; k < 50; k++) if (!upgrade(c, (['accuracy', 'decision', 'arm'] as const)[k % 3])) break;
      }
      const full = JSON.stringify(c).length;
      endSeason(c);
      runOffseason(c);
      const o = offers(c);
      if (o.length) signWith(c, o[0].team, o[0].years, o[0].salary);
      startNextSeason(c);
      sizes.push(`${yr + 1}:${(full / 1024).toFixed(0)}k/${Object.keys(c.league.players).length}p`);
    }
    const tot = c.history.reduce((a, h) => { for (const k in h.line) a[k] = (a[k] ?? 0) + (h.line as Record<string, number>)[k]; return a; }, {} as Record<string, number>);
    const titles = c.history.filter((h) => h.playoff === 'Won the Gridiron Bowl').length;
    const awards = c.history.flatMap((h) => h.awards);
    console.log(`seed ${seed} sizes ${sizes.join(' ')}`);
    console.log(`  totals py ${tot.py} ptd ${tot.ptd} pint ${tot.pint} rating ${passerRating(tot)} wins ${c.history.reduce((a, h) => a + h.w, 0)} titles ${titles} awards ${awards.join('|')}`);
    console.log('  seasons', c.history.map((h) => `${h.year}:${h.w}-${h.l} ${h.line.py}y ${h.line.ptd}td ovr${h.ovr} ${h.playoff ?? ''}`).join(' ; '));
  }
}, 1800000);
