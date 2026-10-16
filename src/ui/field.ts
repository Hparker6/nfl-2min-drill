/**
 * The field: an SVG drawn in yards (x across, 0-53.3; y down the field). Your end zone is at the bottom, theirs at
 * the top. Players are positioned in the offense's frame ([x from the offense's left sideline, yards past the line])
 * and mapped onto the field, so the same formation code works whichever way the offense is going.
 *
 * The camera is a window onto the field whose height follows the element's aspect ratio (resize()), so the field
 * fills whatever space the layout gives it. The renderer is plain DOM so the animation loop never goes through React.
 *
 * Lifecycle of a snap: setup() draws the pre-snap picture (players jog into it from where they were), play()
 * animates the engine's result and calls onOutcome at the moment the play is decided (tackle, catch, drop, kick),
 * then holds the final frame; the next setup() jogs everyone to the new spot.
 */
import { CALL, DEF_POS, DROPS, OFF_POS, POS_LABEL, RECEIVERS, ROUTES } from '../engine/data';
import { flight } from '../engine/sim';
import type { Ev, Look, Rcv, RouteId, State, Team, TeamInfo } from '../engine/types';

const NS = 'http://www.w3.org/2000/svg';
const W = 53.33, CX = W / 2;
type Pt = [number, number];
type Key = [number, number, number]; // t, x, dy

const OFF_SET: Record<string, Pt> = {
  LT: [CX - 4.2, -1.4], LG: [CX - 2.1, -1.4], C: [CX, -1.3], RG: [CX + 2.1, -1.4], RT: [CX + 4.2, -1.4],
  QB: [CX, -5.4], RB: [CX - 2, -5.8], TE: [CX + 6.6, -1.6], WR1: [5, -1.4], WR2: [W - 5, -1.4], WR3: [13, -2],
};

function defSet(look: Look | null): Record<string, Pt> {
  const s: Record<string, Pt> = {
    EDGE1: [CX - 5.6, 1.4], DL1: [CX - 1.7, 1.4], DL2: [CX + 1.7, 1.4], EDGE2: [CX + 5.6, 1.4],
    LB1: [CX - 4.8, 5], LB2: [CX, 5.5], LB3: [CX + 4.8, 5], CB1: [5, 6], CB2: [W - 5, 6], S1: [CX - 9, 13], S2: [CX + 9, 13],
  };
  if (look === 'load') { s.LB1 = [CX - 4, 4]; s.LB2 = [CX, 4.2]; s.LB3 = [CX + 4, 4]; s.S2 = [CX + 7, 6]; s.CB1 = [5, 5]; s.CB2 = [W - 5, 5]; }
  if (look === 'blitz') { s.LB1 = [CX - 3.2, 2.6]; s.LB3 = [CX + 3.6, 2.6]; s.LB2 = [CX, 4.2]; s.S1 = [CX - 8, 11]; s.CB1 = [5, 2.8]; s.CB2 = [W - 5, 2.8]; }
  if (look === 'zone') { s.CB1 = [5, 7.5]; s.CB2 = [W - 5, 7.5]; s.LB1 = [CX - 6, 6]; s.LB3 = [CX + 6, 6]; s.S1 = [CX - 10, 14]; s.S2 = [CX + 10, 14]; }
  if (look === 'man') { s.CB1 = [5, 1.6]; s.CB2 = [W - 5, 1.6]; s.LB1 = [13, 3.2]; s.LB3 = [CX + 6.6, 3.4]; s.LB2 = [CX - 1.5, 5]; s.S1 = [CX, 14]; s.S2 = [CX + 3, 8]; }
  if (look === 'goal') { s.LB1 = [CX - 3.5, 2.3]; s.LB2 = [CX, 2.3]; s.LB3 = [CX + 3.5, 2.3]; s.CB1 = [6, 2.5]; s.CB2 = [W - 6, 2.5]; s.S1 = [CX - 7, 4]; s.S2 = [CX + 7, 4]; }
  if (look === 'soft' || look === 'prevent') { s.LB1 = [CX - 5, 6.5]; s.LB2 = [CX, 7]; s.LB3 = [CX + 5, 6.5]; s.CB1 = [5, 9]; s.CB2 = [W - 5, 9]; s.S1 = [CX - 8, 17]; s.S2 = [CX + 8, 17]; }
  return s;
}

const ratingColor = (r: number) => `hsl(${Math.round(Math.max(0, Math.min(1, (r - 60) / 35)) * 120)} 80% 52%)`;
const lerp = (a: number, b: number, f: number) => a + (b - a) * f;
const easeIn = (f: number) => f * f;
const easeOut = (f: number) => 1 - (1 - f) * (1 - f);
const easeInOut = (f: number) => (f < 0.5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2);

/** Linear in time between keyframes (the ball: it does not accelerate). */
function sample(track: Key[], t: number): Pt {
  if (t <= track[0][0]) return [track[0][1], track[0][2]];
  for (let i = 1; i < track.length; i++) {
    const a = track[i - 1], b = track[i];
    if (t <= b[0]) {
      const f = b[0] === a[0] ? 1 : (t - a[0]) / (b[0] - a[0]);
      return [lerp(a[1], b[1], f), lerp(a[2], b[2], f)];
    }
  }
  const l = track[track.length - 1];
  return [l[1], l[2]];
}

/** Players: accelerate off the snap, decelerate into the last spot. */
function sampleRun(track: Key[], t: number): Pt {
  if (t <= track[0][0]) return [track[0][1], track[0][2]];
  const n = track.length - 1;
  for (let i = 1; i <= n; i++) {
    const a = track[i - 1], b = track[i];
    if (t <= b[0]) {
      let f = b[0] === a[0] ? 1 : (t - a[0]) / (b[0] - a[0]);
      f = n === 1 ? easeInOut(f) : i === 1 ? easeIn(f) * 0.5 + f * 0.5 : i === n ? easeOut(f) * 0.6 + f * 0.4 : f;
      return [lerp(a[1], b[1], f), lerp(a[2], b[2], f)];
    }
  }
  const l = track[n];
  return [l[1], l[2]];
}

