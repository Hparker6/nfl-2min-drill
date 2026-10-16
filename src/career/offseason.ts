/**
 * Between seasons: the year's awards and your season summary, then everyone a year older (young players improve,
 * veterans decline, some retire), rookies and free agents filling the holes, your contract, and trade requests.
 */
import { clip, gauss, hash, rng } from '../engine/rng';
import { SLOT_GROUP, SLOTS } from '../engine/roster';
import { seasonAwards } from './awards';
import { ARCH, ordinal, weeklyGoals, youPlayer, type Career, type SeasonSummary } from './career';
import { genPlayer, nameMaker, overall, teamById, teamInfo } from './league';
import { newSeason, placesFrom, REG_WEEKS } from './season';
import { standings } from './standings';
import type { CPlayer } from './types';

/** The season just ended: awards, your summary, the offseason. Call once, after the final. */
export function endSeason(c: Career) {
  const s = c.season;
  s.awards = seasonAwards(c.league, s, c.you.pid);
  const me = youPlayer(c);
  const st = standings(c.league.teams, s.games)[me.team!];
  const po = s.games.filter((g) => g.kind !== 'reg' && (g.home === me.team || g.away === me.team));
  const lastPo = po[po.length - 1];
  const wonFinal = s.champion === me.team;
  const playoff = !po.length ? undefined : wonFinal ? 'Won the Gridiron Bowl'
    : `Lost in the ${{ wc: 'Wild Card round', div: 'Divisional round', conf: 'Conference Championship', final: 'Gridiron Bowl', reg: '' }[lastPo.kind]}`;
  const sum: SeasonSummary = {
    year: s.year, team: me.team!, line: s.stats[c.you.pid] ?? {}, w: st?.w ?? 0, l: st?.l ?? 0, t: st?.t ?? 0, playoff,
    awards: s.awards.filter((a) => a.you).map((a) => a.name), ovr: me.rating,
  };
  c.history.push(sum);
  // a year off the contract: at 0 he's a free agent this offseason
  if (c.you.contract) c.you.contract.years = Math.max(0, c.you.contract.years - 1);
  for (const a of s.awards.filter((x) => x.you)) c.news.unshift({ week: 23, year: s.year, text: `${c.you.name} wins ${a.name}.`, tone: 'good' });
  c.phase = 'offseason';
}

/** Aging: growth until the mid-20s, a plateau, then decline. Ironman pushes your decline back three years. */
function ageOne(p: CPlayer, r: () => number, iron = false) {
  p.age++;
  p.exp++;
  const g = SLOT_GROUP[p.slot];
  const peak = g === 'QB' || g === 'K' || g === 'P' ? 31 : 28;
  const decline = (g === 'QB' ? 33 : g === 'RB' ? 29 : 30) + (iron ? 3 : 0);
  for (const k in p.attrs) {
    const a = k as keyof typeof p.attrs;
    let v = p.attrs[a] ?? 60;
    if (p.age <= peak && p.id !== 'you') v += Math.max(0, ((p.pot ?? v) - v) * (0.18 + r() * 0.2));
    else if (p.age >= decline) v -= 1 + r() * (p.age - decline + 1) * 0.9;
    else v += gauss(r) * 0.8;
    p.attrs[a] = clip(Math.round(v), 30, 99);
  }
  p.rating = overall(p.attrs);
}

/** Will he hang them up? Older and worse: more likely. You never retire unless you choose to. */
function retires(p: CPlayer, r: () => number): boolean {
  if (p.id === 'you') return false;
  const g = SLOT_GROUP[p.slot];
  const old = g === 'QB' || g === 'K' || g === 'P' ? 37 : g === 'RB' ? 31 : 33;
  if (p.age < old - 3) return p.rating < 58 && r() < 0.3;
  return r() < 0.25 + (p.age - old + 3) * 0.15 + (p.rating < 70 ? 0.2 : 0);
}

/**
 * The offseason in one go: age, retire, then fill every empty slot from free agency (veterans who were let go) or
 * the draft (rookies). Each team also lets a weak starter go now and then and replaces him with a better free agent.
 */
