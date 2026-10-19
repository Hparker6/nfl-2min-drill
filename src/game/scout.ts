/**
 * Reading their defense over a game: what they've done in this kind of spot, the scouting report on their
 * coordinator, and a warning when they've adjusted to a call you keep running. Only games with a coordinator
 * (State.dc) have a scouting report and adjustments; the spot record works on any game.
 */
import { CALL, LOOKS } from '../engine/data';
import { famOf } from '../engine/defense';
import { counterOf, dcSpot } from '../engine/sim';
import type { DcStyle, Ev, LookFam, State } from '../engine/types';

export interface ScoutNote { kind: 'report' | 'record' | 'adjust'; text: string }

type Bucket = 'third' | 'short' | 'long' | 'red' | 'early';
const BUCKET: Record<Bucket, string> = {
  third: 'on third and fourth down', short: 'on short yardage', long: 'on long yardage', red: 'in the red zone', early: 'on early downs',
};
/** The kind of spot a down is, for comparing like with like. */
export function bucketOf(down: number, dist: number, yl: number): Bucket {
  if (100 - yl <= 20) return 'red';
  if (down >= 3 && dist >= 4) return 'third';
  if (dist <= 3) return 'short';
  if (dist >= 7) return 'long';
  return 'early';
}
const DID: Record<LookFam, string> = {
  blitz: 'blitzed', zone: 'sat in zone', man: 'played man', load: 'loaded the box', prevent: 'played soft', balanced: 'stayed balanced', goal: 'gone goal line',
};
export const DC_TEXT: Record<DcStyle['style'], string> = {
  blitz: 'brings the blitz on third down', zone: 'sits back in zone on long yardage', man: 'plays tight man in the red zone', load: 'loads the box on short yardage',
};

export function scoutNotes(s: State, log: Ev[]): ScoutNote[] {
  if (s.off !== 0 || s.stage !== 'call' || s.tryTwo) return [];
  const out: ScoutNote[] = [];
  if (s.dc && s.rep && s.rep.n >= 3) {
    out.push({ kind: 'adjust', text: `They've adjusted to ${s.rep.n} straight ${(CALL[s.rep.call]?.name ?? 'calls').toLowerCase()}: expect ${LOOKS[counterOf(s.rep.call)].label.toLowerCase()}.` });
  }
  const b = bucketOf(s.down, s.dist, s.yl);
  const seen = log.filter((e): e is Extract<Ev, { type: 'snap' }> => e.type === 'snap' && e.off === 0 && !e.try && !e.res.penalty && e.res.kind !== 'kneel' && e.res.kind !== 'spike' && e.res.kind !== 'fg' && e.res.kind !== 'punt')
    .filter((e) => bucketOf(e.down0, e.dist0, e.yl0) === b);
  if (seen.length >= 2 && seen.some((e) => e.res.look)) {
    const n = new Map<LookFam, number>();
    for (const e of seen) { if (!e.res.look) continue; const f = famOf(e.res.look); n.set(f, (n.get(f) ?? 0) + 1); }
    const [fam, k] = [...n].sort((a, c) => c[1] - a[1])[0];
    out.push({ kind: 'record', text: `${BUCKET[b][0].toUpperCase()}${BUCKET[b].slice(1)} they've ${DID[fam]} ${k} of ${seen.length} times.` });
  }
  if (s.dc && dcSpot(s, s.dc.style)) out.push({ kind: 'report', text: `Scouting report: their coordinator ${DC_TEXT[s.dc.style]}. This is his spot.` });
  return out;
}
