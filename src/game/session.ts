/**
 * One game being played: the state, the decision the player faces, and everything they chose. Each step draws its
 * randomness from the scenario seed and the snap counter, so a list of picks replays the exact same game (that is
 * how progress survives a refresh, and why a daily spot plays the same for everyone who calls it the same way).
 */
import { CALLS, LOOKS, TEMPO } from '../engine/data';
import {
  advance, aiDefClock, aiDefLook, aiKick, aiOffClock, aiOffPlay, aiPat, aiST, clone, fgDist, fgProb, leadOf, lookOther, otProb, ytg,
} from '../engine/sim';
import { hash, rng } from '../engine/rng';
import { READ_ACCURACY } from '../engine/evaluate';
import { DEF_CALLS, goalLineSituation } from '../engine/defense';
import type { Scenario } from '../engine/scenario';
import type { Choice, Ev, State } from '../engine/types';
import type { Grade } from './grade';
import { situation } from './describe';

export type Step = 'offClock' | 'defClock' | 'play' | 'look' | 'st' | 'pat' | 'kick';
export type Group = 'clock' | 'run' | 'pass' | 'rpo' | 'trick' | 'special' | 'def' | 'st' | 'pat' | 'kick';

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

  get over() { return this.s.stage === 'over'; }

  private rngFor(tag: string) { return rng(hash(this.sc.seed, this.s.k, tag)); }

  /** The decision the player faces now, or null when the next step is the AI's alone. */
  decision(): Decision | null {
    if (this.dec !== undefined) return this.dec;
    this.dec = this.build();
    return this.dec;
  }

  private build(): Decision | null {
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
          s.shownLook = pre() < READ_ACCURACY ? s.pendLook : lookOther(s.pendLook, pre);
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
      const calls = DEF_CALLS.filter((k) => k !== 'goal' || goalLineSituation(s) || ytg(s) <= 10);
      const options: Opt[] = calls.map((k) => ({ key: k, label: LOOKS[k].label, sub: LOOKS[k].sub, group: 'def', choice: { look: k }, risk: LOOKS[k].tilt }));
      const ai = aiDefLook(s, aiR);
      const goal = s.dist >= ytg(s) ? 'Goal' : String(s.dist);
      const title = s.down === 4 ? `4th & ${goal}: they're going for it` : `${['1st', '2nd', '3rd'][s.down - 1]} & ${goal}: call the defense`;
      return { step: 'look', title, options, aiKey: options.some((o) => o.key === ai) ? ai : 'balanced', state: clone(s) };
    }
    if (s.stage === 'pat') {
      if (s.off !== 0) return null;
      const options: Opt[] = [
        { key: 'xp', label: 'Kick it', sub: 'About 19 in 20 go through', group: 'pat', choice: { pat: 'xp' } },
        { key: 'two', label: 'Go for two', sub: 'About half convert', group: 'pat', choice: { pat: 'two' } },
      ];
      return { step: 'pat', title: 'Touchdown! The try', options, aiKey: aiPat(s), state: clone(s) };
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
    const options: Opt[] = (Object.keys(TEMPO) as (keyof typeof TEMPO)[]).map((k) => ({ key: k, label: TEMPO[k].label, sub: TEMPO[k].sub, group: 'clock', choice: { offClock: k } }));
    if (s.to[0] > 0) {
      options.push({ key: 'timeout', label: 'Timeout', sub: `Stop it now (${s.to[0]} left)`, group: 'clock', choice: { offClock: 'timeout' } });
      if (s.t <= 45 && s.t > 4 && fgDist(s) <= 60) options.push({ key: 'drain', label: 'Run it down', sub: 'Let it run to 0:03, then timeout', group: 'clock', choice: { offClock: 'drain' } });
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
      if (c.id === 'hail' && !(s.t <= 30 && yt >= 30)) continue;
      if (c.id === 'sneak' && s.dist > 3) continue;
      options.push({ key: c.id, label: c.name, sub: c.sub, group: c.fam, choice: { play: c.id }, risk: c.risk });
    }
    const fd = fgDist(s);
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

  /** The final result. A tie goes to overtime, settled by a seeded coin weighted by team strength. */
  result(): { win: boolean; ot: boolean; score: [number, number] } {
    const l = leadOf(this.s, 0);
    if (l !== 0) return { win: l > 0, ot: false, score: [this.s.score[0], this.s.score[1]] };
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
