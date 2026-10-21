/** The clutch ratings, built once per game, are exactly the ones built from scratch, and they follow the score. */
import { describe, expect, it } from 'vitest';
import { newCareer } from './career';
import { COLLEGE_GAME, applyClutch, clutchTime, gameOf, liveRatings, liveTeams, startLive } from './run';
import { step } from '../engine/game';

describe('applyClutch', () => {
  it('gives the same ratings as rebuilding them, snap after snap', () => {
    const c = newCareer({ name: 'Test QB', number: 7, arch: 'pocket', college: 1, seed: 11 });
    c.you.abilities.push('clutch');
    const live = startLive(c, COLLEGE_GAME, 'moments');
    const g = gameOf(c, live.gameId), teams = liveTeams(c, g);
    let checked = 0, clutch = 0;
    for (let i = 0; i < 3000 && live.s.stage !== 'over'; i++) {
      applyClutch(c, live, live.s);
      if (i % 25 === 0) {
        expect(live.s.rat).toEqual(liveRatings(c, g, teams, clutchTime(live.s)));
        checked++;
        if (clutchTime(live.s)) clutch++;
      }
      step(live.seed, live.s, live.ev);
    }
    expect(checked).toBeGreaterThan(5);
    expect(clutch).toBeGreaterThan(0);
  });
});
