/**
 * The live tracker's pictures, broadcast style: the drive chart (the field from the side, every snap of the drive on
 * its own row: passes arc, runs go straight, losses and turnovers in red), the last play called big, a flash when
 * someone scores, your quarterback's line as it happens, and the game's drives with a bar of where each went.
 */
import type { Ev, State, TeamInfo } from '../../engine/types';
import { tv } from './tv';
import { downDist, fmtClock, tell } from '../../game/describe';
import { fmtSecs, toYou, type Drive } from '../../career/drives';
import type { Line } from '../../career/box';
import { chipInk } from '../Scoreboard';

type Snap = Extract<Ev, { type: 'snap' }>;
const W = 1200, EZ = 70;
const X = (y: number) => EZ + (y / 100) * (W - 2 * EZ);   // your yards (0 = your goal line) to the picture
const ROWS = 9;

/** One snap of a drive, in your coordinates: where it started, where the ball ended, and what kind of play it was. */
function geometry(e: Snap) {
  const r = e.res, dir = e.off === 0 ? 1 : -1;
  const from = toYou(e.off, e.yl0);
  const gained = r.turnover || r.kind === 'fg' || r.kind === 'punt' ? 0 : r.yards;
  const to = toYou(e.off, Math.min(100, Math.max(0, e.yl0 + gained)));
  const air = r.kind === 'pass' && r.air != null ? Math.max(1, Math.min(r.air, 100 - e.yl0)) : 0;
  const catchAt = toYou(e.off, Math.min(100, e.yl0 + air));
  const bad = r.turnover || r.safety || r.kind === 'sack' || (!r.penalty && gained < 0);
  const kind: 'run' | 'pass' | 'inc' | 'kick' | 'flag' =
    r.penalty ? 'flag' : r.kind === 'fg' || r.kind === 'punt' ? 'kick' : r.kind === 'pass' && !r.complete ? 'inc' : r.kind === 'pass' ? 'pass' : 'run';
  return { from, to, catchAt, dir, bad, kind, td: !!r.td, gained };
}

