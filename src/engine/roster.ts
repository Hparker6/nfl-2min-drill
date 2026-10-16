/**
 * Rosters and game ratings.
 *
 * Every player carries game ratings on a 0-100 scale, by position. They are GAME ratings: tuning numbers for this
 * simulation, not official measurements. Where they come from is recorded per player (`source`):
 *   'generated'  made up for a fictional player (the current rosters)
 *   'stats'      derived from a published statistic, with the season recorded on the roster
 *   'estimated'  a judgment call where no statistic exists
 * A real-data roster plugs in here without touching the engine or the UI, as long as validateRoster() passes.
 *
 * The engine never reads individual attributes directly. units() rolls a team's players up into the matchups the
 * engine resolves (protection vs pass rush, each receiver vs the defender covering him, run blocking vs run defense),
 * and attributes.ts documents how each of those numbers moves a play.
 */
import type { Rcv } from './types';

export type Attr =
  | 'accuracy' | 'arm' | 'decision' | 'mobility'                    // quarterback
  | 'speed' | 'acceleration' | 'agility' | 'power'                   // ball carriers
  | 'hands' | 'routeRunning' | 'release' | 'contested'               // receivers
  | 'passPro' | 'runBlock'                                           // blockers
  | 'passRush' | 'runDefense' | 'tackling' | 'pursuit'               // front seven
  | 'coverage' | 'reaction' | 'ballSkills'                           // coverage
  | 'kickPower' | 'kickAccuracy';                                    // specialists

export type PosGroup = 'QB' | 'RB' | 'WR' | 'TE' | 'OL' | 'DL' | 'LB' | 'CB' | 'S' | 'K' | 'P';

/** The attributes each position group must have. */
export const GROUP_ATTRS: Record<PosGroup, Attr[]> = {
  QB: ['accuracy', 'arm', 'decision', 'mobility'],
  RB: ['acceleration', 'speed', 'agility', 'power', 'hands'],
  WR: ['speed', 'acceleration', 'routeRunning', 'hands', 'release', 'contested'],
  TE: ['speed', 'routeRunning', 'hands', 'contested', 'runBlock', 'passPro'],
  OL: ['passPro', 'runBlock'],
  DL: ['passRush', 'runDefense', 'tackling', 'pursuit'],
  LB: ['passRush', 'runDefense', 'tackling', 'pursuit', 'coverage'],
  CB: ['coverage', 'reaction', 'speed', 'tackling', 'ballSkills'],
  S: ['coverage', 'reaction', 'speed', 'tackling', 'ballSkills'],
  K: ['kickPower', 'kickAccuracy'],
  P: ['kickPower'],
};

export const ATTR_NAME: Record<Attr, string> = {
  accuracy: 'Accuracy', arm: 'Arm strength', decision: 'Decision-making', mobility: 'Mobility', speed: 'Speed',
  acceleration: 'Acceleration', agility: 'Agility', power: 'Power', hands: 'Hands', routeRunning: 'Route running',
  release: 'Release', contested: 'Contested catch', passPro: 'Pass protection', runBlock: 'Run blocking',
  passRush: 'Pass rush', runDefense: 'Run defense', tackling: 'Tackling', pursuit: 'Pursuit', coverage: 'Coverage',
  reaction: 'Reaction', ballSkills: 'Ball skills', kickPower: 'Leg', kickAccuracy: 'Kick accuracy',
};

/** The 24 spots a roster fills: the 22 on the field plus the specialists. */
export const SLOT_GROUP: Record<string, PosGroup> = {
  QB: 'QB', RB: 'RB', WR1: 'WR', WR2: 'WR', WR3: 'WR', TE: 'TE', LT: 'OL', LG: 'OL', C: 'OL', RG: 'OL', RT: 'OL',
  EDGE1: 'DL', DL1: 'DL', DL2: 'DL', EDGE2: 'DL', LB1: 'LB', LB2: 'LB', LB3: 'LB', CB1: 'CB', CB2: 'CB', S1: 'S', S2: 'S',
  K: 'K', P: 'P',
};
export const SLOTS = Object.keys(SLOT_GROUP);

