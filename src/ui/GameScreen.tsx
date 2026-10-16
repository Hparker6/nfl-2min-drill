import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CALL, POS_ROUTES } from '../engine/data';
import { clone } from '../engine/sim';
import { utcDate, type Scenario } from '../engine/scenario';
import type { Ev, Rcv, RouteId, State } from '../engine/types';
import { ballOn, downDist, fmtClock, headline, situation, tell, type Told } from '../game/describe';
import { GRADE_INFO, type Grade } from '../game/grade';
import { GradeJob } from '../game/grader';
import { Session, type Decision, type Opt, type Pick } from '../game/session';
import { tagsOf } from '../game/share';
import type { Settings, SpotResult } from '../game/storage';
import { track } from '../game/analytics';
import { CallPanel } from './CallPanel';
import { FieldView, type Banner, type FieldHandle } from './FieldView';
import { MiniPlay } from './MiniPlay';
import { Scoreboard } from './Scoreboard';
import { SpotReview } from './Review';
import type { Preview } from './field';

interface Props {
  sc: Scenario;
  saved: Pick[];
  settings: Settings;
  hints: boolean;
  meta?: ReactNode;            // mode header (day number, tiles…)
  label: string;               // "Spot 1 of 3"
  autoStart: boolean;          // resume straight into the game instead of the brief
  onStart?: () => void;
  startLabel?: string;
  briefExtra?: ReactNode;
  welcome?: ReactNode;         // first visit: a short "what is this" above the brief
  onPicks: (p: Pick[]) => void;
  onDone: (r: SpotResult) => void;
  onContinue: () => void;
  continueLabel: string;
}

/**
 * The loop, one primary action per phase:
 *   ready (pick a call) → selected (it is drawn on the field; Snap) → executing (the play runs; the result lands on
 *   the field and the scoreboard the moment it is decided) → result (the final frame stays put; Next play, or Replay)
 *   → the players jog to the next spot and the next call is ready.
 * Clock and timeout decisions are complete in one tap: they go straight on to the play call, and their grade shows
 * as "Last call" there. Steps with no decision for you ('auto': kickoffs, their kneel-downs) play out on their own.
 */
type Phase = 'brief' | 'deciding' | 'snapping' | 'auto' | 'result' | 'over';
interface FeedLine { id: number; t: number; text: string; tone: string }
interface Last { evs: Ev[]; lines: Told[]; head: Told | null; grade: Grade | null; failed?: boolean; label: string }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let uid = 0;

/** The pre-snap picture of a snap that already happened (for the next auto play, or a replay). */
const before = (s: State, ev: Extract<Ev, { type: 'snap' }>): State => ({ ...s, off: ev.off, yl: ev.yl0, down: ev.down0, dist: ev.dist0, t: ev.t0, stage: 'call' });

