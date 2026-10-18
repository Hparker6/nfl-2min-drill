/**
 * One of your games, live. The drive tracker plays the game out snap by snap (scorebug, field strip, play-by-play,
 * drive summaries). When a moment comes, the game hands you the ball: Take over opens the play caller for that
 * drive, and when the drive is over it hands the game back to the tracker.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { step } from '../../engine/game';
import { clone, leadOf, tossFor0 } from '../../engine/sim';
import type { Choice, Ev, State, TeamInfo } from '../../engine/types';
import { downDist, fmtClock, tell } from '../../game/describe';
import type { Settings as AppSettings } from '../../game/storage';
import type { Career } from '../../career/career';
import { drives, fmtSecs, toYou, type Drive } from '../../career/drives';
import { applyClutch, driveOver, endMoment, gameOf, isMoment, liveTeams, momentScenario } from '../../career/run';
import type { LiveGame } from '../../career/types';
import { WEEK_NAME } from '../../career/season';
import { GameScreen } from '../GameScreen';
import { gameOnScreen } from '../AdSlot';
import { Scoreboard, periodName } from '../Scoreboard';
import { CoinToss } from '../CoinToss';

interface Props {
  c: Career;
  app: AppSettings;
  save: (live: LiveGame) => void;
  onFinal: (how: 'moments' | 'full') => void;
  onLeave: () => void;
}

type View = 'watch' | 'prompt' | 'play' | 'toss' | 'final';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const shownEv = (e: Ev) => e.type === 'snap' || e.type === 'kick' || e.type === 'pat' || e.type === 'period' || e.type === 'final' || e.type === 'timeout' || e.type === 'warning';

export function LiveGameView({ c, app, save, onFinal, onLeave }: Props) {
  useEffect(() => { gameOnScreen(true); return () => gameOnScreen(false); }, []);   // a live game: no ads, as in GameScreen
  const liveRef = useRef<LiveGame>(structuredClone(c.live!));
  const L = liveRef.current;
  const g = gameOf(c, L.gameId);
  const teams = useMemo(() => liveTeams(c, g), []);   // eslint-disable-line react-hooks/exhaustive-deps
  const [, setTick] = useState(0);
  const rerender = () => setTick((t) => t + 1);
  const [view, setView] = useState<View>(() => (L.seg ? 'play' : L.s.stage === 'over' ? 'final' : 'watch'));
  const [fast, setFast] = useState(c.settings.speed === 'fast');
  const skipRef = useRef(false);        // "keep simming" this drive
  const ffRef = useRef<'moment' | 'end' | null>(null);   // skip ahead: to the next moment, or the end
  const [ff, setFf] = useState<'moment' | 'end' | null>(null);

  const persist = useCallback(() => save(structuredClone(liveRef.current)), [save]);

  /** The next stop for the tracker: a moment for you, or the end. */
  const atMoment = (s: State) => {
    if (skipRef.current && driveOver(s)) skipRef.current = false;
    return ffRef.current !== 'end' && !skipRef.current && isMoment(c, s, L.mode);
  };

  useEffect(() => {
    if (view !== 'watch') return;
    let cancelled = false;
    (async () => {
      let n = 0;
      while (!cancelled) {
        const s = liveRef.current.s;
        if (s.stage === 'over') { persist(); setView('final'); return; }
        // overtime's coin toss: you call it (unless you're simming to the end)
        if (tossFor0(s) && ffRef.current !== 'end') { ffRef.current = null; setFf(null); persist(); setView('toss'); return; }
        if (atMoment(s)) {
          ffRef.current = null; setFf(null);
          liveRef.current.seg = { start: clone(s), picks: [] };
          persist();
          setView(L.mode === 'full' ? 'play' : 'prompt');
          return;
        }
        const ev: Ev[] = [];
        applyClutch(c, liveRef.current, s);
        step(liveRef.current.seed, s, ev);
        liveRef.current.ev.push(...ev);
        if (++n % 25 === 0) persist();
        if (ffRef.current) { if (n % 40 === 0) { rerender(); await sleep(0); } continue; }
        if (ev.some(shownEv)) { rerender(); await sleep(fast ? 160 : 650); }
      }
    })();
    return () => { cancelled = true; };
  }, [view, fast]);   // eslint-disable-line react-hooks/exhaustive-deps

  const takeOver = () => { setView('play'); };
  /** Your call at the toss, or your choice after it: one step of the game with your decision. */
  const tossStep = (ch: Choice) => {
    const ev: Ev[] = [];
    step(liveRef.current.seed, liveRef.current.s, ev, ch);
    liveRef.current.ev.push(...ev);
    persist();
    if (liveRef.current.s.stage === 'toss') rerender(); else setView('watch');
  };
  const keepSimming = () => { skipRef.current = true; liveRef.current.seg = undefined; persist(); setView('watch'); };
  const skipAhead = (to: 'moment' | 'end') => { ffRef.current = to; setFf(to); if (view === 'prompt' && to === 'end') { liveRef.current.seg = undefined; setView('watch'); } };

  const sc = useMemo(() => (view === 'play' ? momentScenario(c, liveRef.current) : null), [view]);   // eslint-disable-line react-hooks/exhaustive-deps

  const s = L.s;
  const ds = drives(L.ev);
  const feed = useMemo(() => {
    const out: { t: number; q: number; text: string; tone: string; key: number }[] = [];
    let q = 1;
    L.ev.forEach((e, i) => {
      if (e.type === 'period') q = e.q;
      const told = tell(e, teams);
      if (told.text) out.push({ t: e.t, q, text: told.text, tone: told.tone, key: i });
    });
    return out.reverse().slice(0, 40);
  }, [L.ev.length]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (view === 'play' && sc) {
    return (
      <GameScreen key={sc.id} sc={sc} saved={L.seg?.picks ?? []} settings={app} hints={c.settings.diff === 'rookie'} autoStart label="Your drive"
        meta={<MomentHeader c={c} s={sc.start} />}
        onPicks={(p) => { if (liveRef.current.seg) { liveRef.current.seg.picks = p.map((x) => ({ key: x.key, choice: x.choice, grade: x.grade })); persist(); } }}
        onDone={() => {}} onContinue={() => {}} continueLabel="Back to the game"
        segment={{
          endLabel: 'Back to the game',
          onEnd: (end, records, log) => {
            endMoment(liveRef.current, end, log, records.filter((r) => r.grade && r.step === 'play').map((r) => r.grade!.score));
            persist();
            window.scrollTo({ top: 0 });
            setView(end.stage === 'over' ? 'final' : 'watch');
          },
        }} />
    );
  }

  const cur = ds[ds.length - 1];
  return (
    <div className="cg">
      <div className="cg-top">
        <span className="eyebrow">{g.id === 'college' ? 'College bowl game' : WEEK_NAME(g.week)} · {L.mode === 'full' ? 'Full game' : 'Playing the moments'}</span>
        <button className="btn ghost small" onClick={() => { persist(); onLeave(); }}>Save &amp; exit</button>
      </div>
      <Scoreboard s={s} teams={teams} wp={null} trail={[]} noWp />
      <FieldStrip s={s} teams={teams} ds={ds} />
      <div className="cg-grid">
        <section className="cg-main">
          {view === 'prompt' && <MomentPrompt s={s} teams={teams} onTake={takeOver} onSim={keepSimming} />}
          {view === 'toss' && s.stage === 'toss' && (
            <div className="cg-toss">
              <CoinToss s={s} teams={teams} onCall={(c) => tossStep({ toss: c })} onChoose={(recv) => tossStep({ recv })} onContinue={() => setView('watch')} />
            </div>
          )}
          {view === 'final' && (
            <div className="cg-final">
              <div className="eyebrow">Final{s.q && s.q >= 5 ? ' · overtime' : ''}</div>
              <h2>{s.score[0] > s.score[1] ? 'Win' : s.score[0] < s.score[1] ? 'Loss' : 'Tie'}: {teams[0].name} {s.score[0]}, {teams[1].name} {s.score[1]}</h2>
              <button className="btn primary big" onClick={() => onFinal(L.mode)}>Postgame</button>
            </div>
          )}
          {view === 'watch' && (
            <div className="cg-now">
              <div className="k">{ff ? (ff === 'end' ? 'Simming to the end…' : 'Skipping to your next moment…') : 'Live'}</div>
              {cur && !cur.done ? (
                <p className="cg-drive"><b>{teams[cur.team].city}</b> drive: {cur.plays} play{cur.plays === 1 ? '' : 's'}, {cur.yards} yards, {fmtSecs(cur.secs)}{s.stage === 'pre' || s.stage === 'call' ? <> · <b>{downDist(s)}</b></> : null}</p>
              ) : <p className="cg-drive muted">{feed[0]?.text ?? 'Kickoff…'}</p>}
              <div className="cg-ctl">
                <button className={`btn${fast ? ' on' : ''}`} onClick={() => setFast(!fast)} aria-pressed={fast}>{fast ? 'Fast' : 'Normal speed'}</button>
                {L.mode === 'moments' && <button className="btn" onClick={() => skipAhead('moment')} disabled={!!ff}>Skip to my next moment</button>}
                <button className="btn ghost" onClick={() => skipAhead('end')} disabled={ff === 'end'}>Sim to the end</button>
              </div>
            </div>
          )}
          <ol className="cg-feed" aria-label="Play-by-play">
            {feed.map((l) => <li key={l.key} className={`tone-${l.tone}`}><span>{periodShortOf(l.q)} {fmtClock(l.t)}</span>{l.text}</li>)}
          </ol>
        </section>
        <aside className="cg-side">
          <h3>Drives</h3>
          <ol className="cg-drives">
            {[...ds].reverse().slice(0, 14).map((d, i) => <DriveRow key={ds.length - i} d={d} teams={teams} />)}
          </ol>
        </aside>
      </div>
    </div>
  );
}

