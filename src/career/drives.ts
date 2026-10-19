/**
 * Drives from a game's events, for the drive tracker: where each started and ended (in your team's yards, 0 = your
 * goal line), how many plays, yards and minutes, and how it ended.
 */
import type { Ev, Team } from '../engine/types';

export interface Drive {
  team: Team;
  q: number;
  start: number;          // your-team yard line where it started (0-100, attacking toward 100 when team 0 has it)
  end: number;
  plays: number;
  yards: number;
  secs: number;
  result: string;         // Touchdown, Field goal, Punt, Interception…
  done: boolean;
  score?: boolean;
}

/** A yard line (the offense's) in your team's coordinates. */
export const toYou = (team: Team, yl: number) => (team === 0 ? yl : 100 - yl);

export function drives(ev: Ev[]): Drive[] {
  const out: Drive[] = [];
  let cur: Drive | null = null;
  let q = 1;
  let lastT = 0;
  const close = (result: string, score = false) => { if (cur && !cur.done) { cur.result = result; cur.done = true; cur.score = score; } };
  for (const e of ev) {
    if (e.type === 'period') {
      q = e.q;
      if (e.q === 3 || e.q >= 5) close(e.q === 3 ? 'End of half' : 'End of regulation');
      continue;
    }
    if (e.type === 'final') { close('End of game'); continue; }
    if (e.type === 'expire') { close('End of game'); continue; }
    if (e.type === 'kick') { if (e.td) close('Kick return TD', true); continue; }
    if (e.type !== 'snap' || e.try) continue;   // a two-point try isn't part of the drive
    const r = e.res;
    if (!cur || cur.done || cur.team !== e.off) {
      close('Turnover');
      cur = { team: e.off, q, start: toYou(e.off, e.yl0), end: toYou(e.off, e.yl0), plays: 0, yards: 0, secs: 0, result: '', done: false };
      out.push(cur);
      lastT = e.t0;
    }
    const d: Drive = cur;
    if (r.kind !== 'fg' && r.kind !== 'punt') d.plays++;
    d.secs += Math.max(0, lastT - e.t);
    lastT = e.t;
    if (!r.turnover && !r.penalty && r.kind !== 'fg' && r.kind !== 'punt') d.yards += r.yards;
    else if (r.penalty === 'dpi' || r.penalty === 'rough') d.yards += r.yards;
    d.end = toYou(e.off, Math.min(100, Math.max(0, e.yl0 + (r.turnover ? 0 : r.yards))));
    if (r.td) close('Touchdown', true);
    else if (r.defTd) close(r.kind === 'punt' ? 'Punt return TD' : 'Pick six');
    else if (r.safety) close('Safety');
    else if (r.kind === 'fg') close(r.good ? 'Field goal' : r.blocked ? 'Blocked FG' : 'Missed FG', !!r.good);
    else if (r.kind === 'punt') close('Punt');
    else if (r.intercepted) close('Interception');
    else if (r.fumble) close('Fumble');
    else if (e.down0 === 4 && !e.first && !r.penalty) close('Downs');
  }
  return out;
}

export const fmtSecs = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
