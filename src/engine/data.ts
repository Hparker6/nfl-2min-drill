/** Static football data: fictional teams, name pools, routes, drop types and the 27-call playbook. */
import type { Look, Rcv, RouteId } from './types';

/** Fictional franchises: [id, city, nickname, primary, secondary]. No real league marks. */
export const FRANCHISES: [string, string, string, string, string][] = [
  ['AUS', 'Austin', 'Outlaws', '#BF5700', '#1B1B1B'],
  ['BKN', 'Brooklyn', 'Kings', '#1F2937', '#F59E0B'],
  ['OKC', 'Oklahoma City', 'Twisters', '#0E7490', '#F97316'],
  ['ORL', 'Orlando', 'Comets', '#5B21B6', '#22D3EE'],
  ['PDX', 'Portland', 'Lumberjacks', '#14532D', '#FACC15'],
  ['SAT', 'San Antonio', 'Marshals', '#7F1D1D', '#E5E7EB'],
  ['SAC', 'Sacramento', 'Gold Rush', '#A16207', '#1C1917'],
  ['SDT', 'San Diego', 'Tritons', '#0369A1', '#FDE047'],
  ['SLC', 'Salt Lake', 'Summit', '#1D4ED8', '#F1F5F9'],
  ['STL', 'St. Louis', 'Ironmen', '#374151', '#DC2626'],
  ['TOR', 'Toronto', 'Northmen', '#B91C1C', '#F8FAFC'],
  ['MEM', 'Memphis', 'Blues', '#1E3A8A', '#93C5FD'],
  ['OMA', 'Omaha', 'Stampede', '#78350F', '#FBBF24'],
  ['VAB', 'Virginia', 'Admirals', '#0F172A', '#38BDF8'],
  ['BHM', 'Birmingham', 'Ironclads', '#9A3412', '#FED7AA'],
  ['LOU', 'Louisville', 'Colonels', '#9F1239', '#F1F5F9'],
  ['ABQ', 'Albuquerque', 'Roadrunners', '#EA580C', '#134E4A'],
  ['RAL', 'Raleigh', 'Oaks', '#166534', '#F5F5F4'],
  ['COL', 'Columbus', 'Foundry', '#111827', '#EAB308'],
  ['HON', 'Honolulu', 'Waves', '#0284C7', '#ECFEFF'],
];

export const FIRST = ['Marcus', 'Tyler', 'Jalen', 'Devin', 'Chris', 'Brandon', 'Josh', 'Trey', 'Andre', 'Cole', 'Darius', 'Kyle',
  'Isaiah', 'Malik', 'Jordan', 'Nate', 'Caleb', 'Zach', 'Elijah', 'Terrell', 'Bryce', 'Logan', 'Jamal', 'Miles', 'Derek',
  'Quinn', 'Rashad', 'Owen', 'Xavier', 'Garrett', 'Tre', 'Dante', 'Luke', 'Cam', 'Myles', 'Grant', 'Hunter', 'Keon',
  'Reggie', 'Shane', 'Tavon', 'Wyatt', 'Amari', 'Bo', 'Jace', 'Rico', 'Sam', 'Theo'];
export const LAST = ['Walker', 'Hayes', 'Brooks', 'Coleman', 'Reed', 'Simmons', 'Price', 'Fuller', 'Bishop', 'Hargrove', 'Mercer',
  'Dawson', 'Pryor', 'Lockett', 'Vance', 'Holloway', 'Kemp', 'Barrett', 'Sutton', 'Odom', 'Ridley', 'Crane', 'Fowler',
  'Maddox', 'Kincaid', 'Rowe', 'Tate', 'Whitfield', 'Benson', 'Calloway', 'Dixon', 'Easley', 'Gaines', 'Hollins',
  'Ingram', 'Jeter', 'Knox', 'Lyle', 'Monroe', 'Nash', 'Osborne', 'Pruitt', 'Quarles', 'Rucker', 'Stokes', 'Toliver',
  'Upshaw', 'Varner', 'Wade', 'Yarbrough', 'Abbott', 'Boone', 'Cobb', 'Drake', 'Ellis', 'Flowers', 'Greer', 'Hurst'];

