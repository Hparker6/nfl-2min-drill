import { describe, expect, it } from 'vitest';
import { BADGES, awardBadges, earned, titleFor } from './badges';
import { keyMoments } from './recap';
import { defaultStore, type SpotResult } from './storage';
import type { Record_ } from './session';
import type { Grade } from './grade';

const res = (o: Partial<SpotResult> = {}): SpotResult => ({
  id: 'x', mode: 'daily', date: '2026-10-21', teams: ['A', 'B'], win: false, ot: false, score: [17, 20], grades: ['y', 'y'], scores: [80, 80],
  lost: 3, aiLost: 2, tags: [], baseWp: 0.4, ...o,
});
const facts = { lead0: 0, t0: 120, perfect: false, fourth: 0, two: 0, takeaways: 0, long: 8, clutchGreen: false };

describe('badges', () => {
  it('every badge has a unique id, a name and how to earn it', () => {
    expect(new Set(BADGES.map((b) => b.id)).size).toBe(BADGES.length);
    for (const b of BADGES) expect(b.name && b.how && b.icon).toBeTruthy();
  });
  it('a first loss earns the debut; a win, a rally, ice water and overtime earn theirs', () => {
    const st = defaultStore();
    st.history.push(res({ facts }));
    expect([...earned(st)]).toEqual(['debut']);
    st.history.push(res({ win: true, ot: true, facts: { ...facts, lead0: -7, t0: 45 } }));
    for (const id of ['win', 'rally', 'icewater', 'bonus']) expect(earned(st).has(id)).toBe(true);
  });
  it('outcalling the AI coach, a flawless game, fourth downs over several games, a takeaway, a long gain, a clutch win', () => {
    const st = defaultStore();
    st.history.push(res({ aiLost: 6, lost: 1, grades: ['g', 'g', 'g'], facts: { ...facts, fourth: 2 } }));
    st.history.push(res({ facts: { ...facts, fourth: 1, takeaways: 1, long: 44 } }));
    st.history.push(res({ win: true, facts: { ...facts, clutchGreen: true, two: 1 } }));
    const e = earned(st);
    for (const id of ['outcall', 'flawless', 'gambler', 'ballhawk', 'homerun', 'clutch', 'twopoint']) expect(e.has(id)).toBe(true);
    expect(e.has('outcall10')).toBe(false);
  });
  it('practice games never count', () => {
    const st = defaultStore();
    st.history.push(res({ mode: 'practice', win: true }));
    expect(earned(st).size).toBe(0);
  });
  it('streaks and Survivor runs', () => {
    const st = defaultStore();
    for (let d = 1; d <= 7; d++) st.days[`2026-10-0${d}`] = { spots: [res()] };
    st.surv.best = 5;
    const e = earned(st);
    for (const id of ['streak3', 'streak7', 'surv5']) expect(e.has(id)).toBe(true);
    expect(e.has('streak30') || e.has('surv10') || e.has('season')).toBe(false);
  });
  it('awards each badge once, with the date, and a badge stays earned after old games roll off', () => {
    const st = defaultStore();
    st.history.push(res({ win: true, lost: 14 }));
    expect(awardBadges(st, '2026-10-21').map((b) => b.id)).toEqual(['debut', 'win']);
    expect(awardBadges(st, '2026-10-22')).toEqual([]);
    expect(st.badges).toEqual({ debut: '2026-10-21', win: '2026-10-21' });
    st.history = [];
    expect(earned(st).has('win')).toBe(true);
  });
  it('titles climb with badges', () => {
    expect(titleFor(0)).toBe('Rookie coach');
    expect(titleFor(6)).toBe('Coordinator');
    expect(titleFor(20)).toBe('Hall of Famer');
  });
});

describe('key moments', () => {
  const g = (o: Partial<Grade>): Grade => ({ g: 'g', score: 100, lost: 0, wp: 0.5, bestWp: 0.5, bestLabel: 'Slants', aiLabel: 'Punt', aiLost: 0, why: [''], ranked: [], ...o } as Grade);
  const rec = (label: string, grade: Grade, t = 100): Record_ => ({ step: 'play', title: '', key: label, label, choice: {}, situation: '3rd & 4 at the 40', t, grade });
  it('the best call (one the AI coach missed), the costliest, and the turning point', () => {
    const m = keyMoments([
      rec('Power', g({ wp: 0.4, bestWp: 0.4 }), 110),
      rec('Go for it', g({ wp: 0.45, bestWp: 0.45, aiLost: 6, aiLabel: 'Punt' }), 90),
      rec('Deep post', g({ g: 'r', lost: 9, wp: 0.3, bestWp: 0.39, bestLabel: 'Slants' }), 60),
      rec('Kneel', g({ wp: 0.95, bestWp: 0.95 }), 10),
    ]);
    expect(m.map((x) => [x.kind, x.call])).toEqual([['best', 'Go for it'], ['worst', 'Deep post'], ['turn', 'Deep post']]);
    expect(m[0].text).toMatch(/AI coach would have called Punt/);
    expect(m[2].text).toBe('Your win chance went from 30% to 95% on this one.');
  });
  it('nothing to say about a one-call game', () => {
    expect(keyMoments([rec('Kneel', g({}))])).toEqual([]);
  });
});
