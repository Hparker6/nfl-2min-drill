/**
 * The kick cam: a field goal, extra point or kickoff from behind the kicker, the way a broadcast shows it. For a field
 * goal: the line set, the snap, the hold, the kick, the ball end over end over the rush, and through the uprights (or
 * not) into the net. For a kickoff: the ball on the tee, the coverage team on the line, the run-up, the kick, the hang
 * time while the coverage sprints down the field, and the returner settling under it (or a touchback in the end zone);
 * the return itself is played on the field once the cam cuts away.
 *
 * The result is the engine's. This only decides how it looks, seeded by the play so a replay looks the same: where a
 * make crosses, whether a miss is wide (which way), short, or clanks off an upright, and whether a make kisses one on
 * the way in. kickPath() is the flight, pure and testable; KickCam draws it.
 *
 * The camera: a long lens high behind the kicker (35 yards back, 8 up), so the posts and the whole flight fit the
 * frame. Ground and heights in yards; the frame is 100 x 64 units (the overlay crops it to fit the field's box).
 */
import { hash, rng } from '../engine/rng';
import type { TeamInfo } from '../engine/types';
import { DRESSING, inkOn, shade } from './stadium';

export type Flight = 'through' | 'doinkIn' | 'left' | 'right' | 'short' | 'doinkOut';

export const POST = 3.083;   // yards from the middle to an upright (18 ft 6 in apart)
export const BAR = 3.333;    // the crossbar's height, yards (10 ft)
export const TOP = 15;       // the tops of the uprights (35 ft above the bar)
const NET = 2;               // the net hangs this far behind the plane of the uprights

export interface KickPath {
  flight: Flight;
  D: number;                 // yards from the kick spot to the plane of the uprights
  cross: number;             // where it crosses (or reaches) that plane, yards from the middle
  hAt: (z: number) => number;   // height over the ground, yards, at depth z
  xAt: (z: number) => number;   // yards from the middle at depth z (until the plane)
}

/** The flight of a kick from `dist` yards (the distance to the uprights) that the engine ruled good or not. */
export function kickPath(dist: number, good: boolean, seed: number): KickPath {
  const r = rng(hash('kickcam', seed));
  const D = dist;
  let flight: Flight;
  if (good) flight = r() < 0.07 ? 'doinkIn' : 'through';
  else {
    // long ones come up short more often; most misses are wide
    const shortP = Math.min(0.45, Math.max(0.06, (D - 40) * 0.025));
    const x = r();
    flight = x < shortP ? 'short' : x < shortP + 0.1 ? 'doinkOut' : r() < 0.5 ? 'left' : 'right';
  }
  // where it crosses the plane: makes inside the posts, misses outside, doinks on one
  const side = r() < 0.5 ? -1 : 1;
  const cross = flight === 'through' ? (r() - 0.5) * 2 * (POST - 0.6)
    : flight === 'doinkIn' ? side * (POST - 0.25) : flight === 'doinkOut' ? side * (POST + 0.05)
    : flight === 'left' ? -(POST + 0.8 + r() * 2.2) : flight === 'right' ? POST + 0.8 + r() * 2.2 : (r() - 0.5) * 3;
  // the arc: a parabola that clears the bar with room for a make, and comes down at the bar (or before it) short
  const apexZ = D * (0.52 + r() * 0.08);
  const peak = flight === 'short' ? Math.max(5, D * 0.19) : Math.max(BAR + 4.5 + r() * 4, D * 0.21 + 2);
  const endH = flight === 'short' ? 0 : BAR + 2.5 + r() * 5;
  // h(z) through (0,0), (apexZ, peak), (D, endH): a quadratic in z
  const a = ((endH - 0) / D - (peak - 0) / apexZ) / (D - apexZ);
  const b = (peak - 0) / apexZ - a * apexZ;
  const hAt = (z: number) => Math.max(0, a * z * z + b * z);
  const xAt = (z: number) => cross * Math.min(1, z / D);
  return { flight, D, cross, hAt, xAt };
}

export interface KickShot {
  dist: number;              // yards to the uprights (an extra point: 33)
  xp: boolean;
  good: boolean;
  seed: number;
  kicking: TeamInfo;
  defending: TeamInfo;       // whose end zone is under the posts
  home: TeamInfo;
}

export interface KickoffShot {
  kind: 'kickoff' | 'free';
  D: number;                 // yards from the tee to the receiving goal line (65 from the 35, 80 for a free kick)
  catch: { x: number; z: number };   // where the ball comes down: yards from the middle, yards from the tee
  touchback: boolean;
  spot: number;              // where the receiving team starts after a touchback (their yard line)
  seed: number;
  kicking: TeamInfo;
  receiving: TeamInfo;
  home: TeamInfo;
}