export function DriveChart({ s, teams, ev, cur, flash }: { s: State; teams: [TeamInfo, TeamInfo]; ev: Ev[]; cur: Drive | undefined; flash: { key: number; text: string; team: 0 | 1 } | null }) {
  const live = s.stage === 'pre' || s.stage === 'call';
  // phones: a taller field with heavier marks, so a 390-pixel-wide chart still reads
  const narrow = typeof window !== 'undefined' && window.innerWidth < 640;
  const H = narrow ? 620 : 300, k = narrow ? 2.4 : 1;
  const ball = toYou(s.off, s.yl);
  const togo = toYou(s.off, Math.min(100, s.yl + s.dist));
  const snaps = (cur?.snaps ?? []).map((i) => ev[i] as Snap).filter((e) => e?.type === 'snap');
  const shown = snaps.slice(-ROWS);
  const first = snaps.length - shown.length;
  const top = narrow ? 20 : 38, rowH = (H - top - (narrow ? 20 : 34)) / ROWS;
  const team = cur ? teams[cur.team] : teams[s.off];
  return (
    <div className="tr-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Drive chart: ball on the ${Math.round(ball)}`}>
        <defs>
          <marker id="tr-arrow" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10z" fill="context-stroke" /></marker>
        </defs>
        {/* turf: five-yard stripes, end zones in the teams' colors */}
        <rect x="0" y="0" width={W} height={H} fill="var(--turf)" />
        {Array.from({ length: 20 }, (_, i) => i).filter((i) => i % 2 === 0).map((i) => <rect key={i} x={X(i * 5)} y="0" width={X(5) - X(0)} height={H} fill="var(--turf-2)" />)}
        <rect x="0" y="0" width={EZ} height={H} fill={teams[0].color} />
        <rect x={W - EZ} y="0" width={EZ} height={H} fill={teams[1].color} />
        <text x={EZ / 2} y={H / 2} className="tr-ez" fill={chipInk(teams[0].color, teams[0].color2)} transform={`rotate(-90 ${EZ / 2} ${H / 2})`}>{teams[0].name.toUpperCase()}</text>
        <text x={W - EZ / 2} y={H / 2} className="tr-ez" fill={chipInk(teams[1].color, teams[1].color2)} transform={`rotate(90 ${W - EZ / 2} ${H / 2})`}>{teams[1].name.toUpperCase()}</text>
        {Array.from({ length: 19 }, (_, i) => (i + 1) * 5).map((y) => (
          <line key={y} x1={X(y)} x2={X(y)} y1="0" y2={H} stroke={y % 10 ? 'var(--chalk-2)' : 'rgba(255,255,255,.5)'} strokeWidth={y % 10 ? 1 : 2} />
        ))}
        {Array.from({ length: 99 }, (_, i) => i + 1).filter((y) => y % 5).map((y) => (
          <g key={y} stroke="rgba(255,255,255,.35)" strokeWidth="1.5"><line x1={X(y)} x2={X(y)} y1="4" y2="12" /><line x1={X(y)} x2={X(y)} y1={H - 12} y2={H - 4} /></g>
        ))}
        {Array.from({ length: 9 }, (_, i) => (i + 1) * 10).map((y) => (
          <g key={y} className="tr-yd"><text x={X(y)} y="30">{y <= 50 ? y : 100 - y}</text><text x={X(y)} y={H - 16}>{y <= 50 ? y : 100 - y}</text></g>
        ))}
        {/* the line of scrimmage and the line to gain */}
        {live && <line x1={X(ball)} x2={X(ball)} y1="0" y2={H} stroke="var(--los)" strokeWidth={4 * k} opacity=".9" />}
        {live && togo < 100 && togo > 0 && <line x1={X(togo)} x2={X(togo)} y1="0" y2={H} stroke="var(--fd)" strokeWidth={4 * k} opacity=".9" />}
        {/* the drive, one row per snap, oldest on top */}
        {shown.map((e, i) => {
          const g = geometry(e), y = top + i * rowH + rowH / 2;
          const col = g.td ? 'var(--accent)' : g.bad ? '#ff6b5e' : '#fff';
          const x0 = X(g.from), x1 = X(g.to), xc = X(g.catchAt);
          const lift = Math.min(rowH * 1.4, 12 + Math.abs(xc - x0) * 0.18);
          const n = first + i + 1;
          return (
            <g key={e.t0 + ':' + i} className="tr-snap">
              <circle cx={x0} cy={y} r={9 * k} fill={team.color} stroke="rgba(255,255,255,.7)" strokeWidth={1.5 * k} />
              <text x={x0} y={y + 4 * k} className="tr-n" style={narrow ? { fontSize: 26 } : undefined}>{n}</text>
              {g.kind === 'run' && <line x1={x0 + 10 * g.dir} y1={y} x2={x1} y2={y} stroke={col} strokeWidth={5 * k} strokeLinecap="round" markerEnd="url(#tr-arrow)" />}
              {g.kind === 'pass' && <>
                <path d={`M${x0 + 10 * g.dir} ${y} Q${(x0 + xc) / 2} ${y - lift} ${xc} ${y}`} fill="none" stroke={col} strokeWidth={3.5 * k} strokeDasharray={`${2 * k} ${7 * k}`} strokeLinecap="round" />
                <line x1={xc} y1={y} x2={x1} y2={y} stroke={col} strokeWidth={5 * k} strokeLinecap="round" markerEnd={x1 !== xc ? 'url(#tr-arrow)' : undefined} />
                <circle cx={xc} cy={y} r={4.5 * k} fill={col} />
              </>}
              {g.kind === 'inc' && <>
                <path d={`M${x0 + 10 * g.dir} ${y} Q${(x0 + xc) / 2} ${y - lift} ${xc} ${y}`} fill="none" stroke={g.bad ? 'var(--r)' : 'rgba(255,255,255,.55)'} strokeWidth={3 * k} strokeDasharray={`${2 * k} ${7 * k}`} strokeLinecap="round" />
                <path d={`M${xc - 6 * k} ${y - 6 * k} L${xc + 6 * k} ${y + 6 * k} M${xc + 6 * k} ${y - 6 * k} L${xc - 6 * k} ${y + 6 * k}`} stroke={g.bad ? 'var(--r)' : 'rgba(255,255,255,.8)'} strokeWidth={3 * k} strokeLinecap="round" />
              </>}
              {g.kind === 'flag' && <rect x={x0 + 14 * k * g.dir - 6 * k} y={y - 7 * k} width={12 * k} height={14 * k} rx="2" fill="#f5c518" />}
              {g.kind === 'kick' && <path d={`M${x0 + 10 * g.dir} ${y} Q${x0 + 60 * g.dir} ${y - rowH * 1.4} ${x0 + 120 * g.dir} ${y}`} fill="none" stroke="rgba(255,255,255,.75)" strokeWidth={3 * k} strokeDasharray={`${4 * k} ${6 * k}`} />}
            </g>
          );
        })}
        {/* the ball: glides to its new spot */}
        <g className="tr-ball" style={{ transform: `translate(${X(ball)}px, ${shown.length ? top + Math.min(shown.length, ROWS - 1) * rowH + rowH / 2 : H / 2}px)` }}>
          <ellipse rx={15 * k} ry={9 * k} fill="#8a4b22" stroke="#fff" strokeWidth={2.5 * k} />
          <line x1={-6 * k} x2={6 * k} y1="0" y2="0" stroke="#fff" strokeWidth={2 * k} />
        </g>
      </svg>
      {flash && <div key={flash.key} className="tr-flash" style={tv(teams[flash.team])}><b>{flash.text}</b><span>{teams[flash.team].name}</span></div>}
    </div>
  );
}

