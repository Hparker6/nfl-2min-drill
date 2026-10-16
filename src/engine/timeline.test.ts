/**
 * Realism checks for the play timeline. Every case resolves a real snap with the outcome engine, then builds its
 * timeline, and checks football rules across many seeds, calls, defensive calls and rating profiles.
 */
import { describe, expect, it } from 'vitest';
import { CALLS, CALL } from './data';
import { DEF_CALLS } from './defense';
import { DESIGN, designSignature, type Pt } from './formation';
import { customScenario } from './scenario';
import { resolveSnap } from './sim';
import { hash, rng } from './rng';
import { choreograph, type Timeline } from './timeline';
import type { Look, PlayResult, State } from './types';

const SEEDS = 60;
function spotState(seed: string, yl = 35): State {
  const s = customScenario({ you: 'AUS', them: 'PDX', side: 'off', t: 300, lead: 0, yl, down: 1, dist: 10, to: [3, 3], running: false, home: 0 }, seed).start;
  return { ...s, stage: 'call' };
}
function play(s: State, call: string, look: Look, seed: number): { res: PlayResult; tl: Timeline } {
  seed = hash(call, look, seed);   // a separate stream per call and defense
  const res = resolveSnap(s, call, look, rng(seed));
  const tl = choreograph({ res, yl0: s.yl, off: s.rat[0], def: s.rat[1], seed });
  return { res, tl };
}
const at = (tr: [number, number, number][], t: number): Pt => {
  if (t <= tr[0][0]) return [tr[0][1], tr[0][2]];
  for (let i = 1; i < tr.length; i++) if (t <= tr[i][0]) { const f = (t - tr[i - 1][0]) / (tr[i][0] - tr[i - 1][0] || 1); return [tr[i - 1][1] + (tr[i][1] - tr[i - 1][1]) * f, tr[i - 1][2] + (tr[i][2] - tr[i - 1][2]) * f]; }
  const l = tr[tr.length - 1]; return [l[1], l[2]];
};
const d = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const DEFK = ['EDGE1', 'DL1', 'DL2', 'EDGE2', 'LB1', 'LB2', 'LB3', 'CB1', 'CB2', 'S1', 'S2'].map((k) => 'd:' + k);
const OL = ['LT', 'LG', 'C', 'RG', 'RT'].map((k) => 'o:' + k);
const PASSES = CALLS.filter((c) => c.kind === 'pass' && c.id !== 'hail').map((c) => c.id);
const RUNS = CALLS.filter((c) => c.kind === 'run').map((c) => c.id);
const s0 = spotState('tl');

