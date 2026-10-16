/** The field shows what was called: the chosen run side, a roll-out, play action and every edited route. */
import { describe, expect, it } from 'vitest';
import { choreograph, routePoints } from './timeline';
import { realTeam } from './nfl';
import { ROUTES } from './data';
import { formation } from './formation';
import type { PlayResult } from './types';

const A = realTeam('ATL').rat, B = realTeam('CHI').rat;
const base = (o: Partial<PlayResult>): PlayResult => ({ kind: 'run', call: 'power', look: 'balanced', carrier: 'RB', yards: 5, oob: false, td: false, safety: false, turnover: false, dur: 5, side: 1, ...o });
const endX = (tl: ReturnType<typeof choreograph>, key: string) => { const tr = tl.tracks[key]; return tr[tr.length - 1][1]; };
const CX = 53.33 / 2;

describe('called adjustments on the field', () => {
  it('a weak-side run goes left of center, a strong-side run goes right', () => {
    const w = choreograph({ res: base({ side: -1 }), yl0: 40, off: A, def: B, seed: 1 });
    const s = choreograph({ res: base({ side: 1 }), yl0: 40, off: A, def: B, seed: 1 });
    expect(endX(w, 'o:RB')).toBeLessThan(CX);
    expect(endX(s, 'o:RB')).toBeGreaterThan(CX);
  });
  it('a roll-out takes the quarterback well outside the pocket before the throw', () => {
    const res = base({ kind: 'pass', call: 'dig', target: 'WR2', route: 'dig', complete: true, air: 12, yards: 14, mods: { roll: true } });
    const tl = choreograph({ res, yl0: 40, off: A, def: B, seed: 2 });
    const qb = tl.tracks['o:QB'];
    const atThrow = qb.filter(([t]) => t <= (tl.throwT ?? 2)).map(([, x]) => Math.abs(x - CX));
    expect(Math.max(...atThrow)).toBeGreaterThan(6);
    const plain = choreograph({ res: { ...res, mods: undefined }, yl0: 40, off: A, def: B, seed: 2 });
    const pq = plain.tracks['o:QB'].filter(([t]) => t <= (plain.throwT ?? 2)).map(([, x]) => Math.abs(x - CX));
    expect(Math.max(...pq)).toBeLessThan(3);
  });
  it('play action sends the back to the mesh point first', () => {
    const res = base({ kind: 'pass', call: 'dig', target: 'WR2', route: 'dig', complete: true, air: 12, yards: 14, mods: { pa: true } });
    const tl = choreograph({ res, yl0: 40, off: A, def: B, seed: 3 });
    const rb = tl.tracks['o:RB'];
    const early = rb.filter(([t]) => t > 0.3 && t < 1.0);
    expect(early.some(([, x, dy]) => Math.abs(x - CX) < 3 && dy > -5)).toBe(true);
  });
  it('edited routes are the routes that get run, for every receiver', () => {
    const res = base({ kind: 'pass', call: 'dig', target: 'WR2', route: 'corner', complete: true, air: 16, yards: 18, routes: { WR1: 'go', WR2: 'corner', TE: 'cross' } });
    const tl = choreograph({ res, yl0: 40, off: A, def: B, seed: 4 });
    const fm = formation('gun');
    const te = tl.tracks['o:TE'];
    // a crosser ends far across the formation from where the tight end lined up
    expect(Math.abs(te[te.length - 1][1] - fm.TE[0])).toBeGreaterThan(10);
    const wr1 = tl.tracks['o:WR1'];
    const d1 = Math.max(...wr1.map(([, , dy]) => dy));
    expect(d1).toBeGreaterThan(ROUTES.go.depth * 0.7);
    void routePoints;
  });
});