/** The play that just happened, called big, with the yards and what it did to the drive. */
export function LastPlay({ ev, teams, s, cur, ff }: { ev: Ev[]; teams: [TeamInfo, TeamInfo]; s: State; cur: Drive | undefined; ff: 'moment' | 'end' | null }) {
  let last: Ev | undefined;
  for (let i = ev.length - 1; i >= 0; i--) { const e = ev[i]; if (e.type === 'snap' || e.type === 'kick' || (e.type === 'pat' && !e.played)) { last = e; break; } }
  const told = last ? tell(last, teams) : null;
  let chip = 'Kickoff', big: string | null = null;
  if (last?.type === 'snap') {
    const r = last.res;
    chip = r.penalty ? 'Flag' : r.kind === 'fg' ? 'Field goal' : r.kind === 'punt' ? 'Punt' : r.kind === 'sack' ? 'Sack' : r.kind === 'scramble' ? 'Scramble' : r.kind === 'pass' ? (r.complete ? 'Pass' : 'Incomplete') : r.kind === 'kneel' ? 'Kneel' : r.kind === 'spike' ? 'Spike' : 'Run';
    if (r.td) chip = 'Touchdown';
    else if (r.intercepted) chip = 'Interception';
    else if (r.fumble && r.turnover) chip = 'Fumble';
    if (!r.penalty && !r.turnover && r.kind !== 'fg' && r.kind !== 'punt' && r.kind !== 'spike' && !(r.kind === 'pass' && !r.complete)) big = `${r.yards > 0 ? '+' : ''}${r.yards}`;
    if (last.first && !r.td) chip += ' · First down';
  } else if (last?.type === 'pat') chip = last.two ? 'Two-point try' : 'Extra point';
  const live = s.stage === 'pre' || s.stage === 'call';
  return (
    <div className={`tr-last tone-${told?.tone ?? 'neutral'}`}>
      <div className="tr-last-k">
        <span className="tr-live"><i />{ff ? (ff === 'end' ? 'Simming to the end' : 'Skipping to your next moment') : 'Live'}</span>
        {cur && !cur.done && <span><b>{teams[cur.team].city}</b> · {cur.plays} play{cur.plays === 1 ? '' : 's'}, {cur.yards} yd, {fmtSecs(cur.secs)}</span>}
        {live && <span className="tr-dd">{downDist(s)} · {fmtClock(s.t)}</span>}
      </div>
      <div key={ev.length} className="tr-last-main">
        <span className="tr-chip">{chip}</span>
        <p>{told?.text ?? 'Kickoff…'}</p>
        {big && <strong className="tr-yds">{big}<small>yd</small></strong>}
      </div>
    </div>
  );
}

