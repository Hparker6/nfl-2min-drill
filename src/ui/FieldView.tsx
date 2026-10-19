import { forwardRef, useEffect, useImperativeHandle, useRef, type ReactNode } from 'react';
import { FieldRenderer, type Outcome, type Preview } from './field';
import { useState } from 'react';
import type { Ev, Rcv, State, TeamInfo, Weather } from '../engine/types';
import { PlayerCard } from './PlayerCard';
import { WeatherLayer } from './WeatherLayer';

export interface FieldHandle {
  setup(s: State, pv?: Preview, instant?: boolean): void;
  play(ev: Ev, speed: number, onOutcome?: (o: Outcome) => void): Promise<void>;
  playKick(ev: Extract<Ev, { type: 'kick' }>, speed: number, onOutcome?: (o: Outcome) => void): Promise<void>;
  playPat(ev: Extract<Ev, { type: 'pat' }>, speed: number, onOutcome?: (o: Outcome) => void): Promise<void>;
  hype(): void;
}

export interface Banner { id: number; text: string; sub?: string; tone: string }

interface Props {
  teams: [TeamInfo, TeamInfo];
  onTap?: (pos: Rcv) => void;
  banner?: Banner | null;
  children?: ReactNode;      // overlays (legend)
  offense?: 0 | 1;           // which team has the ball, so hovering a marker shows the right player
  weather?: Weather;         // tints the field
  byRating?: boolean;        // markers colored by overall rating
  home?: 0 | 1;              // whose stadium: the midfield emblem and most of the crowd
  look?: string;             // the field's look (badges unlock them): a class on the field
}

export const FieldView = forwardRef<FieldHandle, Props>(function FieldView({ teams, onTap, banner, children, offense = 0, weather, byRating = true, home = 0, look }, ref) {
  const [inspect, setInspect] = useState<{ side: 'o' | 'd'; pos: string } | null>(null);
  // touch screens and narrow windows get the one-line card: the full table would cover the field
  const compact = typeof matchMedia === 'function' && matchMedia('(pointer: coarse), (max-width: 999px)').matches;
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const rRef = useRef<FieldRenderer | null>(null);
  const kickRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!svgRef.current) return;
    rRef.current = new FieldRenderer(svgRef.current);
    rRef.current.setTeams(teams, home);
    rRef.current.attachKickCam(kickRef.current);
    const el = wrapRef.current!;
    rRef.current.resize(el.clientWidth, el.clientHeight);
    const ro = new ResizeObserver(() => rRef.current?.resize(el.clientWidth, el.clientHeight));
    ro.observe(el);
    return () => { ro.disconnect(); rRef.current?.stop(); };
  }, [teams, home]);

  useEffect(() => {
    if (rRef.current) rRef.current.onTap = onTap ?? null;
  }, [onTap]);

  useEffect(() => {
    if (rRef.current) rRef.current.byRating = byRating;
  }, [byRating, teams]);

  useEffect(() => {
    rRef.current?.setWeather(weather);
  }, [weather, teams]);

  useEffect(() => {
    if (rRef.current) rRef.current.onInspect = (side, pos) => setInspect(side && pos ? { side, pos } : null);
  }, [teams]);

  useImperativeHandle(ref, () => ({
    setup: (s, pv, instant) => rRef.current?.setup(s, pv, instant),
    play: (ev, speed, onOutcome) => rRef.current?.play(ev, speed, onOutcome) ?? Promise.resolve(),
    playKick: (ev, speed, onOutcome) => rRef.current?.playKick(ev, speed, onOutcome) ?? Promise.resolve(),
    playPat: (ev, speed, onOutcome) => rRef.current?.playPat(ev, speed, onOutcome) ?? Promise.resolve(),
    hype: () => rRef.current?.hype(),
  }), []);

  return (
    <div className={`field-wrap wx-${weather ?? 'clear'}${look && look !== 'classic' ? ` look-${look}` : ''}`} ref={wrapRef}>
      <WeatherLayer weather={weather} />
      <svg ref={svgRef} className="field" role="img" aria-label="Field: your end zone at the bottom, theirs at the top" />
      <div ref={kickRef} className="kickcam" aria-hidden />
      {banner && (
        <div key={banner.id} className={`ribbon tone-${banner.tone}`} role="status">
          <span className="ribbon-main">{banner.text}</span>
          {banner.sub && <span className="ribbon-sub">{banner.sub}</span>}
        </div>
      )}
      {children}
      {byRating && <div className="rkey" aria-hidden><span>worse</span><i /><span>better</span></div>}
      {inspect && <PlayerCard team={teams[inspect.side === 'o' ? offense : offense === 0 ? 1 : 0]} pos={inspect.pos} compact={compact} />}
    </div>
  );
});
