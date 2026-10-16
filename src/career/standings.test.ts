import { describe, expect, it } from 'vitest';
import { hash, rng } from '../engine/rng';
import { divisionOrder, draftOrder, picture, playoffRound, seeds, standings } from './standings';
import type { Conf, CTeam, Div, Game, GameKind } from './types';

const TEAMS: CTeam[] = Array.from({ length: 32 }, (_, i) => ({
  id: `T${i}`, city: `City ${i}`, name: `Team ${i}`, color: '#000', color2: '#fff',
  conf: Math.floor(i / 16) as Conf, div: (Math.floor(i / 4) % 4) as Div, roster: {},
}));
const COINS = Array.from({ length: 20 }, (_, i) => i + 1);

let gid = 0;
const game = (home: string, away: string, score?: [number, number], week = 1, kind: GameKind = 'reg'): Game =>
  ({ id: `g${gid++}`, week, kind, home, away, score });
/** `a` beats `b` at home. */
const beat = (a: string, b: string, week = 1) => game(a, b, [24, 17], week);

/** A 17-game season: weeks 1-6 a double round-robin in each division, then random pairings, random scores. */
function season(seed: number): Game[] {
  const r = rng(seed);
  const out: Game[] = [];
  const pairs = [[[0, 1], [2, 3]], [[0, 2], [1, 3]], [[0, 3], [1, 2]]];
  for (let week = 1; week <= 17; week++) {
    let ms: [string, string][] = [];
    if (week <= 6) {
      for (let d = 0; d < 8; d++) {
        for (const [a, b] of pairs[(week - 1) % 3]) ms.push(week <= 3 ? [`T${d * 4 + a}`, `T${d * 4 + b}`] : [`T${d * 4 + b}`, `T${d * 4 + a}`]);
      }
    } else {
      const ids = TEAMS.map((t) => t.id);
      for (let i = ids.length - 1; i > 0; i--) {
        const j = Math.floor(r() * (i + 1));
        [ids[i], ids[j]] = [ids[j], ids[i]];
      }
      ms = Array.from({ length: 16 }, (_, i) => [ids[2 * i], ids[2 * i + 1]]);
    }
    for (const [h, a] of ms) {
      const hs = Math.floor(r() * 35);
      out.push(game(h, a, [hs, r() < 0.03 ? hs : Math.floor(r() * 35)], week));
    }
  }
  return out;
}

/** Play out the bracket with random (never tied) results. */
function playoffs(games: Game[], seed: number, coin: number): Game[] {
  const r = rng(seed);
  const all = [...games];
  (['wc', 'div', 'conf', 'final'] as const).forEach((round, i) => {
    for (const m of playoffRound(TEAMS, all, round, coin)) {
      const hs = Math.floor(r() * 35);
      all.push(game(m.home, m.away, [hs, r() < 0.5 ? hs + 3 : Math.max(0, hs - 3)], 19 + i, round));
    }
  });
  return all;
}

describe('standings', () => {
  it('counts records, ties as half a win, and streaks from the latest game', () => {
    const games = [
      game('T0', 'T2', [14, 7], 5),          // listed first: order comes from the week
      beat('T0', 'T1', 1),
      game('T8', 'T0', [30, 10], 2),
      game('T0', 'T20', [17, 17], 3),
      game('T21', 'T0', [3, 20], 4),
      game('T0', 'T3', undefined, 6),         // unplayed
      game('T0', 'T5', [0, 50], 19, 'wc'),    // playoffs don't count
    ];
    const s = standings(TEAMS, games);
    expect(s.T0).toMatchObject({
      w: 3, l: 1, t: 1, pf: 85, pa: 74, divW: 2, divL: 0, divT: 0, confW: 2, confL: 1, confT: 0,
      homeW: 2, homeL: 0, awayW: 1, awayL: 1, streak: 'W2',
    });
    expect(s.T0.pct).toBeCloseTo(0.7);
    expect(s.T20).toMatchObject({ t: 1, pct: 0.5, streak: 'T1', confT: 0 });
    expect(s.T8.streak).toBe('W1');
    expect(s.T1.streak).toBe('L1');
    expect(s.T3).toMatchObject({ w: 0, l: 0, t: 0, pct: 0, streak: '' });
    expect(s.T5.w + s.T5.l).toBe(0);
    expect(Object.keys(s)).toHaveLength(32);
  });
});