const periodShortOf = (q: number) => (q <= 4 ? `Q${q}` : 'OT');

function DriveRow({ d, teams }: { d: Drive; teams: [TeamInfo, TeamInfo] }) {
  return (
    <li className={`cg-dr${d.score ? ' score' : ''}${d.team === 0 ? ' you' : ''}`} style={{ ['--tc' as string]: teams[d.team].color }}>
      <span className="cg-dr-t">{teams[d.team].id}</span>
      <span className="cg-dr-r">{d.done ? d.result : 'In progress'}</span>
      <span className="cg-dr-n">{d.plays} pl · {d.yards} yd · {fmtSecs(d.secs)}</span>
    </li>
  );
}

function MomentPrompt({ s, teams, onTake, onSim }: { s: State; teams: [TeamInfo, TeamInfo]; onTake: () => void; onSim: () => void }) {
  const l = leadOf(s, 0);
  const score = l > 0 ? `up ${l}` : l < 0 ? `down ${-l}` : 'tied';
  const spot = Math.round(s.yl) === 50 ? 'midfield' : s.yl < 50 ? `your own ${Math.round(s.yl)}` : `the ${teams[1].id} ${100 - Math.round(s.yl)}`;
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); onTake(); } };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onTake]);
  return (
    <div className="cg-moment" role="alertdialog" aria-label="Your moment">
      <div className="eyebrow">Your moment</div>
      <h2>{downDist(s)} at {spot}</h2>
      <p>{periodName(s.q)}, {fmtClock(s.t)} left, {score}. The ball is yours.</p>
      <div className="row">
        <button className="btn primary big" onClick={onTake} autoFocus>Take over</button>
        <button className="btn" onClick={onSim}>Keep simming</button>
      </div>
    </div>
  );
}

