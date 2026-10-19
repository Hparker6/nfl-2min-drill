/** Words for the game: clock, field position, situations and the play-by-play. */
import { CALL, LOOKS, ROUTES } from '../engine/data';
import { aiHailMary, aiOffWeights, fgDist, leadOf, resolveSnap, ytg } from '../engine/sim';
import { hash, rng } from '../engine/rng';
import type { Ev, Look, State, Team, TeamInfo } from '../engine/types';

export const fmtClock = (t: number) => {
  const s = Math.max(0, Math.ceil(t - 1e-6));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
export const ord = (n: number) => ['1st', '2nd', '3rd', '4th'][n - 1] || `${n}th`;
const NUM = ['no', 'one', 'two', 'three'];

export function downDist(s: State): string {
  if (s.tryTwo) return 'Two-point try';
  const goal = s.dist >= ytg(s);
  return `${ord(s.down)} & ${goal ? 'Goal' : s.dist}`;
}

/** "AUS 28", "midfield", from the offense's yard line. */
export function ballOn(yl: number, off: Team, teams: [TeamInfo, TeamInfo]): string {
  const y = Math.round(yl);
  if (y === 50) return 'midfield';
  return y < 50 ? `${teams[off].id} ${y}` : `${teams[off === 0 ? 1 : 0].id} ${100 - y}`;
}

/** From your point of view: "your own 28", "their 35". */
function yourSpot(s: State): string {
  const y = Math.round(s.yl);
  if (y === 50) return 'midfield';
  const ownSide = y < 50;
  const you = s.off === 0;
  const whose = ownSide === you ? 'your' : 'their';
  return `${whose}${whose === 'your' ? ' own' : ''} ${y < 50 ? y : 100 - y}`;
}

export function situation(s: State, teams: [TeamInfo, TeamInfo]): string {
  const l = leadOf(s, 0);
  const score = l > 0 ? `You lead by ${l}` : l < 0 ? `You trail by ${-l}` : "It's tied";
  const ball = s.off === 0 ? `Your ball, ${downDist(s)} at ${yourSpot(s)}` : `${teams[1].city} has it, ${downDist(s)} at ${yourSpot(s)}`;
  const tos = `Timeouts: you ${s.to[0]}, them ${s.to[1]}`;
  return `${score} with ${fmtClock(s.t)} left. ${ball}. ${tos}.`;
}

/** The pass plays in the playbook's Short Pass tab; every other pass is in Deep Pass. */
export const SHORT_PASSES = new Set(['quick_out', 'slants', 'screen', 'mesh', 'boot']);
const SIDELINE = new Set(['quick_out', 'comeback', 'deep_corner', 'go']);

export interface Scouting { run: number; short: number; deep: number; note: string }

/**
 * A scouting report on the offense: how often it runs, throws short and throws deep from here, straight from the AI
 * offense's own weights (aiOffWeights), plus its strongest habit. Never the play it has picked for this snap.
 */
export function scouting(s: State): Scouting {
  if (aiHailMary(s)) return { run: 0, short: 0, deep: 1, note: 'Seconds left and far out: expect a Hail Mary.' };
  const w = aiOffWeights(s);
  let run = 0, short = 0, deep = 0, side = 0, total = 0;
  for (const [k, v] of Object.entries(w)) {
    if (!v) continue;
    total += v;
    const c = CALL[k];
    if (!c || c.kind === 'run') run += v;
    else if (c.kind === 'rpo') { run += v / 2; short += v / 2; }
    else if (SHORT_PASSES.has(k)) short += v;
    else deep += v;
    if (SIDELINE.has(k)) side += v;
  }
  const n = total || 1;
  const l = leadOf(s, s.off), yt = ytg(s);
  const note = yt <= 5 ? 'At the goal line: runs, sneaks and quick throws.'
    : s.dist <= 2 && run / n >= 0.45 ? 'Short yardage: a run is likely.'
    : l > 0 && run / n >= 0.55 ? 'They lead: runs to keep the clock moving.'
    : side / n >= 0.38 ? 'They need the clock: outs and comebacks to the sideline are favorites.'
    : yt <= 20 ? 'Close to the end zone: fewer deep shots, more slants and fades.'
    : 'No strong habit here: they could run or throw.';
  return { run: run / n, short: short / n, deep: deep / n, note };
}

/** One line for the defense panel: the mix (rounded to 5%) and the habit. */
export function tendency(s: State): string {
  const sc = scouting(s);
  if (sc.deep === 1 && sc.run === 0 && sc.short === 0) return sc.note;
  // to the nearest 5%, adding up to 100
  const run = Math.round(sc.run * 20) * 5, short = Math.min(100 - run, Math.round(sc.short * 20) * 5), deep = 100 - run - short;
  return `Run ${run}% · short pass ${short}% · deep pass ${deep}%. ${sc.note}`;
}

export type DefFit = 'good' | 'bad' | 'even';
export interface DefVerdict { fit: DefFit; text: string }

/** The offense's expected value of a snap (as the defense test harness scores it): points, first downs, yards. */
function snapValue(s: State, play: string, look: Look, n: number): number {
  let v = 0;
  for (let i = 0; i < n; i++) {
    const res = resolveSnap(s, play, look, rng(hash('verdict', i)));
    v += res.td ? 7 : res.turnover ? -5 : res.yards >= s.dist ? 1.5 + res.yards * 0.1 : res.yards * 0.12 - (res.kind === 'sack' ? 0.5 : 0);
  }
  return v / n;
}

/**
 * Why the defense worked or didn't, after a snap you called on defense: your call against the play they actually
 * ran, compared with the base defense (Cover 3) against the same play, over the same few hundred simulated snaps.
 * The grade says whether the call was right before the snap; this says how it matched the play that came.
 * `pre` is the state the call was made from.
 */
export function defenseVerdict(pre: State, ev: Ev): DefVerdict | null {
  if (ev.type !== 'snap' || ev.off !== 1 || !ev.res.look) return null;
  const play = ev.res.call, look = ev.res.look;
  const c = CALL[play];
  if (!c) return null;   // kneel-downs, spikes and kicks: nothing to read
  const L = LOOKS[look];
  const playName = c.name;
  const won = !ev.res.turnover && (ev.res.td || ev.res.yards >= pre.dist);
  if (look === 'balanced') return { fit: 'even', text: `Cover 3 vs their ${playName}. The base defense takes nothing away and gives nothing up.` };
  const edge = snapValue(pre, play, 'balanced', VERDICT_N) - snapValue(pre, play, look, VERDICT_N);
  const fit: DefFit = edge > VERDICT_EDGE ? 'good' : edge < -VERDICT_EDGE ? 'bad' : 'even';
  const tail = fit === 'good' && won ? ' They made the play anyway.' : fit === 'bad' && !won ? ' You got away with it.' : '';
  const text = fit === 'good' ? `Good fit. ${L.label} vs their ${playName}. Built for it: ${lc(L.stops)}.${tail}`
    : fit === 'bad' ? `Wrong look. ${L.label} vs their ${playName}. Its weak spot: ${lc(L.risk)}.${tail}`
    : `Even matchup. ${L.label} vs their ${playName}: neither side had the edge.`;
  return { fit, text };
}
export const VERDICT_N = 300;
export const VERDICT_EDGE = 0.1;
const lc = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);

