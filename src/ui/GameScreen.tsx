import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CALL, POS_ROUTES } from '../engine/data';
import { DESIGN } from '../engine/formation';
import { WEATHER, clone, leadOf } from '../engine/sim';
import { utcDate, type Scenario } from '../engine/scenario';
import type { Coin, Ev, Rcv, State } from '../engine/types';
import { ballOn, defenseVerdict, downDist, fmtClock, headline, situation, tell, type Told } from '../game/describe';
import { GRADE_INFO, type Grade } from '../game/grade';
import { GradeJob } from '../game/grader';
import { Session, isClutch, isToss, readChance, type Decision, type Opt, type Pick, type Record_ } from '../game/session';
import { DC_TEXT, scoutNotes } from '../game/scout';
import { spotResult } from '../game/rating';
import type { Settings, SpotResult } from '../game/storage';
import { setContext, track } from '../game/analytics';
import { CallPanel, NO_EDITS, type Edits } from './CallPanel';
import { FieldView, type Banner, type FieldHandle } from './FieldView';
import { MiniPlay } from './MiniPlay';
import { Scoreboard } from './Scoreboard';
import { SpotReview } from './Review';
import { tellsOf, type Preview } from './field';
import { AdSlot, gameOnScreen } from './AdSlot';
import { audio } from '../game/audio';
import { cueFor, finalCue, type ImpactKind } from '../game/fx';
import { Impact } from './Impact';
import { CoinToss } from './CoinToss';

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
  /** Career: this screen plays one part of a full game (a drive). When it ends, hand the game back. */
  segment?: { onEnd: (s: State, records: Record_[], log: Ev[]) => void; endLabel?: string };
}

/**
 * The loop, one primary action per phase:
 *   ready (pick a call) → selected (it is drawn on the field; Snap) → executing (the play runs; the result lands on
 *   the field and the scoreboard the moment it is decided) → result (the final frame stays put; Next play, or Replay)
 *   → the players jog to the next spot and the next call is ready.
 * Clock and timeout decisions are complete in one tap: they go straight on to the play call, and their grade shows
 * as "Last call" there. Steps with no decision for you ('auto': kickoffs, their kneel-downs) play out on their own.
 */
type Phase = 'brief' | 'deciding' | 'snapping' | 'auto' | 'result' | 'coin' | 'over';
interface FeedLine { id: number; t: number; text: string; tone: string }
interface Last { evs: Ev[]; lines: Told[]; head: Told | null; grade: Grade | null; failed?: boolean; label: string; pre?: State }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let uid = 0;

/** The pre-snap picture of a snap that already happened (for the next auto play, or a replay). */
const before = (s: State, ev: Extract<Ev, { type: 'snap' }>): State => ({ ...s, off: ev.off, yl: ev.yl0, down: ev.down0, dist: ev.dist0, t: ev.t0, stage: 'call' });

/**
 * The tempo starts on what a coach would usually do, so a play can be snapped in one tap: milk it with the lead, hurry
 * when behind or inside two minutes, huddle otherwise. On defense, let it run. The clock row marks the pick as Auto and
 * says why, so it is never a silent choice (a silent Huddle cost trailing players about a third of their wins).
 */
