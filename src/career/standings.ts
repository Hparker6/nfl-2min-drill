/**
 * Standings, the playoff picture, the bracket and the draft order, all derived from the schedule's results so a save
 * only has to keep the games. Tiebreakers follow the NFL's procedure in simplified form; the last resort is a coin
 * flip seeded by the season, so the same results always give the same order.
 */
import { hash } from '../engine/rng';
import type { Conf, CTeam, Div, Game, StandingRow } from './types';

/** One played regular-season game from a team's side: r is 1 for a win, 0.5 a tie, 0 a loss. */
interface Res { opp: string; r: number; pf: number; pa: number; home: boolean; week: number }

/** A tiebreak step: a value per tied team (higher is better), or null when the step can't compare them. */
type Step = (g: string[]) => number[] | null;

interface Ctx {
  teams: CTeam[];
  byId: Map<string, CTeam>;
  res: Map<string, Res[]>;
  rows: Record<string, StandingRow>;
  coin: number;
  divOrders: Map<string, string[]>;
  divSteps: Step[];
  wcSteps: Step[];
}

type Matchup = { home: string; away: string };
type Round = 'wc' | 'div' | 'conf' | 'final';

const EPS = 1e-9;
const ROUNDS: Round[] = ['wc', 'div', 'conf', 'final'];

function context(teams: CTeam[], games: Game[], coin: number): Ctx {
  const byId = new Map(teams.map((t) => [t.id, t]));
  const res = new Map<string, Res[]>(teams.map((t) => [t.id, []]));
  for (const g of games) {
    if (g.kind !== 'reg' || !g.score) continue;
    const [hs, as] = g.score;
    const r = hs > as ? 1 : hs < as ? 0 : 0.5;
    res.get(g.home)?.push({ opp: g.away, r, pf: hs, pa: as, home: true, week: g.week });
    res.get(g.away)?.push({ opp: g.home, r: 1 - r, pf: as, pa: hs, home: false, week: g.week });
  }
  for (const list of res.values()) list.sort((a, b) => a.week - b.week);
  const ctx: Ctx = { teams, byId, res, rows: {}, coin, divOrders: new Map(), divSteps: [], wcSteps: [] };
  for (const t of teams) ctx.rows[t.id] = row(ctx, t);
  const h2h: Step = (g) => pcts(ctx, g, (_, o) => g.includes(o));
  const conf: Step = (g) => pcts(ctx, g, (id, o) => sameConf(ctx, id, o));
  const sov: Step = (g) => g.map((id) => strength(ctx, id, true));
  const sos: Step = (g) => g.map((id) => strength(ctx, id, false));
  const flip: Step = (g) => g.map((id) => hash(coin, id));
  ctx.divSteps = [h2h, (g) => pcts(ctx, g, (id, o) => sameDiv(ctx, id, o)), common(ctx, 1), conf, sov, sos, flip];
  // across divisions teams may not have met, so head-to-head only counts as a 2-team record or a clean sweep
  const sweep: Step = (g) => {
    if (g.length === 2) return h2h(g);
    const v = g.map((id) => (g.every((o) => o === id || swept(ctx, id, o)) ? 1 : 0));
    return v.includes(1) ? v : null;
  };
  ctx.wcSteps = [sweep, conf, common(ctx, 4), sov, sos, flip];
  return ctx;
}