export function headline(s: State): string {
  const l = leadOf(s, 0);
  if (s.off === 0) {
    if (l < -3) return 'Touchdown or bust';
    if (l < 0) return 'Get into range';
    if (l === 0) return 'Win it with this drive';
    return 'Close it out';
  }
  if (l > 0) return 'Get a stop';
  return 'Hold them, get it back';
}

const short = (full: string) => {
  const [f, ...rest] = full.split(' ');
  return `${f[0]}. ${rest.join(' ')}`;
};

export interface Told { text: string; banner?: string; tone: 'good' | 'bad' | 'neutral' }

const OT_ORD = ['first', 'second', 'third', 'fourth'];

export function tell(ev: Ev, teams: [TeamInfo, TeamInfo]): Told {
  const tone = (team: Team, good: boolean): Told['tone'] => ((team === 0) === good ? 'good' : 'bad');
  switch (ev.type) {
    case 'timeout':
      return { text: `Timeout, ${teams[ev.team].city} (${NUM[ev.left] ?? ev.left} left).`, banner: 'Timeout', tone: 'neutral' };
    case 'warning':
      return { text: 'Two-minute warning.', banner: 'Two-minute warning', tone: 'neutral' };
    case 'expire':
      return { text: 'The clock runs out.', banner: 'Final', tone: 'neutral' };
    case 'pat': {
      if (ev.def2) return { text: `Turned over and returned all the way: two points for ${teams[ev.off === 0 ? 1 : 0].city}.`, banner: 'Defensive two', tone: tone(ev.off, false) };
      const what = ev.two ? 'Two-point try' : 'Extra point';
      return { text: `${what} is ${ev.good ? 'good' : ev.two ? 'no good' : 'missed'}.`, banner: ev.good ? (ev.two ? 'Two points' : undefined) : 'No good', tone: tone(ev.off, ev.good) };
    }
    case 'kick': {
      const T = teams[ev.recover];
      if (ev.kind === 'onside') {
        const got = ev.recover === ev.kicker;
        return { text: `Onside kick… recovered by ${teams[ev.kicker].city}${got ? '!' : '? No, ' + T.city + ' falls on it.'}`, banner: got ? 'Onside recovered' : undefined, tone: tone(ev.kicker, got) };
      }
      if (ev.td) return { text: `Kickoff returned all the way for a touchdown by ${T.city}!`, banner: 'Touchdown', tone: tone(ev.recover, true) };
      const spot = ballOn(ev.yl, ev.recover, teams);
      if (ev.touchback) return { text: `Kickoff into the end zone. Touchback, ball at the ${spot}.`, tone: 'neutral' };
      return { text: `${ev.kind === 'free' ? 'Free kick' : 'Kickoff'} returned to the ${spot}.`, tone: 'neutral' };
    }
    case 'snap':
      // a two-point try's snap: what happened, and the try's own line (the 'pat' event after it) gives the verdict
      if (ev.try) return { text: tellSnapText(ev, teams).text.replace(/TOUCHDOWN!?/g, 'in!').replace(/ for a in!/g, ': in!'), tone: 'neutral' };
      return tellSnap(ev, teams);
    case 'twotry':
      return { text: `${teams[ev.off].city} goes for two.`, banner: 'Going for two', tone: 'neutral' };
    case 'adjust':
      return { text: `${teams[1].city} adjusts: three straight ${(CALL[ev.call]?.name ?? 'calls').toLowerCase()}, and they're answering with ${LOOKS[ev.counter].label.toLowerCase()}. Time to change it up.`, banner: 'They adjust', tone: 'bad' };
    case 'momentum':
      return ev.team === 0
        ? { text: 'Momentum is yours: the sideline is up, and your reads come easier.', banner: 'Momentum', tone: 'good' }
        : { text: `Momentum swings to ${teams[1].city}: it gets harder to read them.`, banner: 'Momentum shift', tone: 'bad' };
    case 'period':
      return ev.q === 3 ? { text: 'Halftime.', banner: 'Halftime', tone: 'neutral' }
        : ev.q >= 5 ? { text: ev.q === 5 ? 'Tied at the end of regulation: overtime.' : `End of the ${OT_ORD[ev.q - 6] ?? `${ev.q - 5}th`} overtime period.`, banner: 'Overtime', tone: 'neutral' }
        : { text: `End of the ${ev.q === 2 ? 'first' : 'third'} quarter.`, banner: `End of Q${ev.q - 1}`, tone: 'neutral' };
    case 'final':
      return { text: ev.ot ? 'Final, in overtime.' : 'Final.', banner: 'Final', tone: 'neutral' };
    case 'toss':
      return { text: `${teams[0].city} calls ${ev.call}. It's ${ev.face}: ${teams[ev.won].city} wins the toss.`, banner: ev.won === 0 ? 'You win the toss' : 'They win the toss', tone: tone(ev.won, true) };
    case 'otpick':
      return { text: `${ev.q > 5 ? 'Third overtime period: ' : ''}${teams[ev.team].city} will ${ev.recv ? 'receive' : 'kick off'}.`, tone: 'neutral' };
  }
}