export function runOffseason(c: Career) {
  const lg = c.league, year = c.season.year + 1;
  const r = rng(hash(c.seed, year, 'offseason'));
  const used = new Set(Object.values(lg.players).map((p) => p.name));
  const name = nameMaker(rng(hash(c.seed, year, 'rookie-names')), used);
  const news: string[] = [];
  for (const p of Object.values(lg.players)) {
    if (p.retired) continue;
    ageOne(p, r, p.id === 'you' && c.you.abilities.includes('iron'));
  }
  // retirements
  for (const t of lg.teams) for (const slot of SLOTS) {
    const p = lg.players[t.roster[slot]];
    if (p && retires(p, r)) {
      p.retired = true; p.team = null; delete t.roster[slot];
      if (p.rating >= 80) news.push(`${p.name} (${t.city}) retires.`);
    }
  }
  for (const p of Object.values(lg.players)) if (!p.team && !p.retired && p.age >= 35 && p.id !== 'you') p.retired = true;
  // a few cuts: a team lets its weakest starters go when the market has better
  const fa = () => Object.values(lg.players).filter((p) => !p.team && !p.retired && p.id !== 'you');
  let n = 0;
  for (const t of lg.teams) {
    for (const slot of SLOTS) {
      if (t.roster[slot]) continue;
      const g = SLOT_GROUP[slot];
      const pool = fa().filter((p) => SLOT_GROUP[p.slot] === g).sort((a, b) => b.rating - a.rating);
      const vet = pool[0];
      // a rookie: 62-76 now, with room to grow
      const rook = genPlayer(`r${year}-${(n++).toString(36)}`, slot, 62 + r() * 14, r, name(), 0, t.id);
      rook.age = 21 + Math.floor(r() * 3); rook.exp = 0; rook.pot = clip(rook.rating + 6 + Math.round(r() * 16), 60, 99);
      const pick = vet && vet.rating > rook.rating + 2 && r() < 0.75 ? vet : rook;
      if (pick === rook) lg.players[rook.id] = rook;
      pick.team = t.id; pick.slot = slot;
      const nums = new Set(SLOTS.map((s) => lg.players[t.roster[s]]?.number));
      if (!pick.number || nums.has(pick.number)) pick.number = [...Array(99).keys()].map((x) => x + 1).find((x) => !nums.has(x)) ?? 0;
      t.roster[slot] = pick.id;
      if (pick === vet && vet.rating >= 80) news.push(`${t.city} signs ${vet.name} (${vet.rating} overall).`);
    }
  }
  // every so often a team upgrades a slot from the free-agent pool
  for (const t of lg.teams) {
    if (r() > 0.5) continue;
    const slot = SLOTS[Math.floor(r() * SLOTS.length)];
    if (slot === 'QB' && t.roster.QB === c.you.pid) continue;
    const cur = lg.players[t.roster[slot]];
    const g = SLOT_GROUP[slot];
    const best = fa().filter((p) => SLOT_GROUP[p.slot] === g).sort((a, b) => b.rating - a.rating)[0];
    if (cur && best && best.rating > cur.rating + 3) {
      cur.team = null; best.team = t.id; best.slot = slot; t.roster[slot] = best.id;
      if (best.rating >= 78) news.push(`${t.city} signs ${best.name}, moving on from ${cur.name}.`);
    }
  }
  for (const text of news.slice(0, 12)) c.news.unshift({ week: 0, year, text, tone: 'neutral' });
}

/** Contract talk: offers from teams that want you, by how good you are. Empty while you're under contract. */
export function offers(c: Career): { team: string; years: number; salary: number }[] {
  const me = youPlayer(c);
  const ct = c.you.contract;
  if (ct && ct.years > 0 && !c.you.wantsTrade) return [];
  const r = rng(hash(c.seed, c.season.year, 'offers'));
  const value = 4 + Math.max(0, me.rating - 65) * 1.6;   // $m a year
  const teams = c.league.teams
    .map((t) => ({ t, need: (c.league.players[t.roster.QB]?.rating ?? 60) }))
    .filter((x) => x.t.id !== me.team && x.need < me.rating + 2)
    .sort((a, b) => a.need - b.need || (r() - 0.5))
    .slice(0, 4);
  const out = teams.map((x) => ({ team: x.t.id, years: 2 + Math.floor(r() * 4), salary: Math.round(value * (0.9 + r() * 0.25) * 10) / 10 }));
  // your own team always wants you back
  if (!c.you.wantsTrade) out.unshift({ team: me.team!, years: 3 + Math.floor(r() * 3), salary: Math.round(value * 1.05 * 10) / 10 });
  return out;
}

/**
 * Sign with a team (or re-sign). Changing teams swaps quarterbacks: theirs becomes a free agent, your old team signs
 * the best one available. A trade works the same way, with the teams' quarterbacks swapped (fair value: they only
 * agree when you're the better player).
 */
export function signWith(c: Career, team: string, years: number, salary: number, trade = false) {
  const lg = c.league, me = youPlayer(c);
  const from = teamById(lg, me.team!), to = teamById(lg, team);
  c.you.contract = { years, salary };
  c.you.wantsTrade = false;
  if (team === me.team) { c.news.unshift({ week: 0, year: c.season.year + 1, text: `${c.you.name} re-signs with ${to.city}: ${years} years, $${salary}m a year.`, tone: 'good' }); return; }
  const theirs = lg.players[to.roster.QB];
  if (trade && theirs) { theirs.team = from.id; from.roster.QB = theirs.id; }
  else {
    if (theirs) theirs.team = null;
    const best = Object.values(lg.players).filter((p) => !p.team && !p.retired && p.slot === 'QB' && p.id !== 'you').sort((a, b) => b.rating - a.rating)[0];
    if (best) { best.team = from.id; from.roster.QB = best.id; } else delete from.roster.QB;
  }
  to.roster.QB = me.id;
  me.team = to.id;
  c.news.unshift({ week: 0, year: c.season.year + 1, text: trade ? `Traded: ${c.you.name} to ${to.city}${theirs ? ` for ${theirs.name}` : ''}.` : `${c.you.name} signs with ${to.city}: ${years} years, $${salary}m a year.`, tone: 'good' });
}

/** Teams that would trade for you now: a worse quarterback, and you're worth his spot. */
export function tradeTargets(c: Career): string[] {
  const me = youPlayer(c);
  return c.league.teams.filter((t) => t.id !== me.team && (c.league.players[t.roster.QB]?.rating ?? 0) <= me.rating - 2).map((t) => t.id);
}

/** The new season: schedule from last year's finishes, goals, a fresh slate. */
export function startNextSeason(c: Career) {
  const places = placesFrom(c.league, c.season.games, c.seed);
  const year = c.season.year + 1;
  c.season = newSeason(c.league, year, places, c.seed);
  c.boxes = {};
  c.phase = 'season';
  c.goals = weeklyGoals(c);
  const t = teamById(c.league, youPlayer(c).team!);
  c.news.unshift({ week: 0, year, text: `The ${year} season begins. ${t.city} opens ${teamInfo(c.league, t).rat.ovr} overall.`, tone: 'neutral' });
}

export const yearsIn = (c: Career) => c.history.length;
export const archName = (c: Career) => ARCH[c.you.arch].name;
export const isOver = (c: Career) => c.season.week > REG_WEEKS + 4;
export { ordinal };
