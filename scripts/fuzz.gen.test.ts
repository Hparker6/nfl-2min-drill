/**
 * A stress run of the engine: thousands of games from every kind of spot, plus full games with quarters and
 * overtime, driven by random (often silly) choices, checking the state after every advance() for the rules the
 * engine must never break. Not a unit test of outcomes: a hunt for NaNs, impossible downs, clocks below zero,
 * possession mix-ups, loops that never end, and non-determinism (the same seed must replay the same).
 *   N=400 npx vitest run --dir scripts fuzz --silent=false --reporter=verbose
 */
import { it, expect } from 'vitest';
import { genScenario, customScenario, type DailyKind, type SpotParams } from '../src/engine/scenario';
import { kickoffState } from '../src/engine/game';
import { advance, clone } from '../src/engine/sim';
import { CALLS } from '../src/engine/data';
import { DEF_CALLS } from '../src/engine/defense';
import { hash, rng } from '../src/engine/rng';
import type { Choice, Ev, State } from '../src/engine/types';

const KINDS: DailyKind[] = ['drill', 'hole', 'tied', 'closeout', 'stand', 'goalline', 'fourthdown'];
const PLAYS = [...CALLS.map((c) => c.id), 'fg', 'punt', 'kneel', 'spike'];
const OFFC = ['nohuddle', 'huddle', 'milk', 'timeout', 'spike', 'kneel', 'drain'] as const;
const DEFC = ['let', 'timeout'] as const;

/** A random choice that could plausibly be offered at this stage (the engine must cope with the implausible too). */
function randomChoice(s: State, r: () => number): Choice | null {
  const pick = <T>(a: readonly T[]) => a[Math.floor(r() * a.length)];
  if (r() < 0.1) return null;   // the AI's own call
  switch (s.stage) {
    case 'pre': return s.off === 0 ? { offClock: pick(OFFC) as Choice['offClock'] } : { defClock: pick(DEFC) as Choice['defClock'] };
    case 'call': return s.off === 0 ? { play: pick(PLAYS), side: r() < 0.5 ? 1 : -1 } : { look: pick(DEF_CALLS) };
    case 'pat': return { pat: r() < 0.5 ? 'xp' : 'two' };
    case 'kick': return { kick: r() < 0.8 ? 'deep' : 'onside' };
    case 'toss': return r() < 0.5 ? { toss: r() < 0.5 ? 'heads' : 'tails' } : { recv: r() < 0.5 };
    default: return null;
  }
}

const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);

function check(s: State, where: string, steps: number) {
  const bad = (m: string) => { throw new Error(`${where} step ${steps}: ${m} :: ${JSON.stringify({ ...s, rat: undefined })}`); };
  for (const k of ['t', 'down', 'dist', 'yl', 'k', 'adj'] as const) if (!num(s[k])) bad(`${k} is ${String(s[k])}`);
  if (!num(s.score[0]) || !num(s.score[1]) || s.score[0] < 0 || s.score[1] < 0) bad('score');
  if (!num(s.to[0]) || !num(s.to[1]) || s.to[0] < 0 || s.to[1] < 0 || s.to[0] > 3 || s.to[1] > 3) bad('timeouts');
  if (s.t < 0) bad('clock below zero');
  if (s.off !== 0 && s.off !== 1) bad('possession');
  if (s.stage !== 'over' && s.stage !== 'kick' && s.stage !== 'pat' && s.stage !== 'toss') {
    if (s.down < 1 || s.down > 4) bad('down');
    if (s.dist < 1 || s.dist > 99) bad('distance');
    if (s.yl < 1 || s.yl > 99) bad('yard line');
    if (s.dist > 100 - s.yl + 0.5) bad('distance past the goal line');
  }
  if (s.q != null) { if (s.q < 1 || !Number.isInteger(s.q)) bad('period'); if (s.qLen != null && s.t > s.qLen) bad('more time than a period'); }
}