function MomentHeader({ c, s }: { c: Career; s: State }) {
  const l = leadOf(s, 0);
  return (
    <div className="meta cg-mhead">
      <div className="meta-l">
        <h2 className="meta-title">Your <span>drive</span></h2>
        <span className="muted">{periodName(s.q)} · {fmtClock(s.t)} · {l > 0 ? `up ${l}` : l < 0 ? `down ${-l}` : 'tied'} · QB {c.you.name}</span>
      </div>
    </div>
  );
}

/** The field from the side: your team attacks right. The current drive is an arrow; earlier ones are faint. */
export function FieldStrip({ s, teams, ds }: { s: State; teams: [TeamInfo, TeamInfo]; ds: Drive[] }) {
  const X = (y: number) => 60 + y * 10.8;
  const live = s.stage === 'pre' || s.stage === 'call';
  const ball = toYou(s.off, s.yl);
  const togo = toYou(s.off, Math.min(100, s.yl + s.dist));
  const cur = ds[ds.length - 1];
  const past = ds.slice(-7, cur && !cur.done ? -1 : undefined);
  // phones: the strip stretches to a readable height (the yard numbers and names give way)
  const narrow = typeof window !== 'undefined' && window.innerWidth < 640;
  return (
    <svg className="cg-field" viewBox="0 0 1200 120" preserveAspectRatio={narrow ? 'none' : undefined} role="img" aria-label={`Ball on the ${Math.round(ball)}`}>
      <rect x="0" y="0" width="1200" height="120" fill="var(--turf)" />
      <rect x="0" y="0" width="60" height="120" fill={teams[0].color} />
      <rect x="1140" y="0" width="60" height="120" fill={teams[1].color} />
      <text x="30" y="64" className="cg-ez" fill={teams[0].color2} transform="rotate(-90 30 60)">{teams[0].name.toUpperCase()}</text>
      <text x="1170" y="64" className="cg-ez" fill={teams[1].color2} transform="rotate(90 1170 60)">{teams[1].name.toUpperCase()}</text>
      {Array.from({ length: 9 }, (_, i) => (i + 1) * 10).map((y) => (
        <g key={y}>
          <line x1={X(y)} x2={X(y)} y1="0" y2="120" stroke="var(--chalk-2)" strokeWidth="2" />
          <text x={X(y)} y="114" className="cg-yd">{y <= 50 ? y : 100 - y}</text>
        </g>
      ))}
      {past.map((d, i) => (
        <line key={i} x1={X(d.start)} x2={X(d.end)} y1={14 + i * 5} y2={14 + i * 5} stroke={teams[d.team].color} strokeWidth="3" opacity=".55" strokeLinecap="round" />
      ))}
      {cur && !cur.done && (
        <g>
          <line x1={X(cur.start)} x2={X(ball)} y1="64" y2="64" stroke={teams[cur.team].color} strokeWidth="10" strokeLinecap="round" opacity=".9" />
          <line x1={X(cur.start)} x2={X(ball)} y1="64" y2="64" stroke={teams[cur.team].color2} strokeWidth="2" strokeDasharray="6 6" />
        </g>
      )}
      {live && <line x1={X(togo)} x2={X(togo)} y1="30" y2="100" stroke="var(--fd)" strokeWidth="4" />}
      {live && <line x1={X(ball)} x2={X(ball)} y1="30" y2="100" stroke="var(--los)" strokeWidth="4" />}
      <g transform={`translate(${X(ball)} 64)`}>
        <ellipse rx="13" ry="8" fill="#8a4b22" stroke="#fff" strokeWidth="2" />
        <line x1="-5" x2="5" y1="0" y2="0" stroke="#fff" strokeWidth="2" />
      </g>
    </svg>
  );
}