function hexRgb(h: string): [number, number, number] {
  const m = h.replace('#', '');
  const n = parseInt(m.length === 3 ? m.split('').map((c) => c + c).join('') : m, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const colorDist = (a: string, b: string) => { const x = hexRgb(a), y = hexRgb(b); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]); };
const lum = (h: string) => { const [r, g, b] = hexRgb(h); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };

export interface Preview {
  play?: string | null;        // selected call
  target?: Rcv | null;
  route?: RouteId | null;
  look?: Look | null;          // the defense drawn (shown look, or your call on defense)
  routes?: boolean;            // draw routes / run arrows
}

/** What the play came to, fired when it happens on the field (not after the hold). */
export type Outcome = 'tackle' | 'catch' | 'drop' | 'pick' | 'td' | 'oob' | 'sack' | 'kick' | 'none';

interface Dot { g: SVGGElement; body: SVGElement; ring: SVGElement; lab: SVGTextElement }

export class FieldRenderer {
  private svg: SVGSVGElement;
  private gField: SVGGElement;
  private gMarks: SVGGElement;
  private gRoutes: SVGGElement;
  private gFx: SVGGElement;
  private gPlayers: SVGGElement;
  private ball: SVGEllipseElement;
  private ballLace: SVGLineElement;
  private shadow: SVGEllipseElement;
  private dots = new Map<string, Dot>();
  private pos = new Map<string, Pt>();      // where each marker is drawn now (field coordinates)
  private teams: [TeamInfo, TeamInfo] | null = null;
  private colors: [string, string] = ['#888', '#444'];
  private s: State | null = null;
  private lastOff: Team | null = null;
  private viewH = 46;          // yards of field in view, set from the element's aspect ratio
  private cam = 55;            // field U at the center of the view
  private camTarget = 55;
  private raf = 0;
  private tweenRaf = 0;
  private panning = false;
  private finish: (() => void) | null = null;   // resolves the play in progress if something interrupts it
  onTap: ((pos: Rcv) => void) | null = null;

  constructor(svg: SVGSVGElement) {
    this.svg = svg;
    svg.innerHTML = '';
    this.gField = this.el('g', { class: 'f-field' }) as SVGGElement;
    this.gMarks = this.el('g', { class: 'f-marks' }) as SVGGElement;
    this.gRoutes = this.el('g', { class: 'f-routes' }) as SVGGElement;
    this.gFx = this.el('g', { class: 'f-fx' }) as SVGGElement;
    this.gPlayers = this.el('g', { class: 'f-players' }) as SVGGElement;
    const defs = this.el('defs', {});
    defs.innerHTML = `<marker id="arrow" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="3.2" markerHeight="3.2" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="context-stroke"/></marker>`;
    this.shadow = this.el('ellipse', { rx: 0.5, ry: 0.3, class: 'f-ball-sh' }) as SVGEllipseElement;
    this.ball = this.el('ellipse', { rx: 0.48, ry: 0.78, class: 'f-ball' }) as SVGEllipseElement;
    this.ballLace = this.el('line', { class: 'f-lace' }) as SVGLineElement;
    svg.append(defs, this.gField, this.gMarks, this.gRoutes, this.gFx, this.gPlayers, this.shadow, this.ball, this.ballLace);
    this.applyCam();
  }

