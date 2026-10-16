/**
 * Kick scenes: field goals and extra points (the kicking unit, the snap, the hold, the kick, the rush and the block),
 * two-point tries (a goal-line snap), and kickoffs (coverage lanes, the catch, the return, touchbacks and onside
 * scrambles). Like the rest of the timeline they draw a result the engine has already decided.
 *
 * Frames: a field goal is in the offense's frame with the ball at the line. A kickoff is in the KICKING team's
 * frame with the ball at its own 35 (20 after a safety): the receiving team's goal line is dy = 65 (80).
 */
import { CX, W, formation, type Pt } from './formation';
import { clip, hash, rng } from './rng';
import { choreograph, profile, timeTo, travel, type BallKey, type Key, type TEvent, type Timeline } from './timeline';
import type { Ev, PlayResult, Ratings } from './types';

const DT = 0.05;
const OFF = ['QB', 'RB', 'WR1', 'WR2', 'WR3', 'TE', 'LT', 'LG', 'C', 'RG', 'RT'];
const DEF = ['EDGE1', 'DL1', 'DL2', 'EDGE2', 'LB1', 'LB2', 'LB3', 'CB1', 'CB2', 'S1', 'S2'];
const lerpP = (a: Pt, b: Pt, f: number): Pt => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Sample a position function into keyframes. */
function track(f: (t: number) => Pt, end: number): Key[] {
  const out: Key[] = [];
  for (let t = 0; t <= end + 1e-9; t = Math.round((t + DT) * 1000) / 1000) { const p = f(t); out.push([t, p[0], p[1]]); }
  return out;
}
/** Hold still, then move between waypoints on a schedule (eased start and stop). */
function path(pts: [number, Pt][]): (t: number) => Pt {
  return (t) => {
    if (t <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) if (t <= pts[i][0]) {
      const f = (t - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0] || 1);
      const g = f < 0.5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2;
      return lerpP(pts[i - 1][1], pts[i][1], g);
    }
    return pts[pts.length - 1][1];
  };
}
function arc(ball: BallKey[], from: Pt, to: Pt, t0: number, t1: number, peak: number) {
  for (let t = t0; t <= t1 + 1e-9; t = Math.round((t + DT) * 1000) / 1000) {
    const f = (t - t0) / (t1 - t0);
    const p = lerpP(from, to, f);
    ball.push({ t, x: p[0], dy: p[1], h: Math.sin(f * Math.PI) * peak });
  }
}
function hold(ball: BallKey[], at: Pt, t0: number, t1: number) {
  for (let t = t0; t <= t1 + 1e-9; t = Math.round((t + DT) * 1000) / 1000) ball.push({ t, x: at[0], dy: at[1], h: 0 });
}

