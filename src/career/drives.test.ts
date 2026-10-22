import { describe, expect, it } from 'vitest';
import { drives, fmtSecs } from './drives';
import { kickoffState, playOut } from '../engine/game';
import { genScenario } from '../engine/scenario';
import type { Ev } from '../engine/types';

describe('drives', () => {
  it('formats a length of time without ever showing :60', () => {
    expect(fmtSecs(59.6)).toBe('1:00');
    expect(fmtSecs(179.5)).toBe('3:00');
    expect(fmtSecs(65)).toBe('1:05');
    expect(fmtSecs(-3)).toBe('0:00');
  });
  it('lists every drive snap by its event, in order, each a snap of that drive’s team', () => {
    const s = kickoffState(genScenario('drives:test', 'practice').start.rat, { seed: 7, qLen: 300 });
    const ev: Ev[] = [];
    playOut(7, s, ev);
    const ds = drives(ev);
    expect(ds.length).toBeGreaterThan(4);
    for (const d of ds) {
      expect(d.snaps.length).toBeGreaterThan(0);
      for (let i = 1; i < d.snaps.length; i++) expect(d.snaps[i]).toBeGreaterThan(d.snaps[i - 1]);
      for (const i of d.snaps) { const e = ev[i]; expect(e.type).toBe('snap'); if (e.type === 'snap') expect(e.off).toBe(d.team); }
    }
  });
});
