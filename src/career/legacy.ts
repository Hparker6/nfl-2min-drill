/**
 * Career Legacy (Coach's Edition): what a career leaves behind. The record book (career totals, best seasons, best
 * games), the league's history (every champion and award winner), the league's single-season records, and the end:
 * retirement and the Hall of Fame vote.
 *
 * Everything is kept in `career.legacy` as the career goes, whether or not the edition is owned, so a player who
 * unlocks it later finds a history already there. Careers saved before it existed start it on load (`ensureLegacy`):
 * the games of the current season and, after a season's end, that season's results are all that can be recovered, so
 * league history and records say which year they start from.
 *
 * The Hall of Fame (`legacyScore`, `verdict`): points for winning, for production, for playoff runs, for awards and
 * for records held, explained line by line on the retirement screen. Five seasons are needed to be eligible.
 *   250+  first-ballot Hall of Famer (80% of the vote or more)
 *   170+  Hall of Famer, elected in his 2nd to 5th year of eligibility
 *   100+  Ring of Honor: the team he played most seasons for (also the best a shorter career can reach)
 *   50+   a solid career; below that, a short one
 * Calibrated on simmed careers (scripts/hof.gen.test.ts): a 15-season starter with Pro Bowls and an Offensive Player
 * of the Year or two lands around 180; add an MVP and a title and it's 250-320.
 */
import { passerRating, type Line } from './box';
import { seasonAwards } from './awards';
import { leaders } from './season';
import type { Award, GameKind, Season } from './types';
import type { Career, SeasonSummary } from './career';

/** A single-game best of yours. */
export interface GameBest { v: number; year: number; week: number; opp: string; kind: GameKind }
/** A league single-season record. */
export interface LeagueRecord { v: number; name: string; team: string; year: number; you?: boolean }
/** One award winner in the league's history. */
export interface AnnalAward { key: string; name: string; player: string; team: string; you?: boolean }

/** One season of league history. */
export interface Annal {
  year: number;
  champion?: string;
  runnerUp?: string;
  final?: [number, number];       // [champion, runner-up]
  awards: AnnalAward[];           // MVP, OPOY, DPOY, the rookies, the final's MVP (no Pro Bowls)
  /** your season (absent for the year before your draft) */
  you?: { team: string; w: number; l: number; t: number; playoff?: string };
}

export type Tier = 'first' | 'hof' | 'ring' | 'solid' | 'short';

export interface Verdict {
  tier: Tier;
  title: string;
  vote: number;            // share of the Hall of Fame vote, 1-99
  electedIn?: number;      // year of eligibility he gets in (1: first ballot)
  ring?: string;           // team id whose Ring of Honor he joins
  eligible: boolean;       // five seasons
}

export interface Retirement { year: number; age: number; score: number; verdict: Verdict; parts: ScorePart[] }

export interface Legacy {
  v: 1;
  /** the first season the league's history and records are complete from */
  since: number;
  annals: Annal[];
  games: Partial<Record<GameStat, GameBest>>;
  records: Partial<Record<RecordStat, LeagueRecord>>;
  retired?: Retirement;
}

export type GameStat = 'py' | 'ptd' | 'pc' | 'ry' | 'rtd' | 'plng';
export const GAME_STATS: [GameStat, string][] = [
  ['py', 'Passing yards'], ['ptd', 'Touchdown passes'], ['pc', 'Completions'], ['plng', 'Longest pass'], ['ry', 'Rushing yards'], ['rtd', 'Rushing touchdowns'],
];

export type RecordStat = 'py' | 'ptd' | 'ry' | 'rtd' | 'rcy' | 'rctd' | 'rec' | 'sck' | 'int';
export const RECORD_STATS: [RecordStat, string][] = [
  ['py', 'Passing yards'], ['ptd', 'Touchdown passes'], ['ry', 'Rushing yards'], ['rtd', 'Rushing touchdowns'], ['rec', 'Receptions'],
  ['rcy', 'Receiving yards'], ['rctd', 'Receiving touchdowns'], ['sck', 'Sacks'], ['int', 'Interceptions'],
];

const HISTORY_AWARDS = new Set(['mvp', 'opoy', 'dpoy', 'oroy', 'droy', 'fmvp']);

