/**
 * What a defensive call looks like drawn: who rushes, who drops into a zone, who covers whom. One source for the play
 * card (MiniPlay), the field preview (field.ts) and the snap animation's blitzers (timeline.ts reads the same rush
 * list), so what you pick is what you see and what happens.
 */
import { DEF_PLAYS, famOf } from '../engine/defense';
import type { Look, LookFam, Rcv } from '../engine/types';

export interface DefShapes { fam: LookFam; rush: string[]; zones: string[]; zoneR: number; man: [string, Rcv][] }

// deep help drawn as zones on the man calls that have it, and each zone call's own shell
const ZONES: Partial<Record<Look, string[]>> = {
  twoman: ['S1', 'S2'], robber: ['S2'], cover4: ['CB1', 'CB2', 'S1', 'S2', 'LB1', 'LB3'],
  tampa2: ['LB1', 'LB2', 'LB3', 'CB1', 'CB2', 'S1', 'S2'], firezone: ['DL1', 'LB2', 'S1', 'S2', 'CB1', 'CB2'],
};
const MAN: [string, Rcv][] = [['CB1', 'WR1'], ['CB2', 'WR2'], ['LB1', 'WR3'], ['LB3', 'TE'], ['LB2', 'RB']];

export function defShapes(look: Look): DefShapes {
  const call = look === 'soft' ? 'prevent' : look;
  const fam = famOf(call);
  const rush = DEF_PLAYS[call].rush ?? [];
  const zones = (ZONES[call] ?? (fam === 'zone' ? ['LB1', 'LB2', 'LB3', 'CB1', 'CB2', 'S1', 'S2'] : fam === 'prevent' ? ['CB1', 'CB2', 'S1', 'S2', 'LB2'] : fam === 'balanced' ? ['S1', 'S2'] : []))
    .filter((k) => !rush.includes(k));
  const man = (fam === 'man' || call === 'glman' || call === 'blitz' ? MAN : []).filter(([d]) => !rush.includes(d));
  return { fam, rush, zones, zoneR: fam === 'prevent' ? 6 : 4.6, man };
}
