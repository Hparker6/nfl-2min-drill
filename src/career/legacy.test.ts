/** Career Legacy: the Hall of Fame rules, the record book, the league's history and retirement. */
import { beforeAll, describe, expect, it } from 'vitest';
import { joinTeam, newCareer, yourGameThisWeek, type Career, type SeasonSummary } from './career';
import { closeWeek, finishLive, simYourGame, startLive, COLLEGE_GAME } from './run';
import { endSeason, offers, runOffseason, signWith, startNextSeason } from './offseason';
import { step } from '../engine/game';
import {
  canRetire, careerTotals, ensureLegacy, hallEntry, HOF, legacyScore, mainTeam, noteSeason, retire, seasonBests, verdict,
} from './legacy';

const season = (o: Partial<SeasonSummary> & { year: number }): SeasonSummary => ({ team: 'BKN', line: {}, w: 9, l: 8, t: 0, awards: [], ovr: 80, ...o });

describe('Hall of Fame rules', () => {
  it('tiers by score, with five seasons needed for the Hall', () => {
    expect(verdict(260, 12).tier).toBe('first');
    expect(verdict(HOF.first, 5).tier).toBe('first');
    expect(verdict(HOF.first - 1, 12).tier).toBe('hof');
    expect(verdict(HOF.hof, 9).tier).toBe('hof');
    expect(verdict(HOF.hof - 1, 9).tier).toBe('ring');
    expect(verdict(HOF.ring, 9).tier).toBe('ring');
    expect(verdict(HOF.solid, 9).tier).toBe('solid');
    expect(verdict(HOF.solid - 1, 9).tier).toBe('short');
    // a great short career is a Ring of Honor at most
    expect(verdict(400, 4)).toMatchObject({ tier: 'ring', eligible: false });
    expect(verdict(60, 3).tier).toBe('solid');
  });

  it('the vote: first ballot is exactly 80% or more; later elections take 2-5 years', () => {
    for (let s = 0; s <= 400; s += 5) {
      const v = verdict(s, 10);
      expect(v.vote).toBeGreaterThanOrEqual(1);
      expect(v.vote).toBeLessThanOrEqual(99);
      if (v.tier === 'first') { expect(v.vote).toBeGreaterThanOrEqual(80); expect(v.electedIn).toBe(1); }
      else expect(v.vote).toBeLessThan(80);
      if (v.tier === 'hof') { expect(v.electedIn).toBeGreaterThanOrEqual(2); expect(v.electedIn).toBeLessThanOrEqual(5); }
    }
    // higher score, never a later election
    expect(verdict(240, 10).electedIn!).toBeLessThanOrEqual(verdict(175, 10).electedIn!);
  });

  it('the score adds up line by line', () => {
    const h = [
      season({ year: 2026, w: 12, line: { py: 5000, ptd: 40, rtd: 0 }, playoff: 'Won the Gridiron Bowl', awards: ['Most Valuable Player', 'Pro Bowl', 'Gridiron Bowl MVP'] }),
      season({ year: 2027, w: 10, line: { py: 5000, ptd: 30, rtd: 10 }, playoff: 'Lost in the Wild Card round', awards: ['Pro Bowl'] }),
      season({ year: 2028, w: 4, line: { py: 2500, ptd: 20 } }),
    ];
    const { total, parts } = legacyScore(h, 1);
    // wins 26*0.5=13, yards 12500/2500=5, TD 100/20=5, title 25, wild card 2, MVP 20, Pro Bowl 2*4=8, final MVP 10, record 5
    expect(total).toBe(13 + 5 + 5 + 25 + 2 + 20 + 8 + 10 + 5);
    expect(parts.map((p) => p.label)).toEqual(['Winning', 'Passing yards', 'Touchdowns', 'Gridiron Bowl titles', 'Wild Card round losses', 'Most Valuable Player', 'Gridiron Bowl MVP', 'Pro Bowls', 'League records']);
    expect(Math.round(parts.reduce((a, p) => a + p.pts, 0))).toBe(total);
  });

  it('calibration: a long, decorated career gets in; a short ordinary one does not', () => {
    // the shape of a simmed 15-season career (scripts/hof.gen.test.ts): Pro Bowls, two OPOYs, playoff trips, no title
    const long = Array.from({ length: 15 }, (_, i) => season({
      year: 2026 + i, w: 9, line: { py: 4200, ptd: 30, rtd: 2 },
      playoff: i % 3 === 0 ? 'Lost in the Divisional round' : i % 3 === 1 ? 'Lost in the Wild Card round' : undefined,
      awards: i < 4 ? ['Pro Bowl'] : i === 6 || i === 8 ? ['Offensive Player of the Year'] : [],
    }));
    const L = legacyScore(long);
    expect(verdict(L.total, long.length).tier).toBe('hof');
    const short = Array.from({ length: 4 }, (_, i) => season({ year: 2026 + i, w: 7, line: { py: 3500, ptd: 22 } }));
    expect(['solid', 'short']).toContain(verdict(legacyScore(short).total, short.length).tier);
  });

  it('the Ring of Honor team is the one he played most seasons for (the latest on a tie)', () => {
    expect(mainTeam([season({ year: 1, team: 'A' }), season({ year: 2, team: 'B' }), season({ year: 3, team: 'B' }), season({ year: 4, team: 'A' })])).toBe('A');
    expect(mainTeam([season({ year: 1, team: 'A' }), season({ year: 2, team: 'B' }), season({ year: 3, team: 'B' })])).toBe('B');
    expect(mainTeam([])).toBeUndefined();
  });
});

