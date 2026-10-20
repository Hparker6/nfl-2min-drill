/**
 * The player's career: create a quarterback, one college game, the draft, then seasons in the league. XP from what
 * he does (and how well he calls it) buys attribute points and abilities.
 */
import { clip, hash, rng } from '../engine/rng';
import type { Attr } from '../engine/roster';
import { passerRating, type Box, type Line } from './box';
import { nameMaker, newLeague, overall, type League } from './league';
import { newSeason, placesFrom, simWeek, advanceWeek, REG_WEEKS } from './season';
import type { CPlayer, Game, LiveGame, Season } from './types';
import { RISK_ATTR_NAME, RISK_CAP, RISK_XP, type RiskAttr, type RiskWin } from './risk';
import { ensureLegacy, type Legacy } from './legacy';

export type Arch = 'pocket' | 'gunslinger' | 'dual' | 'general';
export const QB_ATTRS: Attr[] = ['accuracy', 'arm', 'decision', 'mobility'];

/**
 * The four kinds of quarterback. Each starts with different attributes (they decide how his throws and runs come
 * out in the engine) and one signature ability; everything else is earned.
 */
export const ARCH: Record<Arch, { name: string; tag: string; blurb: string; sig: Ability; attrs: Record<'accuracy' | 'arm' | 'decision' | 'mobility', number> }> = {
  pocket: { name: 'Pocket Passer', tag: 'Accuracy and timing', blurb: 'Stands in and delivers on time. The most accurate thrower, but he can’t outrun anyone.', sig: 'release', attrs: { accuracy: 77, arm: 71, decision: 71, mobility: 50 } },
  dual: { name: 'Scrambler', tag: 'Legs and improvisation', blurb: 'Extends plays and picks up yards with his feet when nothing is open. The throws come along later.', sig: 'escape', attrs: { accuracy: 65, arm: 70, decision: 63, mobility: 84 } },
  general: { name: 'Game Manager', tag: 'Smart and safe', blurb: 'Reads the defense, takes what it gives, and almost never gives the ball away.', sig: 'film', attrs: { accuracy: 71, arm: 64, decision: 80, mobility: 57 } },
  gunslinger: { name: 'Gunslinger', tag: 'Big arm, big risks', blurb: 'The risk taker: a cannon that fits throws into windows nobody else would try. Some of them get picked.', sig: 'deep', attrs: { accuracy: 67, arm: 83, decision: 60, mobility: 61 } },
};

/** Abilities: bought with skill points once the level is high enough. Applied in career/run.ts. */
export const ABILITIES = {
  clutch: { name: 'Clutch', blurb: '+5 accuracy and decision-making in the fourth quarter and overtime of a one-score game.', cost: 6, level: 3 },
  film: { name: 'Film Room', blurb: 'Read the defense right before the snap 85% of the time instead of 70%.', cost: 5, level: 2 },
  release: { name: 'Quick Release', blurb: 'The ball is out fast: sacked about a quarter less often.', cost: 6, level: 4 },
  escape: { name: 'Escape Artist', blurb: '+6 mobility when the pocket breaks down: scrambles go further.', cost: 5, level: 5 },
  deep: { name: 'Deep Ball', blurb: '+5 arm strength: more completions down the field.', cost: 7, level: 6 },
  iron: { name: 'Ironman', blurb: 'Ages slower: your attributes start to decline three years later than everyone else’s.', cost: 8, level: 8 },
} as const;
export type Ability = keyof typeof ABILITIES;

export interface You {
  pid: string;
  name: string;
  number: number;
  arch: Arch;
  college: string;
  xp: number;           // lifetime
  sp: number;           // unspent skill points
  abilities: Ability[];
  drafted?: { year: number; round: number; pick: number; team: string };
  contract?: { years: number; salary: number };   // salary in millions a year
  wantsTrade?: boolean;
}

export interface Goal { key: string; text: string; xp: number; done?: boolean }

export interface SeasonSummary {
  year: number; team: string; line: Line; w: number; l: number; t: number; playoff?: string; awards: string[]; ovr: number;
  po?: Line;            // playoff stats (seasons since Career Legacy)
}

export interface CollegeGame { you: string; them: string; youName: string; themName: string; result?: { score: [number, number]; line: Line; stock: number; grades: number[] } }

export interface DraftPick { pick: number; team: string; name: string; pos: string; college: string; you?: boolean }

export interface NewsItem { week: number; year: number; text: string; tone?: 'good' | 'bad' | 'neutral' }