function tellSnap(ev: Extract<Ev, { type: 'snap' }>, teams: [TeamInfo, TeamInfo]): Told {
  const told = tellSnapText(ev, teams);
  const r = ev.res;
  const gain = r.kind === 'run' || r.kind === 'scramble' || (r.kind === 'pass' && r.complete);
  if (!told.banner && gain && !r.penalty) told.banner = r.yards > 0 ? `+${r.yards}` : r.yards === 0 ? 'No gain' : `−${-r.yards}`;
  if (!told.banner && r.kind === 'pass' && r.complete && ev.first) told.banner = 'First down';
  return told;
}

function tellSnapText(ev: Extract<Ev, { type: 'snap' }>, teams: [TeamInfo, TeamInfo]): Told {
  const O = teams[ev.off], D = teams[ev.off === 0 ? 1 : 0];
  const res = ev.res;
  const nm = (team: TeamInfo, pos: string) => short(team.players[pos]?.name || pos);
  const qb = nm(O, 'QB');
  const yds = (n: number) => `${Math.abs(n)} yard${Math.abs(n) === 1 ? '' : 's'}`;
  const good = (g: boolean): Told['tone'] => ((ev.off === 0) === g ? 'good' : 'bad');
  const tail = () => {
    let t = '';
    if (res.oob) t += ', out of bounds';
    if (ev.first && !res.td) t += '. First down';
    return t + '.';
  };
  const lostOnDowns = ev.down0 === 4 && !ev.first && !res.td && !res.turnover && !res.penalty && res.kind !== 'fg' && res.kind !== 'punt';
  const downs = lostOnDowns ? ' Turnover on downs.' : '';

  if (res.penalty === 'hold') return { text: `Holding on the offense. Ten yards, replay the down.`, banner: 'Flag', tone: good(false) };
  if (res.penalty === 'dpi') return { text: `Pass interference on ${D.city}. ${yds(res.yards)} and an automatic first down.`, banner: 'Flag', tone: good(true) };
  if (res.penalty === 'rough') return { text: `Roughing the kicker! ${O.city} keeps the ball with a first down.`, banner: 'Flag', tone: good(true) };

  switch (res.kind) {
    case 'kneel': return { text: `${qb} takes a knee.`, tone: 'neutral' };
    case 'spike': return { text: `${qb} spikes it to stop the clock.`, tone: 'neutral' };
    case 'fg': {
      const k = nm(O, 'K');
      const d = res.air ?? fgDist({ yl: ev.yl0 } as State);
      if (res.blocked) return { text: `${k}'s ${d}-yard field goal is BLOCKED!`, banner: 'Blocked', tone: good(false) };
      return res.good
        ? { text: `${k}'s ${d}-yard field goal is good.`, banner: 'It’s good', tone: good(true) }
        : { text: `${k}'s ${d}-yard field goal is no good.`, banner: 'No good', tone: good(false) };
    }
    case 'punt': {
      const p = nm(O, 'P');
      if (res.blocked) return { text: `${p}'s punt is BLOCKED!`, banner: 'Blocked', tone: good(false) };
      if (res.defTd) return { text: `${p} punts and ${D.city} takes it back for a touchdown!`, banner: 'Touchdown', tone: good(false) };
      if (res.touchback) return { text: `${p} punts into the end zone. Touchback.`, tone: 'neutral' };
      return { text: `${p} punts ${res.air} yards, returned ${res.retYds ?? 0}.`, tone: 'neutral' };
    }
    case 'sack': {
      if (res.safety) return { text: `${qb} is sacked in the end zone. Safety!`, banner: 'Safety', tone: good(false) };
      const f = res.fumble ? ` He fumbles, and ${D.city} recovers!` : '';
      return { text: `${qb} is sacked for a loss of ${yds(res.yards)}.${f}${downs}`, banner: res.fumble ? 'Fumble' : 'Sack', tone: good(false) };
    }
    case 'scramble':
      if (res.td) return { text: `${qb} scrambles ${yds(res.yards)} for a TOUCHDOWN!`, banner: 'Touchdown', tone: good(true) };
      return { text: `${qb} scrambles for ${yds(res.yards)}${tail()}${downs}`, banner: ev.first ? 'First down' : undefined, tone: good(res.yards >= ev.dist0) };
    case 'run': {
      const who = nm(O, res.carrier);
      const call = CALL[res.call];
      const how = res.call === 'rpo_bubble' || res.call === 'rpo_slant' ? `${qb} hands off, ${who}` : who;
      const lane = res.lane === 'out' ? (res.side < 0 ? 'around left end' : 'around right end') : res.side < 0 ? 'up the middle' : 'off right guard';
      if (res.safety) return { text: `${who} is dropped in the end zone. Safety!`, banner: 'Safety', tone: good(false) };
      if (res.td) return { text: `${how} ${lane}… TOUCHDOWN! ${yds(res.yards)}.`, banner: 'Touchdown', tone: good(true) };
      if (res.fumble) return { text: `${how} ${lane} for ${yds(res.yards)}, and FUMBLES. ${D.city} recovers!`, banner: 'Fumble', tone: good(false) };
      const gain = res.yards > 0 ? `for ${yds(res.yards)}` : res.yards === 0 ? 'for no gain' : `for a loss of ${yds(res.yards)}`;
      return { text: `${call?.name ?? 'Run'}: ${how} ${lane} ${gain}${tail()}${downs}`, banner: lostOnDowns ? 'Turnover on downs' : ev.first ? 'First down' : undefined, tone: good(ev.first || res.yards >= 4) };
    }
    case 'pass': {
      const rc = res.target ? nm(O, res.target) : 'a receiver';
      const route = res.route ? ROUTES[res.route].name.toLowerCase() : 'route';
      const thrower = res.call === 'wr_pass' ? nm(O, 'WR2') : qb;
      if (res.intercepted) {
        const by = nm(D, res.carrier);
        if (res.touchback) return { text: `${thrower} throws for ${rc} in the end zone… INTERCEPTED by ${by}. Touchback.`, banner: 'Intercepted', tone: good(false) };
        if (res.defTd) return { text: `${thrower} is INTERCEPTED by ${by}, and he takes it all the way back for a touchdown!`, banner: 'Pick six', tone: good(false) };
        return { text: `${thrower} is INTERCEPTED by ${by}, returned ${yds(res.retYds ?? 0)}.`, banner: 'Intercepted', tone: good(false) };
      }
      if (!res.complete) return { text: `${thrower} throws incomplete, ${route} intended for ${rc}.${downs}`, banner: lostOnDowns ? 'Turnover on downs' : 'Incomplete', tone: good(false) };
      if (res.td) return { text: `${thrower} finds ${rc} on the ${route}… TOUCHDOWN! ${yds(res.yards)}.`, banner: 'Touchdown', tone: good(true) };
      if (res.fumble) return { text: `${thrower} to ${rc} for ${yds(res.yards)}, but he FUMBLES. ${D.city} recovers!`, banner: 'Fumble', tone: good(false) };
      return { text: `${thrower} to ${rc} on the ${route} for ${res.yards >= 0 ? yds(res.yards) : 'a loss of ' + yds(res.yards)}${tail()}${downs}`, banner: lostOnDowns ? 'Turnover on downs' : ev.first ? 'First down' : undefined, tone: good(ev.first || res.yards >= 6) };
    }
    default:
      return { text: '', tone: 'neutral' };
  }
}
