/**
 * The field: an SVG drawn in yards (x across, 0-53.3; y down the field). Your end zone is at the bottom, theirs at
 * the top. Offense is drawn as blue circles and defense as light diamonds for every team. Players are positioned in the offense's frame ([x from the offense's left sideline, yards past the line])
 * and mapped onto the field, so the same formation code works whichever way the offense is going.
 *
 * The camera is a window onto the field whose height follows the element's aspect ratio (resize()), so the field
 * fills whatever space the layout gives it. The renderer is plain DOM so the animation loop never goes through React.
 *
 * Lifecycle of a snap: setup() draws the pre-snap picture (players jog into it from where they were), play()
 * animates the engine's result and calls onOutcome at the moment the play is decided (tackle, catch, drop, kick),
 * then holds the final frame; the next setup() jogs everyone to the new spot.
 */
import { CALL, DEF_POS, OFF_POS, POS_LABEL, RECEIVERS, ROUTES } from '../engine/data';
import { CX, DESIGN, W, defAlign, formation, type Pt } from '../engine/formation';
import { hash } from '../engine/rng';
import { choreograph, routePoints, type BallKey, type Key, type Timeline } from '../engine/timeline';
import { kickoffTimeline, patTimeline } from '../engine/kicks';
import type { Ev, Look, Rcv, RouteId, State, Team, TeamInfo } from '../engine/types';

const NS = 'http://www.w3.org/2000/svg';

const lerp = (a: number, b: number, f: number) => a + (b - a) * f;
const easeInOut = (f: number) => (f < 0.5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2);

