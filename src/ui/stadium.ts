/**
 * The stadium around the field, drawn into the field's SVG in yards (x across, 0-W; y down the field, the far end
 * line at 0 and yours at 120):
 *
 *   festive end zones   each team's color, a faint pinstripe, a border and an outlined name in its second color, pylons
 *   the field           arrows by the yard numbers pointing to the nearer goal, a midfield emblem in the home colors
 *   behind each end     the goal post (seen a little from above: the uprights lean up the screen), a padded wall with
 *                       the team's name, its cheer squad waving pom-poms, and a crowd mostly in the home team's colors
 *
 * Names and colors only, no logos. The same game always draws the same squad and crowd (seeded by the teams). The
 * squads and crowds animate in CSS (stylesheet: .f-squad, .f-crowd), so reduced motion stills them; hype() makes
 * them jump on a score.
 */
import { hash, rng } from '../engine/rng';
import type { TeamInfo } from '../engine/types';

type El = (tag: string, attrs: Record<string, string | number>, parent?: Element) => SVGElement;

/** Yards of stadium behind each end line (the camera shows the first few). */
export const BEHIND = 18;
/** How far past an end line the camera may look: the post, the squad, the wall and the front rows. */
export const BEHIND_VIEW = 9;
/**
 * What the stadium's decorative surfaces carry (the walls, the midfield mark, the kick cam's wall): the game's own
 * name, not the teams'. The end zones keep the team names: they show which end is whose.
 */
export const DRESSING = 'THE 4TH CALL';

const POST = 3.083;          // center to upright, yards (18 ft 6 in apart)
const BAR = 1.25;            // the crossbar's lift on screen
const UPRIGHT = 4.7;         // the uprights above it, on screen
const GOLD = '#f2d04b';
const SKIN = ['#f1c9a5', '#e0ac85', '#c68c5f', '#a5673f', '#7c4a2a', '#5a3620'];
const HAIR = ['#2b1d14', '#5a3a22', '#a8743c', '#d9b25e', '#1a1a1a', '#7a2f1b'];