describe('record book', () => {
  it('career totals, playoff results and honors', () => {
    const h = [
      season({ year: 2026, w: 11, l: 6, line: { pa: 500, pc: 330, py: 4000, ptd: 30, pint: 10, plng: 70 }, po: { pa: 40, py: 300, ptd: 2 }, playoff: 'Won the Gridiron Bowl', awards: ['Pro Bowl'] }),
      season({ year: 2027, w: 8, l: 9, line: { pa: 480, pc: 300, py: 3600, ptd: 24, pint: 12, plng: 64 }, playoff: 'Lost in the Gridiron Bowl', awards: ['Pro Bowl'] }),
    ];
    const T = careerTotals(h);
    expect(T).toMatchObject({ seasons: 2, w: 19, l: 15, playoffs: 2, titles: 1, finals: 2, awards: { 'Pro Bowl': 2 } });
    expect(T.line).toMatchObject({ pa: 980, pc: 630, py: 7600, ptd: 54, pint: 22, plng: 70 });
    expect(T.po).toMatchObject({ pa: 40, py: 300, ptd: 2 });
  });

  it('best seasons: passer rating only counts with 200 attempts', () => {
    const b = seasonBests([
      season({ year: 2026, w: 12, line: { pa: 100, pc: 90, py: 1500, ptd: 20 } }),
      season({ year: 2027, w: 9, line: { pa: 500, pc: 320, py: 4100, ptd: 28, pint: 9 } }),
    ]);
    const get = (k: string) => b.find((x) => x.key === k);
    expect(get('py')).toMatchObject({ v: 4100, year: 2027 });
    expect(get('w')).toMatchObject({ v: 12, year: 2026 });
    expect(get('rating')?.year).toBe(2027);
  });
});

/** Play a career's college game, the draft and `n` seasons, simmed (each ends in the offseason, ready for the next). */
function playSeasons(c: Career, n: number) {
  if (c.phase === 'college') {
    startLive(c, COLLEGE_GAME, 'moments');
    const live = c.live!;
    for (let i = 0; i < 5000 && live.s.stage !== 'over'; i++) step(live.seed, live.s, live.ev);
    finishLive(c, 'sim');
    joinTeam(c);
  }
  for (let k = 0; k < n; k++) {
    if (c.phase === 'offseason') {
      const o = offers(c);
      if (o.length) signWith(c, o[0].team, o[0].years, o[0].salary);
      startNextSeason(c);
    }
    for (let w = 1; w <= 22; w++) {
      const g = yourGameThisWeek(c);
      if (g && !g.score) simYourGame(c, g);
      closeWeek(c);
    }
    endSeason(c);
    runOffseason(c);
  }
}