export const OFF_POS = ['QB', 'RB', 'WR1', 'WR2', 'WR3', 'TE', 'LT', 'LG', 'C', 'RG', 'RT'] as const;
export const DEF_POS = ['EDGE1', 'DL1', 'DL2', 'EDGE2', 'LB1', 'LB2', 'LB3', 'CB1', 'CB2', 'S1', 'S2'] as const;
export const SPEC_POS = ['K', 'P'] as const;
export const RECEIVERS: Rcv[] = ['WR1', 'WR2', 'WR3', 'TE', 'RB'];
export const POS_LABEL: Record<string, string> = {
  QB: 'QB', RB: 'RB', WR1: 'WR', WR2: 'WR', WR3: 'WR', TE: 'TE', LT: 'T', LG: 'G', C: 'C', RG: 'G', RT: 'T',
  EDGE1: 'DE', DL1: 'DT', DL2: 'DT', EDGE2: 'DE', LB1: 'LB', LB2: 'LB', LB3: 'LB', CB1: 'CB', CB2: 'CB', S1: 'S', S2: 'S', K: 'K', P: 'P',
};
export const POS_NAME: Record<string, string> = {
  QB: 'Quarterback', RB: 'Running back', WR1: 'Wide receiver (left)', WR2: 'Wide receiver (right)', WR3: 'Slot receiver', TE: 'Tight end',
  LT: 'Left tackle', LG: 'Left guard', C: 'Center', RG: 'Right guard', RT: 'Right tackle', EDGE1: 'Edge rusher', EDGE2: 'Edge rusher',
  DL1: 'Defensive tackle', DL2: 'Defensive tackle', LB1: 'Linebacker', LB2: 'Linebacker', LB3: 'Linebacker', CB1: 'Cornerback',
  CB2: 'Cornerback', S1: 'Safety', S2: 'Safety', K: 'Kicker', P: 'Punter',
};

export interface Route {
  name: string;
  depth: number;  // typical catch depth past the line
  comp: number;   // base catch rate
  yac: number;    // mean yards after the catch
  int: number;    // interception rate
  oob: number;    // chance a catch ends out of bounds
  /** route shape: points as [yards toward the middle, yards downfield], last point is the catch point */
  path: (d: number) => [number, number][];
}

export const ROUTES: Record<RouteId, Route> = {
  screen: { name: 'Screen', depth: -2, comp: 0.84, yac: 6.5, int: 0.008, oob: 0.14, path: (d) => [[-2, -1], [-3, d]] },
  flat: { name: 'Flat', depth: 1, comp: 0.8, yac: 4.5, int: 0.012, oob: 0.38, path: (d) => [[-3, 0.5], [-7, d]] },
  angle: { name: 'Angle', depth: 4, comp: 0.71, yac: 3.5, int: 0.02, oob: 0.06, path: (d) => [[-3, 1], [3, d]] },
  hitch: { name: 'Hitch', depth: 6, comp: 0.73, yac: 2, int: 0.016, oob: 0.08, path: (d) => [[0, d + 1.5], [0, d]] },
  slant: { name: 'Slant', depth: 6, comp: 0.7, yac: 3, int: 0.024, oob: 0.04, path: (d) => [[0, 1.5], [6, d]] },
  out: { name: 'Quick out', depth: 5, comp: 0.7, yac: 1.5, int: 0.022, oob: 0.78, path: (d) => [[0, d], [-6, d]] },
  cross: { name: 'Crosser', depth: 6, comp: 0.68, yac: 3.5, int: 0.02, oob: 0.12, path: (d) => [[0, 2.5], [16, d]] },
  dig: { name: 'Dig', depth: 12, comp: 0.58, yac: 2.5, int: 0.03, oob: 0.04, path: (d) => [[0, d], [10, d]] },
  comeback: { name: 'Comeback', depth: 13, comp: 0.57, yac: 1.5, int: 0.03, oob: 0.66, path: (d) => [[0, d + 3], [-3, d]] },
  seam: { name: 'Seam', depth: 16, comp: 0.5, yac: 4, int: 0.038, oob: 0.04, path: (d) => [[0, d]] },
  post: { name: 'Post', depth: 18, comp: 0.43, yac: 5, int: 0.045, oob: 0.05, path: (d) => [[0, 10], [8, d]] },
  corner: { name: 'Corner', depth: 18, comp: 0.44, yac: 2.5, int: 0.035, oob: 0.52, path: (d) => [[0, 10], [-8, d]] },
  go: { name: 'Go', depth: 25, comp: 0.34, yac: 5, int: 0.045, oob: 0.35, path: (d) => [[-1, d]] },
  wheel: { name: 'Wheel', depth: 16, comp: 0.43, yac: 5, int: 0.03, oob: 0.42, path: (d) => [[-5, 1], [-7, 5], [-7, d]] },
  hail: { name: 'End zone', depth: 50, comp: 0.1, yac: 1, int: 0.13, oob: 0, path: (d) => [[0, d * 0.6], [99, d]] },
};

