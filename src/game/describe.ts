/** Words for the game: clock, field position, situations and the play-by-play. */
import { CALL, ROUTES } from '../engine/data';
import { fgDist, leadOf, ytg } from '../engine/sim';
import type { Ev, State, Team, TeamInfo } from '../engine/types';

export const fmtClock = (t: number) => {
  const s = Math.max(0, Math.ceil(t - 1e-6));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
export const ord = (n: number) => ['1st', '2nd', '3rd', '4th'][n - 1] || `${n}th`;
const NUM = ['no', 'one', 'two', 'three'];

export function downDist(s: State): string {
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

/** The offense's likely intentions, read from the situation (the AI's call is never revealed). */
export function tendency(s: State): string {
  const l = leadOf(s, s.off), yt = ytg(s);
  if (yt <= 5) return 'Inside your 5: expect a run, a quick throw or a fade.';
  if (l > 0) return 'They lead: expect runs to keep the clock moving.';
  if (s.down >= 3 && s.dist >= 7) return `${ord(s.down)} and long: expect a pass past the sticks.`;
  if (s.dist <= 2) return 'Short yardage: expect a run or a quick throw.';
  if (l < 0 && s.t <= 300) return 'They trail with the clock running down: expect passes, especially toward the sidelines.';
  if (l === 0 && s.t <= 120) return 'Tied late: they want field goal range without wasting time.';
  return 'Balanced situation: they could run or throw.';
}

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
      return tellSnap(ev, teams);
    case 'period':
      return ev.q === 3 ? { text: 'Halftime.', banner: 'Halftime', tone: 'neutral' }
        : ev.q >= 5 ? { text: ev.q === 5 ? 'Tied at the end of regulation: overtime.' : 'Still tied: another overtime period.', banner: 'Overtime', tone: 'neutral' }
        : { text: `End of the ${ev.q === 2 ? 'first' : 'third'} quarter.`, banner: `End of Q${ev.q - 1}`, tone: 'neutral' };
    case 'final':
      return { text: ev.ot ? 'Final, in overtime.' : 'Final.', banner: 'Final', tone: 'neutral' };
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