export interface Settings {
  qLen: number;                      // full games: minutes per quarter × 60
  moments: 'few' | 'normal' | 'lots';
  diff: 'rookie' | 'pro' | 'allpro';
  speed: 'normal' | 'fast';
}

export interface Career {
  v: 1;
  id: string;
  seed: number;
  created: number;
  phase: 'college' | 'draft' | 'season' | 'offseason' | 'retired';
  you: You;
  league: League;
  season: Season;
  history: SeasonSummary[];
  college: CollegeGame;
  draft?: {
    year: number; order: string[]; picks: DraftPick[]; yourPick: number; revealed: number;
    stock?: number;                          // draft stock after media day
    media?: number;                          // media day's change to the stock (set once it's done)
    trade?: { team: string; from: string };  // a team traded up into your slot
    interest?: string[];                     // teams that called your agent before the draft
  };
  goals: Goal[];                     // this week's
  news: NewsItem[];
  settings: Settings;
  live?: LiveGame;
  /** your games this season: box scores by game id */
  boxes: Record<string, Box>;
  /** XP earned in your last game, for the postgame screen */
  last?: { gameId: string; xp: { label: string; xp: number }[]; total: number; sp: number; levelUp?: number; boosts?: { attr: RiskAttr; label: string }[]; ovr0?: number; ovr1?: number };
  /** the record book, the league's history, retirement (career/legacy.ts; absent on careers saved before it) */
  legacy?: Legacy;
}

/** name, nickname, colors, abbreviation */
export const COLLEGES: [string, string, string, string, string][] = [
  ['Lakeshore State', 'Lakers', '#1D4ED8', '#F8FAFC', 'LKST'], ['Bluff City', 'Bulldogs', '#7F1D1D', '#FDE68A', 'BLUF'],
  ['Prairie Tech', 'Engineers', '#B45309', '#111827', 'PRT'], ['Coastal Carolina A&M', 'Mariners', '#0E7490', '#FDE047', 'CCAM'],
  ['Mountain West U', 'Peaks', '#14532D', '#F1F5F9', 'MWU'], ['Southern Plains', 'Mustangs', '#9F1239', '#F5F5F4', 'SPLN'],
  ['Great Lakes Tech', 'Huskers', '#374151', '#F59E0B', 'GLT'], ['Desert State', 'Coyotes', '#EA580C', '#1C1917', 'DSST'],
];

/** Level from lifetime XP: each level costs a little more than the last. */
export const levelOf = (xp: number) => Math.floor(Math.sqrt(xp / 120)) + 1;
export const xpForLevel = (lv: number) => (lv - 1) * (lv - 1) * 120;
/**
 * XP per skill point. 150 (it was 180): with the risk bonuses a quarterback who plays his games and takes his shots goes
 * from the 60s to the 90s in about two seasons, about three if he plays it safe.
 */
export const XP_PER_SP = 150;

/** What +1 in an attribute costs, by where it is now: cheap in the 60s, dear in the 90s. */
export const attrCost = (v: number) => (v < 80 ? 1 : v < 88 ? 2 : v < 94 ? 3 : 4);

export const youPlayer = (c: Career): CPlayer => c.league.players[c.you.pid];

/** A brand-new career. The league exists from day one (it plays a season before your draft). */
export function newCareer(o: { name: string; number: number; arch: Arch; college: number; seed?: number; settings?: Partial<Settings> }): Career {
  const seed = o.seed ?? Math.floor(Math.random() * 2 ** 31);
  const league = newLeague(seed);
  const pid = 'you';
  const A = ARCH[o.arch];
  const attrs = { ...A.attrs };
  league.players[pid] = {
    id: pid, slot: 'QB', name: o.name, number: o.number, attrs, rating: overall(attrs), source: 'generated', age: 22, team: null, exp: 0, pot: 99,
  };
  const year = 2026;
  // last season, played out, so the draft order and the schedule's same-place games come from real results
  const prev = newSeason(league, year - 1, Object.fromEntries(league.teams.map((t) => [t.id, (hash(seed, t.id) % 4)])), seed);
  playWholeSeason(league, prev, seed);
  const col = COLLEGES[o.college % COLLEGES.length];
  const rival = COLLEGES[(o.college + 3) % COLLEGES.length];
  const c: Career = {
    v: 1, id: `c${seed.toString(36)}`, seed, created: Date.now(), phase: 'college',
    you: { pid, name: o.name, number: o.number, arch: o.arch, college: col[0], xp: 0, sp: 0, abilities: [A.sig] },
    league, season: prev, history: [],
    college: { you: col[0], them: rival[0], youName: col[1], themName: rival[1] },
    goals: [], news: [], boxes: {},
    settings: { qLen: 120, moments: 'normal', diff: 'pro', speed: 'normal', ...o.settings },
  };
  ensureLegacy(c);   // the league's history starts with the season it played before you arrived
  return c;
}

