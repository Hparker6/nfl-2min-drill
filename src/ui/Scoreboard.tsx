import { useEffect, useRef, useState } from 'react';
import { ballOn, downDist, fmtClock } from '../game/describe';
import type { State, TeamInfo } from '../engine/types';

interface Props {
  s: State;
  teams: [TeamInfo, TeamInfo];
  wp: number | null;
  trail: number[];
}

/** Flash a value when it changes, so a score or a new set of downs is noticed. */
function useBump(v: unknown) {
  const prev = useRef(v);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (prev.current !== v) { prev.current = v; setN((x) => x + 1); }
  }, [v]);
  return n;
}

/** The game clock runs down to its new value instead of jumping, so a runoff reads as time passing. */
function useClock(t: number) {
  const [shown, setShown] = useState(t);
  const from = useRef(t);
  useEffect(() => {
    const a = from.current;
    from.current = t;
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (t >= a || reduced) { setShown(t); return; }
    const dur = Math.max(200, Math.min(1100, (a - t) * 30));
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const f = Math.min(1, (now - t0) / dur);
      setShown(a + (t - a) * f);
      if (f < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [t]);
  return shown;
}

function Team({ team, score, tos, ball, you, right }: { team: TeamInfo; score: number; tos: number; ball: boolean; you: boolean; right?: boolean }) {
  const bump = useBump(score);
  return (
    <div className={`sb-team${right ? ' right' : ''}${ball ? ' has-ball' : ''}`} style={{ ['--tc' as string]: team.color }}>
      <div className="sb-id">
        <span className="sb-chip" style={{ background: team.color, color: team.color2 }}>{team.id}</span>
        <div className="sb-names">
          <span className="sb-nick">{team.name}</span>
          <span className="sb-city">{you ? 'You' : team.city}</span>
        </div>
      </div>
      <div className="sb-to" aria-label={`${tos} timeouts left`} title={`${tos} timeouts left`}>
        {[0, 1, 2].map((i) => <i key={i} className={i < tos ? 'on' : ''} />)}
      </div>
      <div key={bump} className={`sb-score${bump ? ' bump' : ''}`}>{score}</div>
      {ball && <span className="sb-ball" aria-label="has the ball" />}
    </div>
  );
}

export function Scoreboard({ s, teams, wp, trail }: Props) {
  const live = s.stage === 'pre' || s.stage === 'call';
  const yt = 100 - s.yl;
  const dd = live ? downDist(s) : s.stage === 'pat' ? 'Try' : s.stage === 'kick' ? 'Kickoff' : 'Final';
  const ddBump = useBump(dd + s.yl);
  const pct = wp == null ? null : wp * 100;
  const clock = useClock(s.t);
  return (
    <section className="sb" aria-label="Scoreboard">
      <div className="sb-main">
        <Team team={teams[0]} score={s.score[0]} tos={s.to[0]} ball={live && s.off === 0} you />
        <div className="sb-center">
          <div className={`sb-clock${s.running && live ? ' running' : ''}`}>{fmtClock(clock)}</div>
          <div className="sb-q">4th quarter{live && s.running ? ' · running' : live ? ' · stopped' : ''}</div>
        </div>
        <Team team={teams[1]} score={s.score[1]} tos={s.to[1]} ball={live && s.off === 1} you={false} right />
      </div>
      <div className="sb-bar">
        <span key={ddBump} className={`sb-dd${ddBump ? ' bump' : ''}`}>{dd}</span>
        {live && <span className="sb-spot">Ball on <b>{ballOn(s.yl, s.off, teams)}</b>{yt <= 20 ? <em className="rz">Red zone</em> : null}</span>}
        <span className="sb-wp" title="Your chance to win from here, by simulation">
          <span className="sb-wp-k">Win</span>
          <span className="sb-wp-bar" aria-hidden>
            <i style={{ width: `${pct ?? 50}%` }} />
          </span>
          <b>{pct == null ? '…' : `${pct.toFixed(0)}%`}</b>
          {trail.length > 1 && <Spark values={trail} h={18} />}
        </span>
      </div>
    </section>
  );
}

export function Spark({ values, h = 26 }: { values: number[]; h?: number }) {
  const w = 100;
  const pts = values.map((v, i) => `${(i / Math.max(1, values.length - 1)) * w},${(1 - v) * h}`).join(' ');
  return (
    <svg className="spark" viewBox={`0 -2 ${w} ${h + 4}`} preserveAspectRatio="none" aria-label="Win chance through the game">
      <line x1="0" x2={w} y1={h / 2} y2={h / 2} className="spark-mid" />
      <polyline points={pts} className="spark-line" />
    </svg>
  );
}
