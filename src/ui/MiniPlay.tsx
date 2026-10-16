/** A small diagram of a call: the target's route, a run lane, or a special-teams icon. */
import { CALL, ROUTES } from '../engine/data';
import type { Look } from '../engine/types';

const route = (id: string, x0: number, scale: number) => {
  const R = ROUTES[id as keyof typeof ROUTES];
  if (!R) return '';
  const depth = Math.min(R.depth, 24);
  const inward = x0 <= 0 ? 1 : -1;   // route paths are written as yards toward the middle
  const pts = [[0, 0] as [number, number], ...R.path(depth)].map(([i, d]) => [i === 99 ? x0 * 0.4 : x0 + i * 0.55 * inward, -d * scale]);
  return pts.map((p, k) => `${k ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
};

export function MiniPlay({ play, look }: { play?: string; look?: Look }) {
  const vb = '-12 -16 24 21';
  if (look) {
    // defensive looks: where the second level stands
    const dots: [number, number][] = look === 'blitz' ? [[-6, -2], [-2, -2], [2, -2], [6, -2], [-3.5, -4], [3.5, -4], [0, -6], [-8, -10], [8, -10]]
      : look === 'load' ? [[-6, -2], [-2, -2], [2, -2], [6, -2], [-4, -5], [0, -5], [4, -5], [6.5, -6], [0, -11]]
      : [[-6, -2], [-2, -2], [2, -2], [6, -2], [-5, -7], [0, -7.5], [5, -7], [-6, -12.5], [6, -12.5]];
    return (
      <svg className="mini" viewBox={vb} aria-hidden>
        <line x1="-12" x2="12" y1="0.5" y2="0.5" className="mini-los" />
        {dots.map(([x, y], i) => <rect key={i} x={x - 1} y={y - 1} width="2" height="2" transform={`rotate(45 ${x} ${y})`} className="mini-d" />)}
        {look === 'blitz' && <path d="M-3.5,-4 L-2,-0.5 M3.5,-4 L2,-0.5" className="mini-arrow" />}
      </svg>
    );
  }
  if (!play) return null;
  if (play === 'fg' || play === 'punt' || play === 'kneel' || play === 'spike') {
    return (
      <svg className="mini" viewBox={vb} aria-hidden>
        {play === 'fg' && <path d="M-5,-13 V-7 H5 V-13 M0,-7 V3" className="mini-post" />}
        {play === 'fg' && <path d="M0,3 Q-2,-6 0,-11" className="mini-arc" />}
        {play === 'punt' && <path d="M-8,3 Q0,-22 8,-6" className="mini-arc" />}
        {play === 'kneel' && <><circle cx="0" cy="-2" r="2.5" className="mini-o" /><path d="M0,1 V4" className="mini-arrow" /></>}
        {play === 'spike' && <path d="M0,-8 V2 M-3,2 H3" className="mini-arrow" />}
      </svg>
    );
  }
  const c = CALL[play];
  if (!c) return null;
  const tgtRoute = c.routes && c.tgt ? c.routes[c.tgt] : null;
  const x0 = c.tgt === 'WR1' ? -9 : c.tgt === 'WR2' ? 9 : c.tgt === 'WR3' ? -5 : c.tgt === 'TE' ? 4 : 1;
  const isRun = c.kind === 'run' || c.kind === 'rpo';
  const out = (c.lane ?? (c.run ? CALL[c.run].lane : 'in')) === 'out';
  return (
    <svg className={`mini fam-${c.fam}`} viewBox={vb} aria-hidden>
      <line x1="-12" x2="12" y1="1" y2="1" className="mini-los" />
      {[-3, -1.5, 0, 1.5, 3].map((x) => <circle key={x} cx={x} cy="2.6" r="0.75" className="mini-ol" />)}
      {isRun && (
        <path d={c.carrier === 'WR2' ? 'M8,1 Q0,4 -6,-1 L-8,-9' : out ? 'M-1,5 L2,1 Q7,-1 9,-11' : 'M-1,5 L0,0 L1,-13'} className="mini-run" markerEnd="" />
      )}
      {c.kind === 'rpo' && tgtRoute && <path d={route(tgtRoute, x0, 0.62)} className="mini-route dash" />}
      {!isRun && tgtRoute && <path d={route(tgtRoute, x0, play === 'hail' ? 0.3 : 0.62)} className="mini-route" />}
      {c.id === 'flea' && <path d="M0,4 L-2,1 M-2,1 L0,4" className="mini-run" />}
    </svg>
  );
}
