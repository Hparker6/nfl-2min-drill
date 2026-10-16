/**
 * A play card: the real formation, every route (the target's on top), the run lane to the side that was called, or
 * the defense's eleven in the alignment of a call. Drawn from the same formation and route tables as the field, so
 * the card matches what the play looks like once it is snapped.
 */
import { CALL, ROUTES } from '../engine/data';
import { DESIGN, defAlign, formation } from '../engine/formation';
import { routePoints } from '../engine/timeline';
import type { Look, PassMods, Rcv, RouteId } from '../engine/types';

type Pt = [number, number];
const W = 53.33, CX = W / 2;
const RCV: Rcv[] = ['WR1', 'WR2', 'WR3', 'TE', 'RB'];
const OL = ['LT', 'LG', 'C', 'RG', 'RT'];
const DEF = ['EDGE1', 'DL1', 'DL2', 'EDGE2', 'LB1', 'LB2', 'LB3', 'CB1', 'CB2', 'S1', 'S2'];
// the card shows 8 yards behind the line and 20 past it; the field is drawn with the offense going up
const VB = `0 -20.5 ${W} 30`;
const Y = (dy: number) => -dy;

const path = (pts: Pt[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${Y(p[1]).toFixed(1)}`).join(' ');
/** A small arrowhead on the last segment of a path. */
function head(pts: Pt[], size = 1.6): string {
  const a = pts[pts.length - 2] ?? pts[0], b = pts[pts.length - 1];
  const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
  const ux = dx / L, uy = dy / L;
  const l: Pt = [b[0] - ux * size - uy * size * 0.6, b[1] - uy * size + ux * size * 0.6];
  const r: Pt = [b[0] - ux * size + uy * size * 0.6, b[1] - uy * size - ux * size * 0.6];
  return `M${l[0].toFixed(1)},${Y(l[1]).toFixed(1)} L${b[0].toFixed(1)},${Y(b[1]).toFixed(1)} L${r[0].toFixed(1)},${Y(r[1]).toFixed(1)}`;
}

interface Props {
  play?: string;
  look?: Look;
  side?: 1 | -1;                              // runs: the side that was called
  routes?: Partial<Record<Rcv, RouteId>>;     // passes: edited routes
  target?: Rcv | null;
  mods?: PassMods;
  className?: string;
}

/** The run lane for a design, to the side given. Mirrors the field preview. */
export function runLane(play: string, side: 1 | -1, yt = 60): Pt[] {
  const design = DESIGN[play];
  const fm = formation(design?.formation ?? 'gun');
  const holeX = Math.max(2, Math.min(W - 2, CX + side * (design?.hole ?? 1.5)));
  const from: Pt = design?.carrier === 'QB' ? fm.QB : design?.carrier === 'WR2' ? fm.WR2 : fm.RB;
  const wide = Math.abs(design?.hole ?? 0) >= 8;
  const run: Pt[] = design?.carrier === 'WR2'
    ? [from, [CX + 2, -4.8], [CX - 4, -4.6], [holeX, -1], [holeX - 3, 6]]
    : [from, [CX + side * 0.8, -4], [holeX, -0.2], [holeX + side * (wide ? 4 : 1), 6]];
  return run.map((p) => [p[0], Math.min(p[1], yt)] as Pt);
}

function Turf() {
  return (
    <>
      <rect x="0" y="-20.5" width={W} height="30" className="mp-turf" />
      {[5, 10, 15, -5].map((d) => <line key={d} x1="0" x2={W} y1={Y(d)} y2={Y(d)} className="mp-yd" />)}
      <line x1="0" x2={W} y1="0" y2="0" className="mp-los" />
    </>
  );
}

export function MiniPlay({ play, look, side, routes, target, mods, className }: Props) {
  const cls = `mini mp${className ? ' ' + className : ''}`;
  if (look) {
    // the defense's eleven, with the ghost of a base offense so the shape of the call reads
    const L = look === 'soft' ? 'prevent' : look;
    const da = defAlign(L);
    const fm = formation('gun');
    const qb: Pt = [CX, -5.4];
    const rushers = L === 'blitz' ? ['LB1', 'LB3', 'CB1'] : L === 'goal' ? ['LB1', 'LB2', 'LB3'] : L === 'load' ? ['LB2'] : [];
    const zones = L === 'zone' ? ['LB1', 'LB2', 'LB3', 'CB1', 'CB2', 'S1', 'S2'] : L === 'prevent' ? ['CB1', 'CB2', 'S1', 'S2', 'LB2'] : L === 'balanced' ? ['S1', 'S2'] : [];
    const manPairs: [string, Rcv][] = L === 'man' ? [['CB1', 'WR1'], ['CB2', 'WR2'], ['LB1', 'WR3'], ['LB3', 'TE'], ['LB2', 'RB']] : [];
    return (
      <svg className={`${cls} mp-def look-${L}`} viewBox={VB} aria-hidden>
        <Turf />
        {zones.map((k) => <circle key={k} cx={da[k][0]} cy={Y(da[k][1]) - 1.2} r={L === 'prevent' ? 6 : 4.6} className="mp-zone" />)}
        {[...OL, 'QB', 'RB', 'TE', 'WR1', 'WR2', 'WR3'].map((k) => <circle key={k} cx={fm[k][0]} cy={Y(fm[k][1])} r="0.95" className="mp-ghost" />)}
        {manPairs.map(([d, o]) => <line key={d} x1={da[d][0]} y1={Y(da[d][1])} x2={fm[o][0]} y2={Y(fm[o][1]) - 1.3} className="mp-man" />)}
        {rushers.map((k) => { const pts: Pt[] = [da[k], [qb[0] + (da[k][0] - CX) * 0.25, qb[1] + 1.2]]; return <g key={k}><path d={path(pts)} className="mp-rush" /><path d={head(pts, 1.4)} className="mp-rush" /></g>; })}
        {DEF.map((k) => <rect key={k} x={da[k][0] - 1.05} y={Y(da[k][1]) - 1.05} width="2.1" height="2.1" transform={`rotate(45 ${da[k][0]} ${Y(da[k][1])})`} className={`mp-d${rushers.includes(k) ? ' rush' : ''}`} />)}
      </svg>
    );
  }
  if (!play) return null;
  if (play === 'fg' || play === 'punt' || play === 'kneel' || play === 'spike') {
    return (
      <svg className={`${cls} mp-st`} viewBox={VB} aria-hidden>
        <Turf />
        {OL.map((k) => <circle key={k} cx={CX + (OL.indexOf(k) - 2) * 1.9} cy={Y(-0.8)} r="0.95" className="mp-ol" />)}
        {play === 'fg' && <><path d={`M${CX - 4},${Y(17)} V${Y(11)} H${CX + 4} V${Y(17)} M${CX},${Y(11)} V${Y(6)}`} className="mp-post" /><path d={`M${CX - 1},${Y(-7)} Q${CX - 2},${Y(4)} ${CX},${Y(16)}`} className="mp-arc" /><circle cx={CX - 1} cy={Y(-7)} r="1" className="mp-o" /></>}
        {play === 'punt' && <><path d={`M${CX},${Y(-13)} Q${CX + 3},${Y(10)} ${CX + 10},${Y(19)}`} className="mp-arc" /><circle cx={CX} cy={Y(-13)} r="1" className="mp-o" /></>}
        {play === 'kneel' && <><circle cx={CX} cy={Y(-5)} r="1.1" className="mp-o qb" /><path d={`M${CX},${Y(-5)} L${CX},${Y(-7)}`} className="mp-run" /><path d={head([[CX, -5], [CX, -7.2]], 1.3)} className="mp-run" /></>}
        {play === 'spike' && <><circle cx={CX} cy={Y(-4)} r="1.1" className="mp-o qb" /><path d={`M${CX},${Y(-2.5)} L${CX},${Y(0.6)} M${CX - 1.6},${Y(0.6)} H${CX + 1.6}`} className="mp-run" /></>}
      </svg>
    );
  }
  const c = CALL[play];
  const design = DESIGN[play];
  if (!c || !design) return null;
  const fm = formation(design.formation);
  const isRun = c.kind === 'run';
  const sd = side ?? design.side ?? 1;
  const tgt = (target ?? c.tgt) as Rcv | undefined;
  const qbA = mods?.roll ? 'boot' : mods?.pa ? 'pa' : design.qb;
  const rbJob = (mods?.pa || mods?.roll) && (design.rb === 'route' || design.rb === 'fake') ? 'fake' : design.rb;
  const running = c.routes && c.kind !== 'run'
    ? RCV.filter((r) => !((r === 'RB' && rbJob !== 'route') || (r === 'TE' && design.te !== 'route')) || r === tgt)
    : [];
  const routeOf = (r: Rcv): RouteId => routes?.[r] ?? c.routes![r];
  const ptsOf = (r: Rcv) => { const rt = routeOf(r); return routePoints(fm[r], rt, rt === 'hail' ? 40 : Math.min(ROUTES[rt].depth, 19), 60); };
  const qbDrop: Pt[] | null = c.kind === 'run' ? null
    : qbA === 'boot' ? [fm.QB, [CX - sd * 1.2, -4], [CX + sd * 9, -6.4]]
    : qbA === 'pa' ? [fm.QB, [CX + sd * 1.2, -4.2], [CX, -8]]
    : null;
  return (
    <svg className={`${cls} fam-${c.fam}`} viewBox={VB} aria-hidden>
      <Turf />
      {/* decoys first, the target on top */}
      {running.filter((r) => r !== tgt).map((r) => { const pts = ptsOf(r); return <g key={r}><path d={path(pts)} className="mp-route" /><path d={head(pts, 1.3)} className="mp-route" /></g>; })}
      {c.kind === 'rpo' && c.routes && tgt && <path d={path(ptsOf(tgt))} className="mp-route tgt dash" />}
      {!isRun && c.kind !== 'rpo' && tgt && running.includes(tgt) && (() => { const pts = ptsOf(tgt); return <g><path d={path(pts)} className="mp-route tgt" /><path d={head(pts, 1.8)} className="mp-route tgt" /></g>; })()}
      {(isRun || c.kind === 'rpo') && (() => { const pts = runLane(play, sd); return <g><path d={path(pts)} className="mp-run" /><path d={head(pts, 1.8)} className="mp-run" /></g>; })()}
      {qbDrop && <path d={path(qbDrop)} className="mp-qb" />}
      {rbJob === 'fake' && !isRun && <path d={path([fm.RB, [CX + sd * 1.2, -4.2], [CX + sd * 2.4, -1.5]])} className="mp-fake" />}
      {OL.map((k) => <circle key={k} cx={fm[k][0]} cy={Y(fm[k][1])} r="0.95" className="mp-ol" />)}
      {['TE', 'WR1', 'WR2', 'WR3', 'RB'].map((k) => <circle key={k} cx={fm[k][0]} cy={Y(fm[k][1])} r="1" className={`mp-o${k === tgt && !isRun ? ' tgt' : ''}${isRun && design.carrier !== 'QB' && (design.carrier ?? 'RB') === k ? ' car' : ''}`} />)}
      <circle cx={fm.QB[0]} cy={Y(fm.QB[1])} r="1.1" className={`mp-o qb${isRun && design.carrier === 'QB' ? ' car' : ''}`} />
    </svg>
  );
}