export function defaultTempo(d: Decision): Opt | null {
  const key = d.step === 'defClock' ? 'let' : d.step === 'offClock'
    ? (leadOf(d.state, 0) > 0 ? 'milk' : leadOf(d.state, 0) < 0 || d.state.t <= 120 ? 'nohuddle' : 'huddle')
    : null;
  return key ? d.options.find((o) => o.key === key) ?? null : null;
}

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
  const [edits, setEdits] = useState<Edits>(NO_EDITS);
  const [clockSel, setClockSel] = useState<Opt | null>(null);
  const [clockHints, setClockHints] = useState<Map<string, number> | null>(null);
  const peekJobRef = useRef<{ key: string; job: GradeJob } | null>(null);
  const [feed, setFeed] = useState<FeedLine[]>(() =>
    session.log.map((l) => ({ id: ++uid, t: l.ev.t, ...tell(l.ev, sc.teams) })).filter((l) => l.text).reverse());
  const [banner, setBanner] = useState<Banner | null>(null);
  const [last, setLast] = useState<Last | null>(null);
  const [prev, setPrev] = useState<{ label: string; g: Grade } | null>(null);
  const [snapping, setSnapping] = useState<Opt | null>(null);
  const [replaying, setReplaying] = useState(false);
  const [result, setResult] = useState<SpotResult | null>(null);
  const [impact, setImpact] = useState<{ id: number; kind: ImpactKind } | null>(null);
  const liveRef = useRef(false);            // the player took part in this game on this screen (not just reopened a finished one)

  const shownAt = useRef(Date.now());       // when the current decision went on the board
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  // the funnel: every phase, with where the game is, so a leave event says where people get stuck
  useEffect(() => {
    setContext({ phase, step: dec?.step ?? null, calls: session.records.length, kind: sc.kind ?? null });
    track('phase', { phase, mode: sc.mode, calls: session.records.length });
    if (phase === 'brief') track('brief_shown', { mode: sc.mode, kind: sc.kind ?? null });
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps
  const speed = settings.speed === 'instant' || reduced ? 0 : settings.speed === 'fast' ? 1.6 : 1;

  /** A big moment on the field: the overlay, and a shake for the ones that hurt (not under reduced motion). */
  const fire = useCallback((kind: ImpactKind) => {
    setImpact({ id: ++uid, kind });
    const el = stageRef.current;
    if (el && kind === 'giveaway' && !reduced) { el.classList.remove('fx-shake'); void el.offsetWidth; el.classList.add('fx-shake'); }
  }, [reduced]);
  /** The sound of a moment, and its impact on the field (replays get the sound only). */
  const react = useCallback((ev: Ev, withImpact = true) => {
    const c = cueFor(ev);
    if (c.sound) audio.play(c.sound);
    if (withImpact && c.impact) fire(c.impact);
    // a big swing of momentum: the stadium feels it
    if (ev.type === 'momentum') { field.current?.hype(); audio.play(ev.team === 0 ? 'cheer' : 'groan'); }
  }, [fire]);
  /** The clutch snap plays in slow motion (set when it's snapped, cleared when it's drawn). */
  const slowRef = useRef(1);

  const preview = useCallback((d: Decision | null, o: Opt | null, e: Edits): Preview => {
    const s = session.s;
    if (!d) return {};
    if (d.step === 'play') return { play: o?.choice.play ?? null, target: e.target, edits: e.routes, side: e.side, mods: e.mods, look: s.shownLook, routes: true, tells: true };
    if (d.step === 'look') return { look: o?.choice.look ?? null, defCall: !!o?.choice.look };
    return {};
  }, [session]);

  // With the clock running, the tempo and the play are one call. The play list comes from a look ahead: the game
  // replayed with the tempo added, which is exactly where the snap will be called from.
  const isClock = dec?.step === 'offClock' || dec?.step === 'defClock';
  const peek = useMemo(() => {
    if (!dec || !isClock) return null;
    const pick = clockSel ?? dec.options.find((o) => o.key === (dec.step === 'offClock' ? 'huddle' : 'let')) ?? dec.options[0];
    try {
      const s2 = new Session(sc, [...session.picks.map((x) => ({ key: x.key, choice: x.choice })), { key: pick.key, choice: pick.choice }]);
      const d2 = s2.decision();
      return d2 && d2.step !== 'offClock' && d2.step !== 'defClock' ? { dec: d2, provisional: !clockSel, key: pick.key } : null;
    } catch { return null; }
  }, [dec, isClock, clockSel, sc, session]);
  const mainDec = isClock ? peek?.dec ?? null : dec;
  useEffect(() => {
    // the look-ahead play call grades from its own state once the tempo is set
    if (!peek || peek.provisional) { peekJobRef.current = null; return; }
    const job = new GradeJob(peek.dec, sc.seed);
    const entry = { key: peek.key, job };
    peekJobRef.current = entry;
    if (hints) job.ready.then(() => { if (peekJobRef.current === entry) setHintMap(new Map(peek.dec.options.map((o) => [o.key, job.wpOf(o.key) ?? 0]))); }).catch(() => {});
  }, [peek, sc.seed, hints]);

  /** On phones the field is above the panel: bring it into view when a play starts. */
  const showStage = () => {
    const el = stageRef.current;
    if (!el || window.innerWidth >= 1000) return;
    const r = el.getBoundingClientRect();
    if (r.top < 60 || r.bottom > window.innerHeight) el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
  };

  /**
   * On phones the field stays pinned while the page scrolls, and after a play it can cover the top of the next call:
   * the situation, the tempo, Timeout and Spike. A new call scrolls up just enough to start right below the field.
   */
  useEffect(() => {
    if (!dec || window.innerWidth >= 1000) return;
    const id = requestAnimationFrame(() => {
      const st = stageRef.current, cp = document.querySelector<HTMLElement>('.side .cp');
      if (!st || !cp) return;
      const gap = cp.getBoundingClientRect().top - st.getBoundingClientRect().bottom - 6;
      if (gap < -4) window.scrollBy({ top: gap, behavior: reduced ? 'auto' : 'smooth' });
    });
    return () => cancelAnimationFrame(id);
  }, [dec, reduced]);

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
        await field.current?.play(ev, speed * slowRef.current, () => {
          if (told.banner) setBanner({ id: ++uid, text: told.banner, tone: told.tone });
          react(ev);
          setView(clone(session.s));
          if (told.text) setFeed((f) => [{ id: ++uid, t: ev.t, ...told }, ...f]);
        });
        staleRef.current = true;
        slowRef.current = 1;   // only the clutch snap itself is slowed
      } else if (ev.type === 'kick' || (ev.type === 'pat' && !ev.played)) {
        // kickoffs and tries are scenes too
        setBanner(null);
        const land = () => {
          if (told.banner) setBanner({ id: ++uid, text: told.banner, tone: told.tone });
          react(ev);
          setView(clone(session.s));
          if (told.text) setFeed((f) => [{ id: ++uid, t: ev.t, ...told }, ...f]);
        };
        if (ev.type === 'kick') await field.current?.playKick(ev, speed, land); else await field.current?.playPat(ev, speed, land);
        staleRef.current = true;
      } else {
        if (told.text) setFeed((f) => [{ id: ++uid, t: ev.t, ...told }, ...f]);
        setView(clone(session.s));
        react(ev);
        if (told.banner) {
          setBanner({ id: ++uid, text: told.banner, tone: told.tone });
          if (speed) await sleep(1300 / speed);
        }
      }
    }
    setView(clone(session.s));
    // the field keeps the final frame; the players move to the next spot when the next call is set up
  }, [sc, session, speed, react]);

  const finish = useCallback(() => {
    const r = session.result();
    const recs = session.records.filter((x) => x.grade);
    const res: SpotResult = spotResult(session, utcDate());
    setResult(res);
    setView(clone(session.s));
    setWp(r.win ? 1 : 0);
    setTrail((t) => [...t, r.win ? 1 : 0]);
    setDec(null);
    setPhase('over');
    if (liveRef.current && !doneRef.current) {
      const c = finalCue(r.win);
      if (c.sound) audio.play(c.sound);
      if (c.impact) fire(c.impact);
    }
    if (!doneRef.current) {
      doneRef.current = true;
      onDone(res);
      track('spot_complete', { mode: sc.mode, win: r.win, calls: recs.length });
    }
  }, [sc, session, onDone, fire]);

  const present = useCallback((d: Decision) => {
    setDec(d);
    setSel(null);
    setEdits(NO_EDITS);
    setClockSel(defaultTempo(d));
    setClockHints(null);
    setHintMap(null);
    peekJobRef.current = null;
    setBanner(null);
    if (isToss(d.step)) {
      // overtime's coin toss: the player's call, with nothing to grade (CoinToss shows it)
      jobRef.current = null;
      setView(clone(session.s));
      setPhase('deciding');
      shownAt.current = Date.now();
      track('decision_shown', { mode: sc.mode, step: d.step, options: d.options.length, n: session.records.length });
      return;
    }
    const job = new GradeJob(d, sc.seed);
    jobRef.current = job;
    job.ready.then(() => {
      if (jobRef.current !== job) return;
      setWp(job.bestWp());
      const m = new Map(d.options.map((o) => [o.key, job.wpOf(o.key) ?? 0]));
      if (hints) { if (d.step === 'offClock' || d.step === 'defClock') setClockHints(m); else setHintMap(m); }
    }).catch(() => { /* the grade for this decision will report the failure */ });
    setView(clone(session.s));
    field.current?.setup(session.s, preview(d, null, NO_EDITS));   // players jog from the last play to the new spot
    staleRef.current = false;
    setPhase('deciding');
    shownAt.current = Date.now();
    if (liveRef.current && isClutch(session.s)) audio.play('drum');   // a heartbeat: the game is on the line
    track('decision_shown', { mode: sc.mode, step: d.step, options: d.options.length, n: session.records.length });
  }, [sc, session, hints, preview]);

  /** Move on: play out anything that needs no decision, then present the next one. */
  const proceed = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      for (let guard = 0; guard < 300; guard++) {
        if (session.over) {
          if (p.segment) { p.segment.onEnd(clone(session.s), session.records, session.log.map((l) => l.ev)); return; }
          finish(); return;
        }
        const d = session.decision();
        if (d) { setLast(null); present(d); return; }
        setPhase('auto');
        await animate(session.auto());
      }
    } finally {
      busyRef.current = false;
    }
  }, [session, finish, present, animate]);

  useEffect(() => { gameOnScreen(true); return () => gameOnScreen(false); }, []);   // no ads while a game is up
  useEffect(() => {
    if (boot.lost) onPicks([]);
    field.current?.setup(session.s, {}, true);
    if (phase !== 'brief') {
      // straight into the game: a resume (after a refresh, or back to a game in progress). A career moment is part of a
      // career game, which reports its own game_start once (Career.tsx), so its drives don't each count as a game.
      if (!p.segment) track('game_start', { mode: sc.mode, resumed: true });
      proceed();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = () => {
    if (busyRef.current) return;
    p.onStart?.();
    liveRef.current = true;
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
    if (phase === 'deciding' && mainDec) field.current?.setup(session.s, preview(mainDec, sel, edits));
  }, [sel, edits, mainDec]); // eslint-disable-line react-hooks/exhaustive-deps

  const onSelect = (o: Opt) => {
    if (sel?.key === o.key) return;   // re-selecting keeps the receiver and routes you set
    setSel(o); setEdits(NO_EDITS);
  };

  /** Tap a receiver on the field: throw to him. Tap him again: his next route. Every edit stays. */
  const onTap = useCallback((pos: Rcv) => {
    if (phase !== 'deciding' || !sel?.choice.play) return;
    const c = CALL[sel.choice.play];
    if (!c?.routes || c.kind !== 'pass' || c.id === 'hail') return;
    if (DESIGN[c.id]?.qb === 'lateral' && pos === 'WR2') return;   // he's the one throwing it
    const cur = edits.target ?? c.tgt!;
    if (pos !== cur) { setEdits({ ...edits, target: pos }); return; }
    const list = POS_ROUTES[pos];
    const i = list.indexOf(edits.routes[pos] ?? c.routes[pos]);
    setEdits({ ...edits, target: pos, routes: { ...edits.routes, [pos]: list[(i + 1) % list.length] } });
  }, [phase, sel, edits]);

  /** The option as called: the receiver, the routes, the side and the signals folded into the choice. */
  const withEdits = (opt: Opt): Opt => {
    if (!opt.choice.play) return opt;
    const c = CALL[opt.choice.play];
    if (!c) return opt;
    if (c.kind === 'run') return c.id === 'sneak' ? opt : { ...opt, choice: { ...opt.choice, side: edits.side } };
    if (!c.routes || c.kind !== 'pass' || c.id === 'hail') return opt;
    const t = edits.target ?? c.tgt!;
    const edited = Object.keys(edits.routes).length > 0;
    const mods = edits.mods.pa || edits.mods.roll || edits.mods.oob ? edits.mods : undefined;
    if (t === c.tgt && !edited && !mods) return opt;
    const r = edits.routes[t] ?? c.routes[t];
    return { ...opt, choice: { ...opt.choice, target: t, route: r, ...(edited ? { routes: edits.routes } : {}), ...(mods ? { mods } : {}) } };
  };

  const onSnap = async (opt: Opt) => {
    let d = dec;
    let job = jobRef.current;
    if (!d || !job || busyRef.current || phase !== 'deciding') return;   // one transition per decision
    busyRef.current = true;
    liveRef.current = true;
    let o = withEdits(opt);
    const combined = isClock && opt.group !== 'clock';
    if (combined) {
      // first the tempo (a complete decision of its own), then the play from where it leaves the game
      const cs = clockSel;
      if (!cs) { busyRef.current = false; return; }
      const ci = session.records.length;
      const gc = job.grade(cs);
      const evc = session.choose(cs);
      onPicks(session.picks);
      track('call_made', { mode: sc.mode, step: d.step, call: cs.key });
      setSnapping(o);
      setPhase('snapping');
      await animate(evc);
      gc.then((g) => { session.setGrade(ci, g); onPicks(session.picks); setTrail((t) => [...t, g.bestWp]); setPrev({ label: cs.label, g }); }).catch(() => {});
      const d2 = session.decision();
      const o2 = d2?.options.find((x) => x.key === opt.key);
      if (!d2 || !o2) {
        // the clock ran the game out (or the spot changed): carry on from wherever it is
        busyRef.current = false;
        setSnapping(null);
        await proceed();
        return;
      }
      d = d2;
      o = withEdits(o2);
      const pj = peekJobRef.current;
      job = pj && pj.key === cs.key ? pj.job : new GradeJob(d2, sc.seed);
      jobRef.current = job;
      setDec(d2);
    }
    setSnapping(o);
    setLast(null);
    if (!combined) setPrev(null);   // a combined snap keeps the tempo's grade as "last call"
    setPhase('snapping');
    const recIdx = session.records.length;
    const dStep = d.step;
    const pre = dStep === 'look' ? d.state : undefined;   // for the defense verdict on the result card
    // the game on the line: this snap plays in slow motion
    slowRef.current = speed && isClutch(session.s) ? 0.6 : 1;
    const gp = job.grade(o);
    const evs = session.choose(o);
    onPicks(session.picks);
    track('call_made', {
      mode: sc.mode, step: dStep, call: o.key, n: recIdx, secs: Math.round((Date.now() - shownAt.current) / 1000),
      tempo: combined ? clockSel?.key : undefined, side: o.choice.side === -1 ? 'weak' : o.choice.side === 1 ? 'strong' : undefined,
      signals: o.choice.mods ? Object.keys(o.choice.mods).filter((k) => (o.choice.mods as Record<string, boolean>)[k]).join('+') || undefined : undefined,
      edited_routes: o.choice.routes ? Object.keys(o.choice.routes).length : undefined, target: o.choice.target,
    });
    const gradedAt = Date.now();
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
      setLast({ evs, lines, head, grade: null, label: o.label, pre });
      setPhase('result');
      try {
        const g = await gp;
        settle(g);
        if (g.g === 'g') audio.play('gradeGood'); else if (g.g === 'r') audio.play('gradeBad');
        setLast({ evs, lines, head, grade: g, label: o.label, pre });
        track('result_shown', { mode: sc.mode, grade: g.g, lost: Math.round(g.lost * 10) / 10, grade_secs: Math.round((Date.now() - gradedAt) / 1000) });
      } catch {
        // the play stands; only its grade is missing. Never leave the player stuck.
        setLast({ evs, lines, head, grade: null, failed: true, label: o.label, pre });
        track('grade_failed', { mode: sc.mode, step: dStep, call: o.key });
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
    track('replay', { mode: sc.mode });
    setReplaying(true);
    setBanner(null);
    field.current?.setup(before(session.s, ev), { look: ev.res.look });
    await sleep(500);
    const told = tell(ev, sc.teams);
    await field.current?.play(ev, Math.max(0.5, speed * 0.55), () => { if (told.banner) setBanner({ id: ++uid, text: told.banner, tone: told.tone }); react(ev, false); });
    staleRef.current = true;
    setReplaying(false);
    busyRef.current = false;
  };

  const next = () => { if (!replaying && (last?.grade || last?.failed)) { track('next_play', { mode: sc.mode }); proceed(); } };

  /** Overtime's toss: the call (then the coin lands on screen), and the winner's choice. Neither is graded. */
  const tossPick = (step: 'toss' | 'otpick', key: string) => {
    const d = session.decision();
    const o = d?.step === step ? d.options.find((x) => x.key === key) : undefined;
    if (!o || busyRef.current) return false;
    liveRef.current = true;
    const n = session.records.length;
    const evs = session.choose(o);
    onPicks(session.picks);
    track('call_made', { mode: sc.mode, step, call: key, n, secs: Math.round((Date.now() - shownAt.current) / 1000) });
    // into the play-by-play once the coin has landed on screen, so the log doesn't give it away
    for (const e of evs) { const told = tell(e, sc.teams); if (told.text) setTimeout(() => setFeed((f) => [{ id: ++uid, t: e.t, ...told }, ...f]), e.type === 'toss' ? 1500 : 0); }
    setView(clone(session.s));
    setDec(null);
    return true;
  };
  const onCall = (c: Coin) => { if (tossPick('toss', c)) setPhase('coin'); };
  const onChoose = (recv: boolean) => { if (tossPick('otpick', recv ? 'receive' : 'kick')) { setPhase('auto'); proceed(); } };

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
  const clutchNow = phase === 'deciding' && !!dec && !isToss(dec.step) && isClutch(session.s);
  const readNow = readChance(sc, session.s);
  const tellNow = phase === 'deciding' && dec?.step === 'play' && session.s.shownLook ? tellsOf(session.s.shownLook).tag : '';
  let side: ReactNode = null;
  if (phase === 'brief') {
    const s0 = sc.start;
    side = (
      <section className="brief">
        {p.welcome}
        {boot.lost && <p className="notice">Your saved progress on this spot couldn't be restored after an update, so it starts over.</p>}
        <div className="eyebrow">{p.label}</div>
        <h2 className="brief-head">{headline(s0)}</h2>
        <p className="brief-sit">{situation(s0, T)}{s0.weather && s0.weather !== 'clear' ? <> <b className={`wx-word wx-${s0.weather}`}>{WEATHER[s0.weather].blurb}</b></> : null}</p>
        {s0.dc && <p className="brief-dc"><span className="k">Scouting report</span>Their defensive coordinator {DC_TEXT[s0.dc.style]}. Watch for it, and don't run the same play three times in a row: he adjusts.</p>}
        <div className="brief-odds">
          <div className="odds-bar"><i style={{ width: `${Math.round(sc.baseWp * 100)}%` }} /></div>
          <span>From here, our simulated coach wins <b>{Math.round(sc.baseWp * 100)}%</b> of the time. Can you do better?</span>
        </div>
        <button className="btn primary big" onClick={start} autoFocus>{p.startLabel ?? 'Take the headset'}</button>
        {p.briefExtra}
      </section>
    );
  } else if ((phase === 'deciding' && dec && isToss(dec.step)) || phase === 'coin') {
    side = <CoinToss s={view} teams={T} onCall={onCall} onChoose={onChoose} onContinue={() => { setPhase('auto'); proceed(); }} />;
  } else if (phase === 'deciding' && dec) {
    side = <CallPanel dec={mainDec ?? dec} clock={mainDec && isClock ? dec : null} clockSel={clockSel} s={session.s} teams={T} selected={sel} edits={edits}
      scout={scoutNotes(session.s, session.log.map((l) => l.ev))} read={readChance(sc, session.s)}
      hints={isClock && !mainDec ? clockHints : hintMap} clockHints={clockHints} prev={prev} autoTempo={defaultTempo(dec)?.key}
      onClock={(o) => { setClockSel(o); setHintMap(null); }} onMajor={onSnap} onSelect={onSelect} onEdit={setEdits} onSnap={onSnap} />;
  } else if (phase === 'snapping' && snapping) {
    side = (
      <section className="status">
        <div className="eyebrow">Running the play</div>
        <div className="status-call"><MiniPlay play={snapping.choice.play} look={snapping.choice.look} /><span>{snapping.label}</span></div>
        <div className="status-run"><i /><i /><i /></div>
      </section>
    );
  } else if (phase === 'result' && last) {
    side = <ResultCard last={last} s={view} teams={T} onNext={next} onReplay={replay} replaying={replaying} over={session.over} overLabel={p.segment ? p.segment.endLabel ?? 'Continue' : undefined} />;
  } else if (phase === 'over' && result) {
    side = <>
      <SpotReview result={result} session={session} trail={trail} onContinue={p.onContinue} continueLabel={p.continueLabel}
        lastPlay={feed.find((l) => l.text && !/expires|runs out/.test(l.text))?.text} />
      {!p.segment && <AdSlot where="end" />}
    </>;
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
    <div className={`game${clutchNow ? ' clutch' : ''}`} ref={gameRef}>
      {p.meta}
      <Scoreboard s={view} teams={T} wp={wp} trail={trail} />
      <div className="arena">
        <div className="stage" ref={stageRef}>
          <FieldView ref={field} teams={T} onTap={onTap} banner={banner} offense={view.off} weather={view.weather} byRating={!settings.plainDots} home={sc.home} look={settings.fieldLook}>
            <div className={`fchip ${chip[0]}`}>{chip[0] === 'live' && <i />}{chip[1]}</div>
            {impact && <Impact key={impact.id} kind={impact.kind} onDone={() => setImpact((x) => (x?.id === impact.id ? null : x))} />}
            {view.mo != null && <Momentum mo={view.mo} you={T[0].id} them={T[1].id} />}
            {clutchNow && <div className="fchip-clutch" aria-live="polite"><i aria-hidden />Game on the line</div>}
            {tellNow && <div className="fchip-tell" title={`What the defense shows before the snap. Your read is right about ${Math.round(readNow.p * 100)}% of the time.`}>Tell · {tellNow}</div>}
            {phase === 'deciding' && readNow.crowd && <div className="fchip-crowd">Road crowd: harder read</div>}
            <div className="legend" aria-hidden>
              <span><i className="lg-o" />Offense: {T[view.off].name}</span>
              <span><i className="lg-d" />Defense: {T[view.off === 0 ? 1 : 0].name}</span>
              <span className="lg-x">Hover a player for ratings</span>
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

interface RCProps { last: Last; s: State; teams: [import('../engine/types').TeamInfo, import('../engine/types').TeamInfo]; onNext: () => void; onReplay: () => void; replaying: boolean; over: boolean; overLabel?: string }

function ResultCard({ last, s, teams, onNext, onReplay, replaying, over, overLabel }: RCProps) {
  const g = last.grade;
  const head = last.head;
  const others = last.lines.filter((l) => l !== head);
  const canReplay = last.evs.some((e) => e.type === 'snap');
  const live = s.stage === 'pre' || s.stage === 'call';
  // on defense: how your call matched the play they ran (computed once per result)
  const verdict = useMemo(() => {
    const snap = last.evs.find((e) => e.type === 'snap');
    return last.pre && snap ? defenseVerdict(last.pre, snap) : null;
  }, [last.pre, last.evs]);
  return (
    <section className="result" aria-live="polite">
      {head && (
        <div className={`res-head tone-${head.tone}`}>
          <span className="res-big">{head.banner ?? 'Result'}</span>
          <p className="res-text">{head.text}</p>
        </div>
      )}
      {others.map((l, i) => <p key={i} className={`res-more tone-${l.tone}`}>{l.text}</p>)}
      {verdict && <p className={`res-def fit-${verdict.fit}`}><span className="res-def-k">Your defense</span> {verdict.text}</p>}
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
            <span className="grade-score" title="Call grade: 100 minus 7 for every point of win chance given up versus the best call">{g.score}<small>/100</small><em>call grade</em></span>
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
        <button className="btn next" onClick={onNext} disabled={(!g && !last.failed) || replaying}>{over ? overLabel ?? 'See the final' : 'Next play'}<kbd>Enter</kbd></button>
      </div>
    </section>
  );
}

/** Momentum, from your side: a bar that leans to whoever has it (-3 to 3), with the team that does. */
function Momentum({ mo, you, them }: { mo: number; you: string; them: string }) {
  const f = Math.max(-1, Math.min(1, mo / 3));
  const who = Math.abs(mo) < 0.75 ? 'Even' : mo > 0 ? you : them;
  return (
    <div className={`mom${mo >= 0.75 ? ' yours' : mo <= -0.75 ? ' theirs' : ''}`} title="Momentum: big plays, first downs, stops and turnovers move it. It sharpens (or clouds) your pre-snap read.">
      <span className="mom-k">Momentum</span>
      <span className="mom-bar"><i style={{ left: f < 0 ? `${50 + f * 50}%` : '50%', width: `${Math.abs(f) * 50}%` }} /></span>
      <span className="mom-who">{who}</span>
    </div>
  );
}