describe('assignments, not a swarm', () => {
  it('offensive linemen hold the pocket on pass plays and do not sprint downfield after the throw', () => {
    for (const call of PASSES.filter((c) => c !== 'screen')) for (let i = 0; i < 25; i++) {
      const { res, tl } = play(s0, call, DEF_CALLS[i % 7], i);
      if (res.kind !== 'pass' || res.penalty) continue;
      for (const k of OL) {
        const tr = tl.tracks[k];
        for (let t = 0; t <= (tl.throwT ?? 0) + 0.5; t += 0.1) {
          const p = at(tr, t);
          expect([call, k, Math.round(t * 10) / 10, p[1] >= -5.5 && p[1] <= 2.5]).toEqual([call, k, Math.round(t * 10) / 10, true]);
        }
        expect(at(tr, tl.end)[1]).toBeLessThanOrEqual(6);
      }
    }
  });
  it('no defender reaches the quarterback before the play develops; on a sack, only the sacker gets there', () => {
    let sacks = 0;
    for (const call of PASSES) for (let i = 0; i < SEEDS; i++) {
      const look = DEF_CALLS[i % 7];
      const { res, tl } = play(s0, call, look, 1000 + i);
      if (res.penalty) continue;
      const qb = tl.tracks['o:QB'];
      const sackEv = tl.events.find((e) => e.kind === 'sack');
      const until = sackEv ? sackEv.t - 0.05 : (tl.throwT ?? 0) * 0.85;
      for (const k of DEFK) {
        if (sackEv && k === sackEv.who) continue;
        for (let t = 0; t <= until; t += 0.1) expect(d(at(tl.tracks[k], t), at(qb, t))).toBeGreaterThan(1.8);
      }
      if (sackEv) {
        sacks++;
        expect(d(at(tl.tracks[sackEv.who!], sackEv.t), at(qb, sackEv.t))).toBeLessThan(1.6);
      }
    }
    expect(sacks).toBeGreaterThan(5);
  });
  it('man coverage stays on its man until the throw; safeties keep their depth', () => {
    for (const call of ['dig', 'go', 'deep_post', 'comeback', 'quick_out']) for (let i = 0; i < 30; i++) {
      const { res, tl } = play(s0, call, 'man', 2000 + i);
      if (res.kind !== 'pass' || res.penalty || !tl.throwT) continue;
      for (let t = 0.6; t <= tl.throwT; t += 0.1) {
        expect(d(at(tl.tracks['d:CB1'], t), at(tl.tracks['o:WR1'], t))).toBeLessThan(5.5);
        expect(d(at(tl.tracks['d:CB2'], t), at(tl.tracks['o:WR2'], t))).toBeLessThan(5.5);
      }
    }
    for (const look of ['zone', 'prevent', 'balanced'] as Look[]) for (const call of ['dig', 'go', 'slants']) for (let i = 0; i < 20; i++) {
      const { res, tl } = play(s0, call, look, 3000 + i);
      if (res.kind !== 'pass' || res.penalty || !tl.throwT) continue;
      for (let t = 0; t <= tl.throwT; t += 0.1) for (const k of ['d:S1', 'd:S2']) expect(at(tl.tracks[k], t)[1]).toBeGreaterThan(8);
    }
  });
  it('on a completion the receiver gets to the catch point first', () => {
    let n = 0;
    for (const call of PASSES) for (let i = 0; i < SEEDS; i++) {
      const { res, tl } = play(s0, call, DEF_CALLS[i % 7], 4000 + i);
      if (!res.complete || res.kind !== 'pass') continue;
      const c = tl.events.find((e) => e.kind === 'catch')!;
      expect(d(at(tl.tracks['o:' + res.target], c.t), c.at!)).toBeLessThan(0.4);
      for (const k of DEFK) expect(d(at(tl.tracks[k], c.t), c.at!)).toBeGreaterThan(0.55);
      n++;
    }
    expect(n).toBeGreaterThan(100);
  });
  it('tackles do not draw a crowd: one tackler, a few nearby, the rest still coming', () => {
    const near: number[] = [];
    for (const call of [...RUNS, 'slants', 'dig', 'screen']) for (let i = 0; i < SEEDS; i++) {
      const { res, tl } = play(s0, call, DEF_CALLS[i % 7], 5000 + i);
      const tk = tl.events.find((e) => e.kind === 'tackle');
      if (!tk || res.turnover) continue;
      const ck = [...tl.carrier].reverse().find((c) => c.t <= tk.t)!.key;
      const cp = at(tl.tracks[ck], tk.t);
      near.push(DEFK.filter((k) => d(at(tl.tracks[k], tk.t), cp) < 2.5).length);
    }
    const avg = near.reduce((a, b) => a + b, 0) / near.length;
    console.log(`defenders within 2.5 yds at the tackle: avg ${avg.toFixed(2)}, max ${Math.max(...near)}, n=${near.length}`);
    expect(avg).toBeLessThan(3.2);
    expect(Math.max(...near)).toBeLessThanOrEqual(6);
  });
  it('a long touchdown leaves the defense behind', () => {
    let n = 0;
    for (const call of ['go', 'deep_post', 'outside_zone', 'toss', 'pa_deep']) for (let i = 0; i < 300 && n < 25; i++) {
      const { res, tl } = play(spotState('tl', 60), call, 'balanced', 6000 + i);
      if (!res.td || res.yards < 20) continue;
      n++;
      const ev = tl.events.find((e) => e.kind === 'td')!;
      const ck = [...tl.carrier].reverse().find((c) => c.t <= ev.t)!.key;
      const cp = at(tl.tracks[ck], ev.t);
      expect(DEFK.filter((k) => d(at(tl.tracks[k], ev.t), cp) < 1.5).length).toBeLessThanOrEqual(1);
    }
    expect(n).toBeGreaterThan(5);
  });
});

