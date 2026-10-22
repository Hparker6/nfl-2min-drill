/**
 * What a moment in the game sounds and looks like. Pure: an event in, a sound and an impact out, from your side of
 * the ball (team 0 is you). The audio engine (audio.ts) and the field overlay (ui/Impact.tsx) do the rest.
 */
import type { Ev } from '../engine/types';

export type Sound =
  | 'whistle' | 'hit' | 'chime' | 'cheer' | 'groan'
  | 'turnoverBad' | 'turnoverGood' | 'tdFor' | 'tdAgainst'
  | 'win' | 'loss' | 'gradeGood' | 'gradeBad'
  | 'ring' | 'drum';      // draft night: the phone, and the roll before your name

/**
 * Big moments get a visual on the field. Turnovers you commit shake it; the final gets a stamp. bigPlay: a gain of 20+
 * for you; converted: your fourth down made; stop: theirs stopped.
 */
export type ImpactKind = 'giveaway' | 'takeaway' | 'tdFor' | 'tdAgainst' | 'win' | 'loss' | 'bigPlay' | 'converted' | 'stop';

/** What a phone feels for each moment (navigator.vibrate patterns, in ms); losses are one dull buzz. */
export const HAPTIC: Record<ImpactKind, number[]> = {
  tdFor: [70, 50, 70, 50, 160], takeaway: [60, 40, 120], converted: [50, 40, 90], bigPlay: [60], stop: [50, 40, 90],
  win: [90, 60, 90, 60, 260], giveaway: [220], tdAgainst: [180], loss: [320],
};

export interface Cue { sound: Sound | null; impact: ImpactKind | null }
const none: Cue = { sound: null, impact: null };

export function cueFor(ev: Ev): Cue {
  if (ev.type === 'snap') {
    const r = ev.res, mine = ev.off === 0;
    if (r.kind === 'kneel' || r.kind === 'spike') return none;
    // an interception or a fumble (a pick six included): the ball changes hands in the run of play
    if (r.intercepted || r.fumble) return mine ? { sound: 'turnoverBad', impact: 'giveaway' } : { sound: 'turnoverGood', impact: 'takeaway' };
    if (r.td) return mine ? { sound: 'tdFor', impact: 'tdFor' } : { sound: 'tdAgainst', impact: 'tdAgainst' };
    if (r.defTd) return mine ? { sound: 'tdAgainst', impact: 'tdAgainst' } : { sound: 'tdFor', impact: 'tdFor' };
    if (r.safety) return mine ? { sound: 'groan', impact: null } : { sound: 'cheer', impact: null };
    // a stop on fourth down (turnover on downs): yours to celebrate when it's their fourth down
    if (r.turnover) return mine ? { sound: 'groan', impact: null } : { sound: 'cheer', impact: r.kind === 'punt' || r.kind === 'fg' ? null : 'stop' };
    if (r.kind === 'fg') return r.good ? { sound: mine ? 'cheer' : 'groan', impact: null } : { sound: mine ? 'groan' : 'cheer', impact: null };
    if (r.kind === 'punt') return { sound: 'whistle', impact: null };
    if (r.kind === 'sack') return { sound: 'hit', impact: null };
    // your fourth down made, and your big plays: the crowd gets up
    if (mine && ev.down0 === 4 && ev.first && !r.penalty) return { sound: 'cheer', impact: 'converted' };
    if (mine && !r.penalty && r.yards >= 20) return { sound: 'cheer', impact: 'bigPlay' };
    if (ev.first) return { sound: 'chime', impact: null };
    return { sound: 'whistle', impact: null };
  }
  if (ev.type === 'kick') {
    if (ev.td) return ev.recover === 0 ? { sound: 'tdFor', impact: 'tdFor' } : { sound: 'tdAgainst', impact: 'tdAgainst' };
    if (ev.kind === 'onside') return ev.recover === ev.kicker ? { sound: ev.kicker === 0 ? 'cheer' : 'groan', impact: null } : { sound: 'whistle', impact: null };
    return { sound: 'whistle', impact: null };
  }
  if (ev.type === 'pat') return ev.good ? { sound: ev.off === 0 ? 'chime' : null, impact: null } : { sound: ev.off === 0 ? 'groan' : 'cheer', impact: null };
  if (ev.type === 'timeout' || ev.type === 'warning') return { sound: 'whistle', impact: null };
  return none;
}

/** The end of a game, from your side. */
export const finalCue = (win: boolean): Cue => (win ? { sound: 'win', impact: 'win' } : { sound: 'loss', impact: 'loss' });