export const POS_ROUTES: Record<Rcv, RouteId[]> = {
  WR1: ['slant', 'hitch', 'out', 'cross', 'dig', 'comeback', 'post', 'corner', 'go', 'screen'],
  WR2: ['slant', 'hitch', 'out', 'cross', 'dig', 'comeback', 'post', 'corner', 'go', 'screen'],
  WR3: ['slant', 'hitch', 'out', 'cross', 'dig', 'seam', 'post', 'corner', 'screen'],
  TE: ['flat', 'hitch', 'out', 'cross', 'dig', 'seam', 'corner'],
  RB: ['flat', 'angle', 'screen', 'wheel'],
};

export type DropId = 'quick' | 'screen' | 'std' | 'deep' | 'pa' | 'roll' | 'hail' | 'flea' | 'trick';
/** Pass protection: sack rate and seconds until the throw. */
export const DROPS: Record<DropId, { sack: number; release: number }> = {
  quick: { sack: 0.025, release: 1.9 }, screen: { sack: 0.012, release: 1.6 }, std: { sack: 0.055, release: 2.6 },
  deep: { sack: 0.085, release: 3.0 }, pa: { sack: 0.075, release: 3.1 }, roll: { sack: 0.04, release: 2.8 },
  hail: { sack: 0.09, release: 3.8 }, flea: { sack: 0.1, release: 3.6 }, trick: { sack: 0.06, release: 3.2 },
};

export type Fam = 'run' | 'pass' | 'rpo' | 'trick';
export interface Call {
  id: string;
  fam: Fam;
  name: string;
  sub: string;
  kind: 'run' | 'pass' | 'rpo';
  // run
  ypc?: number; sd?: number; big?: number; stuff?: number; oob?: number; lane?: 'in' | 'out';
  short?: boolean; draw?: boolean; option?: boolean; qb?: boolean; carrier?: string;
  // pass
  drop?: DropId; tgt?: Rcv; routes?: Record<Rcv, RouteId>; pa?: boolean; adj?: number;
  // rpo: the run it hands off to, and the throw it pulls to when the box is loaded or a blitz comes
  run?: string;
  trick?: boolean;
  risk: 1 | 2 | 3;        // shown as a risk meter on the card
}