export const newLegacy = (since: number): Legacy => ({ v: 1, since, annals: [], games: {}, records: {} });

/** A single game of yours: any new career highs. Returns the stats that are new highs. */
export function noteGame(c: Career, line: Line, g: { week: number; kind: GameKind }, opp: string): GameStat[] {
  const L = ensureLegacy(c);
  const out: GameStat[] = [];
  for (const [k] of GAME_STATS) {
    const v = line[k];
    if (v == null || v <= 0) continue;
    const cur = L.games[k];
    if (!cur || v > cur.v) {
      L.games[k] = { v, year: c.season.year, week: g.week, opp, kind: g.kind };
      if (cur) out.push(k);
    }
  }
  return out;
}

/** A season's history: champion, the final, the awards, your finish. */
function annalOf(c: Career, s: Season, awards: Award[], you?: Annal['you']): Annal {
  const fin = s.games.find((g) => g.kind === 'final' && g.score);
  const champ = s.champion;
  const runnerUp = fin ? (fin.home === champ ? fin.away : fin.home) : undefined;
  const final = fin?.score && champ ? (fin.home === champ ? [fin.score[0], fin.score[1]] : [fin.score[1], fin.score[0]]) as [number, number] : undefined;
  return {
    year: s.year, champion: champ, runnerUp, final,
    awards: awards.filter((a) => HISTORY_AWARDS.has(a.key) && a.player).map((a) => ({
      key: a.key, name: a.name, player: c.league.players[a.player!]?.name ?? '', team: a.team ?? '', ...(a.you ? { you: true } : {}),
    })),
    ...(you ? { you } : {}),
  };
}

/**
 * The season just ended (career.ts endSeason): its history, and the league's single-season records. Returns the
 * records set this season (the ones that beat an earlier mark).
 */
export function noteSeason(c: Career, s: Season, you?: Annal['you']): RecordStat[] {
  const L = ensureLegacy(c);
  if (L.annals.some((a) => a.year === s.year)) return [];
  L.annals.push(annalOf(c, s, s.awards ?? seasonAwards(c.league, s, c.you.pid), you));
  L.annals.sort((a, b) => a.year - b.year);
  const broke: RecordStat[] = [];
  for (const [k] of RECORD_STATS) {
    const top = leaders(c.league, s, k, 1)[0];
    if (!top || top.v <= 0) continue;
    const cur = L.records[k];
    if (!cur || top.v > cur.v) {
      const p = c.league.players[top.id];
      L.records[k] = { v: top.v, name: p?.name ?? '', team: p?.team ?? '', year: s.year, ...(top.id === c.you.pid ? { you: true } : {}) };
      if (cur) broke.push(k);
    }
  }
  return broke;
}

/**
 * Make sure a career has its legacy (careers saved before it existed get one, from what they still hold: this season's
 * box scores and, once a season is over, its results). Safe to call any number of times.
 */
export function ensureLegacy(c: Career): Legacy {
  if (c.legacy && c.legacy.v === 1) return c.legacy;
  // before the draft (college, draft night) the season held is the league's last one, already played out
  const over = c.phase !== 'season';
  const L = (c.legacy = newLegacy(c.season.year));
  if (c.phase === 'season' || c.phase === 'offseason' || c.phase === 'retired') {
    const me = c.league.players[c.you.pid];
    for (const g of c.season.games) {
      const box = c.boxes?.[g.id];
      if (!box || !g.score || !me?.team) continue;
      const line = box.players[c.you.pid];
      if (line) noteGame(c, line, g, g.home === me.team ? g.away : g.home);
    }
  }
  if (over) {
    const h = c.history.find((x) => x.year === c.season.year);
    noteSeason(c, c.season, h ? { team: h.team, w: h.w, l: h.l, t: h.t, playoff: h.playoff } : undefined);
  }
  return L;
}

// ---- the record book ----

export interface Totals {
  seasons: number; w: number; l: number; t: number;
  line: Line;          // regular season
  po: Line;            // playoffs (seasons since Legacy began)
  playoffs: number; titles: number; finals: number;
  awards: Record<string, number>;
}

