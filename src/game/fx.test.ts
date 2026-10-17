import { describe, expect, it } from 'vitest';
import { cueFor, finalCue } from './fx';
import { audio } from './audio';
import type { Ev, PlayResult } from '../engine/types';

const snap = (off: 0 | 1, res: Partial<PlayResult>, first = false): Ev => ({
  type: 'snap', off, yl0: 40, down0: 1, dist0: 10, t0: 100, t: 94, first,
  res: { kind: 'pass', call: 'slants', look: 'zone', carrier: 'WR1', yards: 5, oob: false, td: false, safety: false, turnover: false, dur: 5, side: 1, ...res },
});

describe('what a moment sounds and looks like', () => {
  it('your interception or fumble is a giveaway: the bad sting and the shake', () => {
    expect(cueFor(snap(0, { intercepted: true, turnover: true }))).toEqual({ sound: 'turnoverBad', impact: 'giveaway' });
    expect(cueFor(snap(0, { kind: 'run', fumble: true, turnover: true }))).toEqual({ sound: 'turnoverBad', impact: 'giveaway' });
    expect(cueFor(snap(0, { intercepted: true, turnover: true, defTd: true }))).toEqual({ sound: 'turnoverBad', impact: 'giveaway' });
  });
  it('a turnover your defense forces is a takeaway: the good sting and confetti', () => {
    expect(cueFor(snap(1, { intercepted: true, turnover: true }))).toEqual({ sound: 'turnoverGood', impact: 'takeaway' });
    expect(cueFor(snap(1, { kind: 'sack', fumble: true, turnover: true }))).toEqual({ sound: 'turnoverGood', impact: 'takeaway' });
  });
  it('touchdowns sound different for and against you', () => {
    expect(cueFor(snap(0, { td: true }))).toEqual({ sound: 'tdFor', impact: 'tdFor' });
    expect(cueFor(snap(1, { td: true }))).toEqual({ sound: 'tdAgainst', impact: 'tdAgainst' });
  });
  it('a stop on downs is a crowd reaction, not a turnover sting', () => {
    expect(cueFor(snap(0, { turnover: true, yards: 1 }))).toEqual({ sound: 'groan', impact: null });
    expect(cueFor(snap(1, { turnover: true, yards: 1 }))).toEqual({ sound: 'cheer', impact: null });
  });
  it('ordinary plays are quiet: a whistle, a chime for a first down, a hit for a sack', () => {
    expect(cueFor(snap(0, {}))).toEqual({ sound: 'whistle', impact: null });
    expect(cueFor(snap(0, {}, true))).toEqual({ sound: 'chime', impact: null });
    expect(cueFor(snap(0, { kind: 'sack', yards: -7 }))).toEqual({ sound: 'hit', impact: null });
    expect(cueFor(snap(0, { kind: 'kneel' }))).toEqual({ sound: null, impact: null });
  });
  it('the final whistle: a win stamp or a loss stamp', () => {
    expect(finalCue(true)).toEqual({ sound: 'win', impact: 'win' });
    expect(finalCue(false)).toEqual({ sound: 'loss', impact: 'loss' });
  });
  it('the audio engine is a safe no-op where Web Audio does not exist', () => {
    expect(() => { audio.configure({ sound: true, music: true }); audio.unlock(); audio.play('win'); }).not.toThrow();
  });
});