/** Sim a whole season to the champion (the league's history before you arrive, and tests). */
export function playWholeSeason(lg: League, season: Season, seed: number) {
  for (let guard = 0; guard < 30 && season.week <= 22; guard++) {
    simWeek(lg, season, seed);
    advanceWeek(lg, season, seed);
  }
}

/**
 * Draft stock from the college game, 0-100: how he threw it, whether he won, and how well he called it. A great game
 * in a win goes in the top five; a bad one slides him to the second round.
 */
export function draftStock(line: Line, win: boolean, gradeAvg: number | null): number {
  const pr = passerRating(line);
  const yds = (line.py ?? 0) + (line.ry ?? 0);
  const v = 30 + (pr - 80) * 0.35 + yds / 14 + ((line.ptd ?? 0) + (line.rtd ?? 0)) * 5 - (line.pint ?? 0) * 7 + (win ? 14 : 0)
    + (gradeAvg == null ? 0 : (gradeAvg - 70) * 0.4);
  return Math.round(clip(v, 2, 99));
}

/** Where a stock lands him: pick 1-64, seeded so a replay drafts the same. */
export function pickFor(stock: number, seed: number): number {
  const r = rng(hash(seed, 'draft-luck'));
  const base = 1 + ((100 - stock) / 100) ** 1.4 * 64;
  return clip(Math.round(base + (r() - 0.5) * 6), 1, 64);
}

const POS_POOL = ['QB', 'RB', 'WR', 'WR', 'TE', 'OT', 'OT', 'G', 'C', 'EDGE', 'EDGE', 'DT', 'DT', 'LB', 'LB', 'CB', 'CB', 'CB', 'S', 'S'];

/** How often a better team trades up into your slot on draft night. */
export const TRADE_UP = 0.45;

/**
 * The draft board up to and including your pick: generated prospects for everyone else. The team that holds your slot
 * picks you, unless a better team trades up for you (TRADE_UP of drafts): contenders with a weak quarterback are the
 * likeliest. Three teams call your agent beforehand, so draft night has teams to hope for.
 */
export function makeDraft(c: Career, order: string[], stock: number): NonNullable<Career['draft']> {
  const yourPick = pickFor(stock, c.seed);
  const slotTeam = order[(yourPick - 1) % 32];
  const tr = rng(hash(c.seed, 'draft-trade', stock));
  let trade: { team: string; from: string } | undefined;
  if (tr() < TRADE_UP) {
    // the better half of the league (later in the order), the better and the weaker their quarterback, the keener
    const cands = order.slice(16).filter((t) => t !== slotTeam);
    const qb = (id: string) => c.league.players[c.league.teams.find((t) => t.id === id)!.roster.QB]?.rating ?? 70;
    // a team with an elite quarterback almost never trades up for another one
    const w = cands.map((id, i) => (qb(id) >= 85 ? 0.05 : 1 + i * 0.25 + (qb(id) < 78 ? 3 : 0)));
    let x = tr() * w.reduce((a, b) => a + b, 0), k = 0;
    while (k < w.length - 1 && (x -= w[k]) > 0) k++;
    trade = { team: cands[k], from: slotTeam };
  }
  const yourTeam = trade?.team ?? slotTeam;
  // who called: the team that takes you, plus two that won't (one near your slot, one contender)
  const near = order.filter((t, i) => t !== yourTeam && Math.abs(i - (yourPick - 1)) <= 6);
  const good = order.slice(20).filter((t) => t !== yourTeam && !near.includes(t));
  const interest = [yourTeam, near[Math.floor(tr() * near.length)], good[Math.floor(tr() * good.length)]].filter(Boolean);
  for (let i = interest.length - 1; i > 0; i--) { const j = Math.floor(tr() * (i + 1)); [interest[i], interest[j]] = [interest[j], interest[i]]; }
  const r = rng(hash(c.seed, 'draft'));
  const used = new Set(Object.values(c.league.players).map((p) => p.name));
  const name = nameMaker(rng(hash(c.seed, 'draft-names')), used);
  const picks: DraftPick[] = [];
  for (let i = 1; i <= yourPick; i++) {
    const team = order[(i - 1) % 32];
    if (i === yourPick) picks.push({ pick: i, team: yourTeam, name: c.you.name, pos: 'QB', college: c.you.college, you: true });
    else picks.push({ pick: i, team, name: name(), pos: POS_POOL[Math.floor(r() * POS_POOL.length)], college: COLLEGES[Math.floor(r() * COLLEGES.length)][0] });
  }
  return { year: c.season.year + 1, order, picks, yourPick, revealed: 0, stock, trade, interest: [...new Set(interest)] };
}

