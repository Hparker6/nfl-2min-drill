/**
 * Overtime by the NFL's current rules: the coin toss you call, the winner's choice, both teams' possessions, sudden
 * death, the playoff periods, regular-season ties, and the AI coaches playing to the possession rules.
 */
import { describe, expect, it } from 'vitest';
import { advance, aiOffPlay, aiPat, clone, leadOf, otProb, simulate, value0 } from './sim';
import { customScenario, type SpotParams } from './scenario';
import { kickoffState } from './game';
import { rng } from './rng';
import { Session, isToss } from '../game/session';
import type { Ev, State, Team } from './types';

const params = (o: Partial<SpotParams> = {}): SpotParams => ({
  you: 'AUS', them: 'PDX', side: 'off', t: 30, lead: 0, yl: 40, down: 1, dist: 10, to: [0, 0], running: true, home: 0, ...o,
});
/** A tied late-game spot at 0:00 with the clock running: the next step ends regulation. */
const atGun = (): State => {
  const s = customScenario(params(), 'ot').start;
  s.t = 0; s.running = true; s.stage = 'pre'; s.to = [0, 0];
  return s;
};
type TossEv = Extract<Ev, { type: 'toss' }>;
const tossOf = (ev: Ev[]) => ev.find((e): e is TossEv => e.type === 'toss');

describe('a tied late-game spot goes to overtime', () => {
  it('at 0:00: the coin toss, then the playoff format (15 minutes, three timeouts, no two-minute warning)', () => {
    const s = atGun();
    const ev: Ev[] = [];
    advance(s, rng(1), null, ev);
    expect(s.stage).toBe('toss');
    expect([s.q, s.t, s.po, s.coin]).toEqual([5, 900, true, undefined]);
    expect(s.to).toEqual([3, 3]);
    expect(s.warned).toBe(true);
    expect(ev.map((e) => e.type)).toEqual(['period']);   // no "Final" banner first
  });

  it('an older spot (no played overtime) still ends at 0:00, the tie worth the weighted coin', () => {
    const s = atGun();
    delete s.otPlay; delete s.toss;
    const ev: Ev[] = [];
    advance(s, rng(1), null, ev);
    expect(s.stage).toBe('over');
    expect(ev.some((e) => e.type === 'expire')).toBe(true);
    expect(value0(s)).toBe(otProb(s));
  });

  it('grading rollouts stop at the toss and value the tie at overtime odds (no extra cost)', () => {
    const s = atGun();
    simulate(s, rng(3));
    expect(s.stage).toBe('toss');
    expect(value0(s)).toBe(otProb(s));
  });
});

describe('the coin toss', () => {
  it('the call that matches the coin wins; the winner chooses, and the AI takes the ball', () => {
    let wins = 0;
    for (let i = 0; i < 60; i++) {
      const s = atGun();
      advance(s, rng(i));
      const ev: Ev[] = [];
      advance(s, rng(500 + i), { toss: 'heads' }, ev);
      const t = tossOf(ev)!;
      expect(t.call).toBe('heads');
      expect(t.won).toBe(t.face === 'heads' ? 0 : 1);
      expect(s.stage).toBe('toss');
      expect(s.coin?.pick).toBe(t.won);
      if (t.won === 0) {
        wins++;
        advance(s, rng(1), { recv: false });   // you chose to kick
        expect([s.kicker, s.otOwn]).toEqual([0, 1]);
      } else {
        advance(s, rng(1), null);              // their choice: receive
        expect([s.kicker, s.otOwn]).toEqual([0, 1]);
      }
      expect([s.stage, s.otp]).toEqual(['kick', 1]);
    }
    expect(wins).toBeGreaterThan(15);   // a fair coin
    expect(wins).toBeLessThan(45);
  });
});

describe('overtime possessions, over thousands of AI games', () => {
  it('both teams get the ball, a trailing second team never punts, a deciding touchdown has no try, someone wins', () => {
    let firstOnlyBad = 0, puntTrailing = 0, tryAfterDecider = 0, unfinished = 0, firstOnly = 0;
    for (let i = 0; i < 1500; i++) {
      const s = atGun();
      const r = rng(9000 + i);
      let recv: Team | -1 = -1;
      for (let k = 0; k < 3000 && s.stage !== 'over'; k++) {
        const b = clone(s);
        const ev: Ev[] = [];
        advance(s, r, null, ev);
        if (recv === -1 && b.stage === 'toss' && s.stage === 'kick') recv = s.otOwn!;
        for (const e of ev) {
          if (e.type !== 'snap') continue;
          if (e.res.kind === 'punt' && b.otp === 2 && b.off === b.otOwn && leadOf(b, b.off) < 0) puntTrailing++;
          if (e.res.td && s.stage === 'pat' && ((b.otp === 2 && b.off === b.otOwn && leadOf(s, s.off) > 0) || (b.otp ?? 0) >= 3)) tryAfterDecider++;
        }
      }
      if (s.stage !== 'over' || s.score[0] === s.score[1]) { unfinished++; continue; }
      if (s.otp === 1) {
        // only the kicking team can end it on the first possession (a safety, or a turnover returned for a score)
        firstOnly++;
        if ((s.score[0] > s.score[1] ? 0 : 1) === recv) firstOnlyBad++;
      }
    }
    expect({ unfinished, firstOnlyBad, puntTrailing, tryAfterDecider }).toEqual({ unfinished: 0, firstOnlyBad: 0, puntTrailing: 0, tryAfterDecider: 0 });
    expect(firstOnly).toBeLessThan(60);   // rare, as in the NFL
  });
});