export const CALLS: Call[] = [
  { id: 'inside_zone', fam: 'run', name: 'Inside zone', sub: 'Downhill between the tackles', kind: 'run', ypc: 4.1, sd: 3.3, big: 0.045, stuff: 0.17, oob: 0.03, lane: 'in', risk: 1 },
  { id: 'power', fam: 'run', name: 'Power', sub: 'Pull the guard, hit the hole', kind: 'run', ypc: 4.2, sd: 3.6, big: 0.05, stuff: 0.16, oob: 0.03, lane: 'in', short: true, risk: 1 },
  { id: 'outside_zone', fam: 'run', name: 'Outside zone', sub: 'Stretch it to the edge', kind: 'run', ypc: 4.4, sd: 4.6, big: 0.07, stuff: 0.21, oob: 0.22, lane: 'out', risk: 2 },
  { id: 'counter', fam: 'run', name: 'Counter', sub: 'Step one way, cut back', kind: 'run', ypc: 4.6, sd: 5.0, big: 0.08, stuff: 0.21, oob: 0.06, lane: 'in', risk: 2 },
  { id: 'draw', fam: 'run', name: 'Draw', sub: 'Look like a pass, then hand it off', kind: 'run', ypc: 4.2, sd: 4.8, big: 0.07, stuff: 0.16, oob: 0.04, lane: 'in', draw: true, risk: 1 },
  { id: 'toss', fam: 'run', name: 'Toss sweep', sub: 'Pitch it wide, race the sideline', kind: 'run', ypc: 4.5, sd: 5.6, big: 0.09, stuff: 0.24, oob: 0.34, lane: 'out', risk: 2 },
  { id: 'sneak', fam: 'run', name: 'QB sneak', sub: 'Push the pile for a yard or two', kind: 'run', ypc: 1.7, sd: 1.3, big: 0, stuff: 0.12, oob: 0, lane: 'in', short: true, qb: true, carrier: 'QB', risk: 1 },

  { id: 'quick_out', fam: 'pass', name: 'Quick outs', sub: 'Fast throw, get out of bounds', kind: 'pass', drop: 'quick', tgt: 'WR2', routes: { WR1: 'out', WR2: 'out', WR3: 'hitch', TE: 'flat', RB: 'angle' }, risk: 1 },
  { id: 'slants', fam: 'pass', name: 'Slants', sub: 'Over the middle in a hurry', kind: 'pass', drop: 'quick', tgt: 'WR1', routes: { WR1: 'slant', WR2: 'slant', WR3: 'hitch', TE: 'cross', RB: 'flat' }, risk: 1 },
  { id: 'screen', fam: 'pass', name: 'Screen pass', sub: 'Let the rush come, dump it to the running back', kind: 'pass', drop: 'screen', tgt: 'RB', routes: { WR1: 'go', WR2: 'hitch', WR3: 'slant', TE: 'flat', RB: 'screen' }, risk: 1 },
  { id: 'mesh', fam: 'pass', name: 'Mesh', sub: 'Two receivers cross underneath to shake coverage', kind: 'pass', drop: 'std', tgt: 'WR3', routes: { WR1: 'go', WR2: 'dig', WR3: 'cross', TE: 'cross', RB: 'flat' }, risk: 1 },
  { id: 'dig', fam: 'pass', name: 'Dig', sub: '12 yards out, then cut across the middle', kind: 'pass', drop: 'std', tgt: 'WR1', routes: { WR1: 'dig', WR2: 'go', WR3: 'hitch', TE: 'seam', RB: 'flat' }, risk: 2 },
  { id: 'comeback', fam: 'pass', name: 'Comeback', sub: 'Chunk yards on the sideline', kind: 'pass', drop: 'std', tgt: 'WR2', routes: { WR1: 'comeback', WR2: 'comeback', WR3: 'slant', TE: 'flat', RB: 'angle' }, risk: 2 },
  { id: 'seam', fam: 'pass', name: 'Tight end seam', sub: 'Tight end straight up the middle, between the safeties', kind: 'pass', drop: 'std', tgt: 'TE', routes: { WR1: 'go', WR2: 'out', WR3: 'hitch', TE: 'seam', RB: 'flat' }, risk: 2 },
  { id: 'deep_post', fam: 'pass', name: 'Deep post', sub: 'A shot down the middle', kind: 'pass', drop: 'deep', tgt: 'WR1', routes: { WR1: 'post', WR2: 'dig', WR3: 'seam', TE: 'hitch', RB: 'flat' }, risk: 3 },
  { id: 'deep_corner', fam: 'pass', name: 'Corner', sub: 'Deep and out toward the sideline pylon', kind: 'pass', drop: 'deep', tgt: 'WR2', routes: { WR1: 'go', WR2: 'corner', WR3: 'post', TE: 'out', RB: 'flat' }, risk: 3 },
  { id: 'go', fam: 'pass', name: 'Go route', sub: 'Launch it down the sideline', kind: 'pass', drop: 'deep', tgt: 'WR1', routes: { WR1: 'go', WR2: 'go', WR3: 'seam', TE: 'out', RB: 'flat' }, risk: 3 },
  { id: 'pa_deep', fam: 'pass', name: 'Play-action shot', sub: 'Fake the handoff, then throw deep', kind: 'pass', drop: 'pa', tgt: 'WR1', pa: true, routes: { WR1: 'post', WR2: 'go', WR3: 'dig', TE: 'flat', RB: 'flat' }, risk: 3 },
  { id: 'boot', fam: 'pass', name: 'Bootleg', sub: 'Fake it, roll out, throw on the move', kind: 'pass', drop: 'roll', tgt: 'TE', pa: true, routes: { WR1: 'cross', WR2: 'corner', WR3: 'out', TE: 'flat', RB: 'flat' }, risk: 2 },
  { id: 'hail', fam: 'pass', name: 'Hail Mary', sub: 'Everyone to the end zone', kind: 'pass', drop: 'hail', tgt: 'WR1', routes: { WR1: 'hail', WR2: 'hail', WR3: 'hail', TE: 'hail', RB: 'flat' }, risk: 3 },

  { id: 'rpo_bubble', fam: 'rpo', name: 'Bubble read', sub: 'Hand off, unless the box is stacked: then a quick screen', kind: 'rpo', run: 'inside_zone', tgt: 'WR3', routes: { WR1: 'hitch', WR2: 'hitch', WR3: 'screen', TE: 'flat', RB: 'flat' }, risk: 1 },
  { id: 'rpo_slant', fam: 'rpo', name: 'Slant read', sub: 'Hand off, unless linebackers crowd in: then the slant', kind: 'rpo', run: 'inside_zone', tgt: 'WR1', routes: { WR1: 'slant', WR2: 'hitch', WR3: 'slant', TE: 'flat', RB: 'flat' }, risk: 1 },
  { id: 'read_option', fam: 'rpo', name: 'Read option', sub: 'Quarterback reads the end: hand off or keep it', kind: 'run', ypc: 4.8, sd: 5.0, big: 0.09, stuff: 0.17, oob: 0.12, lane: 'out', option: true, risk: 2 },

  { id: 'flea', fam: 'trick', name: 'Flea-flicker', sub: 'Hand off, pitch it back, go deep', kind: 'pass', drop: 'flea', tgt: 'WR1', trick: true, routes: { WR1: 'post', WR2: 'go', WR3: 'seam', TE: 'hitch', RB: 'flat' }, risk: 3 },
  { id: 'reverse', fam: 'trick', name: 'End-around', sub: 'A receiver loops back the other way with the ball', kind: 'run', ypc: 3.6, sd: 9, big: 0.14, stuff: 0.3, oob: 0.36, lane: 'out', trick: true, carrier: 'WR2', risk: 3 },
  { id: 'wr_pass', fam: 'trick', name: 'Receiver pass', sub: 'Toss it to a receiver, who throws deep', kind: 'pass', drop: 'trick', tgt: 'TE', trick: true, adj: -0.04, routes: { WR1: 'go', WR2: 'screen', WR3: 'post', TE: 'seam', RB: 'flat' }, risk: 3 },
  { id: 'direct', fam: 'trick', name: 'Direct snap', sub: 'Snap it straight to the running back', kind: 'run', ypc: 4.3, sd: 4.6, big: 0.08, stuff: 0.17, oob: 0.08, lane: 'in', trick: true, risk: 2 },
];