function row(ctx: Ctx, t: CTeam): StandingRow {
  const s: StandingRow = {
    team: t.id, w: 0, l: 0, t: 0, pct: 0, pf: 0, pa: 0, divW: 0, divL: 0, divT: 0, confW: 0, confL: 0, confT: 0,
    homeW: 0, homeL: 0, awayW: 0, awayL: 0, streak: '',
  };
  const list = ctx.res.get(t.id)!;
  for (const x of list) {
    const o = ctx.byId.get(x.opp);
    const inConf = o?.conf === t.conf, inDiv = inConf && o?.div === t.div;
    s.pf += x.pf; s.pa += x.pa;
    if (x.r === 1) {
      s.w++; if (inDiv) s.divW++; if (inConf) s.confW++;
      if (x.home) s.homeW++; else s.awayW++;
    } else if (x.r === 0) {
      s.l++; if (inDiv) s.divL++; if (inConf) s.confL++;
      if (x.home) s.homeL++; else s.awayL++;
    } else {
      s.t++; if (inDiv) s.divT++; if (inConf) s.confT++;
    }
  }
  const n = s.w + s.l + s.t;
  s.pct = n ? (s.w + s.t / 2) / n : 0;
  if (list.length) {
    const last = list[list.length - 1].r;
    let k = 0;
    while (k < list.length && list[list.length - 1 - k].r === last) k++;
    s.streak = (last === 1 ? 'W' : last === 0 ? 'L' : 'T') + k;
  }
  return s;
}

const sameConf = (ctx: Ctx, a: string, b: string) => ctx.byId.get(a)?.conf === ctx.byId.get(b)?.conf;
const sameDiv = (ctx: Ctx, a: string, b: string) => sameConf(ctx, a, b) && ctx.byId.get(a)?.div === ctx.byId.get(b)?.div;
const pctOf = (ctx: Ctx, id: string) => ctx.rows[id].pct;
const winsOf = (s: StandingRow) => s.w + s.t / 2;

/** Each team's win pct in the games `pick` selects; null if any of them has none (nothing to compare). */
function pcts(ctx: Ctx, g: string[], pick: (id: string, opp: string) => boolean): number[] | null {
  const v: number[] = [];
  for (const id of g) {
    let n = 0, p = 0;
    for (const x of ctx.res.get(id)!) if (pick(id, x.opp)) { n++; p += x.r; }
    if (!n) return null;
    v.push(p / n);
  }
  return v;
}

/** Record against the opponents every tied team has played, when there are at least `min` of them. */
function common(ctx: Ctx, min: number): Step {
  return (g) => {
    const sets = g.map((id) => new Set(ctx.res.get(id)!.map((x) => x.opp)));
    const both = new Set([...sets[0]].filter((o) => sets.every((s) => s.has(o))));
    return both.size < min ? null : pcts(ctx, g, (_, o) => both.has(o));
  };
}

/** Did `a` play `b` and win every meeting? */
function swept(ctx: Ctx, a: string, b: string): boolean {
  const met = ctx.res.get(a)!.filter((x) => x.opp === b);
  return met.length > 0 && met.every((x) => x.r === 1);
}

/** Combined win pct of the teams beaten (strength of victory) or of every opponent faced (strength of schedule). */
function strength(ctx: Ctx, id: string, beaten: boolean): number {
  let w = 0, n = 0;
  for (const x of ctx.res.get(id)!) {
    if (beaten && x.r !== 1) continue;
    const o = ctx.rows[x.opp];
    if (!o) continue;
    w += winsOf(o); n += o.w + o.l + o.t;
  }
  return n ? w / n : 0;
}

/**
 * The best of a tied group. A step that separates some teams but leaves two or more restarts the procedure for
 * those, as the NFL does; the coin flip always settles it.
 */
function best(g: string[], steps: Step[]): string {
  if (g.length === 1) return g[0];
  for (const step of steps) {
    const v = step(g);
    if (!v) continue;
    const top = Math.max(...v);
    const keep = g.filter((_, i) => v[i] >= top - EPS);
    if (keep.length < g.length) return best(keep, steps);
  }
  return [...g].sort()[0];
}

/** Order teams by win pct, breaking each tie by repeatedly taking the best of what's left of the group. */
function order(ctx: Ctx, ids: string[], pick: (g: string[]) => string): string[] {
  const sorted = [...ids].sort((a, b) => pctOf(ctx, b) - pctOf(ctx, a));
  const out: string[] = [];
  for (let i = 0; i < sorted.length;) {
    let j = i;
    while (j < sorted.length && Math.abs(pctOf(ctx, sorted[j]) - pctOf(ctx, sorted[i])) < EPS) j++;
    let group = sorted.slice(i, j);
    while (group.length) {
      const b = pick(group);
      out.push(b);
      group = group.filter((x) => x !== b);
    }
    i = j;
  }
  return out;
}