export function careerTotals(history: SeasonSummary[]): Totals {
  const line: Line = {}, po: Line = {};
  const awards: Record<string, number> = {};
  const add = (into: Line, l: Line) => {
    for (const k in l) {
      const key = k as keyof Line, v = l[key] ?? 0;
      into[key] = key.endsWith('lng') ? Math.max(into[key] ?? 0, v) : (into[key] ?? 0) + v;
    }
  };
  for (const h of history) {
    add(line, h.line);
    if (h.po) add(po, h.po);
    for (const a of h.awards) awards[a] = (awards[a] ?? 0) + 1;
  }
  return {
    seasons: history.length,
    w: history.reduce((a, h) => a + h.w, 0), l: history.reduce((a, h) => a + h.l, 0), t: history.reduce((a, h) => a + h.t, 0),
    line, po,
    playoffs: history.filter((h) => h.playoff).length,
    titles: history.filter((h) => h.playoff === CHAMPS).length,
    finals: history.filter((h) => h.playoff === CHAMPS || h.playoff === FINAL_LOSS).length,
    awards,
  };
}

/** Your best season in each of these, with the year. Passer rating needs 200 attempts. */
export function seasonBests(history: SeasonSummary[]): { key: string; label: string; v: number; year: number }[] {
  const rows: { key: string; label: string; get: (h: SeasonSummary) => number | null }[] = [
    { key: 'py', label: 'Passing yards', get: (h) => h.line.py ?? null },
    { key: 'ptd', label: 'Touchdown passes', get: (h) => h.line.ptd ?? null },
    { key: 'rating', label: 'Passer rating', get: (h) => ((h.line.pa ?? 0) >= 200 ? passerRating(h.line) : null) },
    { key: 'ry', label: 'Rushing yards', get: (h) => h.line.ry ?? null },
    { key: 'w', label: 'Wins', get: (h) => h.w },
  ];
  const out: { key: string; label: string; v: number; year: number }[] = [];
  for (const r of rows) {
    let best: { v: number; year: number } | null = null;
    for (const h of history) { const v = r.get(h); if (v != null && v > 0 && (!best || v > best.v)) best = { v, year: h.year }; }
    if (best) out.push({ key: r.key, label: r.label, ...best });
  }
  return out;
}

// ---- the Hall of Fame ----

const CHAMPS = 'Won the Gridiron Bowl';
const FINAL_LOSS = 'Lost in the Gridiron Bowl';
/** Points for how far a season went. */
export const PLAYOFF_POINTS: [string, string, number][] = [
  [CHAMPS, 'Gridiron Bowl titles', 25],
  [FINAL_LOSS, 'Gridiron Bowl losses', 10],
  ['Lost in the Conference Championship', 'Conference Championship losses', 7],
  ['Lost in the Divisional round', 'Divisional round losses', 4],
  ['Lost in the Wild Card round', 'Wild Card round losses', 2],
];
/** Points per award (by the name it's given in the season summary). */
export const AWARD_POINTS: [string, number][] = [
  ['Most Valuable Player', 20], ['Offensive Player of the Year', 12], ['Gridiron Bowl MVP', 10], ['Offensive Rookie of the Year', 5], ['Pro Bowl', 4],
];
export const HOF = { seasons: 5, first: 250, hof: 170, ring: 100, solid: 50, recordPts: 5 } as const;

export interface ScorePart { label: string; detail: string; pts: number }

/** The case for the Hall: every line of it. `recordsHeld`: league records in his name. */
export function legacyScore(history: SeasonSummary[], recordsHeld = 0): { total: number; parts: ScorePart[] } {
  const T = careerTotals(history);
  const parts: ScorePart[] = [];
  const add = (label: string, detail: string, pts: number) => { if (pts > 0) parts.push({ label, detail, pts: Math.round(pts * 10) / 10 }); };
  add('Winning', `${T.w} regular-season wins`, T.w * 0.5);
  const yds = T.line.py ?? 0, tds = (T.line.ptd ?? 0) + (T.line.rtd ?? 0);
  add('Passing yards', `${yds.toLocaleString('en-US')} yards`, yds / 2500);
  add('Touchdowns', `${tds} passing and rushing`, tds / 20);
  for (const [result, label, pts] of PLAYOFF_POINTS) {
    const n = history.filter((h) => h.playoff === result).length;
    add(label, `${n} × ${pts}`, n * pts);
  }
  for (const [name, pts] of AWARD_POINTS) {
    const n = T.awards[name] ?? 0;
    add(name === 'Pro Bowl' ? 'Pro Bowls' : name, `${n} × ${pts}`, n * pts);
  }
  add('League records', `${recordsHeld} held`, recordsHeld * HOF.recordPts);
  return { total: Math.round(parts.reduce((a, p) => a + p.pts, 0)), parts };
}

