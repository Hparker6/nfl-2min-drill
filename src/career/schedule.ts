/**
 * The regular-season schedule, built the NFL's way: who plays whom comes from a fixed formula (division rivals,
 * rotating division pairings, same-place finishers), then the 272 games are laid into 18 weeks with one bye per team.
 * Everything is drawn from a seed, so a season's schedule is the same every time it is rebuilt.
 */
import { hash, rng, type Rng } from '../engine/rng';
import type { CTeam, Game } from './types';

const WEEKS = 18;
const BYE_FIRST = 5;
const BYE_LAST = 14;
/** Attempts at laying out the weeks before giving up; a few is the norm, this is a safety net. */
const MAX_TRIES = 500;
/** Attempts that refuse a rematch in back-to-back weeks; after these it is only discouraged. */
const STRICT_TRIES = 40;
/** Search steps per attempt: a dead end deep in the search is cheaper to restart than to dig out of. */
const STEP_BUDGET = 3000;

const mod = (x: number, m: number) => ((x % m) + m) % m;

/** A pairing before it has a week: `h` and `a` index the sorted team list. */
interface Pair { h: number; a: number; div: boolean }

/**
 * The 272 regular-season games for `year`. `places[teamId]` is the team's finish in its division last season
 * (0 first … 3 last); it decides the same-place games. The same inputs always give the same schedule.
 */