/** Jersey numbers each position group may wear (current league numbering rules, simplified). */
export const NUMBER_RANGES: Record<PosGroup, [number, number][]> = {
  QB: [[0, 19]], RB: [[0, 49], [80, 89]], WR: [[0, 49], [80, 89]], TE: [[0, 49], [80, 89]], OL: [[50, 79]],
  // edge rushers are listed as ends or outside linebackers, so the front seven shares one range
  DL: [[0, 79], [90, 99]], LB: [[0, 79], [90, 99]], CB: [[0, 49]], S: [[0, 49]], K: [[0, 49], [90, 99]], P: [[0, 49], [90, 99]],
};

export type RatingSource = 'generated' | 'stats' | 'estimated';

export interface RosterPlayer {
  name: string;
  number: number;
  rating: number;                         // overall game rating: the average of the position's attributes
  attrs: Partial<Record<Attr, number>>;
  source: RatingSource;
}

export interface RosterMeta {
  season?: string;                        // the season every stat-derived rating comes from (one per roster)
  sourceName: string;                     // where names, numbers and stats come from
  sourceUrl?: string;
  license?: string;
}

/** Problems with a roster, empty when it is usable. Real-data imports must pass this. */
export function validateRoster(teamId: string, players: Record<string, RosterPlayer | undefined>, meta: RosterMeta): string[] {
  const issues: string[] = [];
  const numbers = new Map<number, string>();
  if (!meta.sourceName) issues.push(`${teamId}: roster has no source`);
  for (const slot of SLOTS) {
    const p = players[slot];
    const g = SLOT_GROUP[slot];
    if (!p) { issues.push(`${teamId} ${slot}: missing player`); continue; }
    if (!p.name?.trim()) issues.push(`${teamId} ${slot}: missing name`);
    if (!Number.isInteger(p.number) || p.number < 0 || p.number > 99) issues.push(`${teamId} ${slot}: invalid number ${p.number}`);
    else if (!NUMBER_RANGES[g].some(([a, b]) => p.number >= a && p.number <= b)) issues.push(`${teamId} ${slot}: number ${p.number} not allowed for ${g}`);
    if (numbers.has(p.number)) issues.push(`${teamId} ${slot}: number ${p.number} also worn by ${numbers.get(p.number)}`);
    numbers.set(p.number, slot);
    for (const a of GROUP_ATTRS[g]) {
      const v = p.attrs[a];
      if (v == null || !Number.isFinite(v)) issues.push(`${teamId} ${slot}: missing ${a}`);
      else if (v < 0 || v > 100) issues.push(`${teamId} ${slot}: ${a} ${v} outside 0-100`);
    }
    if (p.source === 'stats' && !meta.season) issues.push(`${teamId} ${slot}: stat-derived ratings with no season on the roster`);
    if (!['generated', 'stats', 'estimated'].includes(p.source)) issues.push(`${teamId} ${slot}: unknown rating source`);
  }
  return issues;
}

/** What the engine resolves plays with: a team's players rolled up into matchups. All on the 0-100 scale. */
export interface Units {
  passPro: number;   // offensive line + tight end, pass protection
  runBlock: number;  // offensive line + tight end, run blocking
  passRush: number;  // the four down linemen (blitzers add in the engine)
  runDef: number;    // front seven against the run
  tackling: number;  // front seven and secondary
  pursuit: number;   // how fast the defense closes on a ball carrier
  qb: { accuracy: number; arm: number; decision: number; mobility: number };
  rb: { speed: number; acceleration: number; agility: number; power: number; hands: number };
  /** each eligible receiver: separation (routes, release, speed), hands, run after catch, contested catch, speed */
  rcv: Record<Rcv, { sep: number; hands: number; yac: number; contested: number; speed: number }>;
  /** the defender covering each eligible receiver */
  cov: Record<Rcv, { coverage: number; ballSkills: number; speed: number; reaction: number }>;
  /** the two safeties: deep help on long throws */
  safety: { coverage: number; speed: number };
  /** movement for every slot: top speed, acceleration and reaction (0-100), for the play timeline */
  move: Record<string, { speed: number; accel: number; react: number }>;
}

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Who covers whom in the base defense: corners on the outside receivers, a safety on the slot, linebackers inside. */
const COVERS: Record<Rcv, string[]> = { WR1: ['CB1'], WR2: ['CB2'], WR3: ['S1'], TE: ['LB2', 'S2'], RB: ['LB1'] };