function divOrder(ctx: Ctx, conf: Conf, div: Div): string[] {
  const key = `${conf}-${div}`;
  let o = ctx.divOrders.get(key);
  if (!o) {
    const ids = ctx.teams.filter((t) => t.conf === conf && t.div === div).map((t) => t.id);
    o = order(ctx, ids, (g) => best(g, ctx.divSteps));
    ctx.divOrders.set(key, o);
  }
  return o;
}

/** Wild-card style best: division rivals in the group are first settled among themselves, only the top one stays. */
function bestWc(ctx: Ctx, g: string[]): string {
  const rank = (id: string) => { const t = ctx.byId.get(id)!; return divOrder(ctx, t.conf, t.div).indexOf(id); };
  const lead = g.filter((id) => !g.some((o) => o !== id && sameDiv(ctx, id, o) && rank(o) < rank(id)));
  return best(lead, ctx.wcSteps);
}

function seedsOf(ctx: Ctx, conf: Conf): string[] {
  const winners = ([0, 1, 2, 3] as Div[]).map((d) => divOrder(ctx, conf, d)[0]);
  const rest = ctx.teams.filter((t) => t.conf === conf && !winners.includes(t.id)).map((t) => t.id);
  const pick = (g: string[]) => bestWc(ctx, g);
  return [...order(ctx, winners, pick), ...order(ctx, rest, pick).slice(0, 3)];
}

const regDone = (games: Game[]) => {
  const reg = games.filter((g) => g.kind === 'reg');
  return reg.length > 0 && reg.every((g) => g.score);
};

/** Who won a bracket matchup, from the game of that round between the two teams (null: not played yet). */
function winner(games: Game[], kind: Round, m: Matchup): string | null {
  const g = games.find((x) => x.kind === kind && x.score
    && ((x.home === m.home && x.away === m.away) || (x.home === m.away && x.away === m.home)));
  if (!g || !g.score) return null;
  return g.score[0] > g.score[1] ? g.home : g.away;
}

function bracket(ctx: Ctx, games: Game[], round: Round): Matchup[] {
  if (round === 'wc') {
    if (!regDone(games)) return [];
    return ([0, 1] as Conf[]).flatMap((c) => {
      const s = seedsOf(ctx, c);
      return [[1, 6], [2, 5], [3, 4]].map(([a, b]) => ({ home: s[a], away: s[b] }));
    });
  }
  const prevRound = ROUNDS[ROUNDS.indexOf(round) - 1];
  const prev = bracket(ctx, games, prevRound);
  const won = prev.map((m) => winner(games, prevRound, m));
  if (!prev.length || won.some((w) => !w)) return [];
  const alive = won as string[];
  const confOf = (id: string) => ctx.byId.get(id)!.conf;
  if (round === 'final') {
    const [a, b] = alive;
    return [confOf(a) === 0 ? { home: a, away: b } : { home: b, away: a }];
  }
  return ([0, 1] as Conf[]).flatMap((c) => {
    const s = seedsOf(ctx, c);
    const left = alive.filter((id) => confOf(id) === c);
    if (round === 'div') left.push(s[0]);   // the bye
    left.sort((a, b) => s.indexOf(a) - s.indexOf(b));
    return round === 'div'
      ? [{ home: left[0], away: left[3] }, { home: left[1], away: left[2] }]
      : [{ home: left[0], away: left[1] }];
  });
}

/** Regular-season standings for every team. Playoff games and unplayed games don't count. */
export function standings(teams: CTeam[], games: Game[]): Record<string, StandingRow> {
  return context(teams, games, 0).rows;
}