describe('timing and event order', () => {
  it('short throws come out faster than deep ones', () => {
    const med = (calls: string[]) => {
      const ts: number[] = [];
      for (const call of calls) for (let i = 0; i < 40; i++) { const { tl } = play(s0, call, 'balanced', 7000 + i); if (tl.throwT) ts.push(tl.throwT); }
      ts.sort((a, b) => a - b);
      return ts[Math.floor(ts.length / 2)];
    };
    const short = med(['slants', 'quick_out', 'screen']), deep = med(['go', 'deep_post', 'pa_deep']);
    console.log(`median time to throw: short ${short.toFixed(2)}s, deep ${deep.toFixed(2)}s`);
    expect(deep - short).toBeGreaterThan(0.8);
  });
  it('every snap tells a coherent story that ends where the engine says', () => {
    const bad: string[] = [];
    for (const call of CALLS.map((c) => c.id)) for (let i = 0; i < 30; i++) {
      const look = DEF_CALLS[i % 7];
      const { res, tl } = play(s0, call, look, 8000 + i);
      const kinds = tl.events.map((e) => e.kind);
      const ts = tl.events.map((e) => e.t);
      if (ts.some((t, j) => j && t < ts[j - 1])) bad.push(`${call} events out of order`);
      if (kinds[0] !== 'snap') bad.push(`${call} no snap`);
      if (res.kind === 'sack' && (!kinds.includes('sack') || kinds.includes('throw'))) bad.push(`${call} sack story`);
      if (res.kind === 'pass' && !res.penalty) {
        const ti = kinds.indexOf('throw'), ci = kinds.findIndex((k) => k === 'catch' || k === 'incomplete' || k === 'int');
        if (ti < 0 || ci < ti) bad.push(`${call} pass story ${kinds}`);
        if (res.complete && !res.td && !res.oob && !res.fumble && !kinds.includes('tackle')) bad.push(`${call} catch with no tackle`);
      }
      if (res.kind === 'run' && !res.safety) {
        if (!kinds.some((k) => k === 'handoff' || k === 'pitch')) bad.push(`${call} run without handoff`);
        if (!res.td && !res.oob && !res.fumble && !kinds.includes('tackle')) bad.push(`${call} run with no tackle`);
        const last = tl.ball[tl.ball.length - 1];
        if (Math.abs(last.dy - Math.min(res.yards, 100 - s0.yl + 1)) > 0.8 && !res.td) bad.push(`${call} run ends at ${last.dy.toFixed(1)} not ${res.yards}`);
      }
      if (res.kind === 'pass' && res.complete && !res.td && !res.turnover) {
        const last = tl.ball[tl.ball.length - 1];
        if (Math.abs(last.dy - res.yards) > 0.8) bad.push(`${call} catch ends at ${last.dy.toFixed(1)} not ${res.yards}`);
      }
    }
    expect(bad.slice(0, 10)).toEqual([]);
  });
  it('the same snap always draws the same play (replays never differ)', () => {
    const a = play(s0, 'dig', 'zone', 42), b = play(s0, 'dig', 'zone', 42);
    expect(JSON.stringify(a.tl)).toBe(JSON.stringify(b.tl));
  });
});

describe('ratings move bodies', () => {
  it('better protection keeps the rush off the quarterback longer', () => {
    const strong = spotState('tl-prot'), weak = spotState('tl-prot');
    strong.rat = [{ ...strong.rat[0], units: { ...strong.rat[0].units!, passPro: 95 } }, { ...strong.rat[1], units: { ...strong.rat[1].units!, passRush: 70 } }];
    weak.rat = [{ ...weak.rat[0], units: { ...weak.rat[0].units!, passPro: 65 } }, { ...weak.rat[1], units: { ...weak.rat[1].units!, passRush: 92 } }];
    const p = (s: State) => { let sum = 0; for (let i = 0; i < 40; i++) sum += play(s, 'go', 'balanced', 9000 + i).tl.pressureT!; return sum / 40; };
    expect(p(strong)).toBeGreaterThan(p(weak) + 1);
  });
  it('a faster receiver gets downfield sooner on the same route', () => {
    const fast = spotState('tl-wr'), slow = spotState('tl-wr');
    const mv = (s: State, sp: number) => ({ ...s.rat[0], units: { ...s.rat[0].units!, move: { ...s.rat[0].units!.move, WR1: { speed: sp, accel: sp, react: 75 } } } });
    fast.rat = [mv(fast, 97), fast.rat[1]];
    slow.rat = [mv(slow, 62), slow.rat[1]];
    const depthAt = (s: State) => { const { tl } = play(s, 'go', 'balanced', 77); return at(tl.tracks['o:WR1'], 1.5)[1]; };
    expect(depthAt(fast)).toBeGreaterThan(depthAt(slow) + 1.2);
  });
});

describe('every call is its own play', () => {
  it('no two calls share a design', () => {
    const sigs = CALLS.map((c) => designSignature(c.id));
    expect(new Set(sigs).size).toBe(sigs.length);
    for (const c of CALLS) expect(DESIGN[c.id]).toBeTruthy();
  });
  it('runs look different on the field: different backs, blockers or holes', () => {
    const tracks = (call: string) => {
      // same result for every call, so only the design can make them differ
      const base = resolveSnap(s0, 'inside_zone', 'balanced', rng(11));
      const res: PlayResult = { ...base, call, carrier: CALL[call].carrier ?? 'RB', yards: 4, td: false, oob: false, fumble: false, turnover: false, side: 1, lane: CALL[call].lane };
      return choreograph({ res, yl0: s0.yl, off: s0.rat[0], def: s0.rat[1], seed: 5 });
    };
    const ids = RUNS.filter((r) => r !== 'sneak');
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const a = tracks(ids[i]), b = tracks(ids[j]);
      let diff = 0;
      for (const k of ['o:RB', 'o:QB', 'o:LG', 'o:RG', 'o:LT', 'o:WR2']) for (let t = 0; t <= 1.2; t += 0.2) diff = Math.max(diff, d(at(a.tracks[k], t), at(b.tracks[k], t)));
      expect([ids[i], ids[j], diff > 1]).toEqual([ids[i], ids[j], true]);
    }
  });
});
