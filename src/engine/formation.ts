/**
 * Play design: where everyone lines up and what each call asks of them.
 *
 * Coordinates are in the offense's frame: x is yards from the offense's left sideline (0-53.3), dy is yards past
 * the line of scrimmage (negative = backfield). The renderer maps this frame onto the field.
 *
 * Each of the 27 calls has its own design: formation, blocking scheme, ball carrier or target, how the quarterback
 * plays it, and how long it takes to develop. timeline.ts turns a design plus the engine's resolved result into
 * movement; designSignature() is what the tests use to check that no two calls are the same play under two names.
 */
import { CALL } from './data';
import { famOf } from './defense';
import type { Look, Rcv } from './types';

export const W = 53.33;
export const CX = W / 2;
export type Pt = [number, number];

export type FormationId = 'gun' | 'trips' | 'empty' | 'single' | 'iform' | 'pistol' | 'heavy' | 'bunch' | 'wildcat';

const LINE: Record<string, Pt> = { LT: [CX - 4.2, -1.4], LG: [CX - 2.1, -1.4], C: [CX, -1.3], RG: [CX + 2.1, -1.4], RT: [CX + 4.2, -1.4] };

/** Offensive alignments. Linemen never move between formations; skill players do. */
export function formation(id: FormationId): Record<string, Pt> {
  const base: Record<string, Pt> = { ...LINE, QB: [CX, -5.4], RB: [CX - 2, -5.8], TE: [CX + 6.6, -1.6], WR1: [5, -1.4], WR2: [W - 5, -1.4], WR3: [13, -2] };
  switch (id) {
    case 'gun': return base;
    case 'trips': return { ...base, WR3: [W - 13, -2], TE: [W - 17, -1.8], RB: [CX - 2, -5.8] };
    case 'empty': return { ...base, RB: [17, -1.8], TE: [W - 13, -2], WR3: [10, -1.6] };
    case 'single': return { ...base, QB: [CX, -1.7], RB: [CX, -6.8] };
    case 'iform': return { ...base, QB: [CX, -1.7], RB: [CX, -7.4], WR3: [CX, -4.6] };    // slot receiver as the lead back
    case 'pistol': return { ...base, QB: [CX, -4.2], RB: [CX, -7.2] };
    case 'heavy': return { ...base, QB: [CX, -1.7], RB: [CX, -5.6], WR3: [CX - 6.6, -1.6], WR1: [9, -1.4], WR2: [W - 9, -1.4] };
    case 'bunch': return { ...base, WR2: [W - 12, -1.4], WR3: [W - 13.5, -2.6], TE: [W - 10.5, -2.6] };
    case 'wildcat': return { ...base, QB: [W - 13, -1.6], RB: [CX, -5.4], WR3: [CX - 2, -5.8] };
  }
}

/** Defensive alignments for each call (what the offense sees before the snap). */
export function defAlign(call: Look | null): Record<string, Pt> {
  const look = call ? famOf(call) : null;
  const s: Record<string, Pt> = {
    EDGE1: [CX - 5.6, 1.4], DL1: [CX - 1.7, 1.4], DL2: [CX + 1.7, 1.4], EDGE2: [CX + 5.6, 1.4],
    LB1: [CX - 4.8, 5], LB2: [CX, 5.5], LB3: [CX + 4.8, 5], CB1: [5, 6], CB2: [W - 5, 6], S1: [CX - 9, 13], S2: [CX + 9, 13],
  };
  if (look === 'load') { s.LB1 = [CX - 4, 4]; s.LB2 = [CX, 4.2]; s.LB3 = [CX + 4, 4]; s.S2 = [CX + 7, 6]; s.CB1 = [5, 5]; s.CB2 = [W - 5, 5]; }
  if (look === 'blitz') { s.LB1 = [CX - 3.2, 2.6]; s.LB3 = [CX + 3.6, 2.6]; s.LB2 = [CX, 4.2]; s.S1 = [CX - 8, 11]; s.CB1 = [5, 2.8]; s.CB2 = [W - 5, 2.8]; }
  if (look === 'zone') { s.CB1 = [5, 7.5]; s.CB2 = [W - 5, 7.5]; s.LB1 = [CX - 6, 6]; s.LB3 = [CX + 6, 6]; s.S1 = [CX - 10, 14]; s.S2 = [CX + 10, 14]; }
  if (look === 'man') { s.CB1 = [5, 1.6]; s.CB2 = [W - 5, 1.6]; s.LB1 = [13, 3.2]; s.LB3 = [CX + 6.6, 3.4]; s.LB2 = [CX - 1.5, 5]; s.S1 = [CX, 14]; s.S2 = [CX + 3, 8]; }
  if (look === 'goal') { s.LB1 = [CX - 3.5, 2.3]; s.LB2 = [CX, 2.3]; s.LB3 = [CX + 3.5, 2.3]; s.CB1 = [6, 2.5]; s.CB2 = [W - 6, 2.5]; s.S1 = [CX - 7, 4]; s.S2 = [CX + 7, 4]; }
  if (look === 'prevent') { s.LB1 = [CX - 5, 6.5]; s.LB2 = [CX, 7]; s.LB3 = [CX + 5, 6.5]; s.CB1 = [5, 9]; s.CB2 = [W - 5, 9]; s.S1 = [CX - 8, 17]; s.S2 = [CX + 8, 17]; }
  // the plays built on a family: where they differ before the snap
  switch (call) {
    case 'cover4': s.CB1 = [5, 9]; s.CB2 = [W - 5, 9]; s.S1 = [CX - 12, 13]; s.S2 = [CX + 12, 13]; break;
    case 'tampa2': s.LB2 = [CX, 8.5]; s.S1 = [CX - 11, 15]; s.S2 = [CX + 11, 15]; break;
    case 'twoman': s.S1 = [CX - 10, 15]; s.S2 = [CX + 10, 15]; break;
    case 'press': s.CB1 = [5, 0.9]; s.CB2 = [W - 5, 0.9]; break;
    case 'robber': s.S1 = [CX, 15]; s.S2 = [CX + 1, 9]; break;
    case 'mike': s.LB2 = [CX, 3]; break;
    case 'cblitz': s.CB1 = [7, 3]; break;
    case 'sblitz': s.S1 = [CX - 5, 7]; break;
    case 'glman': s.CB1 = [6, 1.2]; s.CB2 = [W - 6, 1.2]; break;
    case 'runblitz': s.LB1 = [CX - 3.6, 3.2]; s.LB2 = [CX, 3.4]; s.LB3 = [CX + 3.6, 3.2]; break;
  }
  return s;
}