/** Your quarterback's line, as it happens. */
export function YourLine({ name, line }: { name: string; line: Line }) {
  const pa = line.pa ?? 0, pc = line.pc ?? 0;
  return (
    <div className="tr-you">
      <div className="k">{name}</div>
      <div className="tr-you-row">
        <span><b>{pc}/{pa}</b>comp</span>
        <span><b>{line.py ?? 0}</b>pass yd</span>
        <span><b>{line.ptd ?? 0}</b>TD</span>
        <span><b>{line.pint ?? 0}</b>INT</span>
        {(line.ra ?? 0) > 0 && <span><b>{line.ry ?? 0}</b>rush yd</span>}
      </div>
    </div>
  );
}

/** The game's drives, newest first: who, how it ended, and a bar of where it went on the field. */
export function DriveList({ ds, teams }: { ds: Drive[]; teams: [TeamInfo, TeamInfo] }) {
  if (!ds.length) return <p className="muted small">No drives yet.</p>;
  return (
    <ol className="tr-drives">
      {[...ds].reverse().slice(0, 16).map((d, i) => {
        const a = Math.min(d.start, d.end), b = Math.max(d.start, d.end);
        const tone = d.score ? 'score' : /Interception|Fumble|Pick|Safety|Downs|Blocked|Missed/.test(d.result) ? 'lost' : '';
        return (
          <li key={ds.length - i} className={`tr-dr ${tone}${d.done ? '' : ' live'}`} style={{ ['--tc' as string]: teams[d.team].color }}>
            <span className="tr-dr-t">{teams[d.team].id}</span>
            <span className="tr-dr-r">{d.done ? d.result : 'In progress'}</span>
            <span className="tr-dr-q">Q{d.q > 4 ? 'OT' : d.q}</span>
            <span className="tr-dr-bar" aria-hidden><i style={{ left: `${a}%`, width: `${Math.max(1.5, b - a)}%` }} /><em style={{ left: `${d.end}%` }} /></span>
            <span className="tr-dr-n">{d.plays} pl · {d.yards} yd · {fmtSecs(d.secs)}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** A score in the events just played: the flash over the field. */
export function scoreFlash(ev: Ev[]): { key: number; text: string; team: 0 | 1 } | null {
  // the try and the kickoff that follow a score don't cut its flash short (the flash plays once, by its event's index)
  for (let i = ev.length - 1; i >= Math.max(0, ev.length - 3); i--) {
    const e = ev[i];
    if (e.type === 'snap') {
      const r = e.res;
      if (r.td) return { key: i, text: 'Touchdown', team: e.off };
      if (r.defTd) return { key: i, text: r.kind === 'punt' ? 'Return touchdown' : 'Pick six', team: e.off === 0 ? 1 : 0 };
      if (r.kind === 'fg' && r.good) return { key: i, text: 'Field goal', team: e.off };
      if (r.safety) return { key: i, text: 'Safety', team: e.off === 0 ? 1 : 0 };
      if (r.intercepted) return { key: i, text: 'Intercepted', team: e.off === 0 ? 1 : 0 };
      return null;
    }
    if (e.type === 'kick' && e.td) return { key: i, text: 'Return touchdown', team: e.recover };
  }
  return null;
}
