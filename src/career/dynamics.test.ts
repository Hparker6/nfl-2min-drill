/**
 * Career mode should feel different from career to career: risks that pay off grow the quarterback faster, draft
 * night can land you on a good team, the league's good and bad teams change over the years, and media day matters.
 */
import { describe, expect, it } from 'vitest';
import { attrCost, awardXp, joinTeam, makeDraft, newCareer, upgrade, youPlayer, yourGameThisWeek } from './career';
import { closeWeek, finishLive, simYourGame, startLive, COLLEGE_GAME } from './run';
import { draftOrderFor } from './season';
import { endSeason, offers, runOffseason, signWith, startNextSeason } from './offseason';
import { teamInfo } from './league';
import { riskWins, RISK_CAP, type RiskWin } from './risk';
import { finishMediaDay, mediaQuestions, MEDIA_QS, MEDIA_RIGHT, MEDIA_WRONG } from './media';
import { step } from '../engine/game';
import { hash, rng } from '../engine/rng';
import type { Ev, PlayResult } from '../engine/types';

function start(seed: number) {
  const c = newCareer({ name: 'Test QB', number: 7, arch: 'pocket', college: 1, seed });
  startLive(c, COLLEGE_GAME, 'moments');
  for (let i = 0; i < 5000 && c.live!.s.stage !== 'over'; i++) step(c.live!.seed, c.live!.s, c.live!.ev);
  finishLive(c, 'sim');
  return c;
}
const snap = (o: { off?: 0 | 1; down?: number; dist?: number; yl?: number }, res: Partial<PlayResult>): Ev => ({
  type: 'snap', off: o.off ?? 0, yl0: o.yl ?? 40, down0: o.down ?? 1, dist0: o.dist ?? 10, t0: 100, t: 94, first: false,
  res: { kind: 'pass', call: 'slants', look: 'zone', carrier: 'WR1', yards: 5, oob: false, td: false, safety: false, turnover: false, dur: 5, side: 1, ...res },
});

describe('risks that pay off', () => {
  it('finds the deep shot that hit, the fourth down converted, the two-point try, the trick play and the escape', () => {
    const w = riskWins([
      snap({}, { call: 'go', complete: true, yards: 38 }),
      snap({ down: 4, dist: 2 }, { call: 'inside_zone', kind: 'run', yards: 3 }),
      { type: 'pat', off: 0, two: true, good: true, t: 50 },
      snap({}, { call: 'reverse', kind: 'run', yards: 14 }),
      snap({}, { call: 'dig', kind: 'scramble', yards: 15 }),
    ]);
    expect(w.map((x) => x.kind)).toEqual(['deep', 'fourth', 'two', 'trick', 'escape']);
    expect(w.map((x) => x.attr)).toEqual(['arm', 'decision', 'accuracy', 'decision', 'mobility']);
  });
  it('ignores risks that failed, safe calls, and the other team', () => {
    expect(riskWins([
      snap({}, { call: 'go', complete: false, yards: 0 }),
      snap({}, { call: 'go', intercepted: true, turnover: true }),
      snap({ down: 4, dist: 5 }, { call: 'slants', yards: 3, turnover: true }),
      snap({}, { call: 'slants', complete: true, yards: 30 }),
      snap({ off: 1 }, { call: 'go', complete: true, yards: 40 }),
      { type: 'pat', off: 0, two: true, good: false, t: 50 },
    ])).toEqual([]);
  });
  it('each one is worth XP and a free attribute point, up to the cap', () => {
    const c = start(2); joinTeam(c);
    const me = youPlayer(c), arm0 = me.attrs.arm!;
    const risks: RiskWin[] = Array.from({ length: RISK_CAP + 2 }, () => ({ kind: 'deep', label: 'Deep shot', attr: 'arm' }));
    awardXp(c, 'g1', { pa: 20, pc: 12, py: 150 }, true, 'moments', [], 'reg', risks);
    expect(youPlayer(c).attrs.arm).toBe(arm0 + RISK_CAP);
    expect(c.last!.boosts!.length).toBe(RISK_CAP);
    expect(c.last!.xp.filter((p) => p.label.startsWith('Risk paid off')).length).toBe(RISK_CAP);
  });
  it('a quarterback who takes his shots reaches the 90s in about two seasons; one who plays it safe takes about three', () => {
    const run = (risky: boolean) => {
      const c = start(5); joinTeam(c);
      const r = rng(hash('prog', risky ? 1 : 0));
      const ovr = [youPlayer(c).rating];
      for (let season = 0; season < 3; season++) {
        for (let g = 0; g < 17; g++) {
          const risks: RiskWin[] = risky ? Array.from({ length: Math.floor(r() * 3) }, () => ({ kind: 'deep', label: 'x', attr: (['arm', 'decision', 'accuracy', 'mobility'] as const)[Math.floor(r() * 4)] })) : [];
          c.goals = [];
          awardXp(c, `g${season}-${g}`, { pa: 34, pc: 22, py: 250, ptd: 2, pint: 1, ra: 3, ry: 12 }, r() < 0.55, 'moments', Array(10).fill(78), 'reg', risks);
          for (;;) {
            const me = youPlayer(c);
            const a = (['accuracy', 'arm', 'decision', 'mobility'] as const).filter((k) => (me.attrs[k] ?? 60) < 99).sort((x, y) => (me.attrs[x] ?? 60) - (me.attrs[y] ?? 60))[0];
            if (!a || c.you.sp < attrCost(me.attrs[a] ?? 60)) break;
            upgrade(c, a);
          }
        }
        ovr.push(youPlayer(c).rating);
      }
      return ovr;
    };
    const safe = run(false), risky = run(true);
    expect(safe[0]).toBeLessThan(70);
    expect(risky[2]).toBeGreaterThanOrEqual(90);
    expect(safe[2]).toBeLessThan(90);
    expect(safe[3]).toBeGreaterThanOrEqual(86);
    for (let i = 1; i <= 3; i++) expect(risky[i]).toBeGreaterThan(safe[i]);
  });
});