/** A field goal or extra point. yt: yards to the goal line from the line of scrimmage. */
export function fieldGoalTimeline(o: { good: boolean; blocked: boolean; yt: number; off: Ratings; def: Ratings; seed: number; xp?: boolean }): Timeline {
  const r = rng(o.seed);
  const yt = o.yt;
  const tracks: Record<string, Key[]> = {};
  const events: TEvent[] = [{ t: 0, kind: 'snap' }];
  const ball: BallKey[] = [];
  const holder: Pt = [CX + 0.4, -7];
  const kicker0: Pt = [CX + 2.8, -9.2];
  const snapT = 0.6, kickT = 1.3;
  const flightT = o.blocked ? 0 : clip(1.3 + (yt + 10) * 0.045, 1.6, 3.6);
  const T = o.blocked ? 2.6 : kickT + flightT + 0.3;

  // the kicking unit: seven on the line, two wings, the holder and the kicker
  const line: Record<string, Pt> = { LT: [CX - 4.2, -1.2], LG: [CX - 2.1, -1.2], C: [CX, -1.1], RG: [CX + 2.1, -1.2], RT: [CX + 4.2, -1.2], TE: [CX + 6.3, -1.3], WR3: [CX - 6.3, -1.3], WR1: [CX - 8.6, -1.9], WR2: [CX + 8.6, -1.9] };
  for (const k in line) tracks['o:' + k] = track(path([[0, line[k]], [0.35, [line[k][0], line[k][1] + 0.5]], [T, [line[k][0], line[k][1] + 0.5]]]), T);
  tracks['o:QB'] = track(path([[0, [holder[0], holder[1] - 0.2]], [snapT, holder], [T, holder]]), T);
  tracks['o:RB'] = track(path([[0, kicker0], [snapT + 0.1, kicker0], [kickT, [CX - 0.2, -7.2]], [kickT + 0.4, [CX - 1.2, -6.4]], [T, [CX - 1.2, -6.4]]]), T);

  // the block attempt: interior pushes, the edges loop, one man gets through on a block
  const front: Record<string, Pt> = { DL1: [CX - 1.3, 1.2], DL2: [CX + 1.3, 1.2], EDGE1: [CX - 3.6, 1.2], EDGE2: [CX + 3.6, 1.2], LB1: [CX - 6.4, 1.3], LB3: [CX + 6.4, 1.3], LB2: [CX - 2.4, 1.6] };
  for (const k in front) tracks['d:' + k] = track(path([[0, front[k]], [0.6, [front[k][0], 0.3]], [kickT, [front[k][0], -0.4]], [T, [front[k][0], -0.4]]]), T);
  for (const [k, side] of [['CB1', -1], ['CB2', 1]] as const) {
    const s0: Pt = [CX + side * 10.5, 1.6];
    tracks['d:' + k] = track(path([[0, s0], [0.9, [CX + side * 9.5, -2.5]], [kickT + 0.3, [CX + side * 6, -6]], [T, [CX + side * 5, -6.5]]]), T);
  }
  for (const [k, x] of [['S1', CX - 3], ['S2', CX + 3]] as const) tracks['d:' + k] = track(path([[0, [x, 4.5]], [T, [x, 4]]]), T);
  if (o.blocked) {
    // the edge rusher beats the wing and gets a hand on it
    const bk = r() < 0.5 ? 'EDGE1' : 'EDGE2', side = bk === 'EDGE1' ? -1 : 1;
    tracks['d:' + bk] = track(path([[0, front[bk]], [0.5, [CX + side * 4.6, -1]], [kickT, [CX + side * 1.6, -5.4]], [kickT + 0.25, [CX + side * 0.6, -6.2]], [T, [CX + side * 0.6, -6.2]]]), T);
  }

  // the ball: snap to the holder, the kick, then through the uprights, wide, or off a hand
  hold(ball, [CX, 0], 0, 0.02);
  arc(ball, [CX, 0], holder, 0.02, snapT, 0.8);
  hold(ball, holder, snapT, kickT);
  events.push({ t: kickT, kind: 'kick', who: 'o:RB', at: holder });
  if (o.blocked) {
    arc(ball, holder, [CX + (r() < 0.5 ? -1 : 1) * 1.2, -5.4], kickT, kickT + 0.18, 1.2);
    arc(ball, [CX + 1.2, -5.4], [CX + (r() - 0.5) * 8, -3 - r() * 4], kickT + 0.18, T, 2.5);
    events.push({ t: kickT + 0.18, kind: 'blocked', at: [CX, -5.4] });
  } else {
    const wide = o.good ? (r() - 0.5) * 2.2 : (r() < 0.5 ? -1 : 1) * (3.6 + r() * 2);
    const to: Pt = [CX + wide, yt + 10.5];
    arc(ball, holder, to, kickT, kickT + flightT, clip(7 + (yt + 10) * 0.12, 8, 16));
    hold(ball, to, kickT + flightT, T);
    events.push({ t: kickT + flightT, kind: o.good ? 'good' : 'nogood', at: [CX + wide, yt + 9] });
  }
  for (const k of OFF) if (!tracks['o:' + k]) tracks['o:' + k] = track(() => [CX, -12], T);
  for (const k of DEF) if (!tracks['d:' + k]) tracks['d:' + k] = track(() => [CX, 8], T);
  const decisive = o.blocked ? kickT + 0.18 : kickT + flightT;
  return { tracks, ball, events, carrier: [{ t: 0, key: 'o:C' }, { t: snapT, key: 'o:QB' }], end: T, decisive };
}

