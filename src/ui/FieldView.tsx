import { forwardRef, useEffect, useImperativeHandle, useRef, type ReactNode } from 'react';
import { FieldRenderer, type Outcome, type Preview } from './field';
import type { Ev, Rcv, State, TeamInfo } from '../engine/types';

export interface FieldHandle {
  setup(s: State, pv?: Preview, instant?: boolean): void;
  play(ev: Ev, speed: number, onOutcome?: (o: Outcome) => void): Promise<void>;
}

export interface Banner { id: number; text: string; sub?: string; tone: string }

interface Props {
  teams: [TeamInfo, TeamInfo];
  onTap?: (pos: Rcv) => void;
  banner?: Banner | null;
  children?: ReactNode;      // overlays (legend)
}

export const FieldView = forwardRef<FieldHandle, Props>(function FieldView({ teams, onTap, banner, children }, ref) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const rRef = useRef<FieldRenderer | null>(null);

  useEffect(() => {
    if (!svgRef.current) return;
    rRef.current = new FieldRenderer(svgRef.current);
    rRef.current.setTeams(teams);
    const el = wrapRef.current!;
    rRef.current.resize(el.clientWidth, el.clientHeight);
    const ro = new ResizeObserver(() => rRef.current?.resize(el.clientWidth, el.clientHeight));
    ro.observe(el);
    return () => { ro.disconnect(); rRef.current?.stop(); };
  }, [teams]);

  useEffect(() => {
    if (rRef.current) rRef.current.onTap = onTap ?? null;
  }, [onTap]);

  useImperativeHandle(ref, () => ({
    setup: (s, pv, instant) => rRef.current?.setup(s, pv, instant),
    play: (ev, speed, onOutcome) => rRef.current?.play(ev, speed, onOutcome) ?? Promise.resolve(),
  }), []);

  return (
    <div className="field-wrap" ref={wrapRef}>
      <svg ref={svgRef} className="field" role="img" aria-label="Field: your end zone at the bottom, theirs at the top" />
      {banner && (
        <div key={banner.id} className={`ribbon tone-${banner.tone}`} role="status">
          <span className="ribbon-main">{banner.text}</span>
          {banner.sub && <span className="ribbon-sub">{banner.sub}</span>}
        </div>
      )}
      {children}
    </div>
  );
});
