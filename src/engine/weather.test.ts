/** Weather, run sides, pass modifiers and edited routes must change outcomes the way they are described. */
import { describe, expect, it } from 'vitest';
import { customScenario, genScenario } from './scenario';
import { fgProb, resolveFG, resolveSnap } from './sim';
import { hash, rng } from './rng';
import type { Choice, Look, State, Weather } from './types';

function spot(o: { weather?: Weather; yl?: number; down?: number; dist?: number } = {}): State {
  const s = customScenario({ you: 'ATL', them: 'CHI', side: 'off', t: 300, lead: 0, yl: o.yl ?? 40, down: o.down ?? 1, dist: o.dist ?? 10, to: [3, 3], running: false, home: 0, weather: o.weather }, 'wx').start;
  return { ...s, stage: 'call' };
}
function dist(s: State, play: string, look: Look, ch?: Choice, n = 6000) {
  let comp = 0, att = 0, fum = 0, int = 0, y = 0, oob = 0, sack = 0, big = 0, catchYards = 0;
  for (let i = 0; i < n; i++) {
    const res = resolveSnap(s, play, look, rng(hash(play, i)), ch);
    if (res.kind === 'pass') { att++; if (res.complete) { comp++; catchYards += res.yards; } }
    if (res.fumble) fum++;
    if (res.intercepted) int++;
    if (res.kind === 'sack') sack++;
    if (!res.turnover) y += res.yards;
    if (res.oob) oob++;
    if (res.yards >= 20 && !res.turnover) big++;
  }
  return { comp: comp / Math.max(1, att), fum: fum / n, int: int / n, ypp: y / n, oob: oob / n, sack: sack / n, big: big / n, perCatch: catchYards / Math.max(1, comp) };
}

describe('weather', () => {
  it('is rare: about one game in ten has any', () => {
    const counts: Record<string, number> = {};
    for (let i = 0; i < 2000; i++) { const w = genScenario(`wx:${i}`, 'survivor').start.weather ?? 'clear'; counts[w] = (counts[w] || 0) + 1; }
    expect(counts.clear / 2000).toBeGreaterThan(0.86);
    expect(counts.clear / 2000).toBeLessThan(0.94);
    expect(counts.snow / 2000).toBeLessThan(0.04);
    for (const w of ['rain', 'wind', 'snow']) expect(counts[w]).toBeGreaterThan(0);
  });
  it('snow: harder to catch, far more fumbles', () => {
    const c = dist(spot(), 'dig', 'balanced'), sn = dist(spot({ weather: 'snow' }), 'dig', 'balanced');
    expect(sn.comp).toBeLessThan(c.comp - 0.03);
    const cr = dist(spot(), 'inside_zone', 'balanced', undefined, 12000), sr = dist(spot({ weather: 'snow' }), 'inside_zone', 'balanced', undefined, 12000);
    expect(sr.fum).toBeGreaterThan(cr.fum * 1.8);
  });
  it('rain: deep throws suffer most', () => {
    const c = dist(spot(), 'go', 'balanced'), rn = dist(spot({ weather: 'rain' }), 'go', 'balanced');
    expect(rn.comp).toBeLessThan(c.comp - 0.04);
    const cs = dist(spot(), 'slants', 'balanced'), rs = dist(spot({ weather: 'rain' }), 'slants', 'balanced');
    expect(cs.comp - rs.comp).toBeLessThan(c.comp - rn.comp);
  });
  it('wind: field goals are harder, punts shorter', () => {
    const s = spot({ yl: 65 }), w = spot({ weather: 'wind', yl: 65 });
    let g = 0, gw = 0;
    for (let i = 0; i < 4000; i++) { if (resolveFG(s, 'safe', rng(i)).good) g++; if (resolveFG(w, 'safe', rng(i)).good) gw++; }
    expect(gw / 4000).toBeLessThan(g / 4000 - 0.1);
    expect(fgProb(52, 84)).toBeGreaterThan(fgProb(60, 84));
  });
});

describe('run sides', () => {
  it('against a loaded box the weak side gains more; otherwise the strong side does', () => {
    const s = spot();
    const strong = dist(s, 'power', 'load', { play: 'power', side: 1 }), weak = dist(s, 'power', 'load', { play: 'power', side: -1 });
    expect(weak.ypp).toBeGreaterThan(strong.ypp + 0.4);
    const st2 = dist(s, 'power', 'balanced', { play: 'power', side: 1 }), wk2 = dist(s, 'power', 'balanced', { play: 'power', side: -1 });
    expect(st2.ypp).toBeGreaterThan(wk2.ypp + 0.2);
  });
  it('the chosen side is the side the play goes to', () => {
    const s = spot();
    for (let i = 0; i < 20; i++) {
      expect(resolveSnap(s, 'outside_zone', 'zone', rng(i), { play: 'outside_zone', side: -1 }).side).toBe(-1);
      expect(resolveSnap(s, 'outside_zone', 'zone', rng(i), { play: 'outside_zone', side: 1 }).side).toBe(1);
    }
  });
});

describe('pass modifiers and edited routes', () => {
  it('play action helps against a loaded box and costs a few more sacks', () => {
    const s = spot();
    const plain = dist(s, 'dig', 'load'), pa = dist(s, 'dig', 'load', { play: 'dig', mods: { pa: true } });
    expect(pa.comp).toBeGreaterThan(plain.comp + 0.04);
    expect(pa.sack).toBeGreaterThan(plain.sack);
  });
  it('a roll-out takes sacks away', () => {
    const s = spot();
    expect(dist(s, 'deep_post', 'blitz', { play: 'deep_post', mods: { roll: true } }).sack).toBeLessThan(dist(s, 'deep_post', 'blitz').sack * 0.9);
  });
  it('working the sideline gets out of bounds far more often, for fewer yards after the catch', () => {
    const s = spot();
    const plain = dist(s, 'dig', 'zone'), sl = dist(s, 'dig', 'zone', { play: 'dig', mods: { oob: true } });
    expect(sl.oob).toBeGreaterThan(plain.oob + 0.2);
    expect(sl.perCatch).toBeLessThan(plain.perCatch);
  });
  it('edited routes stick for every receiver and the target uses his edited route', () => {
    const s = spot();
    const ch: Choice = { play: 'dig', target: 'WR2', routes: { WR1: 'go', WR2: 'corner', TE: 'cross' } };
    const res = resolveSnap(s, 'dig', 'man', rng(3), ch);
    expect(res.target).toBe('WR2');
    expect(res.route).toBe('corner');
    expect(res.routes).toEqual(ch.routes);
  });
});