const NS = 'http://www.w3.org/2000/svg';
const ZC = -35, CAMH = 8, HORIZON = 21, F = 157.5, CX = 50;
const scaleAt = (z: number) => F / (z - ZC);
/** Ground point (x across, z down the field, h up) to the frame. */
const project = (x: number, z: number, h = 0): [number, number] => { const s = scaleAt(z); return [CX + x * s, HORIZON + (CAMH - h) * s]; };

const SKIN = ['#f1c9a5', '#e0ac85', '#c68c5f', '#a5673f', '#7c4a2a', '#5a3620'];
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));
const ease = (f: number) => (f < 0.5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2);
/** A bold line and a small one, as text nodes: names never become markup. */
function caption(host: HTMLElement, title: string, sub: string) {
  const b = document.createElement('b'), s = document.createElement('span');
  b.textContent = title; s.textContent = sub;
  host.replaceChildren(b, s);
}

interface Scene {
  svg: SVGSVGElement; cam: SVGElement; gp: SVGElement; people: SVGElement; r: () => number;
  /** A player standing at (x, z), drawn once; the frame scales him. */
  body: (x: number, z: number, color: string, num: string | null, opts?: { kneel?: boolean; arms?: boolean }) => SVGElement;
  /** A player who moves: built in yard units at the origin, placed with placeFig(). */
  figure: (color: string, num: string | null) => SVGElement;
  placeFig: (g: SVGElement, x: number, z: number, lean?: number) => void;
  nums: (t: TeamInfo, keys: string[]) => string[];
}

/** The kicker's approach: where he starts (yards from the kick spot), how long it takes, and how many strides. */
interface Approach { x0: number; z0: number; dur: number; strides: number }
const FG_APPROACH: Approach = { x0: -2.9, z0: -2.3, dur: 0.62, strides: 3 };
const KO_APPROACH: Approach = { x0: -3.4, z0: -9, dur: 1.25, strides: 6 };

/** Draws the kick cam into a host element (an overlay over the field) and plays one kick. */
export class KickCam {
  private host: HTMLElement;
  private alive = true;
  private runId = 0;
  constructor(host: HTMLElement) { this.host = host; }
  stop() { this.alive = false; this.host.innerHTML = ''; this.host.classList.remove('on'); }