export const CALL: Record<string, Call> = Object.fromEntries(CALLS.map((c) => [c.id, c]));
export const FAMS: Record<Fam, string> = { run: 'Run', pass: 'Pass', rpo: 'RPO', trick: 'Trick' };

/** Defensive calls as the player sees them: what each is for, what it stops, and what it gives up. */
export const LOOKS: Record<Look, { label: string; sub: string; stops: string; risk: string; tilt: 1 | 2 | 3 }> = {
  // zone
  balanced: { label: 'Cover 3', sub: 'Base defense: three deep, four underneath', stops: 'Nothing gets a free pass', risk: 'Nothing is taken away either', tilt: 1 },
  zone: { label: 'Cover 2', sub: 'Two deep safeties; rally and read the quarterback', stops: 'Yards after the catch; more interceptions', risk: 'Digs and seams sitting in the holes', tilt: 1 },
  cover4: { label: 'Cover 4 Quarters', sub: 'Four deep, each with a quarter of the field', stops: 'Deep shots: posts, seams and go routes', risk: 'Flats, outs, hitches and slants underneath', tilt: 1 },
  tampa2: { label: 'Tampa 2', sub: 'Cover 2 with the middle linebacker running deep', stops: 'Seams and digs over the middle', risk: 'Corners and outs on the sideline; runs', tilt: 2 },
  prevent: { label: 'Prevent', sub: 'Everyone deep; keep it in front', stops: 'Deep shots and long touchdowns', risk: 'Short completions, runs and the clock', tilt: 2 },
  // man
  man: { label: 'Cover 1 Man', sub: 'A defender on every receiver, one safety deep', stops: 'Easy throws underneath to hitches and digs', risk: 'Crossers, slants and wheels that get separation', tilt: 2 },
  twoman: { label: '2-Man Under', sub: 'Man underneath, two safeties over the top', stops: 'Deep throws and contested catches underneath', risk: 'Runs and draws: only six in the box', tilt: 2 },
  press: { label: 'Press Man', sub: 'Jam the receivers at the line', stops: 'Quick throws: slants, hitches, timing routes', risk: 'The go route and anything over the top', tilt: 2 },
  robber: { label: 'Cover 1 Robber', sub: 'Man coverage with a safety lurking in the middle', stops: 'Crossers, slants and digs over the middle', risk: 'Deep outside throws: corners and go routes', tilt: 2 },
  // blitz
  blitz: { label: 'Cover 0 Blitz', sub: 'Send six or seven; nobody deep', stops: 'Sacks on deep drops and slow-developing throws', risk: 'Quick throws, screens and draws find open grass', tilt: 3 },
  firezone: { label: 'Fire Zone', sub: 'Five rush, a lineman drops into coverage', stops: 'Hot routes and screens into the blitz', risk: 'Fewer sacks than an all-out blitz; seams between zones', tilt: 2 },
  mike: { label: 'Mike Blitz', sub: 'The middle linebacker shoots the A-gap', stops: 'Inside runs and long drops', risk: 'Crossers and digs where he left', tilt: 3 },
  cblitz: { label: 'Corner Blitz', sub: 'A corner comes off the edge', stops: 'Screens and runs to his side', risk: 'Outs, hitches and fades to the receiver he left', tilt: 3 },
  sblitz: { label: 'Safety Blitz', sub: 'A safety comes downhill at the snap', stops: 'Runs and play-action', risk: 'Seams and posts with no one in the middle', tilt: 3 },
  // goal line and run stop
  goal: { label: 'Goal Line 6-5', sub: 'Heavy front for the last few yards', stops: 'Runs at the goal line and on short yardage', risk: 'Away from the goal line, anything that gets past it goes far', tilt: 3 },
  glblitz: { label: 'Goal Line Blitz', sub: 'Everyone shoots a gap at the snap', stops: 'Runs, sneaks and slow throws', risk: 'Quick throws, screens and play-action', tilt: 3 },
  glman: { label: 'Goal Line Man', sub: 'Heavy front, every receiver covered', stops: 'Play-action and fades', risk: 'Rubs, crossers and slants; a gap in the run fit', tilt: 2 },
  load: { label: 'Bear 46', sub: 'Eight in the box to stop the run', stops: 'Runs, especially between the tackles', risk: 'Play-action and passes over the top', tilt: 2 },
  runblitz: { label: 'Run Blitz', sub: 'The box shoots its gaps at the snap', stops: 'Runs at the line, before they start', risk: 'Screens and play-action behind it; a missed gap goes far', tilt: 3 },
  soft: { label: 'Prevent', sub: 'Everyone deep; keep it in front', stops: 'Deep shots and long touchdowns', risk: 'Short completions, runs and the clock', tilt: 2 },
};
/** When each defensive call is at its best, in a few words for the play card. */
export const LOOK_USE: Record<Look, string> = {
  balanced: 'No clear read on them: a safe call on any down',
  zone: 'They need yards but you can rally and tackle',
  cover4: 'They need a big play down the field',
  tampa2: 'They keep attacking the middle',
  prevent: 'Seconds left and you lead: no touchdown over the top',
  man: 'They live on short, easy throws',
  twoman: 'An obvious passing down',
  press: 'They want quick throws to stop the clock',
  robber: 'They keep crossing the middle',
  blitz: 'They need a long drop to get the yards',
  firezone: 'They lean on hot routes and screens',
  mike: 'An inside run or a long drop is coming',
  cblitz: 'They run or screen toward one side',
  sblitz: 'A run or play-action is coming',
  goal: 'The last few yards, or a yard or two to go',
  glblitz: 'A short-yardage run or a sneak',
  glman: 'At the goal line against play-action and fades',
  load: 'They are running to burn the clock',
  runblitz: 'A run is coming and you want a loss',
  soft: 'Seconds left and you lead: no touchdown over the top',
};