/** The try after a touchdown: a kick from the 15, or a two-point snap from the 2. */
export function patTimeline(ev: Extract<Ev, { type: 'pat' }>, off: Ratings, def: Ratings, seed: number): { tl: Timeline; res: PlayResult; yl0: number } {
  if (!ev.two) {
    const tl = fieldGoalTimeline({ good: ev.good, blocked: false, yt: 15, off, def, seed, xp: true });
    const res: PlayResult = { kind: 'fg', call: 'xp', look: null, carrier: 'RB', yards: 0, oob: false, td: false, safety: false, turnover: false, dur: 0, side: 1, good: ev.good, air: 33 };
    return { tl, res, yl0: 85 };
  }
  // two points: a power run that gets in, or a slant that falls incomplete
  const r = rng(seed);
  const res: PlayResult = ev.good
    ? { kind: 'run', call: 'power', look: 'goal', carrier: 'RB', yards: 2, oob: false, td: true, safety: false, turnover: false, dur: 4, side: r() < 0.5 ? -1 : 1, lane: 'in' }
    : { kind: 'pass', call: 'slants', look: 'man', carrier: 'QB', target: 'WR1', route: 'slant', yards: 0, air: 3, complete: false, oob: false, td: false, safety: false, turnover: false, dur: 3, side: -1 };
  const tl = choreograph({ res, yl0: 98, off, def, seed });
  // the story is the conversion, not the tackle
  tl.events = tl.events.filter((e) => !['td', 'incomplete', 'tackle'].includes(e.kind));
  tl.events.push({ t: tl.decisive, kind: ev.good ? 'good' : 'nogood', at: [CX, ev.good ? 2.5 : 1] });
  return { tl, res, yl0: 98 };
}