describe('division tiebreakers', () => {
  it('head-to-head settles a two-way tie', () => {
    const games = [beat('T0', 'T1'), beat('T8', 'T0'), beat('T1', 'T2'), beat('T9', 'T3')];
    for (const c of COINS) expect(divisionOrder(TEAMS, games, 0, 0, c).slice(0, 2)).toEqual(['T0', 'T1']);
  });
  it('division record settles a split head-to-head', () => {
    const games = [
      beat('T0', 'T1', 1), beat('T1', 'T0', 2), beat('T0', 'T2', 3), beat('T8', 'T0', 4),
      beat('T1', 'T16', 3), beat('T3', 'T1', 4),
    ];
    for (const c of COINS) expect(divisionOrder(TEAMS, games, 0, 0, c)).toEqual(['T3', 'T0', 'T1', 'T2']);
  });
  it('a three-way tie: conference record takes one out, then the other two restart at head-to-head', () => {
    // a circle of division wins, then each beats one outsider (only T0's is in the conference)
    const games = [
      beat('T0', 'T1'), beat('T1', 'T2'), beat('T2', 'T0'),
      beat('T0', 'T8', 2), beat('T1', 'T24', 2), beat('T2', 'T25', 2),
    ];
    for (const c of COINS) expect(divisionOrder(TEAMS, games, 0, 0, c)).toEqual(['T0', 'T1', 'T2', 'T3']);
  });
  it('the coin flip is seeded: same seed, same order; it follows hash(seed, team)', () => {
    const orders = new Set<string>();
    for (const c of COINS) {
      const o = divisionOrder(TEAMS, [], 1, 2, c);
      expect(divisionOrder(TEAMS, [], 1, 2, c)).toEqual(o);
      expect(o).toEqual(['T24', 'T25', 'T26', 'T27'].sort((a, b) => hash(c, b) - hash(c, a)));
      orders.add(o.join());
    }
    expect(orders.size).toBeGreaterThan(1);
  });
});

describe('seeds', () => {
  // division leaders at 3-0 on out-of-conference wins; T13 the top wild card; T1, T2 and T9 tied at .500
  const games = [
    ...['T16', 'T17', 'T18'].map((o) => beat('T0', o)), ...['T19', 'T20', 'T21'].map((o) => beat('T4', o)),
    ...['T22', 'T23', 'T24'].map((o) => beat('T8', o)), ...['T25', 'T26', 'T27'].map((o) => beat('T12', o)),
    beat('T1', 'T2'), beat('T1', 'T30'), beat('T1', 'T30'), beat('T13', 'T1'), beat('T31', 'T1'), beat('T31', 'T1'),
    beat('T2', 'T13'), beat('T2', 'T14'), beat('T2', 'T6'), beat('T31', 'T2'), beat('T31', 'T2'),
    beat('T9', 'T15'), beat('T9', 'T15'), beat('T13', 'T9'), beat('T28', 'T9'),
  ];
  it('wild-card ties keep only the best of each division in the comparison', () => {
    // T2 has the best conference record of the three, but T1 is ahead of it in their division (head-to-head),
    // so T1 stands in for the division: T9 beats T1 on conference record, then T1 is next and T2 misses out
    for (const c of COINS) {
      expect(divisionOrder(TEAMS, games, 0, 0, c)).toEqual(['T0', 'T1', 'T2', 'T3']);
      const s = seeds(TEAMS, games, 0, c);
      expect([...s.slice(0, 4)].sort()).toEqual(['T0', 'T12', 'T4', 'T8']);
      expect(s.slice(4)).toEqual(['T13', 'T9', 'T1']);
    }
  });
  it('a full season: the four division winners are 1-4, the best of the rest 5-7', () => {
    for (let k = 0; k < 5; k++) {
      const games = season(100 + k);
      const st = standings(TEAMS, games);
      for (const conf of [0, 1] as Conf[]) {
        const s = seeds(TEAMS, games, conf, k);
        const winners = ([0, 1, 2, 3] as Div[]).map((d) => divisionOrder(TEAMS, games, conf, d, k)[0]);
        expect([...s.slice(0, 4)].sort()).toEqual([...winners].sort());
        expect(new Set(s).size).toBe(7);
        for (let i = 1; i < 7; i++) if (i !== 4) expect(st[s[i]].pct).toBeLessThanOrEqual(st[s[i - 1]].pct);
        const out = TEAMS.filter((t) => t.conf === conf && !s.includes(t.id));
        for (const t of out) expect(st[t.id].pct).toBeLessThanOrEqual(st[s[6]].pct);
      }
    }
  });
});

