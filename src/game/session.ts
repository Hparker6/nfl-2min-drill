/**
 * One game being played: the state, the decision the player faces, and everything they chose. Each step draws its
 * randomness from the scenario seed and the snap counter, so a list of picks replays the exact same game (that is
 * how progress survives a refresh, and why a daily spot plays the same for everyone who calls it the same way).
 */
import { CALLS, LOOKS, TEMPO } from '../engine/data';
import {
  advance, endOfHalf, fullGamePace, aiDefClock, aiDefLook, aiKick, aiOffClock, aiOffPlay, aiPat, aiST, clone, fgDist, fgProb, leadOf, lookOther, otProb, ytg,
} from '../engine/sim';
import { hash, rng } from '../engine/rng';
import { READ_ACCURACY } from '../engine/evaluate';
import { DEF_CALLS, DEF_PLAYS, goalLineSituation } from '../engine/defense';
import type { Scenario } from '../engine/scenario';
import type { Choice, Ev, State } from '../engine/types';
import type { Grade } from './grade';
import { situation } from './describe';

export type Step = 'offClock' | 'defClock' | 'play' | 'look' | 'st' | 'pat' | 'kick' | 'toss' | 'otpick';
export type Group = 'clock' | 'run' | 'pass' | 'rpo' | 'trick' | 'special' | 'def' | 'st' | 'pat' | 'kick' | 'toss';

/** Overtime's toss and the choice after it: the player's calls, but nothing to grade (a coin has no better side). */
export const isToss = (step: Step) => step === 'toss' || step === 'otpick';

export interface Opt {
  key: string;
  label: string;
  sub?: string;
  group: Group;
  choice: Choice;
  risk?: number;
}

export interface Decision {
  step: Step;
  title: string;
  options: Opt[];
  aiKey: string;     // what the AI coach would call here
  state: State;      // snapshot to evaluate from
}

export interface Pick { key: string; choice: Choice; grade?: Grade }

export interface Record_ {
  step: Step;
  title: string;
  key: string;
  label: string;
  choice: Choice;
  situation: string;
  t: number;
  grade?: Grade;
}

export interface LogLine { ev: Ev; k: number }

export class Session {
  s: State;
  picks: Pick[] = [];
  records: Record_[] = [];
  log: LogLine[] = [];
  wp: { t: number; wp: number }[] = [];
  private dec: Decision | null | undefined;

  constructor(public sc: Scenario, saved: Pick[] = []) {
    this.s = clone(sc.start);
    let i = 0;
    for (let guard = 0; guard < 1000 && i < saved.length && !this.over; guard++) {
      const d = this.decision();
      if (!d) { this.auto(); continue; }
      const p = saved[i++];
      // 'soft' was the old name of the prevent defense
      const key = d.step === 'look' && p.key === 'soft' ? 'prevent' : p.key;
      const opt = d.options.find((o) => o.key === key);
      if (!opt) throw new Error(`saved call ${p.key} is not on the board`);
      this.choose({ ...opt, choice: p.choice }, p.grade);
    }
  }

  get over() { return this.s.stage === 'over' || !!this.sc.until?.(this.s); }

  private rngFor(tag: string) { return rng(hash(this.sc.seed, this.s.k, tag)); }

  /** The decision the player faces now, or null when the next step is the AI's alone. */
  decision(): Decision | null {
    if (this.dec !== undefined) return this.dec;
    this.dec = this.build();
    return this.dec;
  }

  private build(): Decision | null {
    if (this.over) return null;
    const d = this.buildAll();
    return d && this.sc.control && !this.sc.control(this.s, d.step) ? null : d;
  }