/**
 * Drafted: join the team as its starter. The quarterback he replaces leaves for free agency. A rookie deal: four
 * years, paid by where he went.
 */
export function joinTeam(c: Career) {
  const d = c.draft!;
  const team = d.picks.find((p) => p.you)?.team ?? d.order[(d.yourPick - 1) % 32];
  const t = c.league.teams.find((x) => x.id === team)!;
  const old = c.league.players[t.roster.QB];
  if (old) old.team = null;
  t.roster.QB = c.you.pid;
  const me = youPlayer(c);
  me.team = team;
  // a jersey number nobody else on the team wears
  const nums = new Set(Object.values(t.roster).filter((id) => id !== c.you.pid).map((id) => c.league.players[id]?.number));
  if (nums.has(me.number)) for (let n = 1; n <= 19; n++) if (!nums.has(n)) { me.number = n; c.you.number = n; break; }
  c.you.drafted = { year: d.year, round: d.yourPick <= 32 ? 1 : 2, pick: d.yourPick, team };
  c.you.contract = rookieDeal(d.yourPick);
  const places = placesFrom(c.league, c.season.games, c.seed);
  c.season = newSeason(c.league, d.year, places, c.seed);
  c.phase = 'season';
  c.boxes = {};
  if (d.trade) c.news.unshift({ week: 0, year: d.year, text: `Draft-night trade: ${t.city} moves up to ${ordinal(d.yourPick)} overall, from ${c.league.teams.find((x) => x.id === d.trade!.from)?.city}, to take ${c.you.name}.`, tone: 'good' });
  c.news.unshift({ week: 0, year: d.year, text: `${c.you.name} goes ${ordinal(d.yourPick)} overall to ${t.city}.`, tone: 'good' });
  c.goals = weeklyGoals(c);
}

/** A rookie deal: four years, paid by where he went ($ millions a year). */
export const rookieDeal = (pick: number) => ({ years: 4, salary: Math.round((pick <= 32 ? 10 - (pick - 1) * 0.22 : 2.2) * 10) / 10 });

export const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

/** This week's goals: a few things to aim for, worth extra XP. */
export function weeklyGoals(c: Career): Goal[] {
  const r = rng(hash(c.seed, c.season.year, c.season.week, 'goals'));
  const ovr = youPlayer(c).rating;
  const yards = 200 + Math.round((ovr - 65) * 4 / 25) * 25;
  const pool: Goal[] = [
    { key: 'win', text: 'Win the game', xp: 120 },
    { key: `yds${yards}`, text: `Throw for ${yards}+ yards`, xp: 90 },
    { key: 'td2', text: 'Throw 2+ touchdowns', xp: 90 },
    { key: 'noint', text: 'No interceptions', xp: 80 },
    { key: 'comp', text: 'Complete 65% of your passes', xp: 80 },
    { key: 'rush', text: 'Run for 30+ yards', xp: 70 },
    { key: 'rating', text: 'Passer rating of 100+', xp: 100 },
    { key: 'calls', text: 'Average a call grade of 85+', xp: 100 },
  ];
  const out: Goal[] = [pool[0]];
  const rest = pool.slice(1);
  while (out.length < 3) out.push(rest.splice(Math.floor(r() * rest.length), 1)[0]);
  return out;
}

const goalMet = (g: Goal, line: Line, win: boolean, callAvg: number | null): boolean => {
  if (g.key === 'win') return win;
  if (g.key.startsWith('yds')) return (line.py ?? 0) >= Number(g.key.slice(3) || 250);
  if (g.key === 'td2') return (line.ptd ?? 0) >= 2;
  if (g.key === 'noint') return (line.pa ?? 0) >= 5 && !(line.pint ?? 0);
  if (g.key === 'comp') return (line.pa ?? 0) >= 8 && (line.pc ?? 0) / (line.pa ?? 1) >= 0.65;
  if (g.key === 'rush') return (line.ry ?? 0) >= 30;
  if (g.key === 'rating') return (line.pa ?? 0) >= 8 && passerRating(line) >= 100;
  if (g.key === 'calls') return callAvg != null && callAvg >= 85;
  return false;
};