/** Blocking schemes. */
export type Scheme =
  | 'zone'      // everyone steps play-side; center and back-side guard climb to the linebackers
  | 'gap'       // power: down blocks, the back-side guard pulls through the hole
  | 'stretch'   // outside zone: the line flows to the sideline
  | 'counter'   // back-side guard and tackle pull the other way
  | 'draw'      // pass-set first, then wall off
  | 'pin'       // toss: reach and pull to the edge
  | 'wedge'     // sneak: drive straight ahead
  | 'pass'      // 5-man pocket
  | 'quick'     // short, aggressive pass sets for a fast throw
  | 'screen'    // pass-set, let the rush through, release to lead block
  | 'pa'        // run fake, then pocket
  | 'boot';     // run fake one way, quarterback rolls the other

/** How the quarterback plays it. */
export type QbAction = 'gun3' | 'gun5' | 'ct5' | 'ct7' | 'pa' | 'boot' | 'rpo' | 'option' | 'flea' | 'toss' | 'lateral' | 'sneak' | 'draw' | 'handoff' | 'hand' | 'hail';

export interface Design {
  formation: FormationId;
  scheme: Scheme;
  qb: QbAction;
  carrier?: 'RB' | 'QB' | 'WR2';   // runs: who carries
  hole?: number;                     // runs: aiming point, yards from the center toward the play side
  rb: 'carry' | 'block' | 'route' | 'fake';
  te: 'block' | 'route' | 'chip';
  /** seconds from the snap to the handoff (runs) or the throw (passes), with average protection */
  develop: number;
  /** the play side is fixed by the design (+1 right, -1 left), or decided at the snap */
  side?: 1 | -1;
  /** passes with a lateral first (qb 'lateral'): who takes it and throws (the second receiver unless set) */
  lateralTo?: 'WR2' | 'RB';
}

