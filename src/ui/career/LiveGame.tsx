/**
 * One of your games, live. The drive tracker plays the game out snap by snap (scorebug, field strip, play-by-play,
 * drive summaries). When a moment comes, the game hands you the ball: Take over opens the play caller for that
 * drive, and when the drive is over it hands the game back to the tracker.
 *
 * You can change your mind at any point: switch between every snap and the moments, sim the rest of a drive you
 * took over, skip to the next moment, or sim to the end. The game keeps its clock either way.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { step } from '../../engine/game';
import { clone, leadOf, tossFor0 } from '../../engine/sim';
import type { Choice, Ev, State, TeamInfo } from '../../engine/types';
import { downDist, fmtClock, tell } from '../../game/describe';
import type { Settings as AppSettings } from '../../game/storage';
import type { Career } from '../../career/career';
import { drives } from '../../career/drives';
import { applyClutch, driveOver, endMoment, gameOf, isMoment, liveBox, liveTeams, momentScenario } from '../../career/run';
import { DriveChart, DriveList, LastPlay, YourLine, scoreFlash } from './Tracker';
import type { LiveGame } from '../../career/types';
import { WEEK_NAME } from '../../career/season';
import { GameScreen } from '../GameScreen';
import { AdSlot, gameOnScreen } from '../AdSlot';
import { Scoreboard, periodName } from '../Scoreboard';
import { CoinToss } from '../CoinToss';

interface Props {
  c: Career;
  app: AppSettings;
  save: (live: LiveGame) => void;
  onFinal: (how: 'moments' | 'full' | 'sim') => void;
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
  const [view, setView] = useState<View>(() => (L.seg ? (L.seg.taken === false ? 'prompt' : 'play') : L.s.stage === 'over' ? 'final' : 'watch'));
  const [fast, setFast] = useState(c.settings.speed === 'fast');
  const skipRef = useRef(false);        // "keep simming" this drive
  const ffRef = useRef<'moment' | 'end' | null>(null);   // skip ahead: to the next moment, or the end
  const [ff, setFf] = useState<'moment' | 'end' | null>(null);

  const persist = useCallback(() => save(structuredClone(liveRef.current)), [save]);
  /** The play caller's hand-back (GameScreen fills it in), and what to do once the game is back with the tracker. */
  const leave = useRef<(() => void) | null>(null);
  const after = useRef<'drive' | 'moments' | 'end' | null>(null);
  /** Every snap, or the moments: the game goes on from where it is. */
  const setMode = (m: 'moments' | 'full') => {
    if (liveRef.current.mode === m) return;
    liveRef.current.mode = m;
    // every snap means now: a drive of yours the sim is running comes to you at its next snap
    if (m === 'full') { skipRef.current = false; ffRef.current = null; setFf(null); }
    persist(); rerender();
  };
  /** From inside a drive you took over: give it back to the sim. */
  const handBack = (to: 'drive' | 'moments' | 'end') => { after.current = to; leave.current?.(); };

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
          liveRef.current.seg = { start: clone(s), picks: [], taken: L.mode === 'full' };
          if (L.mode === 'full') liveRef.current.played = true;
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

  const takeOver = () => { if (liveRef.current.seg) liveRef.current.seg.taken = true; liveRef.current.played = true; persist(); setView('play'); };
  /** Your call at the toss, or your choice after it: one step of the game with your decision. */
  const tossStep = (ch: Choice) => {
    const ev: Ev[] = [];
    step(liveRef.current.seed, liveRef.current.s, ev, ch);
    liveRef.current.ev.push(...ev);
    persist();
    if (liveRef.current.s.stage === 'toss') rerender(); else setView('watch');
  };
  const keepSimming = () => { skipRef.current = true; liveRef.current.seg = undefined; persist(); setView('watch'); };
  const skipAhead = (to: 'moment' | 'end') => { ffRef.current = to; setFf(to); if (view === 'prompt' && to === 'end') { liveRef.current.seg = undefined; persist(); setView('watch'); } };

  const sc = useMemo(() => (view === 'play' ? momentScenario(c, liveRef.current) : null), [view]);   // eslint-disable-line react-hooks/exhaustive-deps

  const s = L.s;
  const ds = useMemo(() => drives(L.ev), [L.ev.length]);   // eslint-disable-line react-hooks/exhaustive-deps
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
  const line = useMemo(() => { try { return liveBox(c, L).box.players[c.you.pid] ?? {}; } catch { return {}; } }, [L.ev.length]);   // eslint-disable-line react-hooks/exhaustive-deps
  // a score's flash plays its whole 2.2 s, whatever comes next (the try, the kickoff, a fast sim)
  const held = useRef<{ key: number; text: string; team: 0 | 1; until: number } | null>(null);
  const f = view === 'watch' ? scoreFlash(L.ev) : null;
  if (f && f.key !== held.current?.key) held.current = { ...f, until: Date.now() + 2200 };
  const flash = view === 'watch' && held.current && Date.now() < held.current.until ? held.current : null;

  if (view === 'play' && sc) {
    return (
      <GameScreen key={sc.id} sc={sc} saved={L.seg?.picks ?? []} settings={app} hints={c.settings.diff === 'rookie'} autoStart label="Your drive"
        meta={<MomentHeader c={c} s={sc.start} full={L.mode === 'full'} onBack={handBack} />}
        onPicks={(p) => { if (liveRef.current.seg) { liveRef.current.seg.picks = p.map((x) => ({ key: x.key, choice: x.choice, grade: x.grade })); persist(); } }}
        onDone={() => {}} onContinue={() => {}} continueLabel="Back to the game"
        segment={{
          endLabel: 'Back to the game',
          leave,
          onEnd: (end, records, log) => {
            endMoment(liveRef.current, end, log, records.filter((r) => r.grade && r.step === 'play').map((r) => r.grade!.score));
            const to = after.current;
            after.current = null;
            if (to === 'moments') liveRef.current.mode = 'moments';
            if (to === 'drive' || to === 'moments') skipRef.current = true;   // the rest of this drive goes to the sim
            if (to === 'end') { ffRef.current = 'end'; setFf('end'); }
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
        <span className="eyebrow">{g.id === 'college' ? 'College bowl game' : WEEK_NAME(g.week)}</span>
        <div className="cg-mode" role="group" aria-label="How much you play">
          <button className={L.mode === 'full' ? 'on' : ''} aria-pressed={L.mode === 'full'} onClick={() => setMode('full')}>Every snap</button>
          <button className={L.mode === 'moments' ? 'on' : ''} aria-pressed={L.mode === 'moments'} onClick={() => setMode('moments')}>The moments</button>
        </div>
        <button className="btn ghost small" onClick={() => { persist(); onLeave(); }}>Save &amp; exit</button>
      </div>
      <Scoreboard s={s} teams={teams} wp={null} trail={[]} noWp />
      <DriveChart s={s} teams={teams} ev={L.ev} cur={cur} flash={flash} />
      <div className="cg-grid">
        <section className="cg-main">
          {view === 'prompt' && <MomentPrompt s={s} teams={teams} onTake={takeOver} onSim={keepSimming} onEnd={() => skipAhead('end')} />}
          {view === 'toss' && s.stage === 'toss' && (
            <div className="cg-toss">
              <CoinToss s={s} teams={teams} onCall={(c) => tossStep({ toss: c })} onChoose={(recv) => tossStep({ recv })} onContinue={() => setView('watch')} />
            </div>
          )}
          {view === 'final' && (
            <div className="cg-final">
              <div className="eyebrow">Final{s.q && s.q >= 5 ? ' · overtime' : ''}</div>
              <h2>{s.score[0] > s.score[1] ? 'Win' : s.score[0] < s.score[1] ? 'Loss' : 'Tie'}: {teams[0].name} {s.score[0]}, {teams[1].name} {s.score[1]}</h2>
              {/* a game you never took a snap of (straight to Sim to the end) counts as simmed, like the Sim button */}
              <button className="btn primary big" onClick={() => onFinal(L.played || L.scores?.length ? L.mode : 'sim')}>Postgame</button>
            </div>
          )}
          {view === 'final' && <AdSlot where="end" />}
          {view === 'watch' && (
            <div className="cg-now">
              <LastPlay ev={L.ev} teams={teams} s={s} cur={cur} ff={ff} />
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
          <YourLine name={c.you.name} line={line} />
          <h3>Drives</h3>
          <DriveList ds={ds} teams={teams} />
        </aside>
      </div>
    </div>
  );
}

const periodShortOf = (q: number) => (q <= 4 ? `Q${q}` : 'OT');

function MomentPrompt({ s, teams, onTake, onSim, onEnd }: { s: State; teams: [TeamInfo, TeamInfo]; onTake: () => void; onSim: () => void; onEnd: () => void }) {
  const l = leadOf(s, 0);
  const score = l > 0 ? `up ${l}` : l < 0 ? `down ${-l}` : 'tied';
  const spot = Math.round(s.yl) === 50 ? 'midfield' : s.yl < 50 ? `your own ${Math.round(s.yl)}` : `the ${teams[1].id} ${100 - Math.round(s.yl)}`;
  useEffect(() => {
    // Enter takes over, unless focus is on one of the other buttons (then Enter is that button)
    const k = (e: KeyboardEvent) => { if (e.key === 'Enter' && !(e.target as HTMLElement)?.closest?.('button, a, input, select, textarea')) { e.preventDefault(); onTake(); } };
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
        <button className="btn" onClick={onSim}>Sim this drive</button>
        <button className="btn ghost" onClick={onEnd}>Sim to the end</button>
      </div>
    </div>
  );
}

function MomentHeader({ c, s, full, onBack }: { c: Career; s: State; full: boolean; onBack: (to: 'drive' | 'moments' | 'end') => void }) {
  const l = leadOf(s, 0);
  return (
    <div className="meta cg-mhead">
      <div className="meta-l">
        <h2 className="meta-title">Your <span>drive</span></h2>
        <span className="muted">{periodName(s.q)} · {fmtClock(s.t)} · {l > 0 ? `up ${l}` : l < 0 ? `down ${-l}` : 'tied'} · QB {c.you.name}</span>
      </div>
      {/* changed your mind: hand the ball back (after the play in motion, if one is) */}
      <div className="cg-back" role="group" aria-label="Hand it to the sim">
        <button className="btn small" onClick={() => onBack('drive')}>Sim this drive</button>
        {full && <button className="btn small" onClick={() => onBack('moments')}>Just the moments</button>}
        <button className="btn small ghost" onClick={() => onBack('end')}>Sim to the end</button>
      </div>
    </div>
  );
}