export function makeSchedule(teams: CTeam[], places: Record<string, number>, year: number, seed: number): Game[] {
  const r = rng(hash('schedule', year, seed));
  const t = orderTeams(teams, places);
  const pairs = matchups(year, r);
  const weeks = layWeeks(pairs, r);
  const games: Game[] = pairs.map((p, i) => {
    const home = t[p.h].id, away = t[p.a].id, week = weeks[i];
    return { id: `${year}-w${week}-${away}-${home}`, week, kind: 'reg', home, away };
  });
  return games.sort((x, y) => x.week - y.week || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
}

/**
 * Teams sorted so index = conf*16 + div*4 + finish. Ties in `places` (or a missing entry) fall back to the id, so
 * every division still has a clear 1st to 4th.
 */
function orderTeams(teams: CTeam[], places: Record<string, number>): CTeam[] {
  const out: CTeam[] = [];
  for (let c = 0; c < 2; c++) {
    for (let d = 0; d < 4; d++) {
      const div = teams.filter(x => x.conf === c && x.div === d);
      if (div.length !== 4) throw new Error(`makeSchedule: conference ${c} division ${d} has ${div.length} teams, not 4`);
      div.sort((a, b) => (places[a.id] ?? 0) - (places[b.id] ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      out.push(...div);
    }
  }
  return out;
}

const ix = (c: number, d: number, place: number) => c * 16 + d * 4 + place;

/**
 * Who plays whom, and where. Divisions pair off in a 3-year cycle within the conference (d ^ 1, d ^ 2, d ^ 3 are the
 * three perfect pairings of four divisions) and a 4-year cycle across conferences; both are symmetric by construction.
 */
function matchups(year: number, r: Rng): Pair[] {
  const pairs: Pair[] = [];
  const partner = (d: number) => d ^ (mod(year, 3) + 1);
  const cross = mod(year, 4);                  // conf 0 div d meets conf 1 div (d + cross) % 4
  const extra = cross + 1 + mod(year, 3);      // the 17th game: a different conf 1 division, never the cross one

  for (let c = 0; c < 2; c++) {
    for (let d = 0; d < 4; d++) {
      // Division rivals twice, once at each home.
      for (let i = 0; i < 4; i++) {
        for (let j = i + 1; j < 4; j++) {
          pairs.push({ h: ix(c, d, i), a: ix(c, d, j), div: true }, { h: ix(c, d, j), a: ix(c, d, i), div: true });
        }
      }
      const p = partner(d);
      if (d < p) block(pairs, c, d, c, p, r);
    }
  }
  for (let d = 0; d < 4; d++) block(pairs, 0, d, 1, mod(d + cross, 4), r);

  // Same-place games (two in conference, one across), oriented afterwards so every team ends with 8 or 9 at home.
  const rest: [number, number][] = [];
  for (let c = 0; c < 2; c++) {
    for (let d = 0; d < 4; d++) {
      for (let e = d + 1; e < 4; e++) {
        if (e === partner(d)) continue;
        for (let k = 0; k < 4; k++) rest.push([ix(c, d, k), ix(c, e, k)]);
      }
    }
  }
  for (let d = 0; d < 4; d++) {
    for (let k = 0; k < 4; k++) rest.push([ix(0, d, k), ix(1, mod(d + extra, 4), k)]);
  }
  for (const [h, a] of orient(rest, r)) pairs.push({ h, a, div: false });
  return pairs;
}

/** All four of one division against all four of another, each team two at home and two away. */
function block(pairs: Pair[], c1: number, d1: number, c2: number, d2: number, r: Rng) {
  const shift = Math.floor(r() * 4);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      const a = ix(c1, d1, i), b = ix(c2, d2, j);
      const aHome = mod(j - i + shift, 4) < 2;
      pairs.push({ h: aHome ? a : b, a: aHome ? b : a, div: false });
    }
  }
}

/**
 * Homes for the same-place games. Each team has three, an odd count, so hook every team to a phantom vertex, walk
 * closed trails (every degree is now even) and point each game the way it was walked: in = out everywhere, and
 * dropping the phantom edge leaves each team one or two of its three at home.
 */
function orient(edges: [number, number][], r: Rng): [number, number][] {
  const N = 32, PH = 32;
  const all: [number, number][] = [...edges];
  for (let v = 0; v < N; v++) all.push([v, PH]);
  const adj: number[][] = Array.from({ length: N + 1 }, () => []);
  all.forEach(([a, b], i) => { adj[a].push(i); adj[b].push(i); });
  for (const list of adj) shuffle(list, r);
  const used = new Array<boolean>(all.length).fill(false);
  const dir: [number, number][] = new Array(all.length);
  const ptr = new Array<number>(N + 1).fill(0);
  for (let s = 0; s <= N; s++) {
    for (;;) {
      // Walk from s until stuck; with all degrees even a stuck walk is back at s, a closed trail.
      let v = s, moved = false;
      for (;;) {
        while (ptr[v] < adj[v].length && used[adj[v][ptr[v]]]) ptr[v]++;
        if (ptr[v] === adj[v].length) break;
        const e = adj[v][ptr[v]];
        used[e] = true;
        const w = all[e][0] === v ? all[e][1] : all[e][0];
        dir[e] = [v, w];
        v = w;
        moved = true;
      }
      if (!moved) break;
    }
  }
  return dir.slice(0, edges.length);
}

function shuffle<T>(a: T[], r: Rng) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
}

/**
 * A week for every pair. Byes are dealt first (two to six teams a week, weeks 5-14), then the weeks are filled from
 * 18 back to 1, each as a perfect matching of that week's teams over the games still unplayed, by depth-first search
 * that matches the most constrained team first and backtracks across weeks. Filling backwards lets the late weeks
 * take the division games while there are plenty to choose from, and leaves weeks 1-4 for last: there the remaining
 * games form a regular graph, where a dead end shows up at once. A search that runs too long restarts with new byes
 * (a few hundred steps is typical; in 5,000 test runs no layout needed more than five tries). Rivals never meet in
 * back-to-back weeks unless dozens of tries fail, which has not happened in testing.
 */
function layWeeks(pairs: Pair[], r: Rng): number[] {
  for (let tries = 0; tries < MAX_TRIES; tries++) {
    const w = tryLay(pairs, r, tries < STRICT_TRIES);
    if (w) return w;
  }
  throw new Error('makeSchedule: could not lay out the weeks');
}