function rgb(h: string): [number, number, number] {
  const m = h.replace('#', '');
  const n = parseInt(m.length === 3 ? m.split('').map((c) => c + c).join('') : m, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const lum = (h: string) => { const [r, g, b] = rgb(h); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };
/** White on a dark color, near-black on a light one. */
export const inkOn = (h: string) => (lum(h) > 0.6 ? '#111111' : '#ffffff');
/** A color mixed toward white (f > 0) or black (f < 0). */
export function shade(h: string, f: number) {
  const [r, g, b] = rgb(h);
  const t = f > 0 ? 255 : 0, k = Math.abs(f);
  const c = (v: number) => Math.round(v + (t - v) * k).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}
/** A second color that reads against the first (a team whose two colors are close gets white or black instead). */
function accentOn(base: string, second: string) {
  return Math.abs(lum(base) - lum(second)) > 0.18 ? second : inkOn(base);
}
/** One path holding many circles: a crowd drawn as a few elements, not thousands. */
const circles = (pts: [number, number][], r: number) => pts.map(([x, y]) => `M${(x - r).toFixed(2)},${y.toFixed(2)}a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0`).join('');

/** An end zone: color, pinstripe, border, outlined name, pylons. top: the far end zone (y 0-10). */
export function drawEndZone(el: El, g: SVGElement, team: TeamInfo, top: boolean, W: number, uid: string) {
  const y = top ? 0 : 110;
  const id = `ez-${uid}-${top ? 't' : 'b'}`;
  const pat = el('pattern', { id, patternUnits: 'userSpaceOnUse', width: 1.4, height: 1.4, patternTransform: 'rotate(45)' }, el('defs', {}, g));
  el('rect', { width: 0.7, height: 1.4, fill: lum(team.color) > 0.5 ? 'rgba(0,0,0,.07)' : 'rgba(255,255,255,.07)' }, pat);
  el('rect', { x: 0, y, width: W, height: 10, fill: team.color, class: 'f-ez' }, g);
  el('rect', { x: 0, y, width: W, height: 10, fill: `url(#${id})`, class: 'f-ez' }, g);
  const ac = accentOn(team.color, team.color2);
  el('rect', { x: 0.9, y: y + 0.9, width: W - 1.8, height: 8.2, rx: 0.3, fill: 'none', stroke: ac, 'stroke-width': 0.26, opacity: 0.85 }, g);
  // the name, upright from the field: outlined in the second color
  const t = el('text', { x: W / 2, y: y + 5.1, class: 'f-ezt', fill: inkOn(team.color), stroke: ac, 'stroke-width': 0.32, 'paint-order': 'stroke', 'stroke-linejoin': 'round' }, g);
  t.textContent = team.name.toUpperCase();
  for (const yy of [y, y + 10]) for (const x of [0, W]) el('rect', { x: x - 0.33, y: yy - 0.33, width: 0.66, height: 0.66, rx: 0.1, class: 'f-pylon' }, g);
}

/** The arrow beside a yard number, pointing to the nearer goal (u: yards from your goal line). */
export function drawNumberArrow(el: El, g: SVGElement, x: number, u: number) {
  if (u === 50) return;
  const y = 110 - u, up = u > 50;   // the far goal is up the screen
  const tip = up ? y - 2.35 : y + 2.35, base = up ? y - 1.75 : y + 1.75;
  el('path', { d: `M${x - 0.42},${base} L${x + 0.42},${base} L${x},${tip} Z`, class: 'f-arrow' }, g);
}

/**
 * The midfield mark: the game's own name (DRESSING) painted faintly on the turf in a thin double ring, the way a
 * stadium paints its mark at the 50 (no team names, no logos). Faint enough that the players and lines read over it.
 * The home team is still passed in (unused) so the caller and its stadium layout stay as they are.
 */
export function drawMidfield(el: El, g: SVGElement, _home: TeamInfo, W: number) {
  const cx = W / 2, cy = 60;
  el('circle', { cx, cy, r: 6.4, 'stroke-width': 0.32, class: 'f-mid' }, g);
  el('circle', { cx, cy, r: 5.7, 'stroke-width': 0.12, class: 'f-mid' }, g);
  const t = el('text', { x: cx, y: cy + 0.1, class: 'f-midt' }, g);
  t.textContent = DRESSING;
  t.setAttribute('textLength', '10.4');
  t.setAttribute('lengthAdjust', 'spacingAndGlyphs');
}

/**
 * Everything behind one end line, for the team whose end zone it is. top: the far end (behind y = 0, the stadium
 * going up the screen); otherwise yours (behind y = 120, going down). Returns the group, for hype().
 */
export function drawEnd(el: El, parent: SVGElement, team: TeamInfo, home: TeamInfo, away: TeamInfo, top: boolean, W: number): SVGGElement {
  const g = el('g', { class: `f-end f-end-${top ? 'far' : 'near'}` }, parent) as SVGGElement;
  const r = rng(hash('stadium', team.id, home.id, top ? 1 : 0));
  const dir = top ? -1 : 1;
  const y0 = top ? 0 : 120;
  const at = (d: number) => y0 + dir * d;   // d yards behind the end line, on the ground
  const span = (a: number, b: number) => ({ y: Math.min(at(a), at(b)), height: Math.abs(b - a) });
  const cx = W / 2;

  // the ground behind the end line, then the stands' concrete behind the wall
  el('rect', { x: -6, ...span(0, 4.6), width: W + 12, class: 'f-behind' }, g);
  el('rect', { x: -6, ...span(4.6, BEHIND + 2), width: W + 12, class: 'f-stands' }, g);

  // the crowd: mostly the home team's colors, some of the visitors', some neutral; rows farther back drawn first
  const crowd = el('g', { class: 'f-crowd' }, g);
  const rows = 13;
  const wavers: [number, number, string, number][] = [];
  const shirts = [home.color, home.color, home.color, shade(home.color2, 0), home.color2, away.color, '#e9ecef', '#2a2f35', shade(home.color, 0.35)];
  for (let k = rows - 1; k >= 0; k--) {
    const d = 4.95 + k * 0.98;
    const row = el('g', { class: 'row', style: `--o:${(-(k * 0.07 + r() * 0.05)).toFixed(2)}s` }, crowd);
    const byShirt = new Map<string, [number, number][]>(), bySkin = new Map<string, [number, number][]>();
    for (let x = 0.4 + (k % 2) * 0.45; x < W; x += 0.9 + r() * 0.12) {
      if (r() < 0.06) continue;   // an empty seat
      const hy = at(d) + (r() - 0.5) * 0.12;
      const shirt = shirts[Math.floor(r() * shirts.length)];
      const skin = SKIN[Math.floor(r() * SKIN.length)];
      if (!byShirt.has(shirt)) byShirt.set(shirt, []);
      if (!bySkin.has(skin)) bySkin.set(skin, []);
      byShirt.get(shirt)!.push([x, hy + 0.36]);
      // in the front rows, some fans are on their feet waving
      if (k < 4 && r() < 0.2) wavers.push([x, hy, skin, k]);
      bySkin.get(skin)!.push([x, hy]);
    }
    byShirt.forEach((pts, c) => el('path', { d: circles(pts, 0.36), fill: c }, row));
    bySkin.forEach((pts, c) => el('path', { d: circles(pts, 0.2), fill: c }, row));
    for (const [wx, wy, skin, wk] of wavers.splice(0)) {
      for (const sx of r() < 0.55 ? [-1, 1] : [r() < 0.5 ? -1 : 1]) {
        const fan = el('g', { class: 'fan', transform: `translate(${(wx + sx * 0.3).toFixed(2)} ${(wy + 0.24).toFixed(2)})`, style: `--d:${(0.5 + r() * 0.5).toFixed(2)}s;--o:${(-r() * 1.5).toFixed(2)}s` }, row);
        const sw = el('g', { class: 'sw' }, fan);
        el('line', { x1: 0, y1: 0, x2: 0, y2: -0.5, stroke: skin, 'stroke-width': 0.12, 'stroke-linecap': 'round' }, sw);
        el('circle', { cx: 0, cy: -0.55, r: 0.09, fill: wk === 0 && r() < 0.4 ? team.color2 : skin }, sw);
      }
    }
  }

  // the padded wall: the team's color, its name repeated in the second color
  const ac = accentOn(team.color, team.color2);
  const wall = { y: top ? at(4.55) : at(3.25), h: 1.3 };   // the wall, between the squad and the stands
  el('rect', { x: -6, y: wall.y, width: W + 12, height: wall.h, fill: team.color, class: 'f-wall' }, g);
  el('rect', { x: -6, y: wall.y, width: W + 12, height: 0.16, fill: ac, opacity: 0.9 }, g);
  for (let x = 5; x < W; x += 15.5) {
    const t = el('text', { x, y: wall.y + wall.h * 0.58, class: 'f-wallt', fill: ac }, g);
    t.textContent = DRESSING;
  }

  // the cheer squad, on the ground between the end line and the wall: five a side, the middle left to the post
  const squad = el('g', { class: 'f-squad' }, g);
  const feet = top ? at(2.35) : at(3.15);   // the squad: heads toward the far end, so yours stand a little deeper
  const xs = [2.7, 6.3, 9.9, 13.5, 17.1];
  [...xs, ...xs.map((x) => W - x)].forEach((x, i) => cheerleader(el, squad, x, feet, team, ac, r, i));
  mascot(el, squad, top ? cx - 5.4 : cx + 5.4, feet, team, ac, r);

  // the goal post: the base pad two yards back, the gooseneck, the crossbar over the end line, the uprights
  const post = el('g', { class: 'f-gp' }, g);
  // (the post rises away from the field at both ends, so the near one doesn't stand over your end zone)
  const base = at(2.0), bar = y0 + dir * BAR;
  el('ellipse', { cx: cx + 0.9, cy: base + 0.15, rx: 1.1, ry: 0.32, fill: 'rgba(0,0,0,.28)' }, post);   // its shadow
  el('rect', { x: cx - 0.42, y: top ? base - 0.55 : base - 0.2, width: 0.84, height: 0.75, rx: 0.12, fill: team.color, stroke: ac, 'stroke-width': 0.08 }, post);
  el('path', { d: `M${cx},${base + dir * 0.5} V${base + dir * 1.55} Q${cx},${base + dir * 2.35} ${cx},${bar + dir * 0.45} V${bar}`, fill: 'none', stroke: GOLD, 'stroke-width': 0.3, 'stroke-linecap': 'round' }, post);
  el('line', { x1: cx - POST, x2: cx + POST, y1: bar, y2: bar, stroke: GOLD, 'stroke-width': 0.3, 'stroke-linecap': 'round' }, post);
  for (const s of [-1, 1]) {
    const x = cx + s * POST;
    el('line', { x1: x, x2: x, y1: bar, y2: bar + dir * UPRIGHT, stroke: GOLD, 'stroke-width': 0.22, 'stroke-linecap': 'round' }, post);
    // wind ribbons at the tops
    el('path', { d: `M${x},${bar + dir * UPRIGHT} l${0.55 * s},0.16 l${-0.55 * s},0.16 Z`, fill: '#ff6a3d', class: 'f-ribbon' }, post);
  }
  return g;
}

/**
 * One cheerleader, front on, feet at (x, fy): boots, skirt in the second color, top in the team's, pom-poms in the
 * second color (or silver). Each waves at its own pace; every other one dances a different pattern.
 */
function cheerleader(el: El, parent: SVGElement, x: number, fy: number, team: TeamInfo, ac: string, r: () => number, i: number) {
  const skin = SKIN[Math.floor(r() * SKIN.length)];
  const hair = HAIR[Math.floor(r() * HAIR.length)];
  const pom = r() < 0.3 ? '#dfe4ea' : ac;
  const pos = el('g', { transform: `translate(${x.toFixed(2)} ${fy.toFixed(2)}) scale(1.18)` }, parent);
  const fig = el('g', { class: `cheer ${i % 2 ? 'pat-b' : 'pat-a'}`, style: `--d:${(0.62 + r() * 0.35).toFixed(2)}s;--o:${(-r() * 1.2).toFixed(2)}s` }, pos);
  // legs and boots
  for (const s of [-1, 1]) {
    el('rect', { x: s < 0 ? -0.21 : 0.07, y: -0.86, width: 0.14, height: 0.8, rx: 0.06, fill: skin }, fig);
    el('rect', { x: s < 0 ? -0.24 : 0.05, y: -0.24, width: 0.2, height: 0.24, rx: 0.06, fill: '#f5f6f8' }, fig);
  }
  el('path', { d: 'M-0.21,-1.2 L0.21,-1.2 L0.37,-0.78 L-0.37,-0.78 Z', fill: ac }, fig);                  // skirt
  el('rect', { x: -0.23, y: -1.74, width: 0.46, height: 0.58, rx: 0.13, fill: team.color }, fig);           // top
  el('path', { d: 'M-0.23,-1.36 L0.23,-1.36', stroke: ac, 'stroke-width': 0.06 }, fig);                     // trim
  el('circle', { cx: 0, cy: -1.99, r: 0.2, fill: skin }, fig);                                              // head
  el('path', { d: 'M-0.21,-2.02 Q-0.2,-2.27 0,-2.25 Q0.2,-2.27 0.21,-2.02 Q0.14,-2.13 0,-2.13 Q-0.14,-2.13 -0.21,-2.02 Z', fill: hair }, fig);
  el('path', { d: 'M0.16,-2.12 Q0.42,-2.05 0.34,-1.72', fill: 'none', stroke: hair, 'stroke-width': 0.1, 'stroke-linecap': 'round' }, fig);   // ponytail
  for (const s of [-1, 1]) {
    const arm = el('g', { class: `arm arm-${s < 0 ? 'l' : 'r'}`, transform: `translate(${(s * 0.21).toFixed(2)} -1.64)` }, fig);
    const sw = el('g', { class: 'sw' }, arm);   // swings about the shoulder: the bottom middle of its box (stylesheet)
    el('line', { x1: 0, y1: 0, x2: 0, y2: -0.6, stroke: skin, 'stroke-width': 0.1, 'stroke-linecap': 'round' }, sw);
    el('circle', { cx: 0, cy: -0.76, r: 0.27, fill: pom, class: 'pom' }, sw);
    el('circle', { cx: -0.08, cy: -0.84, r: 0.1, fill: '#ffffff', opacity: 0.35 }, sw);
  }
}

/**
 * The team's mascot: a generic costumed character in the team's colors (big round head, ears, a jersey with the
 * team's initial), waving. Not any real team's character.
 */
function mascot(el: El, parent: SVGElement, x: number, fy: number, team: TeamInfo, ac: string, r: () => number) {
  const fur = ac, dark = shade(ac, -0.45);
  const pos = el('g', { transform: `translate(${x.toFixed(2)} ${fy.toFixed(2)}) scale(1.5)` }, parent);
  const fig = el('g', { class: 'masc', style: `--d:.7s;--o:${(-r()).toFixed(2)}s` }, pos);
  for (const sx of [-1, 1]) el('ellipse', { cx: sx * 0.17, cy: -0.1, rx: 0.17, ry: 0.11, fill: dark }, fig);              // big feet
  for (const sx of [-1, 1]) el('rect', { x: sx < 0 ? -0.24 : 0.06, y: -0.72, width: 0.18, height: 0.64, rx: 0.08, fill: fur }, fig);
  el('rect', { x: -0.32, y: -1.5, width: 0.64, height: 0.86, rx: 0.2, fill: team.color }, fig);                          // jersey
  const t = el('text', { x: 0, y: -1.06, class: 'f-mascn', fill: ac }, fig);
  t.textContent = '4';
  for (const sx of [-1, 1]) {
    const arm = el('g', { class: `arm arm-${sx < 0 ? 'l' : 'r'}`, transform: `translate(${(sx * 0.3).toFixed(2)} -1.38)` }, fig);
    const sw = el('g', { class: 'sw' }, arm);
    el('line', { x1: 0, y1: 0, x2: 0, y2: -0.55, stroke: fur, 'stroke-width': 0.16, 'stroke-linecap': 'round' }, sw);
    el('circle', { cx: 0, cy: -0.62, r: 0.13, fill: '#ffffff' }, sw);                                                    // a big glove
  }
  for (const sx of [-1, 1]) el('circle', { cx: sx * 0.34, cy: -2.12, r: 0.15, fill: fur, stroke: dark, 'stroke-width': 0.04 }, fig);   // ears
  el('circle', { cx: 0, cy: -1.86, r: 0.42, fill: fur, stroke: dark, 'stroke-width': 0.05 }, fig);                       // head
  el('ellipse', { cx: 0, cy: -1.72, rx: 0.24, ry: 0.17, fill: '#f6efe2' }, fig);                                         // muzzle
  for (const sx of [-1, 1]) {
    el('circle', { cx: sx * 0.14, cy: -1.98, r: 0.09, fill: '#ffffff' }, fig);
    el('circle', { cx: sx * 0.14 + 0.02, cy: -1.97, r: 0.045, fill: '#111111' }, fig);
  }
  el('ellipse', { cx: 0, cy: -1.79, rx: 0.07, ry: 0.05, fill: '#2a1a12' }, fig);                                        // nose
  el('path', { d: 'M-0.1,-1.68 Q0,-1.6 0.1,-1.68', fill: 'none', stroke: '#2a1a12', 'stroke-width': 0.035, 'stroke-linecap': 'round' }, fig);
}