export function units(p: Record<string, RosterPlayer>): Units {
  const a = (slot: string, k: Attr, d = 70) => p[slot]?.attrs[k] ?? d;
  const line = ['LT', 'LG', 'C', 'RG', 'RT'];
  const front = ['EDGE1', 'DL1', 'DL2', 'EDGE2'];
  const second = ['LB1', 'LB2', 'LB3'];
  const back = ['CB1', 'CB2', 'S1', 'S2'];
  const rcv = {} as Units['rcv'];
  const cov = {} as Units['cov'];
  for (const r of ['WR1', 'WR2', 'WR3', 'TE', 'RB'] as Rcv[]) {
    const sep = r === 'RB' ? avg([a(r, 'agility'), a(r, 'acceleration')])
      : r === 'TE' ? avg([a(r, 'routeRunning'), a(r, 'speed')])
      : 0.45 * a(r, 'routeRunning') + 0.3 * a(r, 'release') + 0.25 * a(r, 'speed');
    const yac = r === 'RB' ? avg([a(r, 'agility'), a(r, 'speed'), a(r, 'power')])
      : r === 'TE' ? avg([a(r, 'speed'), a(r, 'contested')])
      : avg([a(r, 'speed'), a(r, 'acceleration')]);
    rcv[r] = { sep, hands: a(r, 'hands'), yac, contested: a(r, 'contested', a(r, 'hands')), speed: a(r, 'speed') };
    const cs = COVERS[r];
    cov[r] = {
      coverage: avg(cs.map((c) => a(c, 'coverage'))), ballSkills: avg(cs.map((c) => a(c, 'ballSkills', 60))),
      speed: avg(cs.map((c) => a(c, 'speed', a(c, 'pursuit')))), reaction: avg(cs.map((c) => a(c, 'reaction', a(c, 'pursuit')))),
    };
  }
  return {
    passPro: 0.85 * avg(line.map((s) => a(s, 'passPro'))) + 0.15 * a('TE', 'passPro'),
    runBlock: 0.85 * avg(line.map((s) => a(s, 'runBlock'))) + 0.15 * a('TE', 'runBlock'),
    // the best rusher matters, but he is one of four against five blockers
    passRush: 0.7 * avg(front.map((s) => a(s, 'passRush'))) + 0.3 * Math.max(...front.map((s) => a(s, 'passRush'))),
    runDef: 0.65 * avg(front.map((s) => a(s, 'runDefense'))) + 0.35 * avg(second.map((s) => a(s, 'runDefense'))),
    tackling: avg([...front, ...second, ...back].map((s) => a(s, 'tackling'))),
    pursuit: avg([...front.map((s) => a(s, 'pursuit')), ...second.map((s) => a(s, 'pursuit')), ...back.map((s) => a(s, 'speed'))]),
    qb: { accuracy: a('QB', 'accuracy'), arm: a('QB', 'arm'), decision: a('QB', 'decision'), mobility: a('QB', 'mobility') },
    rb: { speed: a('RB', 'speed'), acceleration: a('RB', 'acceleration'), agility: a('RB', 'agility'), power: a('RB', 'power'), hands: a('RB', 'hands') },
    rcv,
    cov,
    safety: { coverage: avg(['S1', 'S2'].map((s) => a(s, 'coverage'))), speed: avg(['S1', 'S2'].map((s) => a(s, 'speed'))) },
    move: Object.fromEntries(SLOTS.map((s) => {
      const g = SLOT_GROUP[s];
      // linemen and front-seven players have no speed rating: pursuit (or a lineman's baseline) stands in
      const speed = g === 'QB' ? a(s, 'mobility') : g === 'OL' ? 50 : g === 'DL' || g === 'LB' ? a(s, 'pursuit') : g === 'K' || g === 'P' ? 50 : a(s, 'speed');
      const accel = p[s]?.attrs.acceleration ?? speed;
      const react = g === 'CB' || g === 'S' ? a(s, 'reaction') : g === 'DL' || g === 'LB' ? a(s, 'pursuit') : 75;
      return [s, { speed, accel, react }];
    })),
  };
}