export function GameScreen(p: Props) {
  const { sc, saved, settings, hints, onPicks, onDone } = p;
  // a saved spot that cannot be replayed (say, after an update changed the game) starts over instead of breaking
  const boot = useMemo(() => {
    try { return { session: new Session(sc, saved), lost: false }; } catch { return { session: new Session(sc, []), lost: saved.length > 0 }; }
  }, [sc]);  // eslint-disable-line react-hooks/exhaustive-deps
  const session = boot.session;
  const field = useRef<FieldHandle>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<HTMLDivElement>(null);
  const jobRef = useRef<GradeJob | null>(null);
  const doneRef = useRef(false);
  const busyRef = useRef(false);          // one game-state transition at a time
  const staleRef = useRef(false);         // the field shows a finished play, not a formation
  const [view, setView] = useState<State>(() => clone(session.s));
  const [dec, setDec] = useState<Decision | null>(null);
  const [phase, setPhase] = useState<Phase>(!boot.lost && (p.autoStart || saved.length) ? 'auto' : 'brief');
  const [wp, setWp] = useState<number | null>(sc.baseWp);
  const [trail, setTrail] = useState<number[]>(() => [sc.baseWp, ...session.records.filter((r) => r.grade).map((r) => r.grade!.bestWp)]);
  const [hintMap, setHintMap] = useState<Map<string, number> | null>(null);
  const [sel, setSel] = useState<Opt | null>(null);
  const [target, setTarget] = useState<Rcv | null>(null);
  const [route, setRoute] = useState<RouteId | null>(null);
  const [feed, setFeed] = useState<FeedLine[]>(() =>
    session.log.map((l) => ({ id: ++uid, t: l.ev.t, ...tell(l.ev, sc.teams) })).filter((l) => l.text).reverse());
  const [banner, setBanner] = useState<Banner | null>(null);
  const [last, setLast] = useState<Last | null>(null);
  const [prev, setPrev] = useState<{ label: string; g: Grade } | null>(null);
  const [snapping, setSnapping] = useState<Opt | null>(null);
  const [replaying, setReplaying] = useState(false);
  const [result, setResult] = useState<SpotResult | null>(null);

  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const speed = settings.speed === 'instant' || reduced ? 0 : settings.speed === 'fast' ? 1.6 : 1;

  const preview = useCallback((d: Decision | null, o: Opt | null, t: Rcv | null, r: RouteId | null): Preview => {
    const s = session.s;
    if (!d) return {};
    if (d.step === 'play') return { play: o?.choice.play ?? null, target: t, route: r, look: s.shownLook, routes: true };
    if (d.step === 'look') return { look: o?.choice.look ?? null };
    return {};
  }, [session]);

  /** On phones the field is above the panel: bring it into view when a play starts. */
  const showStage = () => {
    const el = stageRef.current;
    if (!el || window.innerWidth >= 1000) return;
    const r = el.getBoundingClientRect();
    if (r.top < 60 || r.bottom > window.innerHeight) el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
  };

  /** Play events on the field. The banner and the scoreboard update land when each play is decided. */
  const animate = useCallback(async (evs: Ev[]) => {
    for (const ev of evs) {
      const told = tell(ev, sc.teams);
      if (ev.type === 'snap') {
        if (staleRef.current) {
          // a second play in a row with no decision between: set the formation first, then run it
          field.current?.setup(before(session.s, ev), { look: ev.res.look });
          if (speed) await sleep(650 / speed);
        }
        setBanner(null);
        await field.current?.play(ev, speed, () => {
          if (told.banner) setBanner({ id: ++uid, text: told.banner, tone: told.tone });
          setView(clone(session.s));
          if (told.text) setFeed((f) => [{ id: ++uid, t: ev.t, ...told }, ...f]);
        });
        staleRef.current = true;
      } else {
        if (told.text) setFeed((f) => [{ id: ++uid, t: ev.t, ...told }, ...f]);
        setView(clone(session.s));
        if (told.banner) {
          setBanner({ id: ++uid, text: told.banner, tone: told.tone });
          if (speed) await sleep(1300 / speed);
        } else if (speed && (ev.type === 'kick' || ev.type === 'pat')) await sleep(700 / speed);
      }
    }
    setView(clone(session.s));
    // the field keeps the final frame; the players move to the next spot when the next call is set up
  }, [sc, session, speed]);

  const finish = useCallback(() => {
    const r = session.result();
    const recs = session.records.filter((x) => x.grade);
    const res: SpotResult = {
      id: sc.id, mode: sc.mode, date: utcDate(), teams: [sc.teams[0].id, sc.teams[1].id], win: r.win, ot: r.ot, score: r.score,
      grades: recs.map((x) => x.grade!.g), scores: recs.map((x) => x.grade!.score),
      lost: recs.reduce((a, x) => a + x.grade!.lost, 0), aiLost: recs.reduce((a, x) => a + x.grade!.aiLost, 0),
      tags: tagsOf(session.records),
    };
    setResult(res);
    setView(clone(session.s));
    setWp(r.win ? 1 : 0);
    setTrail((t) => [...t, r.win ? 1 : 0]);
    setDec(null);
    setPhase('over');
    if (!doneRef.current) {
      doneRef.current = true;
      onDone(res);
      track('spot_complete', { mode: sc.mode, win: r.win, calls: recs.length });
    }
  }, [sc, session, onDone]);

  const present = useCallback((d: Decision) => {
    setDec(d);
    setSel(null);
    setTarget(null);
    setRoute(null);
    setHintMap(null);
    setBanner(null);
    const job = new GradeJob(d, sc.seed);
    jobRef.current = job;
    job.ready.then(() => {
      if (jobRef.current !== job) return;
      setWp(job.bestWp());
      if (hints) setHintMap(new Map(d.options.map((o) => [o.key, job.wpOf(o.key) ?? 0])));
    }).catch(() => { /* the grade for this decision will report the failure */ });
    setView(clone(session.s));
    field.current?.setup(session.s, preview(d, null, null, null));   // players jog from the last play to the new spot
    staleRef.current = false;
    setPhase('deciding');
  }, [sc, session, hints, preview]);

  /** Move on: play out anything that needs no decision, then present the next one. */
  const proceed = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      for (let guard = 0; guard < 300; guard++) {
        if (session.over) { finish(); return; }
        const d = session.decision();
        if (d) { setLast(null); present(d); return; }
        setPhase('auto');
        await animate(session.auto());
      }
    } finally {
      busyRef.current = false;
    }
  }, [session, finish, present, animate]);

  useEffect(() => {
    if (boot.lost) onPicks([]);
    field.current?.setup(session.s, {}, true);
    if (phase !== 'brief') {
      track('game_start', { mode: sc.mode, resumed: saved.length > 0 });
      proceed();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = () => {
    if (busyRef.current) return;
    p.onStart?.();
    track('game_start', { mode: sc.mode, resumed: false });
    setPhase('auto');
    proceed();
  };

  // phones: the scoreboard and the field stay pinned while the call list scrolls under them. Publish their real
  // heights so the field pins right below the scoreboard and scrolled-to rows land clear of both (and of Snap).
  useEffect(() => {
    const game = gameRef.current;
    if (!game || typeof ResizeObserver === 'undefined') return;
    const root = document.documentElement;
    const measure = () => {
      const sb = game.querySelector('.sb')?.getBoundingClientRect().height ?? 0;
      const st = stageRef.current?.getBoundingClientRect().height ?? 0;
      const foot = game.querySelector('.cp-foot')?.getBoundingClientRect().height ?? 0;
      game.style.setProperty('--sb-h', `${Math.round(sb)}px`);
      root.style.setProperty('--sticky-top', `${Math.round(sb + st + 8)}px`);
      root.style.setProperty('--sticky-bottom', `${Math.round(foot + 8)}px`);
    };
    const ro = new ResizeObserver(measure);
    ro.observe(game);
    measure();
    return () => { ro.disconnect(); root.style.removeProperty('--sticky-top'); root.style.removeProperty('--sticky-bottom'); };
  }, []);

  // keep the field preview in step with the selection
  useEffect(() => {
    if (phase === 'deciding' && dec) field.current?.setup(session.s, preview(dec, sel, target, route));
  }, [sel, target, route]); // eslint-disable-line react-hooks/exhaustive-deps

  const onSelect = (o: Opt) => {
    if (sel?.key === o.key) return;   // re-selecting keeps the receiver and route you set
    setSel(o); setTarget(null); setRoute(null);
  };

  const onTap = useCallback((pos: Rcv) => {
    if (phase !== 'deciding' || !sel?.choice.play) return;
    const c = CALL[sel.choice.play];
    if (!c?.routes || c.kind !== 'pass' || c.id === 'hail') return;
    const cur = target ?? c.tgt!;
    if (pos !== cur) { setTarget(pos); setRoute(c.routes[pos]); return; }
    const list = POS_ROUTES[pos];
    const i = list.indexOf(route ?? c.routes[pos]);
    setTarget(pos);
    setRoute(list[(i + 1) % list.length]);
  }, [phase, sel, target, route]);

  const onSnap = async (opt: Opt) => {
    const d = dec;
    const job = jobRef.current;
    if (!d || !job || busyRef.current || phase !== 'deciding') return;   // one transition per decision
    busyRef.current = true;
    let o = opt;
    if (d.step === 'play' && opt.choice.play && (target || route)) {
      const c = CALL[opt.choice.play];
      if (c?.routes) {
        const t = target ?? c.tgt!;
        const r = route ?? c.routes[t];
        if (t !== c.tgt || r !== c.routes[c.tgt!]) o = { ...opt, choice: { ...opt.choice, target: t, route: r } };
      }
    }
    setSnapping(o);
    setLast(null);
    setPrev(null);
    setPhase('snapping');
    const recIdx = session.records.length;
    const gp = job.grade(o);
    const evs = session.choose(o);
    onPicks(session.picks);
    track('call_made', { mode: sc.mode, step: d.step, call: o.key });
    const settle = (g: Grade) => { session.setGrade(recIdx, g); onPicks(session.picks); setTrail((t) => [...t, g.bestWp]); };
    const playedOut = evs.some((e) => e.type === 'snap' || e.type === 'kick' || e.type === 'pat');
    try {
      if (!playedOut) {
        // tempo, timeout, let it run: complete decisions. Show their effect and go straight on to the next call.
        await animate(evs);
        gp.then((g) => { settle(g); setPrev({ label: o.label, g }); }).catch(() => { /* graded calls only count when grading worked */ });
        busyRef.current = false;
        setSnapping(null);
        await proceed();
        return;
      }
      showStage();
      await animate(evs);
      const lines = evs.map((e) => tell(e, sc.teams)).filter((l) => l.text);
      const head = [...lines].reverse().find((l) => l.banner) ?? lines[lines.length - 1] ?? null;
      setLast({ evs, lines, head, grade: null, label: o.label });
      setPhase('result');
      try {
        const g = await gp;
        settle(g);
        setLast({ evs, lines, head, grade: g, label: o.label });
      } catch {
        // the play stands; only its grade is missing. Never leave the player stuck.
        setLast({ evs, lines, head, grade: null, failed: true, label: o.label });
      }
    } finally {
      busyRef.current = false;
      setSnapping(null);
    }
  };

  /** Watch the last play again, slower. The game state does not move. */
  const replay = async () => {
    const ev = last ? [...last.evs].reverse().find((e) => e.type === 'snap') as Extract<Ev, { type: 'snap' }> | undefined : undefined;
    if (!ev || replaying || busyRef.current) return;
    busyRef.current = true;
    setReplaying(true);
    setBanner(null);
    field.current?.setup(before(session.s, ev), { look: ev.res.look });
    await sleep(500);
    const told = tell(ev, sc.teams);
    await field.current?.play(ev, Math.max(0.5, speed * 0.55), () => told.banner && setBanner({ id: ++uid, text: told.banner, tone: told.tone }));
    staleRef.current = true;
    setReplaying(false);
    busyRef.current = false;
  };

  const next = () => { if (!replaying && (last?.grade || last?.failed)) proceed(); };

  // Enter or Space: Next play. R: replay.
  useEffect(() => {
    if (phase !== 'result') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); next(); }
      else if (e.key.toLowerCase() === 'r') { e.preventDefault(); replay(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const T = sc.teams;
  let side: ReactNode = null;
  if (phase === 'brief') {
    const s0 = sc.start;
    side = (
      <section className="brief">
        {p.welcome}
        {boot.lost && <p className="notice">Your saved progress on this spot couldn't be restored after an update, so it starts over.</p>}
        <div className="eyebrow">{p.label}</div>
        <h2 className="brief-head">{headline(s0)}</h2>
        <p className="brief-sit">{situation(s0, T)}</p>
        <div className="brief-odds">
          <div className="odds-bar"><i style={{ width: `${Math.round(sc.baseWp * 100)}%` }} /></div>
          <span>From here, our simulated coach wins <b>{Math.round(sc.baseWp * 100)}%</b> of the time. Can you do better?</span>
        </div>
        <button className="btn primary big" onClick={start} autoFocus>{p.startLabel ?? 'Take the headset'}</button>
        {p.briefExtra}
      </section>
    );
  } else if (phase === 'deciding' && dec) {
    side = <CallPanel dec={dec} s={session.s} teams={T} selected={sel} target={target} route={route} hints={hintMap} prev={prev} onSelect={onSelect} onSnap={onSnap} />;
  } else if (phase === 'snapping' && snapping) {
    side = (
      <section className="status">
        <div className="eyebrow">Running the play</div>
        <div className="status-call"><MiniPlay play={snapping.choice.play} look={snapping.choice.look} /><span>{snapping.label}</span></div>
        <div className="status-run"><i /><i /><i /></div>
      </section>
    );
  } else if (phase === 'result' && last) {
    side = <ResultCard last={last} s={view} teams={T} onNext={next} onReplay={replay} replaying={replaying} over={session.over} />;
  } else if (phase === 'over' && result) {
    side = <SpotReview result={result} session={session} trail={trail} onContinue={p.onContinue} continueLabel={p.continueLabel}
      lastPlay={feed.find((l) => l.text && !/expires|runs out/.test(l.text))?.text} />;
  } else {
    side = (
      <section className="status">
        <div className="eyebrow">{p.label}</div>
        <div className="status-line">{feed[0]?.text ?? 'Setting up…'}</div>
        <div className="status-run"><i /><i /><i /></div>
      </section>
    );
  }

  const chip = replaying ? ['replay', '↺ Replay'] : phase === 'snapping' || phase === 'auto' ? ['live', 'Live'] : phase === 'result' ? ['result', 'Result'] : phase === 'over' ? ['result', 'Final']
    : phase === 'deciding' ? (sel ? ['sel', `Selected: ${sel.label}`] : ['ready', dec?.step === 'play' ? 'Pick a play' : 'Your call']) : ['ready', 'Pre-game'];

  return (
    <div className="game" ref={gameRef}>
      {p.meta}
      <Scoreboard s={view} teams={T} wp={wp} trail={trail} />
      <div className="arena">
        <div className="stage" ref={stageRef}>
          <FieldView ref={field} teams={T} onTap={onTap} banner={banner}>
            <div className={`fchip ${chip[0]}`}>{chip[0] === 'live' && <i />}{chip[1]}</div>
            <div className="legend" aria-hidden>
              <span><i className="lg-o" style={{ background: T[0].color }} />{T[0].name}</span>
              <span><i className="lg-d" style={{ background: T[1].color }} />{T[1].name}</span>
              <span className="lg-x"><i className="lg-ring" />ring: player rating</span>
            </div>
          </FieldView>
        </div>
        <aside className="side">
          {side}
          <details className="pbp">
            <summary>Play-by-play <span className="muted">({feed.length})</span></summary>
            <ol>
              {feed.map((l) => (
                <li key={l.id} className={`tone-${l.tone}`}><span className="pbp-t">{fmtClock(l.t)}</span> {l.text}</li>
              ))}
            </ol>
          </details>
        </aside>
      </div>
    </div>
  );
}

interface RCProps { last: Last; s: State; teams: [import('../engine/types').TeamInfo, import('../engine/types').TeamInfo]; onNext: () => void; onReplay: () => void; replaying: boolean; over: boolean }

function ResultCard({ last, s, teams, onNext, onReplay, replaying, over }: RCProps) {
  const g = last.grade;
  const head = last.head;
  const others = last.lines.filter((l) => l !== head);
  const canReplay = last.evs.some((e) => e.type === 'snap');
  const live = s.stage === 'pre' || s.stage === 'call';
  return (
    <section className="result" aria-live="polite">
      {head && (
        <div className={`res-head tone-${head.tone}`}>
          <span className="res-big">{head.banner ?? 'Result'}</span>
          <p className="res-text">{head.text}</p>
        </div>
      )}
      {others.map((l, i) => <p key={i} className={`res-more tone-${l.tone}`}>{l.text}</p>)}
      <div className="res-now">
        <span className="k">Now</span>
        <span>{live ? <><b>{downDist(s)}</b> · {s.off === 0 ? 'your' : 'their'} ball on {ballOn(s.yl, s.off, teams)}</> : s.stage === 'pat' ? <b>Try after the touchdown</b> : s.stage === 'kick' ? <b>Kickoff</b> : <b>Game over</b>}</span>
        <span>{fmtClock(s.t)} · {s.score[0]}–{s.score[1]}</span>
      </div>
      {last.failed ? (
        <div className="grade pending"><span>This call couldn't be graded. The play stands; carry on.</span></div>
      ) : !g ? (
        <div className="grade pending"><span className="grading">Grading: playing out the rest of the game thousands of times for every option…</span></div>
      ) : (
        <div className={`grade g-${g.g}`}>
          <div className="grade-top">
            <span className="grade-chip">{GRADE_INFO[g.g].glyph} {GRADE_INFO[g.g].word}</span>
            <span className="grade-call">{last.label}</span>
            <span className="grade-score">{g.score}<small>/100</small></span>
          </div>
          {g.lost < 0.05
            ? <div className="grade-best">The best call on the board.</div>
            : g.g === 'g'
              ? <div className="grade-best">Within {g.lost.toFixed(1)} pts of the best call, <b>{g.bestLabel}</b>.</div>
              : <div className="grade-best">Better call: <b>{g.bestLabel}</b> <em>+{g.lost.toFixed(1)} pts win chance</em></div>}
          <p className="grade-why">{g.why[0]}</p>
          <details className="why-box">
            <summary>Why?</summary>
            {g.why.length > 1 && <ul className="why">{g.why.slice(1).map((w, i) => <li key={i}>{w}</li>)}</ul>}
            <table className="cmp">
              <tbody>
                <tr><th>You</th><td>{last.label}</td><td>{(g.wp * 100).toFixed(1)}%</td></tr>
                {g.lost >= 0.05 && <tr><th>Best</th><td>{g.bestLabel}</td><td>{(g.bestWp * 100).toFixed(1)}%</td></tr>}
                <tr><th>AI coach</th><td>{g.aiLabel}</td><td>{((g.bestWp - g.aiLost / 100) * 100).toFixed(1)}%</td></tr>
              </tbody>
            </table>
            <p className="muted small">Win chance for each option comes from playing the rest of the game out thousands of times.</p>
          </details>
        </div>
      )}
      <div className="res-actions">
        {canReplay && <button className="btn ghost replay" onClick={onReplay} disabled={replaying}>↺ Replay<kbd>R</kbd></button>}
        <button className="btn next" onClick={onNext} disabled={(!g && !last.failed) || replaying}>{over ? 'See the final' : 'Next play'}<kbd>Enter</kbd></button>
      </div>
    </section>
  );
}