  private buildAll(): Decision | null {
    const s = this.s;
    if (s.stage === 'over') return null;
    const aiR = this.rngFor('ai');
    if (s.stage === 'pre') {
      if (!s.running) return null;
      if (s.off === 0) return this.offClock(aiR);
      if (s.to[0] > 0) {
        const options: Opt[] = [
          { key: 'timeout', label: 'Timeout', sub: `Stop the clock (${s.to[0]} left)`, group: 'clock', choice: { defClock: 'timeout' } },
          { key: 'let', label: 'Let it run', sub: 'Save your timeout', group: 'clock', choice: { defClock: 'let' } },
        ];
        return { step: 'defClock', title: 'Their clock is running', options, aiKey: aiDefClock(s, aiR), state: clone(s) };
      }
      return null;
    }
    if (s.stage === 'call') {
      const pre = this.rngFor('pre');
      if (s.off === 0) {
        if (!s.pendLook) {
          s.pendLook = aiDefLook(s, pre);
          s.shownLook = pre() < (this.sc.readAcc ?? READ_ACCURACY) ? s.pendLook : lookOther(s.pendLook, pre, s.mix);
        }
        return this.playCall(aiR);
      }
      if (!s.pendPlay) s.pendPlay = aiOffPlay(s, pre);
      const pp = s.pendPlay;
      if (pp === 'fg') {
        const options: Opt[] = [
          { key: 'block', label: 'Go for the block', sub: 'All-out rush. Roughing gives them a first down', group: 'st', choice: { st: 'block' } },
          { key: 'safe', label: 'Stay home', sub: 'Normal rush, no risk', group: 'st', choice: { st: 'safe' } },
        ];
        return { step: 'st', title: `They line up for a ${fgDist(s)}-yard field goal`, options, aiKey: 'safe', state: clone(s) };
      }
      if (pp === 'punt') {
        const options: Opt[] = [
          { key: 'return', label: 'Set up the return', sub: 'Your returner gets a shot at it', group: 'st', choice: { st: 'return' } },
          { key: 'rush', label: 'Rush the punt', sub: 'A chance at a block, a roughing risk, no return', group: 'st', choice: { st: 'rush' } },
        ];
        return { step: 'st', title: 'They are punting', options, aiKey: aiST('punt'), state: clone(s) };
      }
      if (pp === 'kneel' || pp === 'spike') return null;
      // goal-line defense is offered where it belongs: near the goal line or on short yardage
      const calls = DEF_CALLS.filter((k) => !DEF_PLAYS[k].goalOnly || goalLineSituation(s) || ytg(s) <= 10);
      const options: Opt[] = calls.map((k) => ({ key: k, label: LOOKS[k].label, sub: LOOKS[k].sub, group: 'def', choice: { look: k }, risk: LOOKS[k].tilt }));
      const ai = aiDefLook(s, aiR);
      const goal = s.dist >= ytg(s) ? 'Goal' : String(s.dist);
      const title = s.tryTwo ? 'Two-point try: call the defense' : s.down === 4 ? `4th & ${goal}: they're going for it` : `${['1st', '2nd', '3rd'][s.down - 1]} & ${goal}: call the defense`;
      return { step: 'look', title, options, aiKey: options.some((o) => o.key === ai) ? ai : 'balanced', state: clone(s) };
    }
    if (s.stage === 'pat') {
      if (s.off !== 0) return null;
      const options: Opt[] = [
        { key: 'xp', label: 'Kick it', sub: 'About 19 in 20 go through', group: 'pat', choice: { pat: 'xp' } },
        { key: 'two', label: 'Go for two', sub: s.twoPlay ? 'Call a play from the 2: about half convert' : 'About half convert', group: 'pat', choice: { pat: 'two' } },
      ];
      return { step: 'pat', title: 'Touchdown! The try', options, aiKey: aiPat(s), state: clone(s) };
    }
    if (s.stage === 'toss') {
      if (!s.coin) {
        const options: Opt[] = [
          { key: 'heads', label: 'Heads', group: 'toss', choice: { toss: 'heads' } },
          { key: 'tails', label: 'Tails', group: 'toss', choice: { toss: 'tails' } },
        ];
        return { step: 'toss', title: 'Overtime coin toss: call it in the air', options, aiKey: 'heads', state: clone(s) };
      }
      if (s.coin.pick !== 0) return null;
      const third = (s.q ?? 5) > 5;
      const options: Opt[] = [
        { key: 'receive', label: 'Receive', sub: 'Ball first. Both teams still get a possession: score, and they have to match it', group: 'toss', choice: { recv: true } },
        { key: 'kick', label: 'Kick', sub: 'They go first. On your possession you know exactly what you need', group: 'toss', choice: { recv: false } },
      ];
      return { step: 'otpick', title: third ? 'Third overtime period: your choice' : 'You won the toss: your choice', options, aiKey: 'receive', state: clone(s) };
    }
    if (s.stage === 'kick') {
      if (s.kicker !== 0 || s.safetyKick || leadOf(s, 0) >= 0) return null;
      const options: Opt[] = [
        { key: 'deep', label: 'Kick it deep', sub: 'Touchback puts them at the 35', group: 'kick', choice: { kick: 'deep' } },
        { key: 'onside', label: 'Onside kick', sub: 'About 1 in 8 recovered', group: 'kick', choice: { kick: 'onside' } },
      ];
      return { step: 'kick', title: 'Kickoff', options, aiKey: aiKick(s), state: clone(s) };
    }
    return null;
  }

  private offClock(aiR: () => number): Decision {
    const s = this.s;
    const options: Opt[] = (Object.keys(TEMPO) as (keyof typeof TEMPO)[]).map((k) => ({
      key: k, label: TEMPO[k].label, group: 'clock', choice: { offClock: k },
      // a full game's normal huddle uses more of the play clock (see fullGamePace)
      sub: s.q != null && fullGamePace(k) ? `Normal pace: about ${TEMPO[k].secs + fullGamePace(k)} seconds` : TEMPO[k].sub,
    }));
    if (s.to[0] > 0) {
      options.push({ key: 'timeout', label: 'Timeout', sub: `Stop it now (${s.to[0]} left)`, group: 'clock', choice: { offClock: 'timeout' } });
      if (s.t <= 45 && s.t > 4 && fgDist(s) <= 60 && endOfHalf(s)) options.push({ key: 'drain', label: 'Run it down', sub: 'Let it run to 0:03, then timeout', group: 'clock', choice: { offClock: 'drain' } });
    }
    if (s.down < 4) options.push({ key: 'spike', label: 'Spike it', sub: 'Stop the clock, lose a down', group: 'clock', choice: { offClock: 'spike' } });
    if (leadOf(s, 0) > 0) options.push({ key: 'kneel', label: 'Kneel', sub: 'Run the play clock, take a knee', group: 'clock', choice: { offClock: 'kneel' } });
    const ai = aiOffClock(s, aiR);
    return { step: 'offClock', title: 'The clock is running', options, aiKey: options.some((o) => o.key === ai) ? ai : 'nohuddle', state: clone(s) };
  }