describe('playoffs and the draft', () => {
  it('pairs each round, reseeds the divisional round, and drafts the champion last', () => {
    const coin = 7;
    let games = season(42);
    expect(playoffRound(TEAMS, games.map((g) => (g.week === 17 ? { ...g, score: undefined } : g)), 'wc', coin)).toEqual([]);
    const a = seeds(TEAMS, games, 0, coin), b = seeds(TEAMS, games, 1, coin);
    const wc = playoffRound(TEAMS, games, 'wc', coin);
    expect(wc).toEqual([
      { home: a[1], away: a[6] }, { home: a[2], away: a[5] }, { home: a[3], away: a[4] },
      { home: b[1], away: b[6] }, { home: b[2], away: b[5] }, { home: b[3], away: b[4] },
    ]);
    expect(playoffRound(TEAMS, games, 'div', coin)).toEqual([]);
    // the road teams win in conference 0 (7, 6 and 5 go through), the home teams in conference 1
    const play = (kind: GameKind, ms: { home: string; away: string }[], homeWins: (i: number) => boolean) => {
      games = [...games, ...ms.map((m, i) => game(m.home, m.away, homeWins(i) ? [20, 10] : [10, 20], 20, kind))];
    };
    play('wc', wc, (i) => i >= 3);
    const div = playoffRound(TEAMS, games, 'div', coin);
    expect(div).toEqual([
      { home: a[0], away: a[6] }, { home: a[4], away: a[5] },
      { home: b[0], away: b[3] }, { home: b[1], away: b[2] },
    ]);
    play('div', div.slice(0, 1), () => true);
    expect(playoffRound(TEAMS, games, 'conf', coin)).toEqual([]);
    play('div', div.slice(1), () => true);
    const conf = playoffRound(TEAMS, games, 'conf', coin);
    expect(conf).toEqual([{ home: a[0], away: a[4] }, { home: b[0], away: b[1] }]);
    expect(draftOrder(TEAMS, games, coin)).toHaveLength(32);
    play('conf', conf, (i) => i === 1);
    const final = playoffRound(TEAMS, games, 'final', coin);
    expect(final).toEqual([{ home: a[4], away: b[0] }]);
    play('final', final, () => false);

    const st = standings(TEAMS, games);
    const d = draftOrder(TEAMS, games, coin);
    expect(new Set(d).size).toBe(32);
    expect(d[31]).toBe(b[0]);
    expect(d[30]).toBe(a[4]);
    expect([...d.slice(28, 30)].sort()).toEqual([a[0], b[1]].sort());
    expect([...d.slice(24, 28)].sort()).toEqual([a[5], a[6], b[2], b[3]].sort());
    expect([...d.slice(18, 24)].sort()).toEqual([a[1], a[2], a[3], b[4], b[5], b[6]].sort());
    const seeded = [...a, ...b];
    expect(d.slice(0, 18).every((id) => !seeded.includes(id))).toBe(true);
    for (let i = 1; i < 18; i++) expect(st[d[i]].pct).toBeGreaterThanOrEqual(st[d[i - 1]].pct);
    expect(Math.min(...TEAMS.map((t) => st[t.id].pct))).toBe(st[d[0]].pct);
  });
  it('before the playoffs finish, the draft is simply worst record first', () => {
    const games = season(9);
    const st = standings(TEAMS, games);
    const d = draftOrder(TEAMS, games, 3);
    expect(new Set(d).size).toBe(32);
    for (let i = 1; i < 32; i++) expect(st[d[i]].pct).toBeGreaterThanOrEqual(st[d[i - 1]].pct);
  });
});

