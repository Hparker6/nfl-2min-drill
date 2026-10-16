/**
 * The late-game modes must play exactly as they always have: the Daily replays saved games and everyone gets the same
 * spot. This pins a digest of generated spots and AI-played games, so a change for full games (quarters, overtime,
 * the whole-game AI) that leaks into the fourth-quarter engine fails here.
 */
import { describe, expect, it } from 'vitest';
import { dailyScenarios, survivorScenario, DEF_AMP_FROM } from './scenario';
import { advance, clone } from './sim';
import { hash, rng } from './rng';
import type { Ev } from './types';

const DIGEST = 'd98bb4e7';

function digest(): string {
  let h = 0;
  const mix = (v: unknown) => { h = hash(h, JSON.stringify(v)); };
  // the dailies before the defense change (DEF_AMP_FROM): exactly as they were
  const days = Array.from({ length: 12 }, (_, i) => new Date(Date.parse('2026-10-05T00:00:00Z') + i * 864e5).toISOString().slice(0, 10));
  const scs = days.flatMap((d) => dailyScenarios(d));
  for (const sc of scs) {
    mix([sc.id, sc.start.t, sc.start.score, sc.start.yl, sc.start.down, sc.start.dist, Math.round(sc.baseWp * 1e4)]);
    for (let g = 0; g < 25; g++) {
      const s = clone(sc.start);
      const r = rng(hash(sc.seed, g));
      const ev: Ev[] = [];
      for (let i = 0; i < 500 && s.stage !== 'over'; i++) advance(s, r, null, ev);
      mix([s.score, s.t, ev.length]);
    }
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

describe('the late-game engine is unchanged', () => {
  it('turns the defense change on from its first daily, and in survivor', () => {
    expect(dailyScenarios('2026-10-16')[0].start.dx).toBeUndefined();
    expect(dailyScenarios(DEF_AMP_FROM)[0].start.dx).toBeGreaterThan(1);
    expect(survivorScenario(1, 1).start.dx).toBeGreaterThan(1);
  });
  it('generates the same spots and plays the same games', () => {
    expect(digest()).toBe(DIGEST);
  });
});