export const DESIGN: Record<string, Design> = {
  // ---- Run
  inside_zone: { formation: 'gun', scheme: 'zone', qb: 'handoff', carrier: 'RB', hole: 1.5, rb: 'carry', te: 'block', develop: 0.55 },
  power: { formation: 'single', scheme: 'gap', qb: 'hand', carrier: 'RB', hole: 3.5, rb: 'carry', te: 'block', develop: 0.75 },
  outside_zone: { formation: 'gun', scheme: 'stretch', qb: 'handoff', carrier: 'RB', hole: 9, rb: 'carry', te: 'block', develop: 0.5 },
  counter: { formation: 'pistol', scheme: 'counter', qb: 'handoff', carrier: 'RB', hole: 3, rb: 'carry', te: 'block', develop: 0.85 },
  draw: { formation: 'gun', scheme: 'draw', qb: 'draw', carrier: 'RB', hole: 1, rb: 'carry', te: 'chip', develop: 1.15 },
  toss: { formation: 'iform', scheme: 'pin', qb: 'toss', carrier: 'RB', hole: 13, rb: 'carry', te: 'block', develop: 0.4 },
  sneak: { formation: 'heavy', scheme: 'wedge', qb: 'sneak', carrier: 'QB', hole: 0, rb: 'block', te: 'block', develop: 0.15 },
  // ---- Short Pass
  quick_out: { formation: 'gun', scheme: 'quick', qb: 'gun3', rb: 'block', te: 'route', develop: 1.05 },
  slants: { formation: 'gun', scheme: 'quick', qb: 'gun3', rb: 'route', te: 'route', develop: 0.95, side: -1 },
  screen: { formation: 'gun', scheme: 'screen', qb: 'gun3', rb: 'route', te: 'block', develop: 1.45 },
  mesh: { formation: 'trips', scheme: 'pass', qb: 'gun5', rb: 'route', te: 'route', develop: 1.7 },
  boot: { formation: 'single', scheme: 'boot', qb: 'boot', rb: 'fake', te: 'route', develop: 2.2, side: 1 },
  // ---- Deep Pass
  dig: { formation: 'gun', scheme: 'pass', qb: 'gun5', rb: 'block', te: 'route', develop: 2.0 },
  comeback: { formation: 'empty', scheme: 'pass', qb: 'gun5', rb: 'route', te: 'route', develop: 2.15 },
  seam: { formation: 'trips', scheme: 'pass', qb: 'gun5', rb: 'block', te: 'route', develop: 1.95 },
  deep_post: { formation: 'single', scheme: 'pass', qb: 'ct7', rb: 'block', te: 'chip', develop: 2.55 },
  deep_corner: { formation: 'bunch', scheme: 'pass', qb: 'gun5', rb: 'block', te: 'route', develop: 2.4 },
  go: { formation: 'gun', scheme: 'pass', qb: 'ct5', rb: 'block', te: 'chip', develop: 2.5 },
  pa_deep: { formation: 'iform', scheme: 'pa', qb: 'pa', rb: 'fake', te: 'block', develop: 2.65 },
  hail: { formation: 'empty', scheme: 'pass', qb: 'hail', rb: 'route', te: 'route', develop: 3.1 },
  // ---- RPO
  rpo_bubble: { formation: 'trips', scheme: 'zone', qb: 'rpo', carrier: 'RB', hole: 1.5, rb: 'carry', te: 'block', develop: 0.7 },
  rpo_slant: { formation: 'gun', scheme: 'zone', qb: 'rpo', carrier: 'RB', hole: -1.5, rb: 'carry', te: 'block', develop: 0.75 },
  read_option: { formation: 'pistol', scheme: 'zone', qb: 'option', carrier: 'RB', hole: 2, rb: 'carry', te: 'block', develop: 0.7 },
  // ---- Trick
  flea: { formation: 'single', scheme: 'pa', qb: 'flea', rb: 'fake', te: 'block', develop: 2.75 },
  reverse: { formation: 'gun', scheme: 'stretch', qb: 'handoff', carrier: 'WR2', hole: -11, rb: 'fake', te: 'block', develop: 1.0 },
  wr_pass: { formation: 'gun', scheme: 'pass', qb: 'lateral', rb: 'block', te: 'route', develop: 1.9 },
  direct: { formation: 'wildcat', scheme: 'gap', qb: 'hand', carrier: 'RB', hole: 3.5, rb: 'carry', te: 'block', develop: 0.15 },
  // ---- the Coach's Playbook
  hook_ladder: { formation: 'trips', scheme: 'pass', qb: 'gun3', rb: 'route', te: 'route', develop: 1.15 },
  statue: { formation: 'gun', scheme: 'stretch', qb: 'handoff', carrier: 'RB', hole: -9, rb: 'carry', te: 'block', develop: 1.35 },
  hb_pass: { formation: 'single', scheme: 'pass', qb: 'lateral', lateralTo: 'RB', rb: 'block', te: 'route', develop: 2.1 },
  fake_punt: { formation: 'wildcat', scheme: 'zone', qb: 'hand', carrier: 'RB', hole: -2.5, rb: 'carry', te: 'block', develop: 0.2 },
};

/** Everything that makes a call the play it is. Two calls with the same signature would be the same play. */
export function designSignature(id: string): string {
  const d = DESIGN[id], c = CALL[id];
  const routes = c?.routes ? (Object.keys(c.routes) as Rcv[]).map((r) => `${r}:${c.routes![r]}`).join(',') : '-';
  return [d.formation, d.scheme, d.qb, d.carrier ?? '-', d.hole ?? '-', d.rb, d.te, d.develop, c?.tgt ?? '-', routes, c?.kind].join('|');
}