describe('clinch markers', () => {
  /** A conference-0 team's record so far, against its own conference-1 opponent, with games still to play. */
  const record = (i: number, w: number, l: number, left = 2): Game[] => {
    const id = `T${i}`, opp = `T${i + 16}`;
    return [
      ...Array.from({ length: w }, (_, k) => beat(id, opp, k + 1)),
      ...Array.from({ length: l }, (_, k) => beat(opp, id, w + k + 1)),
      ...Array.from({ length: left }, (_, k) => game(id, opp, undefined, w + l + k + 1)),
    ];
  };
  const midSeason = (t4Wins: number) => [
    ...record(0, 10, 0), ...record(4, t4Wins, 10 - t4Wins),
    ...[8, 9, 10, 12, 13].flatMap((i) => record(i, 7, 3)), ...record(14, 5, 5),
    ...[1, 2, 3, 5, 6, 7, 11, 15].flatMap((i) => record(i, 2, 8)),
  ];
  it('mid-season: division clinched, nothing yet for the pack, eliminated at the bottom', () => {
    const p = picture(TEAMS, midSeason(9), 1);
    expect(p.T0.clinch).toBe('y');            // T4 can still pass it for the bye
    expect(p.T4.clinch).toBe('y');
    for (const id of ['T8', 'T9', 'T10', 'T12', 'T13', 'T14']) expect(p[id].clinch).toBeUndefined();
    for (const id of ['T1', 'T2', 'T3', 'T5', 'T6', 'T7', 'T11', 'T15']) expect(p[id].clinch).toBe('e');
    expect(p.T0.seed).toBe(1);
    expect(TEAMS.filter((t) => t.conf === 0 && p[t.id].seed).length).toBe(7);
    expect(picture(TEAMS, midSeason(7), 1).T0.clinch).toBe('z');
  });
  it('a full season: markers come from the final seeds', () => {
    const games = season(5);
    const p = picture(TEAMS, games, 2);
    for (const conf of [0, 1] as Conf[]) {
      const s = seeds(TEAMS, games, conf, 2);
      s.forEach((id, i) => {
        expect(p[id].seed).toBe(i + 1);
        expect(p[id].clinch).toBe(i === 0 ? 'z' : i < 4 ? 'y' : 'x');
      });
      for (const t of TEAMS) if (t.conf === conf && !s.includes(t.id)) {
        expect(p[t.id].clinch).toBe('e');
        expect(p[t.id].seed).toBeUndefined();
      }
    }
  });
});

describe('random seasons', () => {
  it('keep their invariants, and mid-season markers hold up once the season is played out', () => {
    for (let k = 0; k < 12; k++) {
      const full = season(1000 + k);
      const st = standings(TEAMS, full);
      const rows = Object.values(st);
      for (const r of rows) expect(r.w + r.l + r.t).toBe(17);
      expect(rows.reduce((n, r) => n + r.w, 0)).toBe(rows.reduce((n, r) => n + r.l, 0));
      expect(rows.reduce((n, r) => n + r.pf, 0)).toBe(rows.reduce((n, r) => n + r.pa, 0));
      for (const conf of [0, 1] as Conf[]) for (const div of [0, 1, 2, 3] as Div[]) {
        const o = divisionOrder(TEAMS, full, conf, div, k);
        expect([...o].sort()).toEqual(TEAMS.filter((t) => t.conf === conf && t.div === div).map((t) => t.id).sort());
        for (let i = 1; i < 4; i++) expect(st[o[i]].pct).toBeLessThanOrEqual(st[o[i - 1]].pct);
      }
      const final = [0, 1].flatMap((c) => seeds(TEAMS, full, c as Conf, k));
      const winners = new Set(([0, 1] as Conf[]).flatMap((c) => ([0, 1, 2, 3] as Div[]).map((d) => divisionOrder(TEAMS, full, c, d, k)[0])));
      for (const week of [10, 13, 16]) {
        const p = picture(TEAMS, full.map((g) => (g.week > week ? { ...g, score: undefined } : g)), k);
        for (const t of TEAMS) {
          const c = p[t.id].clinch;
          if (c === 'z') expect(final[t.conf * 7]).toBe(t.id);
          if (c === 'y') expect(winners.has(t.id)).toBe(true);
          if (c === 'x' || c === 'y' || c === 'z') expect(final).toContain(t.id);
          if (c === 'e') expect(final).not.toContain(t.id);
        }
      }
      const done = playoffs(full, k, k);
      const d = draftOrder(TEAMS, done, k);
      expect(new Set(d).size).toBe(32);
      const fin = done.find((g) => g.kind === 'final')!;
      expect(d[31]).toBe(fin.score![0] > fin.score![1] ? fin.home : fin.away);
      expect(done.filter((g) => g.kind !== 'reg')).toHaveLength(13);
    }
  });
});