function tryLay(pairs: Pair[], r: Rng, strict: boolean): number[] | null {
  const N = 32;
  // Byes: 16 pairs of teams over the 10 bye weeks, at least one pair and at most three in each.
  const pairCount = new Array<number>(WEEKS + 1).fill(0);
  for (let w = BYE_FIRST; w <= BYE_LAST; w++) pairCount[w] = 1;
  for (let spare = 16 - (BYE_LAST - BYE_FIRST + 1); spare > 0;) {
    const w = BYE_FIRST + Math.floor(r() * (BYE_LAST - BYE_FIRST + 1));
    if (pairCount[w] < 3) { pairCount[w]++; spare--; }
  }
  const order = Array.from({ length: N }, (_, i) => i);
  shuffle(order, r);
  const bye = new Array<number>(N);
  let k = 0;
  for (let w = BYE_FIRST; w <= BYE_LAST; w++) for (let n = 0; n < pairCount[w] * 2; n++) bye[order[k++]] = w;

  // Unscheduled games between each pair of teams (division rivals start with two).
  const left: number[][][] = Array.from({ length: N }, () => Array.from({ length: N }, () => []));
  pairs.forEach((p, i) => { left[p.h][p.a].push(i); left[p.a][p.h].push(i); });
  const isDiv = (a: number, b: number) => (a >> 2) === (b >> 2);
  /** week the pair a-b last met in, by team: to keep rivals from meeting in back-to-back weeks */
  const met: number[][] = Array.from({ length: N }, () => new Array<number>(WEEKS + 2).fill(-1));
  const weekOf = new Array<number>(pairs.length).fill(0);
  let steps = 0;

  const take = (a: number, b: number, w: number) => {
    const list = left[a][b];
    const g = list.pop() as number;
    const other = left[b][a];
    other.splice(other.indexOf(g), 1);
    weekOf[g] = w;
    met[a][w] = b; met[b][w] = a;
    return g;
  };
  const give = (a: number, b: number, g: number, w: number) => {
    left[a][b].push(g); left[b][a].push(g);
    weekOf[g] = 0;
    met[a][w] = -1; met[b][w] = -1;
  };

  const rematch = (a: number, b: number, w: number) => met[a][w - 1] === b || met[a][w + 1] === b;
  /** Preference for a game in week w: late weeks want division games, nobody wants a rematch a week apart. */
  const score = (a: number, b: number, w: number) => {
    let s = r();
    if (isDiv(a, b)) s += w === 18 ? 3 : w === 17 ? 2 : w >= 15 ? 0.6 : 0;
    if (rematch(a, b, w)) s -= 4;
    return s;
  };

  const fillWeek = (w: number, open: number[]): boolean => {
    if (++steps > STEP_BUDGET) return false;
    if (open.length === 0) return w === 1 || fillWeek(w - 1, playing(w - 1));
    // The open team with the fewest open opponents still to play goes first; none means a dead end.
    let best = -1, bestN = 99, opts: number[] = [];
    for (const a of open) {
      const o: number[] = [];
      for (const b of open) if (b !== a && left[a][b].length > 0 && !(strict && rematch(a, b, w))) o.push(b);
      if (o.length < bestN) { best = a; bestN = o.length; opts = o; if (bestN === 0) return false; }
    }
    const scored = opts.map(b => ({ b, s: score(best, b, w) })).sort((x, y) => y.s - x.s);
    for (const { b } of scored) {
      const g = take(best, b, w);
      if (fillWeek(w, open.filter(x => x !== best && x !== b))) return true;
      give(best, b, g, w);
      if (steps > STEP_BUDGET) return false;
    }
    return false;
  };
  const playing = (w: number) => {
    const out: number[] = [];
    for (let v = 0; v < N; v++) if (bye[v] !== w) out.push(v);
    return out;
  };

  return fillWeek(WEEKS, playing(WEEKS)) ? weekOf : null;
}