/** A kickoff, free kick or onside kick, in the kicking team's frame. */
export function kickoffTimeline(ev: Extract<Ev, { type: 'kick' }>, kick: Ratings, recv: Ratings, seed: number): { tl: Timeline; res: PlayResult; yl0: number } {
  const r = rng(hash(seed, 'ko'));
  const yl0 = ev.kind === 'free' ? 20 : 35;
  const G = 100 - yl0;                       // the receiving goal line, in dy
  const tracks: Record<string, Key[]> = {};
  const events: TEvent[] = [{ t: 0, kind: 'snap' }];
  const ball: BallKey[] = [];
  const carrier: Timeline['carrier'] = [{ t: 0, key: 'o:QB' }];
  const onside = ev.kind === 'onside';
  const kickT = 0.9;
  const lanes = ['LT', 'LG', 'C', 'RG', 'RT', 'WR1', 'WR2', 'WR3', 'TE', 'RB'];
  const laneX = (i: number) => 4 + (i * (W - 8)) / 9;
  const recvPos: Record<string, Pt> = {
    EDGE1: [8, 35], DL1: [19, 35], DL2: [CX, 35], EDGE2: [W - 19, 35], LB1: [W - 8, 35],
    LB2: [12, 48], LB3: [W - 12, 48], CB1: [CX - 6, 50], CB2: [CX + 6, 50], S2: [CX - 8, 58], S1: [CX, G - 2],
  };
  // the kick
  hold(ball, [CX, 0], 0, kickT);
  let T: number, decisive: number;
  if (onside) {
    const land: Pt = [CX + (r() < 0.5 ? -1 : 1) * (8 + r() * 6), 10.5];
    arc(ball, [CX, 0], land, kickT, kickT + 0.7, 1.2);
    arc(ball, land, [land[0] + 1, land[1] + 1.5], kickT + 0.7, kickT + 1.1, 0.6);
    const recT = kickT + 2.0;
    const spot: Pt = [land[0] + 1, land[1] + 1.5];
    hold(ball, spot, kickT + 1.1, recT + 0.3);
    T = recT + 0.6; decisive = recT;
    const who = ev.recover === ev.kicker ? 'o:' + lanes[Math.floor(lanes.length / 2)] : 'd:EDGE2';
    // everyone near the ball dives for it; the recovering player ends on it
    lanes.forEach((k, i) => { const x = laneX(i); tracks['o:' + k] = track(path([[0, [x, -1]], [kickT, [x, -0.5]], [recT, [lerpP([x, -0.5], spot, 0.75)[0], lerpP([x, -0.5], spot, 0.75)[1]]], [T, lerpP([x, -0.5], spot, 0.78)]]), T); });
    for (const k in recvPos) { const p0: Pt = k === 'S1' ? [CX, G - 2] : [recvPos[k][0], Math.min(recvPos[k][1], 22)]; tracks['d:' + k] = track(path([[0, p0], [kickT + 0.3, p0], [recT, lerpP(p0, spot, 0.8)], [T, lerpP(p0, spot, 0.82)]]), T); }
    tracks[who] = track(path([[0, who.startsWith('o:') ? [laneX(5), -1] : recvPos.EDGE2], [kickT + 0.3, who.startsWith('o:') ? [laneX(5), -0.5] : [recvPos.EDGE2[0], 22]], [recT, [spot[0] - 0.4, spot[1] - 0.3]], [T, [spot[0] - 0.4, spot[1] - 0.3]]]), T);
    carrier.push({ t: recT, key: who });
    events.push({ t: kickT, kind: 'kick', who: 'o:QB' }, { t: recT, kind: 'recover', who, at: spot });
  } else {
    const hang = 3.9;
    const catchDy = ev.touchback ? G + 3 : clip(G - 3 - r() * 4, G - 9, G - 1);
    const catchX = clip(CX + (r() - 0.5) * 16, 6, W - 6);
    const catchPt: Pt = [catchX, catchDy];
    arc(ball, [CX, 0], catchPt, kickT, kickT + hang, 24);
    const catchT = kickT + hang;
    const ret = profile(recv, 'S1');
    let endPt: Pt;
    if (ev.touchback) { endPt = catchPt; T = catchT + 0.8; decisive = catchT + 0.3; events.push({ t: catchT, kind: 'catch', who: 'd:S1', at: catchPt }, { t: catchT + 0.3, kind: 'touchback', at: catchPt }); }
    else {
      endPt = ev.td ? [clip(catchX + (r() - 0.5) * 10, 4, W - 4), -yl0 - 1] : [clip(catchX + (r() - 0.5) * 14, 2, W - 2), G - ev.yl];
      const runT = timeTo(dist(catchPt, endPt) + travel(0.3, ret), ret) - 0.3;
      T = catchT + runT + 0.5; decisive = catchT + runT;
      events.push({ t: catchT, kind: 'catch', who: 'd:S1', at: catchPt }, { t: decisive, kind: ev.td ? 'td' : 'return', who: 'd:S1', at: endPt });
    }
    const retTrack = path([[0, [CX, G - 2]], [kickT + 1.2, [catchX, G - 2]], [catchT, catchPt], [decisive, endPt], [T, endPt]]);
    tracks['d:S1'] = track(retTrack, T);
    carrier.push({ t: catchT, key: 'd:S1' });
    for (let t = catchT + DT; t <= T + 1e-9; t = Math.round((t + DT) * 1000) / 1000) { const p = retTrack(t); ball.push({ t, x: p[0], dy: p[1], h: 0 }); }
    // coverage: run the lanes, then close on the returner; the nearest lane makes the stop
    let tackler = '', best = Infinity;
    lanes.forEach((k, i) => { const x = laneX(i); const d = Math.hypot(x - endPt[0], endPt[1] - 20); if (d < best) { best = d; tackler = 'o:' + k; } });
    lanes.forEach((k, i) => {
      const x = laneX(i), p = profile(kick, k);
      const far = Math.min(G - 12, 20 + p.vmax * 2.8);
      const isT = 'o:' + k === tackler && !ev.touchback && !ev.td;
      const closeTo: Pt = isT ? [endPt[0] + (x < endPt[0] ? -0.6 : 0.6), endPt[1] - 0.8] : lerpP([x, far], endPt, ev.td ? 0.35 : 0.6);
      tracks['o:' + k] = track(path([[0, [x, -1]], [kickT, [x, -1]], [catchT, [x, far]], [T, closeTo]]), T);
    });
    tracks['o:QB'] = track(path([[0, [CX, -8]], [kickT, [CX, 0.5]], [catchT, [CX, 14]], [T, [CX, 18]]]), T);
    // the return team: the front line drops to block, the rest hold their wedge then trail the runner
    for (const k in recvPos) if (k !== 'S1') {
      const p0 = recvPos[k];
      const blockPt: Pt = [p0[0], Math.max(p0[1] - 14, 10)];
      tracks['d:' + k] = track(path([[0, p0], [kickT, p0], [catchT, [lerpP(p0, [catchX, p0[1] - 6], 0.5)[0], p0[1] - 4]], [T, lerpP(blockPt, endPt, 0.25)]]), T);
    }
    events.unshift({ t: kickT, kind: 'kick', who: 'o:QB' });
  }
  for (const k of OFF) if (!tracks['o:' + k]) tracks['o:' + k] = track(() => [CX, -8], T);
  for (const k of DEF) if (!tracks['d:' + k]) tracks['d:' + k] = track(() => [CX, 30], T);
  events.sort((a, b) => a.t - b.t);
  const retYds = ev.touchback ? 0 : Math.max(0, Math.round(G - 2 - (G - ev.yl)));
  const res: PlayResult = { kind: 'kickoff', call: ev.kind, look: null, carrier: 'S1', yards: retYds, air: G, oob: false, td: ev.td, safety: false, turnover: false, dur: 0, side: 1, touchback: ev.touchback, retYds };
  return { tl: { tracks, ball, events, carrier, end: T, decisive }, res, yl0 };
}

export const KICK_FORMATION = formation;