  private el(tag: string, attrs: Record<string, string | number>, parent?: Element): SVGElement {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, String(attrs[k]));
    if (parent) parent.appendChild(e);
    return e as SVGElement;
  }

  /** The element's size changed: show as many yards as its shape allows. */
  resize(w: number, h: number) {
    if (w <= 0 || h <= 0) return;
    this.viewH = Math.max(26, Math.min(80, (W * h) / w));
    if (this.s) {
      const dir = this.s.off === 0 ? 1 : -1;
      const ballU = this.s.off === 0 ? this.s.yl : 100 - this.s.yl;
      this.camTarget = this.clampCam(ballU + dir * this.camLead());
      this.cam = this.camTarget;
    }
    this.applyCam();
  }

  setTeams(teams: [TeamInfo, TeamInfo]) {
    this.teams = teams;
    // the two sides must be told apart at a glance: if the colors are close, the opponent wears its second color
    const a = teams[0].color;
    const b = colorDist(a, teams[1].color) >= 120 ? teams[1].color : colorDist(a, teams[1].color2) > colorDist(a, teams[1].color) ? teams[1].color2 : teams[1].color;
    this.colors = [a, b];
    this.drawField();
  }

  private drawField() {
    const g = this.gField;
    g.innerHTML = '';
    const T = this.teams!;
    this.el('rect', { x: -6, y: -6, width: W + 12, height: 132, class: 'f-apron' }, g);
    for (let u = 0; u < 100; u += 5) this.el('rect', { x: 0, y: 110 - u - 5, width: W, height: 5, class: (u / 5) % 2 ? 'f-turf2' : 'f-turf' }, g);
    // end zones: theirs at the top, yours at the bottom
    const ez = (y: number, team: TeamInfo, flip: boolean) => {
      this.el('rect', { x: 0, y, width: W, height: 10, fill: team.color, class: 'f-ez' }, g);
      const t = this.el('text', { x: CX, y: y + 5, class: 'f-ezt', fill: lum(team.color) > 0.6 ? '#111' : '#fff', transform: flip ? `rotate(180 ${CX} ${y + 5})` : '' }, g);
      t.textContent = team.name.toUpperCase();
    };
    ez(0, T[1], true);
    ez(110, T[0], false);
    for (let u = 0; u <= 100; u += 5) this.el('line', { x1: 0, x2: W, y1: 110 - u, y2: 110 - u, class: u === 0 || u === 100 ? 'f-line f-goal' : 'f-line' }, g);
    for (let u = 1; u < 100; u++) {
      if (u % 5 === 0) continue;
      for (const x of [0.25, 23.6, 29.15, W - 0.95]) this.el('line', { x1: x, x2: x + 0.7, y1: 110 - u, y2: 110 - u, class: 'f-hash' }, g);
    }
    // yard numbers, upright so they read at a glance
    for (let u = 10; u <= 90; u += 10) {
      const n = u <= 50 ? u : 100 - u;
      for (const x of [7.5, W - 7.5]) {
        const t = this.el('text', { x, y: 110 - u, class: 'f-num' }, g);
        t.textContent = String(n);
      }
    }
    for (const y of [0.15, 119.85]) this.el('line', { x1: CX - 3.1, x2: CX + 3.1, y1: y, y2: y, class: 'f-post' }, g);
    this.el('rect', { x: 0, y: 0, width: W, height: 120, class: 'f-border' }, g);
  }

  // offense frame → field coordinates
  private frame(off: Team, yl: number) {
    const dir = off === 0 ? 1 : -1;
    const ballU = off === 0 ? yl : 100 - yl;
    return (p: Pt): Pt => {
      const u = ballU + dir * p[1];
      return [dir === 1 ? p[0] : W - p[0], 110 - u];
    };
  }

  private ensureDots() {
    if (this.dots.size) return;
    for (const side of ['o', 'd'] as const) {
      for (const pos of side === 'o' ? OFF_POS : DEF_POS) {
        const g = this.el('g', { class: `f-dot f-${side}` }, this.gPlayers) as SVGGElement;
        // offense: circles; defense: diamonds. The outline is the player's rating, red to green.
        const ring = side === 'o'
          ? this.el('circle', { r: 1.05, class: 'f-ring' }, g)
          : this.el('rect', { x: -0.98, y: -0.98, width: 1.96, height: 1.96, rx: 0.3, transform: 'rotate(45)', class: 'f-ring' }, g);
        const body = side === 'o'
          ? this.el('circle', { r: 0.8, class: 'f-body' }, g)
          : this.el('rect', { x: -0.74, y: -0.74, width: 1.48, height: 1.48, rx: 0.22, transform: 'rotate(45)', class: 'f-body' }, g);
        const lab = this.el('text', { y: 0.3, class: 'f-lab' }, g) as SVGTextElement;
        lab.textContent = POS_LABEL[pos];
        if (side === 'o' && (RECEIVERS as string[]).includes(pos)) {
          g.addEventListener('click', () => this.onTap?.(pos as Rcv));
          g.setAttribute('data-rcv', pos);
        }
        this.el('title', {}, g).textContent = pos;
        this.dots.set(`${side}:${pos}`, { g, body, ring, lab });
      }
    }
  }

  private place(key: string, xy: Pt) {
    const d = this.dots.get(key);
    if (!d) return;
    this.pos.set(key, xy);
    d.g.setAttribute('transform', `translate(${xy[0].toFixed(2)} ${xy[1].toFixed(2)})`);
  }

  private camLead() { return Math.max(4, this.viewH / 2 - 13); }   // keep ~13 yards behind the line in view
  private clampCam(u: number) { return Math.max(-10 + this.viewH / 2, Math.min(110 - this.viewH / 2, u)); }
  private applyCam() {
    const y0 = 110 - this.cam - this.viewH / 2;
    this.svg.setAttribute('viewBox', `0 ${y0.toFixed(2)} ${W} ${this.viewH.toFixed(2)}`);
  }
  private pan() {
    if (this.panning) return;
    this.panning = true;
    const loop = () => {
      const d = this.camTarget - this.cam;
      if (Math.abs(d) < 0.03) { this.cam = this.camTarget; this.applyCam(); this.panning = false; return; }
      this.cam += d * 0.14;
      this.applyCam();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  /** Draw the pre-snap picture for a state. Players jog there from where they were; instant skips that. */
  setup(s: State, pv: Preview = {}, instant = false) {
    if (!this.teams) return;
    this.s = s;
    this.ensureDots();
    this.interrupt();
    cancelAnimationFrame(this.tweenRaf);
    const T = this.teams;
    const map = this.frame(s.off, s.yl);
    const yt = 100 - s.yl;
    const qbUnder = pv.play === 'sneak' || pv.play === 'kneel';
    const live = s.stage === 'pre' || s.stage === 'call' || s.stage === 'over';
    this.gPlayers.classList.toggle('dim', !live);
    this.gFx.innerHTML = '';
    const targets = new Map<string, Pt>();
    const off = s.off, def: Team = off === 0 ? 1 : 0;
    const passCall = !!pv.routes && !!pv.play && CALL[pv.play]?.kind === 'pass' && pv.play !== 'hail' && off === 0;
    for (const pos of OFF_POS) {
      let p = OFF_SET[pos];
      if (pos === 'QB' && qbUnder) p = [CX, -1.6];
      p = [p[0], Math.max(p[1], -s.yl - 8)];
      const d = this.dots.get(`o:${pos}`)!;
      const pl = T[off].players[pos];
      this.paint(d, this.colors[off], pl?.rating ?? 75);
      d.g.classList.toggle('tgt', pv.target === pos || (!!pv.play && passCall && !pv.target && CALL[pv.play]?.tgt === pos));
      d.g.classList.toggle('tappable', passCall && (RECEIVERS as string[]).includes(pos));
      d.g.classList.remove('carrier');
      d.g.querySelector('title')!.textContent = `${pl?.name} · ${pos} · rated ${pl?.rating}`;
      targets.set(`o:${pos}`, map(p));
    }
    const ds = defSet(pv.look ?? null);
    for (const pos of DEF_POS) {
      const p = ds[pos];
      const d = this.dots.get(`d:${pos}`)!;
      const pl = T[def].players[pos];
      this.paint(d, this.colors[def], pl?.rating ?? 75);
      d.g.classList.remove('tgt', 'tappable', 'carrier');
      d.g.querySelector('title')!.textContent = `${pl?.name} · ${pos} · rated ${pl?.rating}`;
      targets.set(`d:${pos}`, map([p[0], Math.min(p[1], yt + 9)]));
    }
    // ball, line of scrimmage, line to gain
    const b = map([CX, 0]);
    this.setBall(b, 0, 1);
    this.gMarks.innerHTML = '';
    this.el('line', { x1: 0, x2: W, y1: b[1], y2: b[1], class: 'f-los' }, this.gMarks);
    if (s.dist < yt && (s.stage === 'pre' || s.stage === 'call')) {
      const fd = map([0, s.dist])[1];
      this.el('line', { x1: 0, x2: W, y1: fd, y2: fd, class: 'f-fd' }, this.gMarks);
      for (const x of [0, W]) this.el('rect', { x: x - 0.45, y: fd - 0.45, width: 0.9, height: 0.9, class: 'f-stick' }, this.gMarks);
    }
    // direction of attack: a chevron on the sideline behind the ball
    const a1 = map([W - 1.6, -3.5]), a2 = map([W - 1.6, -0.8]);
    this.el('line', { x1: a1[0], x2: a2[0], y1: a1[1], y2: a2[1], class: 'f-dir', 'marker-end': 'url(#arrow)' }, this.gMarks);

    this.drawPreview(s, pv);

    // move players: a jog from where they stand, or a quick fade when the ball changed hands
    const swapped = this.lastOff !== null && this.lastOff !== off;
    this.lastOff = off;
    if (instant || !this.pos.size) targets.forEach((p, k) => this.place(k, p));
    else if (swapped) {
      this.gPlayers.classList.add('fade');
      setTimeout(() => { targets.forEach((p, k) => this.place(k, p)); this.gPlayers.classList.remove('fade'); }, 180);
    } else {
      const from = new Map(this.pos);
      const far = [...targets].reduce((m, [k, p]) => { const q = from.get(k) ?? p; return Math.max(m, Math.hypot(p[0] - q[0], p[1] - q[1])); }, 0);
      const dur = far < 0.5 ? 0 : Math.min(650, 220 + far * 14);
      if (!dur) targets.forEach((p, k) => this.place(k, p));
      else {
        const t0 = performance.now();
        const step = (now: number) => {
          const f = easeInOut(Math.min(1, (now - t0) / dur));
          targets.forEach((p, k) => { const q = from.get(k) ?? p; this.place(k, [lerp(q[0], p[0], f), lerp(q[1], p[1], f)]); });
          if (f < 1) this.tweenRaf = requestAnimationFrame(step);
        };
        this.tweenRaf = requestAnimationFrame(step);
      }
    }
    const dir = off === 0 ? 1 : -1;
    const ballU = off === 0 ? s.yl : 100 - s.yl;
    this.camTarget = this.clampCam(ballU + dir * this.camLead());
    if (instant) { this.cam = this.camTarget; this.applyCam(); } else this.pan();
  }

  private paint(d: Dot, color: string, rating: number) {
    d.body.setAttribute('fill', color);
    d.ring.setAttribute('stroke', ratingColor(rating));
    d.lab.setAttribute('fill', lum(color) > 0.62 ? '#10150f' : '#fff');
  }

  private setBall(p: Pt, h: number, scale: number) {
    // h: height of the ball in yards; it rises toward the viewer, so it is drawn above its shadow
    this.shadow.setAttribute('cx', p[0].toFixed(2));
    this.shadow.setAttribute('cy', p[1].toFixed(2));
    this.shadow.style.opacity = h > 0.3 ? String(Math.max(0.15, 0.5 - h * 0.03)) : '0';
    const y = p[1] - h * 0.45;
    this.ball.setAttribute('cx', p[0].toFixed(2));
    this.ball.setAttribute('cy', y.toFixed(2));
    this.ball.setAttribute('rx', (0.48 * scale).toFixed(2));
    this.ball.setAttribute('ry', (0.78 * scale).toFixed(2));
    this.ballLace.setAttribute('x1', p[0].toFixed(2));
    this.ballLace.setAttribute('x2', p[0].toFixed(2));
    this.ballLace.setAttribute('y1', (y - 0.32 * scale).toFixed(2));
    this.ballLace.setAttribute('y2', (y + 0.32 * scale).toFixed(2));
    this.ball.style.opacity = this.ballLace.style.opacity = '1';
  }

  private routePoints(pos: Rcv, route: RouteId, yt: number, air?: number): Pt[] {
    const start = OFF_SET[pos];
    const R = ROUTES[route];
    const depth = air ?? (route === 'hail' ? Math.min(yt + 3, 55) : Math.min(R.depth, yt + 4));
    const sign = start[0] < CX ? 1 : -1;
    const pts: Pt[] = [start];
    for (const [i, d] of R.path(depth)) {
      const x = i === 99 ? CX + (start[0] - CX) * 0.25 : start[0] + sign * i;
      pts.push([Math.max(1, Math.min(W - 1, x)), Math.min(d, yt + 9)]);
    }
    return pts;
  }

  private drawPreview(s: State, pv: Preview) {
    this.gRoutes.innerHTML = '';
    if (!pv.routes || !pv.play) return;
    const map = this.frame(s.off, s.yl);
    const c = CALL[pv.play];
    if (!c) return;
    const yt = 100 - s.yl;
    const line = (pts: Pt[], cls: string) => {
      const d = pts.map((p, i) => `${i ? 'L' : 'M'}${map(p)[0].toFixed(2)},${map(p)[1].toFixed(2)}`).join(' ');
      this.el('path', { d, class: `${cls} under` }, this.gRoutes);
      this.el('path', { d, class: cls, 'marker-end': 'url(#arrow)' }, this.gRoutes);
    };
    if (c.routes) {
      const tgt = pv.target ?? c.tgt;
      // decoys first, the target's route on top
      for (const pos of [...RECEIVERS.filter((r) => r !== tgt), tgt!]) {
        const isT = tgt === pos;
        const rt = isT && pv.route ? pv.route : c.routes[pos];
        line(this.routePoints(pos, rt, yt), isT ? 'f-route tgt' : 'f-route');
        if (isT) {
          const end = map(this.routePoints(pos, rt, yt).slice(-1)[0]);
          const g = this.el('g', { transform: `translate(${end[0].toFixed(2)} ${(end[1] + (s.off === 0 ? -1.9 : 1.9)).toFixed(2)})` }, this.gRoutes);
          const label = ROUTES[rt].name;
          this.el('rect', { x: -label.length * 0.42 - 0.6, y: -0.85, width: label.length * 0.84 + 1.2, height: 1.7, rx: 0.4, class: 'f-rtag' }, g);
          this.el('text', { y: 0.42, class: 'f-rlab' }, g).textContent = label;
        }
      }
    }
    if (c.kind === 'run' || c.kind === 'rpo') {
      const from: Pt = c.carrier === 'QB' ? [CX, -1.6] : c.carrier === 'WR2' ? OFF_SET.WR2 : OFF_SET.RB;
      const out = (c.lane ?? (c.run ? CALL[c.run].lane : 'in')) === 'out';
      const pts: Pt[] = c.carrier === 'WR2'
        ? [from, [CX + 4, -4], [10, 2], [8, 7]]
        : [from, [CX + (out ? 3 : 0.5), -2], out ? [CX + 14, 1.5] : [CX + 1, 1], out ? [CX + 16, 6] : [CX + 1.5, 6]];
      line(pts.map((p) => [p[0], Math.min(p[1], yt)] as Pt), 'f-run');
    }
  }

  stop() {
    this.interrupt();
    cancelAnimationFrame(this.tweenRaf);
  }

  private interrupt() {
    cancelAnimationFrame(this.raf);
    const f = this.finish;
    this.finish = null;
    f?.();
  }

  private fx(kind: string, at: Pt, extra: Record<string, string | number> = {}) {
    if (kind === 'hit') {
      this.el('circle', { cx: at[0], cy: at[1], r: 1.2, class: 'fx-hit', ...extra }, this.gFx);
      this.el('circle', { cx: at[0], cy: at[1], r: 1.2, class: 'fx-hit late', ...extra }, this.gFx);
    } else if (kind === 'x') {
      const g = this.el('g', { transform: `translate(${at[0]} ${at[1]})`, class: 'fx-x' }, this.gFx);
      this.el('path', { d: 'M-1,-1 L1,1 M1,-1 L-1,1' }, g);
    } else if (kind === 'pick') {
      this.el('circle', { cx: at[0], cy: at[1], r: 1.5, class: 'fx-pick' }, this.gFx);
    } else if (kind === 'oob') {
      this.el('line', { x1: at[0], x2: at[0], y1: at[1] - 1.8, y2: at[1] + 1.8, class: 'fx-oob' }, this.gFx);
    } else if (kind === 'td') {
      this.el('rect', { x: 0, y: at[1], width: W, height: 10, class: 'fx-td' }, this.gFx);
    } else if (kind === 'spot') {
      this.el('line', { x1: 0, x2: W, y1: at[1], y2: at[1], class: 'fx-spot' }, this.gFx);
    }
  }

  /**
   * Animate one snap. speed: 1 normal, faster above 1, slower below (replays); 0 draws the final frame at once
   * (reduced motion). onOutcome fires when the play is decided on the field, so the caller can show the result at
   * that moment. The final frame stays on the field until the next setup().
   */
  play(ev: Ev, speed: number, onOutcome?: (o: Outcome) => void): Promise<void> {
    if (!this.teams || ev.type !== 'snap') { onOutcome?.('none'); return Promise.resolve(); }
    this.ensureDots();
    this.interrupt();
    cancelAnimationFrame(this.tweenRaf);
    const res = ev.res;
    const map = this.frame(ev.off, ev.yl0);
    const yt0 = 100 - ev.yl0;
    const tracks = new Map<string, Key[]>();
    const set = (k: string, keys: Key[]) => tracks.set(k, keys);
    const offStart = (pos: string): Pt => {
      const p = OFF_SET[pos];
      if (pos === 'QB' && (res.call === 'sneak' || res.kind === 'kneel' || res.kind === 'spike')) return [CX, -1.6];
      return [p[0], Math.max(p[1], -ev.yl0 - 8)];
    };
    const ds = defSet(res.look);
    const defStart = (pos: string): Pt => [ds[pos][0], Math.min(ds[pos][1], yt0 + 9)];
    let ball: Key[] = [];
    let air: [number, number, number] | null = null;   // [t0, t1, peak height] of a throw or kick
    let T = 1.2;
    let carrierKey: string | null = null;
    let tCarry = 0;                                       // when the final carrier has the ball
    let outcome: Outcome = 'tackle';

    for (const p of OFF_POS) { const s = offStart(p); set(`o:${p}`, [[0, s[0], s[1]]]); }
    for (const p of DEF_POS) { const s = defStart(p); set(`d:${p}`, [[0, s[0], s[1]]]); }

    if (res.kind === 'kneel' || res.kind === 'spike') {
      T = 1.1;
      outcome = 'none';
      set('o:QB', [[0, CX, -1.6], [0.5, CX, res.kind === 'kneel' ? -2.3 : -1.8]]);
      ball = [[0, CX, 0], [0.2, CX, -1.6], [0.5, CX, res.kind === 'kneel' ? -2.3 : -1.2]];
    } else if (res.kind === 'fg' || res.kind === 'punt') {
      outcome = 'kick';
      const fromDy = res.kind === 'fg' ? -7 : -14;
      const toDy = res.kind === 'fg' ? yt0 + 10 : Math.min(res.air ?? 40, yt0 + 10);
      T = res.kind === 'fg' ? 2.2 : 2.8;
      const wide = res.kind === 'fg' && !res.good && !res.blocked ? 4.5 : 0;
      set('o:QB', [[0, offStart('QB')[0], offStart('QB')[1]], [0.3, CX - 1, fromDy]]);
      ball = res.blocked
        ? [[0, CX, 0], [0.3, CX, fromDy], [0.65, CX, fromDy + 1.5], [T, CX + 3, fromDy - 3]]
        : [[0, CX, 0], [0.3, CX, fromDy], [T, CX + wide, toDy]];
      if (!res.blocked) air = [0.3, T, res.kind === 'fg' ? 9 : 14];
      for (const p of DEF_POS) { const s = defStart(p); set(`d:${p}`, [[0, s[0], s[1]], [T, s[0], Math.max(s[1] - 2, 0.6)]]); }
    } else {
      // the line: blockers step up, the front meets them (never through them)
      for (const p of ['LT', 'LG', 'C', 'RG', 'RT']) { const s = offStart(p); set(`o:${p}`, [[0, s[0], s[1]], [0.35, s[0], s[1] + 0.45], [Math.max(1.2, T), s[0], s[1] + 0.3]]); }
      for (const p of ['EDGE1', 'DL1', 'DL2', 'EDGE2']) { const s = defStart(p); set(`d:${p}`, [[0, s[0], s[1]], [0.35, s[0], 1.05]]); }
      const qb0 = offStart('QB');

      if (res.kind === 'run') {
        carrierKey = `o:${res.carrier}`;
        const out = res.lane === 'out';
        const side = res.side;
        let endX = Math.max(1.5, Math.min(W - 1.5, CX + side * (out ? 15 : 2.5) + (res.yards > 12 ? side * 4 : 0)));
        if (res.oob) endX = side < 0 ? 0.4 : W - 0.4;
        const endDy = res.yards;
        const tHand = 0.45;
        T = Math.min(4.4, 1.5 + Math.min(Math.abs(res.yards), 60) * 0.07);
        const c0 = offStart(res.carrier in OFF_SET ? res.carrier : 'RB');
        let track: Key[];
        if (res.carrier === 'QB') track = [[0, qb0[0], qb0[1]], [0.3, qb0[0] + side, qb0[1] + 0.5], [T, endX, endDy]];
        else if (res.carrier === 'WR2') track = [[0, c0[0], c0[1]], [0.55, CX + 2, -4], [0.75, CX - 2, -4], [T, W - endX, endDy]];
        else track = [[0, c0[0], c0[1]], [tHand, CX + side * 0.6, -3], [tHand + 0.4, CX + side * (out ? 5 : 1.2), Math.min(0, endDy - 0.5)], [T, endX, endDy]];
        set(carrierKey, track);
        if (res.carrier !== 'QB') set('o:QB', [[0, qb0[0], qb0[1]], [tHand, CX + side * 0.4, -3.6], [tHand + 0.6, CX - side * 2, -4.5]]);
        tCarry = res.carrier === 'QB' ? 0.15 : res.carrier === 'WR2' ? 0.65 : tHand;
        ball = [[0, CX, 0], [0.15, qb0[0], qb0[1]]];
        if (res.carrier !== 'QB') { const h = sampleRun(tracks.get('o:QB')!, tCarry); ball.push([tCarry - 0.05, h[0], h[1]]); }
        for (let t = tCarry; t <= T + 1e-6; t += 0.05) { const p = sampleRun(track, t); ball.push([t, p[0], p[1]]); }
        outcome = res.td ? 'td' : res.oob ? 'oob' : res.fumble ? 'pick' : 'tackle';
      } else if (res.kind === 'sack' || res.kind === 'scramble') {
        carrierKey = 'o:QB';
        const endDy = res.yards;
        T = res.kind === 'sack' ? 1.9 : Math.min(3.6, 1.9 + Math.abs(res.yards) * 0.06);
        const side = res.side;
        set('o:QB', res.kind === 'sack'
          ? [[0, qb0[0], qb0[1]], [0.55, CX, -7], [1.05, CX + side * 1.5, -7.5], [T, CX + side * 2, endDy]]
          : [[0, qb0[0], qb0[1]], [0.55, CX, -7], [1.15, CX + side * 6, -6], [T, res.oob ? (side < 0 ? 0.4 : W - 0.4) : CX + side * 14, endDy]]);
        if (res.kind === 'sack') set('d:EDGE1', [[0, defStart('EDGE1')[0], defStart('EDGE1')[1]], [0.35, CX - 6.5, 0.6], [1.05, CX + side * 1.5 - 1, -6.6], [T, CX + side * 2 - 0.8, endDy + 0.7]]);
        const qt = tracks.get('o:QB')!;
        for (let t = 0; t <= T + 1e-6; t += 0.05) { const p = t < 0.15 ? [CX, 0] as Pt : sampleRun(qt, t); ball.push([t, p[0], p[1]]); }
        this.routesFor(res.call, res.target, res.route ?? null, yt0, T, tracks, null);
        outcome = res.kind === 'sack' ? 'sack' : res.td ? 'td' : res.oob ? 'oob' : 'tackle';
      } else if (res.kind === 'pass') {
        const c = CALL[res.call];
        const drop = DROPS[c?.drop ?? 'quick'];
        const rpo = c?.kind === 'rpo';
        const tR = (rpo ? 1.3 : drop.release) * 0.55;
        const depth = res.air ?? 8;
        const tC = tR + flight(depth) * 0.95;
        const yac = res.complete ? res.yards - depth : 0;
        T = tC + (res.complete ? Math.max(0.7, Math.min(2.8, Math.abs(yac) * 0.08)) : res.intercepted ? 1.4 : 0.7);
        const roll = c?.drop === 'roll';
        const qbSpot: Pt = roll ? [CX + 9, -6] : rpo ? [CX, -4.5] : [CX, -7];
        set('o:QB', [[0, qb0[0], qb0[1]], [Math.min(0.55, tR), qbSpot[0], qbSpot[1]], [T, qbSpot[0], qbSpot[1] + 0.3]]);
        if (c?.pa || c?.drop === 'flea') set('o:RB', [[0, OFF_SET.RB[0], OFF_SET.RB[1]], [0.35, CX + 0.6, -3], [0.95, CX + 2, -0.4]]);
        const tgt = res.target!;
        const catchPt = this.routesFor(res.call, tgt, res.route ?? null, yt0, tC, tracks, depth);
        ball = [[0, CX, 0], [0.12, qb0[0], qb0[1]], [tR, qbSpot[0], qbSpot[1]], [tC, catchPt[0], catchPt[1]]];
        air = [tR, tC, Math.min(7, 1 + Math.abs(depth) * 0.22)];
        if (res.complete) {
          carrierKey = `o:${tgt}`;
          tCarry = tC;
          const tr = tracks.get(carrierKey)!;
          const endX = Math.max(1.5, Math.min(W - 1.5, catchPt[0] + (res.oob ? (catchPt[0] < CX ? -catchPt[0] + 0.4 : W - catchPt[0] - 0.4) : yac * 0.15)));
          tr.push([T, endX, res.yards]);
          for (let t = tC + 0.05; t <= T + 1e-6; t += 0.05) { const p = sampleRun(tr, t); ball.push([t, p[0], p[1]]); }
          outcome = res.td ? 'td' : res.oob ? 'oob' : res.fumble ? 'pick' : 'tackle';
        } else if (res.intercepted) {
          carrierKey = `d:${res.carrier}`;
          tCarry = tC;
          const s0 = defStart(res.carrier);
          const back = Math.max(-8, depth - (res.retYds ?? 0));
          const tr: Key[] = [[0, s0[0], s0[1]], [tC, catchPt[0] + 0.8, catchPt[1] + 0.6], [T, catchPt[0] + 2, back]];
          set(carrierKey, tr);
          for (let t = tC + 0.05; t <= T + 1e-6; t += 0.05) { const p = sampleRun(tr, t); ball.push([t, p[0], p[1]]); }
          outcome = 'pick';
        } else {
          // incomplete: the ball skips off the turf past the receiver
          ball.push([tC + 0.3, catchPt[0] + 0.8, catchPt[1] + 1.6], [T, catchPt[0] + 1.2, catchPt[1] + 2.2]);
          outcome = 'drop';
        }
      }
      // the defense: cover first, then rally. One defender (the closest) makes the tackle right where the play ends;
      // nobody stands next to a runner with room to run, and a runner who scores leaves them trailing.
      const endPt: Pt = ball.length ? [ball[ball.length - 1][1], ball[ball.length - 1][2]] : [CX, 0];
      const mid = ball.length ? sample(ball, T * 0.55) : [CX, 4];
      const tackled = !!carrierKey && carrierKey.startsWith('o:') && !res.td && !res.fumble;
      const pool = ['EDGE1', 'DL1', 'DL2', 'EDGE2', 'LB1', 'LB2', 'LB3', 'CB1', 'CB2', 'S1', 'S2']
        .filter((p) => `d:${p}` !== carrierKey && !(res.kind === 'sack' && p === 'EDGE1'));
      let tackler: string | null = null;
      if (tackled) {
        let best = Infinity;
        for (const p of pool) {
          const st = defStart(p);
          const d = Math.hypot(st[0] - endPt[0], st[1] - endPt[1]);
          if (d < best) { best = d; tackler = p; }
        }
      }
      for (const p of pool) {
        const s0 = defStart(p);
        const front = p.startsWith('DL') || p.startsWith('EDGE');
        const shadow = p === 'CB1' ? 'o:WR1' : p === 'CB2' ? 'o:WR2' : null;
        const keys: Key[] = [[0, s0[0], s0[1]]];
        if (front) keys.push([0.35, s0[0], 1.05], [0.9, s0[0] + (s0[0] < CX ? 0.6 : -0.6), 0.5]);
        else if (shadow && tracks.get(shadow)!.length > 1) {
          const tr = tracks.get(shadow)!;
          for (let t = 0.3; t < T * 0.6; t += 0.3) { const q = sampleRun(tr, t); keys.push([t, q[0] + (q[0] < CX ? 0.9 : -0.9), q[1] + 1.4]); }
        } else keys.push([T * 0.5, lerp(s0[0], mid[0], 0.4), lerp(s0[1], mid[1], 0.4)]);
        const last = keys[keys.length - 1];
        // after a takeaway the front turns and watches; it never runs back through the offensive line
        if (front && carrierKey?.startsWith('d:')) { set(`d:${p}`, keys); continue; }
        if (p === tackler) {
          // close in, then wrap him up from the downfield side
          const fx = endPt[0] + (endPt[0] < CX ? 0.6 : -0.6), fy = endPt[1] + 1.0;
          if (last[0] < T - 0.3) keys.push([T - 0.3, lerp(last[1], fx, 0.75), lerp(last[2], fy, 0.75)]);
          keys.push([T, fx, fy]);
        } else {
          const d = Math.hypot(last[1] - endPt[0], last[2] - endPt[1]);
          const close = carrierKey ? Math.max(0.35, Math.min(0.85, 1 - d / 45)) : 0.4;
          let fy = lerp(last[2], endPt[1], close);
          if (res.td && carrierKey?.startsWith('o:')) fy = Math.min(fy, endPt[1] - 2);   // chasing, not catching
          keys.push([Math.max(T, last[0] + 0.1), lerp(last[1], endPt[0], close), fy]);
        }
        set(`d:${p}`, keys);
      }
    }

    // run the timeline: the play, then a short hold on the final frame so the outcome registers
    const PRE = 0.35;       // the snap count: the picture is set, nothing moves
    const HOLD = 0.5;       // the outcome registers before the caller moves on
    const total = PRE + T + HOLD;
    const dur = speed > 0 ? total / speed : 0;
    const dir = ev.off === 0 ? 1 : -1;
    const ballU0 = ev.off === 0 ? ev.yl0 : 100 - ev.yl0;
    // frame the whole play: from behind the line to its deepest point
    const far = Math.max(res.kind === 'fg' ? yt0 + 10 : res.air ?? 0, res.yards, 0);
    if (far > this.viewH - this.camLead() - 18) this.camTarget = this.clampCam(ballU0 + dir * Math.min(far / 2 + 2, 48));
    else this.camTarget = this.clampCam(ballU0 + dir * this.camLead());
    if (speed > 0) this.pan();
    this.gRoutes.innerHTML = '';
    this.gFx.innerHTML = '';
    const carrierDot = carrierKey ? this.dots.get(carrierKey) : null;
    let fired = false, trailDrawn = false;
    const endPt = ball.length ? map([ball[ball.length - 1][1], ball[ball.length - 1][2]]) : map([CX, 0]);

    return new Promise((done) => {
      const resolve = () => { this.finish = null; done(); };
      this.finish = done;
      const t0 = performance.now();
      const step = (now: number) => {
        const f = dur > 0 ? Math.min(1, (now - t0) / 1000 / dur) : 1;
        const t = Math.max(0, f * total - PRE);
        tracks.forEach((tr, k) => this.place(k, map(sampleRun(tr, t))));
        if (carrierDot) carrierDot.g.classList.toggle('carrier', t >= tCarry);
        if (ball.length) {
          const bp = map(sample(ball, t));
          let h = 0, scale = 1;
          if (air && t >= air[0] && t <= air[1]) {
            const g = (t - air[0]) / (air[1] - air[0]);
            h = Math.sin(g * Math.PI) * air[2];
            scale = 1 + h * 0.06;
            if (!trailDrawn) {
              trailDrawn = true;
              const a = map(sample(ball, air[0])), b = map(sample(ball, air[1]));
              this.el('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], class: 'f-trail' }, this.gFx);
            }
          }
          this.setBall(bp, h, scale);
          // keep the ball in frame
          const u = 110 - bp[1];
          const margin = this.viewH * 0.5 - 5;
          if (Math.abs(u - this.cam) > margin) { this.camTarget = this.clampCam(u - Math.sign(u - this.cam) * margin); this.pan(); }
        }
        if (!fired && t >= T) {
          fired = true;
          this.outcomeFx(outcome, res, endPt, ev);
          onOutcome?.(outcome);
        }
        if (outcome === 'drop' && t > T) { const o = String(Math.max(0.25, 1 - (t - T) / HOLD)); this.ball.style.opacity = o; this.ballLace.style.opacity = o; }
        if (f < 1) this.raf = requestAnimationFrame(step);
        else resolve();
      };
      if (dur > 0) this.raf = requestAnimationFrame(step);
      else { if (!dur && ball.length) { this.cam = this.camTarget = this.clampCam(110 - map(sample(ball, T))[1]); this.applyCam(); } step(performance.now()); }
    });
  }

  private outcomeFx(o: Outcome, res: Extract<Ev, { type: 'snap' }>['res'], at: Pt, ev: Extract<Ev, { type: 'snap' }>) {
    if (o === 'tackle' || o === 'sack') this.fx('hit', at);
    else if (o === 'drop') this.fx('x', at);
    else if (o === 'pick') this.fx('pick', at);
    else if (o === 'oob') this.fx('oob', [at[0] < W / 2 ? 0 : W, at[1]]);
    if (res.td) {
      // the end zone the offense attacks: theirs (top) when you have it, yours (bottom) when they do
      const scorerTop = (ev.off === 0) !== !!res.defTd;
      this.fx('td', [0, scorerTop ? 0 : 110]);
    }
    if (o === 'tackle' || o === 'oob' || o === 'sack') this.fx('spot', at);
  }

  /** Receivers' routes as tracks; returns the target's catch point. */
  private routesFor(call: string, tgt: Rcv | undefined, route: RouteId | null, yt: number, tEnd: number, tracks: Map<string, Key[]>, air: number | null): Pt {
    const c = CALL[call];
    let catchPt: Pt = [CX, 8];
    if (!c?.routes) return catchPt;
    for (const pos of RECEIVERS) {
      if (pos === 'RB' && (c.pa || c.drop === 'flea') && pos !== tgt) continue;
      const rt = pos === tgt && route ? route : c.routes[pos];
      const pts = this.routePoints(pos, rt, yt, pos === tgt && air != null ? air : undefined);
      // spread the points over the time by distance run
      const lens = [0];
      for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      const total = lens[lens.length - 1] || 1;
      const t0 = 0.12;
      const keys: Key[] = pts.map((p, i) => [t0 + (tEnd - t0) * (lens[i] / total), p[0], p[1]]);
      tracks.set(`o:${pos}`, keys);
      if (pos === tgt) catchPt = pts[pts.length - 1];
    }
    return catchPt;
  }
}