/** The team he played the most seasons for (the latest, on a tie). */
export function mainTeam(history: SeasonSummary[]): string | undefined {
  const n = new Map<string, number>();
  for (const h of history) n.set(h.team, (n.get(h.team) ?? 0) + 1);
  let best: string | undefined, most = 0;
  for (const h of history) { const k = n.get(h.team)!; if (k >= most) { most = k; best = h.team; } }
  return best;
}

export function verdict(score: number, seasons: number, ring?: string): Verdict {
  const eligible = seasons >= HOF.seasons;
  const vote = Math.max(1, Math.min(99, Math.round((score / HOF.first) * 80)));
  if (eligible && score >= HOF.first) return { tier: 'first', title: 'First-ballot Hall of Famer', vote, electedIn: 1, ring, eligible };
  if (eligible && score >= HOF.hof) {
    const electedIn = Math.min(5, 1 + Math.ceil((HOF.first - score) / 20));
    return { tier: 'hof', title: 'Hall of Famer', vote, electedIn, ring, eligible };
  }
  if (score >= HOF.ring) return { tier: 'ring', title: 'Ring of Honor', vote, ring, eligible };
  if (score >= HOF.solid) return { tier: 'solid', title: 'A solid career', vote, eligible };
  return { tier: 'short', title: 'A career to remember', vote, eligible };
}

/** League records in your name right now. */
export const recordsHeld = (L: Legacy | undefined) => Object.values(L?.records ?? {}).filter((r) => r?.you).length;

/** Retiring is for the offseason, after at least one full season, outside a game. */
export const canRetire = (c: Career) => c.phase === 'offseason' && c.history.length >= 1 && !c.live;

/** Hang them up: the Hall of Fame vote, and the career ends. */
export function retire(c: Career): Retirement {
  const L = ensureLegacy(c);
  const { total, parts } = legacyScore(c.history, recordsHeld(L));
  const me = c.league.players[c.you.pid];
  const r: Retirement = { year: c.season.year, age: me?.age ?? 0, score: total, verdict: verdict(total, c.history.length, mainTeam(c.history)), parts };
  L.retired = r;
  c.phase = 'retired';
  c.news.unshift({ week: 0, year: c.season.year + 1, text: `${c.you.name} retires after ${c.history.length} season${c.history.length === 1 ? '' : 's'}.`, tone: 'neutral' });
  return r;
}

/** A retired career, kept for the Hall even after its save is gone. */
export interface HallEntry {
  id: string; name: string; number: number; arch: string;
  first: number; last: number; team: string; teamName: string;
  score: number; tier: Tier; title: string; vote: number;
  w: number; l: number; py: number; td: number; titles: number;
}

export function hallEntry(c: Career, archName: string): HallEntry | null {
  const r = c.legacy?.retired;
  if (!r) return null;
  const T = careerTotals(c.history);
  const tid = r.verdict.ring ?? mainTeam(c.history) ?? '';
  const t = c.league.teams.find((x) => x.id === tid);
  return {
    id: c.id, name: c.you.name, number: c.you.number, arch: archName,
    first: c.history[0]?.year ?? r.year, last: r.year, team: tid, teamName: t ? `${t.city} ${t.name}` : tid,
    score: r.score, tier: r.verdict.tier, title: r.verdict.title, vote: r.verdict.vote,
    w: T.w, l: T.l, py: T.line.py ?? 0, td: (T.line.ptd ?? 0) + (T.line.rtd ?? 0), titles: T.titles,
  };
}