describe('draft night', () => {
  it('a better team often trades up for you, so you are not always drafted by a bad one', () => {
    let better = 0, trades = 0, n = 0, eliteTrades = 0;
    for (let seed = 1; seed <= 25; seed++) {
      const c = start(seed);
      const order = draftOrderFor(c.league, c.season, c.seed);
      for (const stock of [85, 55, 35]) {
        const d = makeDraft(c, order, stock);
        const team = d.picks.find((p) => p.you)!.team;
        n++;
        if (order.indexOf(team) >= 16) better++;
        if (d.trade) {
          trades++;
          if ((c.league.players[c.league.teams.find((t) => t.id === d.trade!.team)!.roster.QB]?.rating ?? 0) >= 85) eliteTrades++;
          expect(order.indexOf(d.trade.team)).toBeGreaterThanOrEqual(16);   // only the better half trades up
          expect(d.trade.from).toBe(order[(d.yourPick - 1) % 32]);
        }
        expect(d.interest).toContain(team);
        expect(new Set(d.interest).size).toBe(d.interest!.length);
      }
    }
    expect(trades / n).toBeGreaterThan(0.3);
    expect(eliteTrades / Math.max(1, trades)).toBeLessThan(0.1);   // a team with an elite quarterback rarely trades up for one
    expect(better / n).toBeGreaterThan(0.5);
  });
  it('joining the team uses the team that actually drafted you', () => {
    const c = start(9);
    const d = c.draft!;
    joinTeam(c);
    expect(youPlayer(c).team).toBe(d.picks.find((p) => p.you)!.team);
    expect(c.league.teams.find((t) => t.id === youPlayer(c).team)!.roster.QB).toBe('you');
  });
});

describe('media day', () => {
  it('three questions with a valid right answer each, the same for a career after a reload', () => {
    const qs = mediaQuestions(42);
    expect(qs).toHaveLength(3);
    for (const q of qs) { expect(q.a[q.right]).toBe(MEDIA_QS.find((x) => x.q === q.q)!.a[0]); }
    expect(mediaQuestions(42)).toEqual(qs);
  });
  it('moves the draft stock once and redraws the board', () => {
    const c = start(4);
    const before = c.draft!.stock!;
    finishMediaDay(c, 2, 1);
    expect(c.draft!.stock).toBe(Math.min(99, Math.max(2, before + 2 * MEDIA_RIGHT + MEDIA_WRONG)));
    expect(c.draft!.media).toBe(2 * MEDIA_RIGHT + MEDIA_WRONG);
    const again = c.draft!.stock;
    finishMediaDay(c, 3, 0);
    expect(c.draft!.stock).toBe(again);
  });
});

describe('the league changes over the years', () => {
  it('team rankings move: several teams rise or fall eight or more places in four seasons', () => {
    let moved = 0, total = 0;
    for (const seed of [3, 11]) {
      const c = start(seed); joinTeam(c);
      const r0 = new Map(c.league.teams.map((t) => [t.id, teamInfo(c.league, t).rat.ovr]));
      for (let yr = 0; yr < 4; yr++) {
        for (let w = 1; w <= 22; w++) { const g = yourGameThisWeek(c); if (g && !g.score) simYourGame(c, g); closeWeek(c); }
        endSeason(c); runOffseason(c);
        if (c.you.contract!.years === 0) { const o = offers(c); signWith(c, o[0].team, o[0].years, o[0].salary); }
        startNextSeason(c);
      }
      const r4 = new Map(c.league.teams.map((t) => [t.id, teamInfo(c.league, t).rat.ovr]));
      const ids = c.league.teams.map((t) => t.id);
      const rk = (m: Map<string, number>) => new Map([...ids].sort((a, b) => m.get(b)! - m.get(a)!).map((id, i) => [id, i]));
      const a = rk(r0), b = rk(r4);
      for (const id of ids) { total++; if (Math.abs(a.get(id)! - b.get(id)!) >= 8) moved++; }
    }
    expect(moved / total).toBeGreaterThan(0.28);
  }, 300000);
});