/** A division's four teams, first to last, with the division tiebreakers. */
export function divisionOrder(teams: CTeam[], games: Game[], conf: Conf, div: Div, seedForCoin: number): string[] {
  return divOrder(context(teams, games, seedForCoin), conf, div);
}

/** A conference's seven playoff seeds as of now: 1-4 the division leaders, 5-7 the wild cards. */
export function seeds(teams: CTeam[], games: Game[], conf: Conf, seedForCoin: number): string[] {
  return seedsOf(context(teams, games, seedForCoin), conf);
}

/**
 * Standings with the current seeds and clinch markers. Mid-season the markers are conservative counts against each
 * team's best possible finish (no search over outcomes), so a clinch can show up later than the NFL would show it.
 */
export function picture(teams: CTeam[], games: Game[], seedForCoin: number): Record<string, StandingRow> {
  const ctx = context(teams, games, seedForCoin);
  const rows = ctx.rows;
  const done = regDone(games);
  const left = new Map(teams.map((t) => [t.id, 0]));
  for (const g of games) {
    if (g.kind !== 'reg' || g.score) continue;
    for (const id of [g.home, g.away]) if (left.has(id)) left.set(id, left.get(id)! + 1);
  }
  const now = (id: string) => winsOf(rows[id]);
  const max = (id: string) => now(id) + left.get(id)!;
  for (const conf of [0, 1] as Conf[]) {
    const s = seedsOf(ctx, conf);
    s.forEach((id, i) => { rows[id].seed = i + 1; });
    const ids = teams.filter((t) => t.conf === conf).map((t) => t.id);
    for (const id of ids) {
      const r = rows[id];
      if (done) {
        const i = s.indexOf(id);
        r.clinch = i === 0 ? 'z' : i > 0 && i < 4 ? 'y' : i >= 4 ? 'x' : 'e';
        continue;
      }
      const others = ids.filter((o) => o !== id);
      const rivals = others.filter((o) => sameDiv(ctx, id, o));
      const w = now(id);
      const div = !rivals.some((o) => max(o) >= w);
      if (div && !others.some((o) => max(o) >= w)) r.clinch = 'z';
      else if (div) r.clinch = 'y';
      else if (others.filter((o) => max(o) >= w).length < 7) r.clinch = 'x';
      // out only if seven others are already past its best finish and it can't win the division either
      else if (others.filter((o) => now(o) > max(id)).length >= 7 && rivals.some((o) => now(o) > max(id))) r.clinch = 'e';
    }
  }
  return rows;
}

/** A playoff round's matchups given the results so far; [] until the previous round is complete. */
export function playoffRound(teams: CTeam[], games: Game[], round: Round, seedForCoin: number): Matchup[] {
  return bracket(context(teams, games, seedForCoin), games, round);
}

/**
 * The draft order, pick 1 first: non-playoff teams worst first, then playoff teams by the round they went out in,
 * the champion last. Before the final is played it's simply worst record first.
 */
export function draftOrder(teams: CTeam[], games: Game[], seedForCoin: number): string[] {
  const ctx = context(teams, games, seedForCoin);
  const worstFirst = (ids: string[]) => [...ids].sort((a, b) =>
    (Math.abs(pctOf(ctx, a) - pctOf(ctx, b)) > EPS ? pctOf(ctx, a) - pctOf(ctx, b) : 0)
    || strength(ctx, a, false) - strength(ctx, b, false)
    || hash(seedForCoin, a) - hash(seedForCoin, b));
  const all = teams.map((t) => t.id);
  const final = bracket(ctx, games, 'final');
  const champ = final.length ? winner(games, 'final', final[0]) : null;
  if (!champ) return worstFirst(all);
  const seeded = [...seedsOf(ctx, 0), ...seedsOf(ctx, 1)];
  const out = worstFirst(all.filter((id) => !seeded.includes(id)));
  for (const round of ROUNDS) {
    const losers = bracket(ctx, games, round).map((m) => (winner(games, round, m) === m.home ? m.away : m.home));
    out.push(...worstFirst(losers));
  }
  out.push(champ);
  return out;
}