function playOut(s: State, seed: number, where: string, max = 1200): { steps: number; evs: Ev[] } {
  const r = rng(hash(seed, 'fuzz'));
  const evs: Ev[] = [];
  let steps = 0;
  while (s.stage !== 'over') {
    if (++steps > max) throw new Error(`${where}: no end after ${max} steps :: ${JSON.stringify({ ...s, rat: undefined })}`);
    const before = s.stage;
    advance(s, r, randomChoice(s, r), evs);
    check(s, where, steps);
    if (s.stage === before && before !== 'call' && before !== 'pre' && steps > 50 && evs.length === 0) throw new Error(`${where}: stuck at ${before}`);
  }
  return { steps, evs };
}

it('late-game spots of every kind survive random play-calling', () => {
  const N = Number(process.env.N || 400);
  let plays = 0;
  for (let i = 0; i < N; i++) {
    const kind = KINDS[i % KINDS.length];
    const sc = genScenario(`fuzz:${kind}:${i}`, i % 3 === 0 ? 'daily' : i % 3 === 1 ? 'survivor' : 'practice', { kind });
    const { steps } = playOut(clone(sc.start), i, `${kind}#${i}`);
    plays += steps;
    // determinism: the same seed replays the same game
    const a = clone(sc.start), b = clone(sc.start);
    playOut(a, i + 7, 'det-a'); playOut(b, i + 7, 'det-b');
    expect(JSON.stringify({ ...a, rat: undefined })).toBe(JSON.stringify({ ...b, rat: undefined }));
  }
  console.log(`spots: ${N} games, ${plays} steps`);
}, 1_800_000);

it('custom spots at the edges of the field and the clock', () => {
  let n = 0;
  for (const yl of [1, 2, 50, 98, 99]) for (const t of [1, 4, 40, 120, 480]) for (const lead of [-14, -3, 0, 3]) for (const side of ['off', 'def'] as const) for (const down of [1, 4]) {
    const p: SpotParams = { you: 'ATL', them: 'CHI', side, t, lead, yl, down, dist: Math.min(10, 100 - yl), to: [n % 4 as 0 | 1 | 2 | 3, 3 - (n % 4) as 0 | 1 | 2 | 3], running: n % 2 === 0, home: 0 };
    const sc = customScenario(p, `fuzz:custom:${n}`);
    playOut(clone(sc.start), n, `custom yl${yl} t${t} lead${lead} ${side} d${down}`);
    n++;
  }
  console.log(`custom spots: ${n}`);
}, 1_800_000);

it('full games with quarters, halftime, tries and overtime end, and end by the rules', () => {
  const N = Number(process.env.N || 400) / 4;
  const sc = genScenario('fuzz:full', 'practice');
  let ot = 0, ties = 0, steps = 0;
  for (let i = 0; i < N; i++) {
    const po = i % 2 === 1;
    const s = kickoffState(sc.start.rat, { seed: 1000 + i, qLen: i % 3 === 0 ? 120 : i % 3 === 1 ? 300 : 60, po, weather: 'clear', toss: i % 4 === 0 });
    const r = playOut(s, 5000 + i, `full#${i} po=${po}`, 4000);
    steps += r.steps;
    if ((s.q ?? 0) >= 5) ot++;
    if (s.score[0] === s.score[1]) { ties++; if (po) throw new Error(`playoff game #${i} ended tied`); }
    // every period event is in order, and a 'final' is last
    const periods = r.evs.filter((e) => e.type === 'period').map((e) => (e as { q: number }).q);
    for (let k = 1; k < periods.length; k++) if (periods[k] <= periods[k - 1]) throw new Error(`full#${i}: periods out of order ${periods}`);
    if (r.evs.length && r.evs[r.evs.length - 1].type !== 'final') throw new Error(`full#${i}: last event is ${r.evs[r.evs.length - 1].type}`);
  }
  console.log(`full games: ${N}, steps ${steps}, overtime ${ot}, regular-season ties ${ties}`);
}, 3_600_000);