export const LOOK_READ: Record<Look, string> = {
  balanced: 'Base front, two deep safeties: nothing given away',
  blitz: 'Linebackers creeping up: blitz showing',
  load: 'Eight in the box: they expect a run',
  zone: 'Corners bailing at the snap count: zone',
  man: 'Corners pressed on the receivers: man coverage',
  prevent: 'Safeties deep, corners off: soft shell',
  goal: 'Heavy goal-line front',
  soft: 'Safeties deep, corners off: soft shell',
  cover4: 'Four deep, corners off: quarters',
  tampa2: 'Two deep, middle linebacker bailing: Tampa 2',
  twoman: 'Corners pressed, two safeties deep',
  press: 'Corners in the receivers\' faces: press man',
  robber: 'Man looks, a safety sitting in the middle',
  firezone: 'Linebackers creeping up: pressure showing',
  mike: 'Middle linebacker in the A-gap: blitz showing',
  cblitz: 'A corner cheating toward the line',
  sblitz: 'A safety rolled down near the box',
  glblitz: 'Heavy goal-line front, everyone on the line',
  glman: 'Heavy goal-line front, corners pressed',
  runblitz: 'Eight in the box, linebackers on the line',
};

export const TEMPO = {
  nohuddle: { label: 'No-huddle', sub: 'Snap fast: about 13 seconds', secs: 13, sd: 2.5 },
  huddle: { label: 'Huddle', sub: 'Normal pace: about 27 seconds', secs: 27, sd: 3 },
  milk: { label: 'Milk the clock', sub: 'Snap as the play clock expires', secs: 38, sd: 1 },
} as const;

export const ARCHETYPES = {
  gunslinger: { name: 'The Gunslinger', blurb: 'You live for the deep ball. Every snap is a chance to flip the game in one throw.' },
  surgeon: { name: 'The Clock Surgeon', blurb: 'Tempo, timeouts and the sideline: you treat every second as a resource.' },
  grinder: { name: 'The Ground Pounder', blurb: 'Hand it off, move the chains, bleed the clock. Football the old way.' },
  gambler: { name: 'The Riverboat Gambler', blurb: 'Fourth downs, two-pointers, trick plays. Fortune favors you, sometimes.' },
  professor: { name: 'The West Coast Professor', blurb: 'Short, high-percentage throws that march the field like a metronome.' },
  pressure: { name: 'The Pressure Merchant', blurb: 'On defense you bring heat and dare them to beat the blitz.' },
  bend: { name: "The Bend-Don't-Break DC", blurb: 'Keep it in front, rally, tackle. Make them earn every yard.' },
} as const;
export type ArchetypeId = keyof typeof ARCHETYPES;