  private playCall(aiR: () => number): Decision {
    const s = this.s;
    const yt = ytg(s);
    const options: Opt[] = [];
    for (const c of CALLS) {
      if (c.id === 'hail' && (s.tryTwo || !(s.t <= 30 && yt >= 30))) continue;
      if (c.id === 'sneak' && s.dist > 3) continue;
      options.push({ key: c.id, label: c.name, sub: c.sub, group: c.fam, choice: { play: c.id }, risk: c.risk });
    }
    const fd = fgDist(s);
    if (s.tryTwo) {
      // a two-point try: plays only, from the 2
      const ai = aiOffPlay(s, aiR);
      return { step: 'play', title: 'Two-point try: call the play', options, aiKey: options.some((o) => o.key === ai) ? ai : 'power', state: clone(s) };
    }
    if (fd <= 63) {
      const p = Math.round(fgProb(fd, s.rat[0].k) * 100);
      options.push({ key: 'fg', label: `Field goal`, sub: `${fd} yards, about ${p}% from there`, group: 'special', choice: { play: 'fg' } });
    }
    if (s.down === 4) options.push({ key: 'punt', label: 'Punt', sub: 'Pin them deep', group: 'special', choice: { play: 'punt' } });
    if (leadOf(s, 0) > 0 || (leadOf(s, 0) === 0 && s.t <= 40)) options.push({ key: 'kneel', label: 'Kneel', sub: 'Take a knee, keep the clock moving', group: 'special', choice: { play: 'kneel' } });
    const ai = aiOffPlay(s, aiR);
    const title = s.down === 4 ? `4th & ${s.dist >= yt ? 'Goal' : s.dist}: your call` : 'Call the play';
    return { step: 'play', title, options, aiKey: options.some((o) => o.key === ai) ? ai : 'inside_zone', state: clone(s) };
  }

  private push(ev: Ev[]) {
    for (const e of ev) this.log.push({ ev: e, k: this.s.k });
  }

  /** Let the AI take the next step. */
  auto(): Ev[] {
    const ev: Ev[] = [];
    const r = this.rngFor('snap');
    advance(this.s, r, null, ev);
    this.s.k++;
    this.dec = undefined;
    this.push(ev);
    return ev;
  }

  /** The player decides. */
  choose(opt: Opt, grade?: Grade): Ev[] {
    const d = this.decision();
    if (!d) return this.auto();
    this.records.push({
      step: d.step, title: d.title, key: opt.key, label: optLabel(opt), choice: opt.choice, situation: situation(this.s, this.sc.teams),
      t: this.s.t, grade,
    });
    this.picks.push({ key: opt.key, choice: opt.choice, grade });
    const ev: Ev[] = [];
    const r = this.rngFor('snap');
    advance(this.s, r, opt.choice, ev);
    this.s.k++;
    this.dec = undefined;
    this.push(ev);
    return ev;
  }

  /** Attach a grade that finished computing after the pick. */
  setGrade(idx: number, grade: Grade) {
    if (this.records[idx]) this.records[idx].grade = grade;
    if (this.picks[idx]) this.picks[idx].grade = grade;
  }

  /**
   * The final result. A spot that plays overtime is decided on the field (`ot` when it went past regulation). An older
   * spot that ended tied goes to an overtime settled by a seeded coin weighted by team strength.
   */
  result(): { win: boolean; ot: boolean; score: [number, number] } {
    const l = leadOf(this.s, 0);
    if (l !== 0) return { win: l > 0, ot: (this.s.q ?? 0) >= 5, score: [this.s.score[0], this.s.score[1]] };
    const win = rng(hash(this.sc.seed, 'ot'))() < otProb(this.s);
    const score: [number, number] = [this.s.score[0] + (win ? 3 : 0), this.s.score[1] + (win ? 0 : 3)];
    return { win, ot: true, score };
  }
}

export function optLabel(opt: Opt): string {
  const c = opt.choice;
  const bits: string[] = [];
  if (c.side) bits.push(c.side === 1 ? 'strong' : 'weak');
  if (c.mods?.pa) bits.push('play action');
  if (c.mods?.roll) bits.push('roll out');
  if (c.mods?.oob) bits.push('sideline');
  if (c.target || c.routes) bits.push('custom routes');
  return bits.length ? `${opt.label} (${bits.join(', ')})` : opt.label;
}