/**
 * XP for a game: the box score, the result, the goals, and the play calls you made yourself (a simmed game earns
 * less: the calls weren't yours). Returns the breakdown for the postgame screen.
 */
export function awardXp(c: Career, gameId: string, line: Line, win: boolean, how: 'sim' | 'moments' | 'full', callScores: number[], kind: string, risks: RiskWin[] = []) {
  const parts: { label: string; xp: number }[] = [];
  const add = (label: string, xp: number) => { if (xp) parts.push({ label, xp: Math.round(xp) }); };
  const mult = how === 'sim' ? 0.6 : 1;
  add('Completions', (line.pc ?? 0) * 3 * mult);
  add('Passing yards', (line.py ?? 0) * 0.35 * mult);
  add('Touchdowns', ((line.ptd ?? 0) + (line.rtd ?? 0)) * 25 * mult);
  add('Rushing yards', Math.max(0, line.ry ?? 0) * 0.5 * mult);
  add('Interceptions', -(line.pint ?? 0) * 15 * mult);
  add(win ? 'Win' : 'Played', (win ? 110 : 40) * (kind === 'reg' ? 1 : 1.6));
  const avg = callScores.length ? callScores.reduce((a, b) => a + b, 0) / callScores.length : null;
  if (avg != null) add(`Play calls (${callScores.length}, average ${Math.round(avg)})`, callScores.length * Math.max(0, avg - 40) * 0.3);
  for (const g of c.goals) if (goalMet(g, line, win, avg)) { g.done = true; add(`Goal: ${g.text}`, g.xp); }
  // risks that paid off: XP, and a free point in the attribute each one showed off
  const me = youPlayer(c);
  const ovr0 = me.rating;
  const boosts: { attr: RiskAttr; label: string }[] = [];
  for (const rk of risks.slice(0, RISK_CAP)) {
    add(`Risk paid off: ${rk.label}`, RISK_XP);
    const v = me.attrs[rk.attr] ?? 60;
    if (v < 99) { me.attrs[rk.attr] = v + 1; boosts.push({ attr: rk.attr, label: `${RISK_ATTR_NAME[rk.attr]} +1` }); }
  }
  if (boosts.length) me.rating = overall(me.attrs);
  const total = Math.max(20, parts.reduce((a, b) => a + b.xp, 0));
  const lv0 = levelOf(c.you.xp);
  const sp0 = Math.floor(c.you.xp / XP_PER_SP);
  c.you.xp += total;
  const sp = Math.floor(c.you.xp / XP_PER_SP) - sp0;
  c.you.sp += sp;
  const lv1 = levelOf(c.you.xp);
  c.last = { gameId, xp: parts, total, sp, levelUp: lv1 > lv0 ? lv1 : undefined, boosts, ovr0, ovr1: me.rating };
}

/** Spend skill points on an attribute. */
export function upgrade(c: Career, a: 'accuracy' | 'arm' | 'decision' | 'mobility'): boolean {
  const p = youPlayer(c);
  const v = p.attrs[a] ?? 60;
  const cost = attrCost(v);
  if (v >= 99 || c.you.sp < cost) return false;
  c.you.sp -= cost;
  p.attrs[a] = v + 1;
  p.rating = overall(p.attrs);
  return true;
}

export function buyAbility(c: Career, k: Ability): boolean {
  const A = ABILITIES[k];
  if (c.you.abilities.includes(k) || c.you.sp < A.cost || levelOf(c.you.xp) < A.level) return false;
  c.you.sp -= A.cost;
  c.you.abilities.push(k);
  return true;
}

/** Your games this season, in order. */
export const yourGames = (c: Career): Game[] => {
  const tm = youPlayer(c).team;
  return c.season.games.filter((g) => g.home === tm || g.away === tm).sort((a, b) => a.week - b.week);
};
export const yourGameThisWeek = (c: Career): Game | undefined => {
  const tm = youPlayer(c).team;
  return c.season.games.find((g) => g.week === c.season.week && (g.home === tm || g.away === tm));
};

export const isRegular = (w: number) => w <= REG_WEEKS;