  private el(tag: string, attrs: Record<string, string | number>, parent: Element): SVGElement {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, String(attrs[k]));
    parent.appendChild(e);
    return e as SVGElement;
  }

  /**
   * The stadium from behind the kick spot: night sky, lights, the stands rising behind the end zone in the home
   * colors, the defending team's wall and end zone D yards away, the turf with its lines and numbers, the goal post,
   * and (for a field goal) the net raised behind it.
   */
  private scene(K: TeamInfo, E: TeamInfo, H: TeamInfo, D: number, seed: number, net: boolean): Scene {
    const host = this.host;
    host.innerHTML = '';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 100 64');
    svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
    svg.setAttribute('class', 'kc-svg');
    svg.setAttribute('aria-hidden', 'true');
    host.appendChild(svg);
    const cam = this.el('g', { class: 'kc-cam' }, svg);

    // ---- the far end: night sky, lights, the stands rising behind the end zone, the net
    const defs = this.el('defs', {}, svg);
    defs.innerHTML = `<linearGradient id="kc-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#05080d"/><stop offset="1" stop-color="#18202b"/></linearGradient>
      <radialGradient id="kc-glow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fffbe6" stop-opacity=".9"/><stop offset="1" stop-color="#fffbe6" stop-opacity="0"/></radialGradient>
      <linearGradient id="kc-turf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1f5a36"/><stop offset="1" stop-color="#2f7d4a"/></linearGradient>
      <pattern id="kc-mesh" patternUnits="userSpaceOnUse" width=".9" height=".9"><path d="M0,0 L.9,.9 M.9,0 L0,.9" stroke="rgba(255,255,255,.28)" stroke-width=".08"/></pattern>`;
    this.el('rect', { x: -10, y: -10, width: 120, height: 84, fill: 'url(#kc-sky)' }, cam);
    for (const lx of [12, 88]) this.el('ellipse', { cx: lx, cy: 3, rx: 9, ry: 4, fill: 'url(#kc-glow)', class: 'kc-light' }, cam);
    // the stands: tiers stepping up and back from the end line, mostly the home colors
    const r = rng(hash('kc-crowd', seed));
    const shirts = [H.color, H.color, H.color2, K === H ? E.color : K.color, '#e9ecef', '#2a2f35', shade(H.color, 0.3)];
    const stands = this.el('g', { class: 'kc-stands' }, cam);
    for (let tier = 11; tier >= 0; tier--) {
      const z = D + 6 + tier * 1.25, h = 1.6 + tier * 0.95;
      const [, y] = project(0, z, h);
      const s = scaleAt(z);
      this.el('rect', { x: -10, y: y - 0.2, width: 120, height: s * 1.4, fill: tier % 2 ? '#1a2027' : '#20272f' }, stands);
      // each fan: a shirt and a head (a few path elements per tier, not one per person)
      const by = new Map<string, string>(), heads = new Map<string, string>();
      const dot = (cx: number, cy: number, rr: number) => `M${(cx - rr).toFixed(2)},${cy.toFixed(2)}a${rr.toFixed(2)},${rr.toFixed(2)} 0 1,0 ${(2 * rr).toFixed(2)},0a${rr.toFixed(2)},${rr.toFixed(2)} 0 1,0 ${(-2 * rr).toFixed(2)},0`;
      for (let x = -60; x <= 60; x += 0.85 + r() * 0.2) {
        if (r() < 0.08) continue;
        const [sx] = project(x, z, h);
        if (sx < -4 || sx > 104) continue;
        const c = shirts[Math.floor(r() * shirts.length)], skin = SKIN[Math.floor(r() * SKIN.length)];
        const jy = y + (r() - 0.5) * 0.1 * s;
        by.set(c, (by.get(c) ?? '') + dot(sx, jy + 0.18 * s, 0.33 * s));
        heads.set(skin, (heads.get(skin) ?? '') + dot(sx, jy - 0.3 * s, 0.19 * s));
      }
      by.forEach((d, c) => this.el('path', { d, fill: c }, stands));
      heads.forEach((d, c) => this.el('path', { d, fill: c }, stands));
    }
    // the wall behind the end line, in the defending team's colors, its name repeated
    {
      const zw = D + 4.5;
      const [, yTop] = project(0, zw, 1.6), [, yBot] = project(0, zw, 0);
      this.el('rect', { x: -10, y: yTop, width: 120, height: yBot - yTop, fill: E.color }, cam);
      for (let x = -40; x <= 40; x += 16) {
        const [sx] = project(x, zw, 0.8);
        const t = this.el('text', { x: sx, y: (yTop + yBot) / 2, class: 'kc-wallt', fill: inkOn(E.color), 'font-size': ((yBot - yTop) * 0.62).toFixed(2) }, cam);
        t.textContent = DRESSING;
      }
    }
    // the net, raised behind the uprights for the kick
    if (net) {
      const [x0, y0] = project(-9, D + NET, 17), [x1, y1] = project(9, D + NET, 4);
      this.el('rect', { x: x0, y: y0, width: x1 - x0, height: y1 - y0, fill: 'url(#kc-mesh)', stroke: 'rgba(255,255,255,.35)', 'stroke-width': 0.12, class: 'kc-net' }, cam);
    }

    // ---- the field: turf to the end line, yard lines, numbers, the end zone with its name
    const field = this.el('g', {}, cam);
    const quad = (z0: number, z1: number, w = 26.67) => {
      const a = project(-w, z0), b = project(w, z0), c = project(w, z1), d = project(-w, z1);
      return `M${a[0]},${a[1]} L${b[0]},${b[1]} L${c[0]},${c[1]} L${d[0]},${d[1]} Z`;
    };
    // (the camera is 35 yards back: ground nearer than 12 yards behind the kick spot is under the frame)
    this.el('path', { d: quad(D + 4.5, -12, 60), fill: '#1d4d31' }, field);   // beyond the sidelines and the end line
    this.el('path', { d: quad(D, -12), fill: 'url(#kc-turf)' }, field);
    // mowing stripes, five yards each
    for (let z = D - 10; z > -12; z -= 10) this.el('path', { d: quad(z - 5, Math.max(-12, z - 10)), fill: 'rgba(0,0,0,.07)' }, field);
    this.el('path', { d: quad(D, D - 10), fill: E.color, opacity: 0.95 }, field);
    for (let z = D - 10; z > -12; z -= 5) {
      const a = project(-26.67, z), b = project(26.67, z);
      this.el('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: 'rgba(255,255,255,' + (z === D - 10 ? 0.95 : 0.55) + ')', 'stroke-width': (0.14 * scaleAt(z)).toFixed(3) }, field);
      // the numbers, every ten yards from the goal
      const toGoal = D - 10 - z;
      if (toGoal > 0 && toGoal % 10 === 0 && toGoal <= 50) {
        for (const sx of [-1, 1]) {
          const [nx, ny] = project(sx * 17.5, z);
          const t = this.el('text', { x: nx, y: ny, class: 'kc-num', 'font-size': (1.9 * scaleAt(z)).toFixed(2), transform: `translate(${nx} ${ny}) scale(1 0.42) translate(${-nx} ${-ny})` }, field);
          t.textContent = String(toGoal);
        }
      }
    }
    this.el('line', { x1: project(-26.67, D)[0], y1: project(0, D)[1], x2: project(26.67, D)[0], y2: project(0, D)[1], stroke: '#fff', 'stroke-width': (0.16 * scaleAt(D)).toFixed(3) }, field);

    // ---- the goal post: base pad and gooseneck behind, the crossbar, the uprights with ribbons
    const gp = this.el('g', { class: 'kc-gp' }, cam);
    const gold = '#f4d23e';
    {
      const [bx, by] = project(0, D + 2, 0), [, bTop] = project(0, D + 2, BAR - 0.6);
      const [cx2, cy2] = project(0, D, BAR);
      const s = scaleAt(D);
      this.el('rect', { x: bx - 0.6 * s, y: by - 0.8 * s, width: 1.2 * s, height: 0.8 * s, rx: 0.15 * s, fill: E.color }, gp);
      this.el('path', { d: `M${bx},${by - 0.7 * s} L${bx},${bTop} Q${bx},${cy2 - 0.4 * s} ${cx2},${cy2}`, fill: 'none', stroke: gold, 'stroke-width': (0.28 * s).toFixed(3), 'stroke-linecap': 'round' }, gp);
      const [lx, ly] = project(-POST, D, BAR), [rx] = project(POST, D, BAR);
      this.el('line', { x1: lx, y1: ly, x2: rx, y2: ly, stroke: gold, 'stroke-width': (0.26 * s).toFixed(3), 'stroke-linecap': 'round' }, gp);
      for (const sx of [-1, 1]) {
        const [ux, uy] = project(sx * POST, D, TOP);
        this.el('line', { x1: ux, y1: ly, x2: ux, y2: uy, stroke: gold, 'stroke-width': (0.2 * s).toFixed(3), 'stroke-linecap': 'round', class: sx < 0 ? 'kc-up-l' : 'kc-up-r' }, gp);
        this.el('path', { d: `M${ux},${uy} l${(1.1 * s).toFixed(2)},${(0.25 * s).toFixed(2)} l${(-1.1 * s).toFixed(2)},${(0.25 * s).toFixed(2)} Z`, fill: '#ff6a3d', class: 'kc-ribbon' }, gp);
      }
    }

    // ---- the players
    const people = this.el('g', {}, cam);
    const body: Scene['body'] = (x, z, color, num, opts = {}) => {
      const s = scaleAt(z);
      const [px, py] = project(x, z, 0);
      const h = (opts.kneel ? 1.25 : 2.05) * s, w = 0.82 * s;
      const g = this.el('g', { class: opts.arms ? 'kc-rush' : '' }, people);
      this.el('rect', { x: px - w / 2, y: py - h, width: w, height: h * 0.62, rx: w * 0.3, fill: color }, g);
      this.el('rect', { x: px - w * 0.42, y: py - h * 0.4, width: w * 0.36, height: h * 0.4, rx: w * 0.12, fill: shade(color, -0.35) }, g);
      this.el('rect', { x: px + w * 0.06, y: py - h * 0.4, width: w * 0.36, height: h * 0.4, rx: w * 0.12, fill: shade(color, -0.35) }, g);
      this.el('circle', { cx: px, cy: py - h - w * 0.28, r: w * 0.36, fill: shade(color, -0.15) }, g);
      if (num) { const t = this.el('text', { x: px, y: py - h * 0.66, class: 'kc-numb', fill: inkOn(color), 'font-size': (w * 0.62).toFixed(2) }, g); t.textContent = num; }
      if (opts.arms) for (const sx of [-1, 1]) this.el('line', { x1: px + sx * w * 0.42, y1: py - h * 0.95, x2: px + sx * w * 0.6, y2: py - h * 1.5, stroke: color, 'stroke-width': (w * 0.22).toFixed(2), 'stroke-linecap': 'round', class: 'kc-arm' }, g);
      return g;
    };
    // a mover: the same figure in yard units at the origin, so placing him is one transform
    const figure: Scene['figure'] = (color, num) => {
      const g = this.el('g', { class: 'kc-fig' }, people);
      const h = 2.05, w = 0.82;
      this.el('rect', { x: -w / 2, y: -h, width: w, height: h * 0.62, rx: w * 0.3, fill: color }, g);
      this.el('rect', { x: -w * 0.42, y: -h * 0.4, width: w * 0.36, height: h * 0.4, rx: w * 0.12, fill: shade(color, -0.35), class: 'kc-leg' }, g);
      this.el('rect', { x: w * 0.06, y: -h * 0.4, width: w * 0.36, height: h * 0.4, rx: w * 0.12, fill: shade(color, -0.35), class: 'kc-leg' }, g);
      this.el('circle', { cx: 0, cy: -h - w * 0.28, r: w * 0.36, fill: shade(color, -0.15) }, g);
      if (num) { const t = this.el('text', { x: 0, y: -h * 0.66, class: 'kc-numb', fill: inkOn(color), 'font-size': (w * 0.62).toFixed(2) }, g); t.textContent = num; }
      return g;
    };
    const placeFig: Scene['placeFig'] = (g, x, z, lean = 0) => {
      const s = scaleAt(z), [px, py] = project(x, z, 0);
      g.setAttribute('transform', `translate(${px.toFixed(2)} ${py.toFixed(2)}) scale(${s.toFixed(3)}) rotate(${lean.toFixed(1)})`);
    };
    const nums: Scene['nums'] = (t, keys) => keys.map((key) => String(t.players[key]?.number ?? ''));
    return { svg, cam, gp, people, r, body, figure, placeFig, nums };
  }

  /** The kicker, seen from behind: drawn at his feet in yards (the frame scales him), the kicking leg on its own hinge. */
  private kicker(K: TeamInfo, sc: Scene, approach: Approach) {
    const kicker = this.el('g', {}, sc.people);
    const kc = K.color, kd = K.color2;   // pants in the second color, so the swing reads against any jersey
    const plant = this.el('g', {}, kicker), kickLeg = this.el('g', {}, kicker);
    const legRect = (g: SVGElement) => { this.el('rect', { x: -0.14, y: 0, width: 0.28, height: 0.8, rx: 0.1, fill: kd }, g); this.el('rect', { x: -0.16, y: 0.68, width: 0.32, height: 0.16, rx: 0.07, fill: '#111' }, g); };
    legRect(plant); legRect(kickLeg);
    const torso = this.el('g', {}, kicker);
    this.el('rect', { x: -0.41, y: -2.05, width: 0.82, height: 1.27, rx: 0.25, fill: kc }, torso);
    { const t = this.el('text', { x: 0, y: -1.42, class: 'kc-numb', fill: inkOn(kc), 'font-size': '0.5' }, torso); t.textContent = String(K.players.K?.number ?? ''); }
    this.el('circle', { cx: 0, cy: -2.28, r: 0.3, fill: shade(kc, -0.15) }, torso);
    const armL = this.el('line', { x1: -0.36, y1: -1.85, x2: -0.5, y2: -1.2, stroke: kc, 'stroke-width': 0.18, 'stroke-linecap': 'round' }, torso);
    const armR = this.el('line', { x1: 0.36, y1: -1.85, x2: 0.5, y2: -1.2, stroke: kc, 'stroke-width': 0.18, 'stroke-linecap': 'round' }, torso);
    const puff = this.el('circle', { r: 0, fill: 'rgba(255,255,255,.75)', opacity: 0 }, sc.cam);
    /** Where he is and what his body is doing at time t: the approach, the plant, the swing, the follow-through. */
    const pose = (t: number, KICK: number) => {
      const t0 = KICK - approach.dur;               // the steps in, from the left and behind
      const a = Math.max(0, Math.min(1, (t - t0) / approach.dur));
      const x = approach.x0 + (-0.78 - approach.x0) * ease(a), z = approach.z0 + (-0.32 - approach.z0) * ease(a);
      const stride = a > 0 && a < 1 ? Math.sin(a * Math.PI * approach.strides) : 0;
      let kick = 0, lift = 0, lean = 0;           // kick: the leg's hinge, degrees; lift: how far up it has swung (0-1)
      if (t >= KICK - 0.16 && t < KICK) kick = 38 * ((t - (KICK - 0.16)) / 0.16);          // the backswing
      else if (t >= KICK) { const f = Math.min(1, (t - KICK) / 0.28); lift = ease(f); kick = 38 * (1 - f) - 14 * f; lean = 7 * f; }
      if (t >= KICK + 0.75) { const f = Math.min(1, (t - KICK - 0.75) / 0.35); lift *= 1 - f; kick *= 1 - f; lean *= 1 - f; }
      const scl = scaleAt(z), [px, py] = project(x, z, 0);
      const hop = lift * 0.18;
      kicker.setAttribute('transform', `translate(${px.toFixed(2)} ${(py - hop * scl).toFixed(2)}) scale(${scl.toFixed(3)}) rotate(${(-lean).toFixed(1)})`);
      plant.setAttribute('transform', `translate(-0.17 -0.82) rotate(${(stride * -14).toFixed(1)})`);
      // the kicking leg swings through and up: from behind it shortens, then rises past the hip
      const sy = 1 - lift * 1.6;
      kickLeg.setAttribute('transform', `translate(0.19 -0.82) rotate(${(kick + stride * 14).toFixed(1)}) scale(1 ${sy.toFixed(3)})`);
      // arms out for balance as he plants
      const out = t >= KICK - 0.2 ? Math.min(1, (t - KICK + 0.2) / 0.2) * (t > KICK + 0.9 ? Math.max(0, 1 - (t - KICK - 0.9) / 0.3) : 1) : 0;
      armL.setAttribute('x2', String(-0.5 - out * 0.55)); armL.setAttribute('y2', String(-1.2 - out * 0.45));
      armR.setAttribute('x2', String(0.5 + out * 0.35)); armR.setAttribute('y2', String(-1.2 - out * 0.2));
      // contact: a puff at the ball
      const p = (t - KICK) / 0.3;
      if (p >= 0 && p <= 1) {
        const [bx, by] = project(-0.5, 0.4, 0.15), bs = scaleAt(0.4);
        puff.setAttribute('cx', bx.toFixed(2)); puff.setAttribute('cy', by.toFixed(2));
        puff.setAttribute('r', (bs * (0.15 + p * 0.5)).toFixed(2)); puff.setAttribute('opacity', (0.8 * (1 - p)).toFixed(2));
      } else puff.setAttribute('opacity', '0');
    };
    return pose;
  }

  /** The ball and its shadow; place() puts it at (x, z, h) spinning end over end. Past the posts it goes behind them. */
  private ball(sc: Scene, D: number) {
    const shadow = this.el('ellipse', { rx: 0.5, ry: 0.18, fill: 'rgba(0,0,0,.35)' }, sc.cam);
    const ball = this.el('g', {}, sc.cam);
    const ballEl = this.el('ellipse', { rx: 0.6, ry: 0.38, fill: '#7a3b1c', stroke: '#4a220f', 'stroke-width': 0.08 }, ball);
    const lace = this.el('line', { stroke: '#f3efe6', 'stroke-width': 0.08, 'stroke-linecap': 'round' }, ball);
    const place = (x: number, z: number, h: number, spin: number) => {
      const [sx, sy] = project(x, z, h);
      const [gx, gy] = project(x, z, 0);
      const s = scaleAt(z) * 1.7;
      ball.setAttribute('transform', `translate(${sx.toFixed(2)} ${sy.toFixed(2)}) scale(${(s / 4).toFixed(3)}) rotate(${(spin * 57.3).toFixed(1)})`);
      ballEl.setAttribute('ry', (0.38 * Math.max(0.35, Math.abs(Math.cos(spin * 1.7)))).toFixed(3));
      lace.setAttribute('x1', '-0.22'); lace.setAttribute('x2', '0.22'); lace.setAttribute('y1', '0'); lace.setAttribute('y2', '0');
      shadow.setAttribute('cx', gx.toFixed(2)); shadow.setAttribute('cy', gy.toFixed(2));
      shadow.setAttribute('rx', (0.45 * scaleAt(z)).toFixed(2)); shadow.setAttribute('ry', (0.14 * scaleAt(z)).toFixed(2));
      shadow.setAttribute('opacity', String(Math.max(0, 1 - h / 9).toFixed(2)));
      // past the plane of the uprights the ball is behind them
      if (z > D && ball.nextSibling !== sc.gp) sc.cam.insertBefore(ball, sc.gp);
    };
    return place;
  }

  /** The broadcast graphics: a lower third now, and a verdict box to show later. */
  private graphics(title: string, sub: string) {
    const lower = document.createElement('div');
    lower.className = 'kc-lower';
    caption(lower, title, sub);
    this.host.appendChild(lower);
    const verdict = document.createElement('div');
    verdict.className = 'kc-verdict';
    this.host.appendChild(verdict);
    this.host.classList.add('on');
    return verdict;
  }

  /** Runs frame(t) from 0 to total seconds at the given speed (0: the final frame at once), then fades the cam out. */
  private async run(total: number, speed: number, frame: (t: number) => void, atEnd: () => void) {
    const mine = ++this.runId;   // a stop() followed by a new play(): the old run's tail must not touch the new scene
    const dur = speed > 0 ? total / speed : 0;
    if (!dur) { frame(total); atEnd(); await sleep(900); }
    else {
      const t0 = performance.now();
      await new Promise<void>((done) => {
        const step = (now: number) => {
          if (!this.alive) return done();
          const t = ((now - t0) / 1000 / dur) * total;
          frame(Math.min(t, total));
          if (t < total) requestAnimationFrame(step); else done();
        };
        requestAnimationFrame(step);
      });
    }
    if (!this.alive || mine !== this.runId) return;   // stopped: no outcome, and nothing of a newer scene is touched
    atEnd();
    this.host.classList.add('out');
    await sleep(speed > 0 ? 260 : 0);
    if (mine !== this.runId) return;
    this.host.classList.remove('on', 'out', 'kc-live', 'kc-cheer');
    this.host.innerHTML = '';
  }

  /**
   * Play a field goal or extra point. speed: 1 normal, higher faster, lower slower (replays). onOutcome fires when the
   * ball reaches the uprights (or comes down short): the moment the kick is decided.
   */
  async play(k: KickShot, speed: number, onOutcome?: () => void): Promise<void> {
    this.alive = true;
    const host = this.host;
    const path = kickPath(k.dist, k.good, k.seed);
    const D = path.D, E = k.defending, K = k.kicking;
    const sc = this.scene(K, E, k.home, D, k.seed, true);
    const r = sc.r;

    // ---- the players: the rush (defending colors), the line (kicking colors), the holder and the kicker
    const rushN = sc.nums(E, ['EDGE1', 'DL1', 'DL2', 'EDGE2', 'LB1', 'LB2', 'CB1', 'CB2']);
    [-5.2, -3.8, -2.4, -1, 1, 2.4, 3.8, 5.2].forEach((x, i) => sc.body(x + (r() - 0.5) * 0.4, 8.6 + r() * 0.6, E.color, rushN[i] ?? null, { arms: true }));
    const lineN = sc.nums(K, ['TE', 'LT', 'LG', 'C', 'RG', 'RT', 'WR3']);
    [-4.6, -2.9, -1.45, 0, 1.45, 2.9, 4.6].forEach((x, i) => sc.body(x, 7.2, K.color, lineN[i] ?? null));
    sc.body(-0.95, 0.4, K.color, String(K.players.P?.number ?? ''), { kneel: true });   // the holder (the punter, as most teams use)
    const pose = this.kicker(K, sc, FG_APPROACH);
    const place = this.ball(sc, D);
    const verdict = this.graphics(k.xp ? 'Extra point' : `${k.dist}-yard field goal`, K.players.K?.name ?? 'The kicker');

    // ---- the clock of it all (seconds at speed 1)
    const SNAP = 0.45, HOLD = 0.8, KICK = 1.05;
    const flightT = 1.15 + D * 0.019;
    const stopZ = path.flight === 'short' ? D - 0.5 : path.flight === 'doinkOut' ? D : D + NET;
    const total = KICK + flightT * (stopZ / (D + NET)) + 1.3;
    const decideT = KICK + flightT * (Math.min(D, stopZ) / (D + NET));
    let decided = false;
    const decide = () => {
      if (decided) return;
      decided = true;
      const f = path.flight;
      const sub = f === 'left' ? 'Wide left' : f === 'right' ? 'Wide right' : f === 'short' ? 'Short' : f === 'doinkOut' ? 'Off the upright' : f === 'doinkIn' ? 'Off the upright and in!' : k.xp ? 'Extra point' : `${k.dist} yards`;
      verdict.className = `kc-verdict show ${k.good ? 'good' : 'bad'}`;
      caption(verdict, k.good ? 'It’s good!' : 'No good', sub);
      if (f === 'doinkIn' || f === 'doinkOut') host.querySelector(path.cross < 0 ? '.kc-up-l' : '.kc-up-r')?.classList.add('kc-clank');
      if (k.good) host.classList.add('kc-cheer');
      onOutcome?.();
    };

    const frame = (t: number) => {
      // the snap: from the center (7 yards ahead) back to the holder; the kicker's two steps; the kick
      if (t < SNAP) place(0, 7, 0.6, 0);
      else if (t < HOLD) { const f = ease((t - SNAP) / (HOLD - SNAP)); place(-0.95 * f, 7 - 6.6 * f, 0.6 + Math.sin(f * Math.PI) * 0.4, f * 3); }
      else if (t < KICK) place(-0.95 + 0.45 * ((t - HOLD) / (KICK - HOLD)), 0.4, 0.15, 1.57);
      else {
        const f = Math.min(1, (t - KICK) / flightT);
        let z = f * (D + NET), x = path.xAt(z), h = path.hAt(z);
        if (path.flight === 'short' && z >= stopZ) { z = stopZ; h = 0; }
        if (path.flight === 'doinkOut' && z >= D) {
          // off the upright: back toward the field and down, outward
          const g = Math.min(1, (t - KICK - flightT * (D / (D + NET))) / 0.8);
          z = D - 2.5 * g; x = path.cross * (1 + 0.6 * g); h = path.hAt(D) * (1 - g * g);
        }
        if (path.flight === 'doinkIn' && z > D) x = path.cross * Math.max(0.35, 1 - (z - D) * 0.4);
        if (z >= D + NET - 0.05) h = Math.max(path.hAt(D + NET) - (t - KICK - flightT) * 9, 3.5);   // drops down the net
        place(-0.5 + x, 0.4 + z, h, (t - KICK) * 9);
        if (!decided && t >= decideT) decide();
      }
      pose(t, KICK);
      host.classList.toggle('kc-live', t >= KICK);
    };
    await this.run(total, speed, frame, decide);
  }

  /**
   * Play a kickoff: the tee, the coverage team on the line, the run-up, the kick, the hang time, the catch (or a
   * touchback in the end zone). onCatch fires the moment the ball comes down: the field takes over the return from
   * there, so the cam cuts away right after it.
   */
  async playKickoff(k: KickoffShot, speed: number, onCatch?: () => void): Promise<void> {
    this.alive = true;
    const host = this.host;
    const D = k.D, K = k.kicking, E = k.receiving;
    const sc = this.scene(K, E, k.home, D, k.seed, false);
    const r = sc.r;

    // ---- the coverage team on the line either side of the tee; the return team's front and wedge; the returner
    const laneN = sc.nums(K, ['LT', 'LG', 'C', 'RG', 'RT', 'WR1', 'WR2', 'WR3', 'TE', 'RB']);
    // the line stands a couple of yards ahead of the tee, tight enough for the lens; it fans out as it runs
    const lanesX = [-9.6, -7.6, -5.6, -3.7, -1.9, 1.9, 3.7, 5.6, 7.6, 9.6];
    const cover = lanesX.map((x, i) => ({ g: sc.figure(K.color, laneN[i] ?? null), x, z0: 1.6 + r() * 0.9, v: 0.86 + r() * 0.22, lean: 0 }));
    const frontN = sc.nums(E, ['EDGE1', 'DL1', 'DL2', 'EDGE2', 'LB1', 'LB2', 'LB3', 'CB1']);
    [-22, -15, -8, 0, 8, 15, 22].forEach((x, i) => sc.body(x + (r() - 0.5) * 1.5, D - 40 + (r() - 0.5) * 2, E.color, frontN[i] ?? null));
    [-9, 0, 9].forEach((x, i) => sc.body(x, D - 24 + (r() - 0.5) * 2, E.color, frontN[7 - i] ?? null));
    const retN = String(E.players.S1?.number ?? '');
    const returner = sc.figure(E.color, retN);
    const ret0 = { x: k.catch.x * 0.35, z: D - 1.5 };
    const pose = this.kicker(K, sc, KO_APPROACH);
    const place = this.ball(sc, D);
    const verdict = this.graphics(k.kind === 'free' ? 'Free kick' : 'Kickoff', K.players.K?.name ?? 'The kicker');
    // the tee
    { const [tx, ty] = project(-0.5, 0.4, 0), s = scaleAt(0.4); this.el('rect', { x: tx - 0.22 * s, y: ty - 0.12 * s, width: 0.44 * s, height: 0.14 * s, rx: 0.04 * s, fill: '#e8762c' }, sc.cam); }

    // ---- the clock of it all (seconds at speed 1): the whistle, the run-up, the kick, the hang time
    const KICK = 1.65;
    const flightT = 2.2 + D * 0.016;
    const CATCH = KICK + flightT;
    const total = CATCH + (k.touchback ? 1.1 : 0.35);
    const peak = 10;   // the visual arc: a real kickoff's hang would leave the frame
    let caught = false;
    const land = () => {
      if (caught) return;
      caught = true;
      if (k.touchback) { verdict.className = 'kc-verdict show neutral'; caption(verdict, 'Touchback', `Out to the ${k.spot}`); }
      onCatch?.();
    };
    const frame = (t: number) => {
      const f = Math.max(0, Math.min(1, (t - KICK) / flightT));
      if (t < KICK) place(-0.5, 0.4, 0.15, 1.5);
      else {
        const z = 0.4 + f * k.catch.z, x = -0.5 + f * (k.catch.x + 0.5), h = peak * 4 * f * (1 - f);
        place(x, z, Math.max(h, f >= 1 ? 0.2 : 0), (t - KICK) * 7);
        if (!caught && t >= CATCH) land();
      }
      // the coverage sprints once the ball is away, each man at his own pace, and keeps going past the catch
      const run = Math.max(0, t - KICK);
      for (const c of cover) {
        const z = c.z0 + Math.min(D - 10, run * 8.2 * c.v);
        const stride = run > 0 && z < D - 10 ? Math.sin(run * 11 * c.v) * 6 : 0;
        sc.placeFig(c.g, Math.max(-24, Math.min(24, c.x * (1 + run * 0.42))), z, stride);
      }
      // the returner settles under the ball
      const g = ease(Math.min(1, f / 0.9));
      sc.placeFig(returner, ret0.x + (k.catch.x - ret0.x) * g, ret0.z + (k.catch.z - ret0.z) * g);
      pose(t, KICK);
      host.classList.toggle('kc-live', t >= KICK);
    };
    await this.run(total, speed, frame, land);
  }
}