describe('overtime periods', () => {
  it('playoffs: the second period plays on from the same spot; the third opens with the toss loser’s choice', () => {
    const s = atGun();
    advance(s, rng(1));
    s.coin = { call: 'heads', face: 'heads', won: 0, pick: 0 };
    advance(s, rng(2), { recv: true });
    // a scoreless first period ends with team 0 on the ball
    Object.assign(s, { stage: 'pre', off: 0, yl: 37, down: 2, dist: 6, t: 0, running: true, to: [1, 0], otp: 3, otOwn: 0 });
    advance(s, rng(3));
    expect([s.q, s.stage, s.off, s.yl, s.down, s.t]).toEqual([6, 'pre', 0, 37, 2, 900]);
    expect(s.to).toEqual([1, 0]);         // the same "half": timeouts carry over
    expect(s.warned).toBe(false);         // and the two-minute warning applies
    // the second period ends scoreless: the third starts with a kickoff, the choice to the team that lost the toss
    Object.assign(s, { stage: 'pre', t: 0, running: true, to: [0, 0] });
    advance(s, rng(4));
    expect([s.q, s.stage, s.coin?.pick]).toEqual([7, 'toss', 1]);
    expect(s.to).toEqual([3, 3]);
    const ev: Ev[] = [];
    advance(s, rng(5), null, ev);
    expect(ev.find((e) => e.type === 'otpick')).toMatchObject({ team: 1, recv: true, q: 7 });
    expect([s.stage, s.kicker]).toEqual(['kick', 0]);
  });

  it('regular season (a career game): one 10-minute period, two timeouts, the two-minute warning, and a tie', () => {
    const rat = customScenario(params(), 'ot').start.rat;
    const s = kickoffState([rat[0], rat[1]], { seed: 5, qLen: 900, po: false, toss: true });
    Object.assign(s, { q: 4, t: 0, stage: 'pre', running: true, score: [17, 17], off: 0, to: [0, 0] });
    advance(s, rng(2));
    expect([s.q, s.stage, s.t, s.warned]).toEqual([5, 'toss', 600, false]);
    expect(s.to).toEqual([2, 2]);
    s.coin = { call: 'tails', face: 'tails', won: 0, pick: 0 };
    advance(s, rng(3), { recv: true });
    Object.assign(s, { stage: 'pre', running: true, t: 0, off: 0, otp: 3, to: [0, 0] });
    const ev: Ev[] = [];
    advance(s, rng(4), null, ev);
    expect(s.stage).toBe('over');
    expect(s.score).toEqual([17, 17]);
    expect(ev.find((e) => e.type === 'final')).toMatchObject({ ot: true });
  });

  it('a game without the called toss (the AI’s league games, older saves) keeps the silent one', () => {
    const rat = customScenario(params(), 'ot').start.rat;
    const s = kickoffState([rat[0], rat[1]], { seed: 5, qLen: 900, po: false });
    Object.assign(s, { q: 4, t: 0, stage: 'pre', running: true, score: [17, 17], off: 0, to: [0, 0] });
    advance(s, rng(2));
    expect([s.q, s.stage, s.otp]).toEqual([5, 'kick', 1]);
  });
});

describe('the AI in overtime', () => {
  const ot = (o: Partial<State>): State => {
    const s = atGun();
    advance(s, rng(1));
    return Object.assign(s, { stage: 'call', running: false, t: 600, ...o });
  };
  it('second possession, down a touchdown, fourth and long at its own 30: goes for it, every time', () => {
    const s = ot({ otp: 2, otOwn: 1, off: 1, score: [7, 0], down: 4, dist: 9, yl: 30 });
    for (let i = 0; i < 200; i++) expect(['punt', 'fg']).not.toContain(aiOffPlay(s, rng(i)));
  });
  it('second possession, down a field goal, fourth down in range: kicks the tying field goal', () => {
    expect(aiOffPlay(ot({ otp: 2, otOwn: 1, off: 1, score: [3, 0], down: 4, dist: 6, yl: 75 }), rng(1))).toBe('fg');
  });
  it('sudden death, third down at the 15: kicks the winner', () => {
    expect(aiOffPlay(ot({ otp: 3, otOwn: 1, off: 1, score: [3, 3], down: 3, dist: 8, yl: 85 }), rng(1))).toBe('fg');
  });
  it('second possession, a point short after the touchdown: goes for two to win', () => {
    expect(aiPat(ot({ otp: 2, otOwn: 1, off: 1, score: [7, 6], stage: 'pat' }))).toBe('two');
  });
});

describe('the toss in a played game', () => {
  it('is the player’s call, the choice follows a win, and it all replays from saved picks', () => {
    const sc = customScenario(params({ t: 2 }), 'ot-session');
    const ses = new Session(sc);
    for (let g = 0; g < 50 && ses.decision()?.step !== 'toss' && !ses.over; g++) {
      const d = ses.decision();
      if (!d) ses.auto(); else ses.choose(d.options.find((o) => o.key === d.aiKey) ?? d.options[0]);
    }
    const d = ses.decision()!;
    expect(d.step).toBe('toss');
    expect(isToss(d.step)).toBe(true);
    expect(d.options.map((o) => o.key)).toEqual(['heads', 'tails']);
    ses.choose(d.options[0]);
    const won = ses.s.coin!.won === 0;
    const next = ses.decision();
    if (won) {
      expect(next?.step).toBe('otpick');
      ses.choose(next!.options.find((o) => o.key === 'kick')!);
      expect(ses.s.otOwn).toBe(1);
    } else {
      expect(next).toBeNull();
    }
    const again = new Session(sc, ses.picks);
    expect(again.s).toEqual(ses.s);
  });
});