describe('a career, played', () => {
  let c: Career;
  beforeAll(() => {
    c = newCareer({ name: 'Legacy Tester', number: 12, arch: 'general', college: 2, seed: 777 });
    playSeasons(c, 2);
  }, 120_000);

  it('the league history starts with the season before the draft, then one row a season', () => {
    const L = c.legacy!;
    expect(L.since).toBe(2025);
    expect(L.annals.map((a) => a.year)).toEqual([2025, 2026, 2027]);
    for (const a of L.annals) {
      expect(c.league.teams.some((t) => t.id === a.champion)).toBe(true);
      expect(a.runnerUp).not.toBe(a.champion);
      expect(a.final![0]).toBeGreaterThan(a.final![1]);
      expect(a.awards.find((x) => x.key === 'mvp')?.player).toBeTruthy();
    }
    expect(L.annals[0].you).toBeUndefined();
    expect(L.annals[1].you).toMatchObject({ team: c.history[0].team, w: c.history[0].w });
  });

  it('league single-season records, and your best games, are kept', () => {
    const L = c.legacy!;
    expect(L.records.py?.v).toBeGreaterThan(3000);
    expect(L.records.sck?.v).toBeGreaterThan(5);
    expect(L.games.py?.v).toBeGreaterThan(200);
    expect(L.games.py!.year).toBeGreaterThanOrEqual(2026);
    expect(c.league.teams.some((t) => t.id === L.games.py!.opp)).toBe(true);
  });

  it('a season is never written into the history twice', () => {
    const n = c.legacy!.annals.length;
    expect(noteSeason(c, c.season)).toEqual([]);
    expect(c.legacy!.annals.length).toBe(n);
  });

  it('retiring: only in the offseason, then the vote, and the career ends', () => {
    expect(canRetire(c)).toBe(true);
    const x = structuredClone(c);
    const r = retire(x);
    expect(x.phase).toBe('retired');
    expect(x.legacy!.retired).toEqual(r);
    expect(r.score).toBe(legacyScore(x.history, Object.values(x.legacy!.records).filter((v) => v?.you).length).total);
    expect(r.verdict.eligible).toBe(false);   // two seasons
    expect(['ring', 'solid', 'short']).toContain(r.verdict.tier);
    expect(canRetire(x)).toBe(false);
    const e = hallEntry(x, 'Game Manager')!;
    expect(e).toMatchObject({ id: x.id, name: 'Legacy Tester', first: 2026, last: 2027, score: r.score });
    // mid-season, no
    const y = structuredClone(c);
    startNextSeason(y);
    expect(canRetire(y)).toBe(false);
  });

  it('a career saved before Legacy, mid-season, recovers its games so far', () => {
    const x = structuredClone(c);
    startNextSeason(x);
    for (let w = 1; w <= 4; w++) { const g = yourGameThisWeek(x); if (g && !g.score) simYourGame(x, g); closeWeek(x); }
    delete x.legacy;
    const L = ensureLegacy(x);
    expect(L.since).toBe(x.season.year);
    expect(L.annals).toEqual([]);
    expect(L.games.py?.year).toBe(x.season.year);
    expect(ensureLegacy(x)).toBe(L);
  });

  it('a career saved before Legacy, in the offseason, recovers the season just played', () => {
    const x = structuredClone(c);
    delete x.legacy;
    const L = ensureLegacy(x);
    expect(L.annals.map((a) => a.year)).toEqual([x.season.year]);
    expect(L.annals[0].you?.team).toBe(x.history[x.history.length - 1].team);
  });
});