function hexRgb(h: string): [number, number, number] {
  const m = h.replace('#', '');
  const n = parseInt(m.length === 3 ? m.split('').map((c) => c + c).join('') : m, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
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

interface Dot { g: SVGGElement; body: SVGElement; ring: SVGElement; lab: SVGTextElement; name: SVGTextElement }

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
  /** Hover/focus on a player: which side ('o' offense, 'd' defense) and position; nulls when the pointer leaves. */
  onInspect: ((side: 'o' | 'd' | null, pos: string | null) => void) | null = null;

  constructor(svg: SVGSVGElement) {
    this.svg = svg;
    svg.innerHTML = '';
    this.gField = this.el('g', { class: 'f-field' }) as SVGGElement;
    this.gMarks = this.el('g', { class: 'f-marks' }) as SVGGElement;
    this.gRoutes = this.el('g', { class: 'f-routes' }) as SVGGElement;
    this.gFx = this.el('g', { class: 'f-fx' }) as SVGGElement;
    this.gPlayers = this.el('g', { class: 'f-players' }) as SVGGElement;
    const defs = this.el('defs', {});
    const head = (id: string, fill: string, size: number) => `<marker id="${id}" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="${size}" markerHeight="${size}" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="${fill}"/></marker>`;
    defs.innerHTML = head('ah-tgt', '#f5c518', 3.2) + head('ah-dec', '#ffffff', 3.6) + head('ah-run', '#f0a43a', 3) + head('ah-dir', 'rgba(255,255,255,.7)', 3.4);
    this.shadow = this.el('ellipse', { rx: 0.5, ry: 0.3, class: 'f-ball-sh' }) as SVGEllipseElement;
    this.ball = this.el('ellipse', { rx: 0.42, ry: 0.7, class: 'f-ball' }) as SVGEllipseElement;
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
          ? this.el('circle', { r: 1.12, class: 'f-ring' }, g)
          : this.el('rect', { x: -1.02, y: -1.02, width: 2.04, height: 2.04, rx: 0.3, transform: 'rotate(45)', class: 'f-ring' }, g);
        const body = side === 'o'
          ? this.el('circle', { r: 0.86, class: 'f-body' }, g)
          : this.el('rect', { x: -0.74, y: -0.74, width: 1.48, height: 1.48, rx: 0.2, transform: 'rotate(45)', class: 'f-body' }, g);
        const lab = this.el('text', { y: 0.3, class: 'f-lab' }, g) as SVGTextElement;
        lab.textContent = POS_LABEL[pos];
        // linemen stand a yard apart: their names would overlap, so they go by number only
        const crowded = ['LT', 'LG', 'C', 'RG', 'RT', 'EDGE1', 'DL1', 'DL2', 'EDGE2'].includes(pos);
        const name = this.el('text', { y: 2.05, class: crowded ? 'f-name f-name-line' : 'f-name' }, g) as SVGTextElement;
        if (side === 'o' && (RECEIVERS as string[]).includes(pos)) {
          g.addEventListener('click', () => this.onTap?.(pos as Rcv));
          // Enter on a focused receiver retargets the throw; it must not also reach the panel's Enter-to-snap
          g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); this.onTap?.(pos as Rcv); } });
          g.setAttribute('data-rcv', pos);
        }
        // details on hover or keyboard focus, never on the field all the time
        const show = () => this.onInspect?.(side, pos);
        const hide = () => this.onInspect?.(null, null);
        g.addEventListener('mouseenter', show);
        g.addEventListener('mouseleave', hide);
        g.addEventListener('focus', show);
        g.addEventListener('blur', hide);
        this.el('title', {}, g).textContent = pos;
        this.dots.set(`${side}:${pos}`, { g, body, ring, lab, name });
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
    const live = s.stage === 'pre' || s.stage === 'call' || s.stage === 'over';
    this.gPlayers.classList.toggle('dim', !live);
    this.gFx.innerHTML = '';
    const targets = new Map<string, Pt>();
    const off = s.off, def: Team = off === 0 ? 1 : 0;
    const passCall = !!pv.routes && !!pv.play && CALL[pv.play]?.kind === 'pass' && pv.play !== 'hail' && off === 0;
    const fm = formation(DESIGN[pv.play ?? '']?.formation ?? 'gun');
    for (const pos of OFF_POS) {
      let p = fm[pos];
      if (pos === 'QB' && pv.play === 'kneel') p = [CX, -1.6];
      p = [p[0], Math.max(p[1], -s.yl - 8)];
      const d = this.dots.get(`o:${pos}`)!;
      const pl = T[off].players[pos];
      this.paint(d, 'o', pl, pos);
      d.g.classList.toggle('tgt', pv.target === pos || (!!pv.play && passCall && !pv.target && CALL[pv.play]?.tgt === pos));
      const tappable = passCall && (RECEIVERS as string[]).includes(pos);
      d.g.classList.toggle('tappable', tappable);
      if (tappable) { d.g.setAttribute('tabindex', '0'); d.g.setAttribute('role', 'button'); d.g.setAttribute('aria-label', `Throw to ${pl?.name}, ${pos}`); }
      else { d.g.removeAttribute('tabindex'); d.g.removeAttribute('role'); d.g.removeAttribute('aria-label'); }
      d.g.classList.remove('carrier');
      d.g.querySelector('title')!.textContent = `${pl?.name} · ${pos} · rated ${pl?.rating}`;
      targets.set(`o:${pos}`, map(p));
    }
    const ds = defAlign(pv.look ?? null);
    for (const pos of DEF_POS) {
      const p = ds[pos];
      const d = this.dots.get(`d:${pos}`)!;
      const pl = T[def].players[pos];
      this.paint(d, 'd', pl, pos);
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
    this.el('line', { x1: a1[0], x2: a2[0], y1: a1[1], y2: a2[1], class: 'f-dir', 'marker-end': 'url(#ah-dir)' }, this.gMarks);

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

  /** Offense and defense look the same for every team: blue circles and light diamonds, for an instant read. */
  private paint(d: Dot, side: 'o' | 'd', pl: { name: string; number?: number } | undefined, pos: string) {
    d.body.setAttribute('class', `f-body ${side === 'o' ? 'f-body-o' : 'f-body-d'}`);
    d.lab.setAttribute('class', `f-lab ${side === 'o' ? 'f-lab-o' : 'f-lab-d'}`);
    d.lab.textContent = pl?.number != null ? String(pl.number) : POS_LABEL[pos];
    d.name.textContent = pl ? shortName(pl.name) : '';
  }

  private setBall(p: Pt, h: number, scale: number) {
    // h: height of the ball in yards; it rises toward the viewer, so it is drawn above its shadow
    this.shadow.setAttribute('cx', p[0].toFixed(2));
    this.shadow.setAttribute('cy', p[1].toFixed(2));
    this.shadow.style.opacity = h > 0.3 ? String(Math.max(0.15, 0.5 - h * 0.03)) : '0';
    const y = p[1] - h * 0.45;
    this.ball.setAttribute('cx', p[0].toFixed(2));
    this.ball.setAttribute('cy', y.toFixed(2));
    this.ball.setAttribute('rx', (0.42 * scale).toFixed(2));
    this.ball.setAttribute('ry', (0.7 * scale).toFixed(2));
    this.ballLace.setAttribute('x1', p[0].toFixed(2));
    this.ballLace.setAttribute('x2', p[0].toFixed(2));
    this.ballLace.setAttribute('y1', (y - 0.32 * scale).toFixed(2));
    this.ballLace.setAttribute('y2', (y + 0.32 * scale).toFixed(2));
    this.ball.style.opacity = this.ballLace.style.opacity = '1';
  }

  private drawPreview(s: State, pv: Preview) {
    this.gRoutes.innerHTML = '';
    if (!pv.routes || !pv.play) return;
    const map = this.frame(s.off, s.yl);
    const c = CALL[pv.play];
    const design = DESIGN[pv.play];
    if (!c || !design) return;
    const yt = 100 - s.yl;
    const fm = formation(design.formation);
    const line = (pts: Pt[], cls: string) => {
      const d = pts.map((p, i) => `${i ? 'L' : 'M'}${map(p)[0].toFixed(2)},${map(p)[1].toFixed(2)}`).join(' ');
      this.el('path', { d, class: `${cls} under` }, this.gRoutes);
      const head = cls.includes('tgt') ? 'ah-tgt' : cls.includes('run') ? 'ah-run' : 'ah-dec';
      this.el('path', { d, class: cls, 'marker-end': `url(#${head})` }, this.gRoutes);
    };
    const pts = (pos: Rcv, rt: RouteId) => routePoints(fm[pos], rt, rt === 'hail' ? Math.min(yt + 3, 55) : Math.min(ROUTES[rt].depth, yt + 4), yt);
    if (c.routes && c.kind === 'pass') {
      const tgt = pv.target ?? c.tgt;
      // decoys first, the target's route on top. Blockers run no route.
      const running = RECEIVERS.filter((r) => !((r === 'RB' && design.rb !== 'route') || (r === 'TE' && design.te !== 'route')) || r === tgt);
      for (const pos of [...running.filter((r) => r !== tgt), tgt!]) {
        const isT = tgt === pos;
        const rt = isT && pv.route ? pv.route : c.routes[pos];
        const ps = pts(pos, rt);
        line(ps, isT ? 'f-route tgt' : 'f-route');
        if (isT) {
          const end = map(ps[ps.length - 1]);
          const g = this.el('g', { transform: `translate(${end[0].toFixed(2)} ${(end[1] + (s.off === 0 ? -1.9 : 1.9)).toFixed(2)})` }, this.gRoutes);
          const label = ROUTES[rt].name;
          this.el('rect', { x: -label.length * 0.42 - 0.6, y: -0.85, width: label.length * 0.84 + 1.2, height: 1.7, rx: 0.4, class: 'f-rtag' }, g);
          this.el('text', { y: 0.42, class: 'f-rlab' }, g).textContent = label;
        }
      }
    }
    if (c.kind === 'run' || c.kind === 'rpo') {
      const side = design.side ?? 1;
      const holeX = Math.max(2, Math.min(W - 2, CX + side * (design.hole ?? 1.5)));
      const from: Pt = design.carrier === 'QB' ? fm.QB : design.carrier === 'WR2' ? fm.WR2 : fm.RB;
      const wide = Math.abs(design.hole ?? 0) >= 8;
      const run: Pt[] = design.carrier === 'WR2'
        ? [from, [CX + 2, -4.8], [CX - 4, -4.6], [holeX, -1], [holeX - 3, 6]]
        : [from, [CX + side * 0.8, -4], [holeX, -0.2], [holeX + side * (wide ? 4 : 1), 6]];
      line(run.map((p) => [p[0], Math.min(p[1], yt)] as Pt), 'f-run');
      if (c.kind === 'rpo' && c.routes && c.tgt) line(pts(c.tgt, c.routes[c.tgt]), 'f-route');
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
   * Animate one snap: build its timeline (engine/timeline.ts) from the engine's result and draw it. speed: 1 normal,
   * faster above 1, slower below (replays); 0 draws the final frame at once (reduced motion). onOutcome fires when the
   * play is decided on the field. The final frame stays until the next setup().
   */
  play(ev: Ev, speed: number, onOutcome?: (o: Outcome) => void): Promise<void> {
    if (!this.teams || ev.type !== 'snap') { onOutcome?.('none'); return Promise.resolve(); }
    this.ensureDots();
    this.interrupt();
    cancelAnimationFrame(this.tweenRaf);
    const res = ev.res;
    const T = this.teams;
    const map = this.frame(ev.off, ev.yl0);
    const seed = hash(ev.t0, ev.yl0, ev.down0, ev.off, res.call, res.kind, res.yards, res.carrier, res.target ?? '', res.route ?? '');
    const tl: Timeline = choreograph({ res, yl0: ev.yl0, off: T[ev.off].rat, def: T[ev.off === 0 ? 1 : 0].rat, seed });
    const outcome: Outcome = res.kind === 'kneel' || res.kind === 'spike' ? 'none' : res.kind === 'fg' || res.kind === 'punt' ? 'kick'
      : res.kind === 'sack' ? 'sack' : res.intercepted || res.fumble ? 'pick' : res.td ? 'td' : res.oob ? 'oob' : res.kind === 'pass' && !res.complete ? 'drop' : 'tackle';
    return this.runTimeline(tl, ev, map, outcome, speed, onOutcome);
  }

  /** A kickoff, free kick or onside kick, drawn in the kicking team's frame. */
  playKick(ev: Extract<Ev, { type: 'kick' }>, speed: number, onOutcome?: (o: Outcome) => void): Promise<void> {
    if (!this.teams) { onOutcome?.('none'); return Promise.resolve(); }
    this.ensureDots();
    this.interrupt();
    cancelAnimationFrame(this.tweenRaf);
    const T = this.teams;
    const seed = hash(ev.t, ev.kind, ev.kicker, ev.yl, ev.touchback ? 1 : 0, ev.td ? 1 : 0);
    const { tl, res, yl0 } = kickoffTimeline(ev, T[ev.kicker].rat, T[ev.kicker === 0 ? 1 : 0].rat, seed);
    this.lastOff = ev.kicker;
    for (const k of OFF_POS) this.paint(this.dots.get('o:' + k)!, 'o', T[ev.kicker].players[k], k);
    for (const k of DEF_POS) this.paint(this.dots.get('d:' + k)!, 'd', T[ev.kicker === 0 ? 1 : 0].players[k], k);
    const fake = { type: 'snap', off: ev.kicker, yl0, down0: 1, dist0: 10, t0: ev.t, t: ev.t, res, first: false } as Extract<Ev, { type: 'snap' }>;
    return this.runTimeline(tl, fake, this.frame(ev.kicker, yl0), 'kick', speed, onOutcome);
  }

  /** The try after a touchdown: an extra point from the 15, or a two-point snap from the 2. */
  playPat(ev: Extract<Ev, { type: 'pat' }>, speed: number, onOutcome?: (o: Outcome) => void): Promise<void> {
    if (!this.teams) { onOutcome?.('none'); return Promise.resolve(); }
    this.ensureDots();
    this.interrupt();
    cancelAnimationFrame(this.tweenRaf);
    const T = this.teams;
    const seed = hash(ev.t, ev.off, ev.two ? 'two' : 'xp', ev.good ? 1 : 0);
    const { tl, res, yl0 } = patTimeline(ev, T[ev.off].rat, T[ev.off === 0 ? 1 : 0].rat, seed);
    this.lastOff = ev.off;
    for (const k of OFF_POS) this.paint(this.dots.get('o:' + k)!, 'o', T[ev.off].players[k], k);
    for (const k of DEF_POS) this.paint(this.dots.get('d:' + k)!, 'd', T[ev.off === 0 ? 1 : 0].players[k], k);
    const fake = { type: 'snap', off: ev.off, yl0, down0: 1, dist0: 100 - yl0, t0: ev.t, t: ev.t, res, first: false } as Extract<Ev, { type: 'snap' }>;
    return this.runTimeline(tl, fake, this.frame(ev.off, yl0), 'kick', speed, onOutcome);
  }

  private runTimeline(tl: Timeline, ev: Extract<Ev, { type: 'snap' }>, map: (p: Pt) => Pt, outcome: Outcome, speed: number, onOutcome?: (o: Outcome) => void): Promise<void> {
    const res = ev.res;
    this.gMarks.innerHTML = '';
    const los = map([CX, 0]);
    if (res.kind !== 'kickoff') this.el('line', { x1: 0, x2: W, y1: los[1], y2: los[1], class: 'f-los' }, this.gMarks);

    const PRE = 0.35, HOLD = 0.5;
    const total = PRE + tl.end + HOLD;
    const T = this.teams!;
    void T;
    // a long return or breakaway plays faster, like a broadcast cut: no play takes more than ~9 s of real time
    const squeeze = total > 9 ? 9 / total : 1;
    const dur = speed > 0 ? (total * squeeze) / speed : 0;
    const dir = ev.off === 0 ? 1 : -1;
    const ballU0 = ev.off === 0 ? ev.yl0 : 100 - ev.yl0;
    const far = Math.max(res.kind === 'fg' ? 100 - ev.yl0 + 10 : res.air ?? 0, res.yards, 0);
    if (far > this.viewH - this.camLead() - 18) this.camTarget = this.clampCam(ballU0 + dir * Math.min(far / 2 + 2, 48));
    else this.camTarget = this.clampCam(ballU0 + dir * this.camLead());
    if (speed > 0) this.pan();
    this.gRoutes.innerHTML = '';
    this.gFx.innerHTML = '';

    const fired = new Set<number>();
    let decided = false, trail = false;
    const carrierAt = (t: number) => { let k: string | null = null; for (const c of tl.carrier) if (c.t <= t) k = c.key; return k; };
    const dropAt = tl.events.find((e) => e.kind === 'incomplete')?.t;

    return new Promise((done) => {
      const resolve = () => { this.finish = null; done(); };
      this.finish = done;
      const t0 = performance.now();
      const step = (now: number) => {
        const f = dur > 0 ? Math.min(1, (now - t0) / 1000 / dur) : 1;
        const t = Math.max(0, f * total - PRE);
        for (const k in tl.tracks) this.place(k, map(trackAt(tl.tracks[k], t)));
        const ck = t >= 0.12 ? carrierAt(t) : null;
        this.dots.forEach((d, k) => d.g.classList.toggle('carrier', k === ck && k !== 'o:C'));
        const b = ballAt(tl.ball, t);
        this.setBall(map([b.x, b.dy]), b.h, 1 + b.h * 0.06);
        if (tl.throwT != null && tl.catchT != null && !trail && t >= tl.throwT) {
          trail = true;
          const ta = ballAt(tl.ball, tl.throwT), tc = ballAt(tl.ball, tl.catchT);
          const a = map([ta.x, ta.dy]), c = map([tc.x, tc.dy]);
          this.el('line', { x1: a[0], y1: a[1], x2: c[0], y2: c[1], class: 'f-trail' }, this.gFx);
        }
        // keep the ball in frame
        const u = 110 - map([b.x, b.dy])[1];
        const margin = this.viewH * 0.5 - 5;
        if (Math.abs(u - this.cam) > margin) { this.camTarget = this.clampCam(u - Math.sign(u - this.cam) * margin); this.pan(); }
        // events, as they happen
        tl.events.forEach((e, i) => {
          if (fired.has(i) || t < e.t) return;
          fired.add(i);
          this.eventFx(e.kind, e.at ? map(e.at) : map([b.x, b.dy]), res, ev);
        });
        if (!decided && t >= tl.decisive) { decided = true; onOutcome?.(outcome); }
        if (dropAt != null && t > dropAt) { const o = String(Math.max(0.25, 1 - (t - dropAt) / 0.6)); this.ball.style.opacity = o; this.ballLace.style.opacity = o; }
        if (f < 1) this.raf = requestAnimationFrame(step);
        else resolve();
      };
      if (dur > 0) this.raf = requestAnimationFrame(step);
      else { this.cam = this.camTarget = this.clampCam(110 - map([ballAt(tl.ball, tl.end).x, ballAt(tl.ball, tl.end).dy])[1]); this.applyCam(); step(performance.now()); }
    });
  }

  /** What the viewer sees when something happens: a mark on the turf and a short call-out at the spot. */
  private eventFx(kind: string, at: Pt, res: Ev extends { type: 'snap' } ? never : Extract<Ev, { type: 'snap' }>['res'], ev: Extract<Ev, { type: 'snap' }>) {
    const good = ev.off === 0;
    switch (kind) {
      case 'catch': this.callout('CATCH', at, 'neutral', 0.9); break;
      case 'incomplete': this.fx('x', at); this.callout('INCOMPLETE', at, good ? 'bad' : 'good'); break;
      case 'int': this.fx('pick', at); this.callout('INTERCEPTED', at, good ? 'bad' : 'good'); break;
      case 'sack': this.fx('hit', at); this.callout('SACKED', at, good ? 'bad' : 'good'); break;
      case 'fumble': this.fx('hit', at); this.callout('FUMBLE', at, good ? 'bad' : 'good'); break;
      case 'tackle': this.fx('hit', at); this.fx('spot', at); this.callout(res.yards >= 0 ? `TACKLED · +${res.yards}` : `TACKLED · −${-res.yards}`, at, 'neutral'); break;
      case 'oob': this.fx('oob', [at[0] < W / 2 ? 0 : W, at[1]]); this.fx('spot', at); this.callout('OUT OF BOUNDS', at, 'neutral'); break;
      case 'td': {
        const scorerTop = good !== !!res.defTd;
        this.fx('td', [0, scorerTop ? 0 : 110]);
        this.callout('TOUCHDOWN', at, good !== !!res.defTd ? 'good' : 'bad', 2.2);
        break;
      }
      case 'good': this.fx('td', [0, good ? 0 : 110]); this.callout(res.call === 'xp' || res.call === 'fg' ? "IT'S GOOD!" : 'GOOD · 2 POINTS', at, good ? 'good' : 'bad', 2.2); break;
      case 'nogood': this.fx('x', at); this.callout('NO GOOD', at, good ? 'bad' : 'good', 2.2); break;
      case 'blocked': this.fx('hit', at); this.callout('BLOCKED!', at, good ? 'bad' : 'good', 2.2); break;
      case 'touchback': this.callout('TOUCHBACK', at, 'neutral', 1.6); break;
      case 'return': this.fx('hit', at); this.fx('spot', at); this.callout(`RETURN · ${res.retYds ?? 0} YDS`, at, 'neutral'); break;
      case 'recover': this.fx('hit', at); this.callout(res.call === 'onside' ? (ev.off === 0 ? 'ONSIDE RECOVERED!' : 'THEY RECOVER') : 'RECOVERED', at, ev.off === 0 ? 'good' : 'bad', 2); break;
      default: break;
    }
  }

  /** A short text box on the field, like a broadcast graphic, at the spot of the play. */
  private callout(text: string, at: Pt, tone: 'good' | 'bad' | 'neutral', secs = 1.6) {
    const g = this.el('g', { class: `fx-call ${tone}`, style: `--life:${secs}s` }, this.gFx);
    const x = Math.max(7, Math.min(W - 7, at[0]));
    const y = Math.max(3, at[1] - 2.4);
    const w = text.length * 0.78 + 2.4;
    this.el('rect', { x: x - w / 2, y: y - 1.25, width: w, height: 2.5, rx: 0.5, class: 'fx-call-box' }, g);
    this.el('text', { x, y: y + 0.45, class: 'fx-call-text' }, g).textContent = text;
  }
}

/** Where a track is at time t (keyframes every 0.05 s; linear in between). */
function trackAt(tr: Key[], t: number): Pt {
  if (!tr.length) return [CX, 0];
  if (t <= tr[0][0]) return [tr[0][1], tr[0][2]];
  let lo = 0, hi = tr.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (tr[m][0] <= t) lo = m; else hi = m; }
  const a = tr[lo], b = tr[hi];
  if (t >= b[0]) return [b[1], b[2]];
  const f = (t - a[0]) / (b[0] - a[0] || 1);
  return [a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

function ballAt(bk: BallKey[], t: number): BallKey {
  if (!bk.length) return { t, x: CX, dy: 0, h: 0 };
  if (t <= bk[0].t) return bk[0];
  let lo = 0, hi = bk.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (bk[m].t <= t) lo = m; else hi = m; }
  const a = bk[lo], b = bk[hi];
  if (t >= b.t) return b;
  const f = (t - a.t) / (b.t - a.t || 1);
  return { t, x: a.x + (b.x - a.x) * f, dy: a.dy + (b.dy - a.dy) * f, h: a.h + (b.h - a.h) * f };
}

/** "Bijan Robinson" → "B. Robinson"; suffixes stay with the last name. */
export function shortName(full: string): string {
  const parts = full.trim().split(/\s+/);
  if (parts.length < 2) return full;
  return `${parts[0][0]}. ${parts.slice(1).join(' ')}`;
}

