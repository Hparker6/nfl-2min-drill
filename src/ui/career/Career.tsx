/**
 * Career mode: create a quarterback, play one college game for your draft stock, get drafted, and play seasons in a
 * fictional league. Saved in this browser.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Settings as AppSettings } from '../../game/storage';
import { track } from '../../game/analytics';
import {
  ARCH, ABILITIES, COLLEGES, joinTeam, newCareer, yourGameThisWeek, type Arch, type Career, type Settings,
} from '../../career/career';
import { closeWeek, finishLive, gameOf, simYourGame, startLive, COLLEGE_GAME } from '../../career/run';
import { endSeason, runOffseason, startNextSeason } from '../../career/offseason';
import { activeSlot, addToHall, exportCareer, importCareer, loadCareer, saveCareer, setActiveSlot, unreadableSaves } from '../../career/save';
import { hallEntry, retire } from '../../career/legacy';
import { editionShown, ownsEdition } from '../../game/edition';
import { RetireCard, Retired, Slots } from './Legacy';
import { download } from '../../game/shareImage';
import { LiveGameView } from './LiveGame';
import { Hub } from './Hub';
import { Offseason, Postgame, SeasonDone } from './Screens';
import { DraftNight } from './Draft';
import { CareerBoundary } from './Boundary';
import './career.css';

export type Commit = (fn: (c: Career) => void) => void;

export function CareerMode({ app }: { app: AppSettings }) {
  return <CareerBoundary slot={startSlot()}><CareerInner app={app} /></CareerBoundary>;
}

/** This week's game when it's finished and the week hasn't moved on: its postgame shows instead of the hub. */
function pendingPost(c: Career | null): string | null {
  if (!c || c.live || c.phase !== 'season') return null;
  const g = yourGameThisWeek(c);
  return g?.score ? g.id : null;
}

/** The slot to open: the last one played, or slot 1 without the Coach's Edition (slots 2 and 3 are its). */
const startSlot = () => (ownsEdition() ? activeSlot() : 1);

function CareerInner({ app }: { app: AppSettings }) {
  const [slot, setSlot] = useState(startSlot);
  const slotRef = useRef(slot);
  const [c, setC] = useState<Career | null>(() => loadCareer(slotRef.current));
  const [slots, setSlots] = useState(false);   // the career slots screen (Coach's Edition)
  // the game id whose postgame is showing: also after a refresh, or leaving and coming back, so a finished game can't be played again
  const [post, setPost] = useState<string | null>(() => pendingPost(loadCareer(slotRef.current)));
  const [paused, setPaused] = useState(false);   // Save & exit: the game in progress waits on the hub
  const [busy, setBusy] = useState<string | null>(null);
  const [unsaved, setUnsaved] = useState(false);
  const [setAside, setSetAside] = useState(() => unreadableSaves(slotRef.current));   // an unreadable save in this slot, set aside by loadCareer
  const [hubTab, setHubTab] = useState<'home' | 'player'>('home');   // the postgame's Spend points opens the Player tab

  const commit: Commit = useCallback((fn) => {
    setC((prev) => {
      if (!prev) return prev;
      const next = structuredClone(prev);
      fn(next);
      setUnsaved(!saveCareer(next, slotRef.current));
      return next;
    });
  }, []);

  useEffect(() => { window.scrollTo({ top: 0 }); }, [c?.phase, post, !!c?.live, slots, slot]);

  /** Open a slot: its career, or the new-career screen when it's empty. */
  const open = (n: number) => {
    slotRef.current = n;
    setActiveSlot(n);
    setSlot(n);
    const nc = loadCareer(n);
    setPost(pendingPost(nc));
    setPaused(false);
    setUnsaved(false);
    setC(nc);
    setSetAside(unreadableSaves(n));
    setSlots(false);
  };

  /** Long work (a season of other games) off the click, so the button can show it's working. */
  const work = (label: string, fn: () => void) => { setBusy(label); setTimeout(() => { try { fn(); } finally { setBusy(null); } }, 30); };

  if (busy) return <div className="cr-page"><div className="cr-busy"><i /><span>{busy}</span></div></div>;
  if (slots) return <Slots current={slot} onOpen={open} onClose={() => setSlots(false)} />;
  const toSlots = editionShown() ? () => setSlots(true) : undefined;

  if (!c) {
    return <>
      {setAside > 0 && <p className="notice">A saved career in this slot couldn't be read, so it was set aside rather than deleted. Starting a new one here is safe; the old data stays in this browser's storage.</p>}
      <NewCareer onCreate={(o) => work('Building the league: 32 teams, a season of history…', () => {
      const nc = newCareer(o);
      setUnsaved(!saveCareer(nc, slotRef.current));
      setC(nc);
      track('career_start', { arch: o.arch });
    })} onLoad={(nc) => { setUnsaved(!saveCareer(nc, slotRef.current)); setPost(pendingPost(nc)); setC(nc); }} onSlots={toSlots} slot={slot} />
    </>;
  }

  const banner = unsaved ? <p className="notice">This browser isn't letting the game save (storage full or blocked). Your career plays on, but download a save from Settings to keep it.</p> : null;

  // a game in progress (unless it's paused: Save & exit)
  if (c.live && !paused) {
    return (
      <LiveGameView key={c.live.gameId} c={c} app={app}
        save={(live) => commit((x) => { x.live = live; })}
        onLeave={() => setPaused(true)}
        onFinal={(how: 'moments' | 'full' | 'sim') => {
          const id = c.live!.gameId;
          commit((x) => { finishLive(x, how); });
          setPost(id);
          track('career_game', { how, id });
        }} />
    );
  }

  if (post && c.last?.gameId === post) {
    return <Postgame c={c} gameId={post} onContinue={(upgrade) => {
      if (post === 'college') { setPost(null); return; }
      setHubTab(upgrade ? 'player' : 'home');
      work('Simming the rest of the week…', () => { commit((x) => closeWeek(x)); setPost(null); });
    }} />;
  }

  const play = (mode: 'moments' | 'full' | 'sim') => {
    // a paused game is resumed, never replaced
    if (c.live) { setPaused(false); return; }
    const g = c.phase === 'college' ? COLLEGE_GAME : yourGameThisWeek(c);
    if (!g) return;
    // already played (it has a score): the week moves on instead of the game being played again
    if (g.score) { work('Simming the rest of the week…', () => commit((x) => closeWeek(x))); return; }
    if (mode === 'sim') {
      work('Simming your game…', () => { commit((x) => { simYourGame(x, gameOf(x, g.id)); }); setPost(g.id); });
      return;
    }
    commit((x) => { startLive(x, gameOf(x, g.id), mode); });
    // one game_start per career game you play (its moments don't each count; a simmed game isn't played)
    track('game_start', { mode: 'career', resumed: false, how: mode });
  };

  if (c.phase === 'retired') return <Retired c={c} onSlots={() => setSlots(true)} />;
  const resume = c.live && paused ? (
    <div className="cr-paused" role="status">
      <span><b>Game in progress</b> · {c.live.s.score[0]}-{c.live.s.score[1]}, {c.live.s.q && c.live.s.q > 4 ? 'overtime' : `Q${c.live.s.q ?? 4}`}</span>
      <button className="btn primary small" onClick={() => setPaused(false)}>Resume game</button>
    </div>
  ) : null;
  if (c.phase === 'college') return <>{banner}{resume}<CollegeIntro c={c} onPlay={play} /></>;
  if (c.phase === 'draft') return <>{banner}<DraftNight c={c} commit={commit} onDone={() => work('Setting up your rookie season…', () => commit((x) => joinTeam(x)))} /></>;
  if (c.phase === 'offseason') {
    const onRetire = () => commit((x) => { retire(x); const e = hallEntry(x, ARCH[x.you.arch].name); if (e) addToHall(e); });
    return <>{banner}<Offseason c={c} commit={commit} onNext={() => work('A new season: schedules, rosters, rookies…', () => commit((x) => startNextSeason(x)))}
      retire={editionShown() ? <RetireCard c={c} onRetire={onRetire} /> : undefined} /></>;
  }
  if (c.season.week > 22) {
    return <>{banner}<SeasonDone c={c} onOffseason={() => work('Awards, retirements, free agency…', () => commit((x) => { endSeason(x); runOffseason(x); }))} /></>;
  }
  return <>{banner}{resume}<Hub key={hubTab} initialTab={hubTab} c={c} commit={commit} onPlay={play} onBye={() => work('Simming the week…', () => commit((x) => closeWeek(x)))}
    onRetire={() => { if (confirm('Start over? This career will be deleted from this browser.')) { saveCareer(null, slotRef.current); setC(null); } }}
    onSlots={toSlots}
    onExport={() => download(exportCareer(c), `the-4th-call-career-${c.you.name.replace(/\W+/g, '-').toLowerCase()}.json`)} /></>;
}

const ATTR_LABEL: Record<'accuracy' | 'arm' | 'decision' | 'mobility', string> = { accuracy: 'Accuracy', arm: 'Arm', decision: 'Decisions', mobility: 'Mobility' };
const ATTRS = ['accuracy', 'arm', 'decision', 'mobility'] as const;
/** Each style's best attribute, for its card. */
const peak = (a: Arch) => ATTRS.reduce((b, k) => (ARCH[a].attrs[k] > ARCH[a].attrs[b] ? k : b), 'accuracy' as (typeof ATTRS)[number]);

/**
 * Create your quarterback: four short steps on the left (who, how he plays, where he played, the settings, folded away)
 * and his card on the right, built live as you choose, with the button to start on the card itself.
 */
function NewCareer({ onCreate, onLoad, onSlots, slot }: { onCreate: (o: { name: string; number: number; arch: Arch; college: number; settings: Partial<Settings> }) => void; onLoad: (c: Career) => void; onSlots?: () => void; slot: number }) {
  const [name, setName] = useState('');
  const [number, setNumber] = useState(7);
  const [arch, setArch] = useState<Arch>('pocket');
  const [college, setCollege] = useState(0);
  const [qLen, setQLen] = useState(2);
  const [diff, setDiff] = useState<Settings['diff']>('pro');
  const [moments, setMoments] = useState<Settings['moments']>('normal');
  const [speed, setSpeed] = useState<Settings['speed']>('normal');
  const [numText, setNumText] = useState('7');   // what's typed in the number box (it may be empty while typing)
  const [err, setErr] = useState<string | null>(null);
  const clean = name.trim().replace(/\s+/g, ' ').slice(0, 24);
  const ok = clean.length >= 2;
  const A = ARCH[arch];
  const col = COLLEGES[college];
  const ovr = Math.round(ATTRS.reduce((s, k) => s + A.attrs[k], 0) / ATTRS.length);
  const start = () => ok && onCreate({ name: clean, number, arch, college, settings: { qLen: qLen * 60, diff, moments, speed } });
  // any number 0-99: type it, or step with the arrows (which wrap around)
  const setNum = (n: number) => { const v = ((Math.round(n) % 100) + 100) % 100; setNumber(v); setNumText(String(v)); };
  const step = (d: number) => setNum(number + d);
  return (
    <div className="cr-page nc">
      <header className="nc-hero">
        <div className="eyebrow">Career mode · beta</div>
        <h1>Become the <em>franchise</em> quarterback</h1>
        <p>One bowl game in front of the scouts. Draft night. Then a 17-game season, the playoffs and the Gridiron Bowl, calling your own plays when it's on the line.</p>
      </header>

      <div className="nc-layout">
        <div className="nc-steps">
          <section className="nc-step">
            <h2><i>1</i>Who he is</h2>
            <div className="nc-id">
              <label className="nc-name"><span className="sr-only">Name</span>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your quarterback's name" maxLength={24} autoComplete="off" autoFocus />
              </label>
              <div className="nc-num" role="group" aria-label="Jersey number">
                <button type="button" onClick={() => step(-1)} aria-label="Lower number">‹</button>
                <label className="nc-num-in"><span aria-hidden>#</span>
                  <input type="text" inputMode="numeric" pattern="[0-9]*" maxLength={2} aria-label="Jersey number, 0 to 99" value={numText}
                    onChange={(e) => { const t = e.target.value.replace(/\D/g, '').slice(0, 2); setNumText(t); if (t) setNumber(Number(t)); }}
                    onBlur={() => setNum(numText ? Number(numText) : number)}
                    onKeyDown={(e) => { if (e.key === 'ArrowUp') { e.preventDefault(); step(1); } else if (e.key === 'ArrowDown') { e.preventDefault(); step(-1); } }}
                    onFocus={(e) => e.target.select()} />
                </label>
                <button type="button" onClick={() => step(1)} aria-label="Higher number">›</button>
              </div>
            </div>
          </section>

          <section className="nc-step">
            <h2><i>2</i>How he plays</h2>
            <div className="nc-styles" role="radiogroup" aria-label="Style of play">
              {(Object.keys(ARCH) as Arch[]).map((k) => {
                const S = ARCH[k], top = peak(k);
                return (
                  <button key={k} role="radio" aria-checked={arch === k} className={`nc-style${arch === k ? ' on' : ''}`} onClick={() => setArch(k)}>
                    <b>{S.name}</b>
                    <span>{S.tag}</span>
                    <em>{ATTR_LABEL[top]} {S.attrs[top]}</em>
                  </button>
                );
              })}
            </div>
            <p className="nc-blurb">{A.blurb}</p>
          </section>

          <section className="nc-step">
            <h2><i>3</i>Where he played</h2>
            <div className="nc-colleges" role="radiogroup" aria-label="College">
              {COLLEGES.map((c, i) => (
                <button key={c[0]} role="radio" aria-checked={college === i} className={`nc-col${college === i ? ' on' : ''}`} onClick={() => setCollege(i)} style={{ ['--tc' as string]: c[2], ['--tc2' as string]: c[3] }}>
                  <i aria-hidden>{c[4]}</i><span>{c[0]}</span>
                </button>
              ))}
            </div>
          </section>

          <details className="nc-step nc-settings">
            <summary><h2><i>4</i>Game settings</h2><span>{diff === 'allpro' ? 'All-Pro' : diff === 'rookie' ? 'Rookie' : 'Pro'} · {moments === 'few' ? 'few moments' : moments === 'lots' ? 'lots of moments' : 'the big moments'} · {qLen}-min quarters</span></summary>
            <div className="nc-set">
              <label><span>Quarter length (full games)</span>
                <select value={qLen} onChange={(e) => setQLen(Number(e.target.value))}>
                  {[2, 3, 4, 5, 6, 8, 10, 12].map((m) => <option key={m} value={m}>{m} minutes{m === 2 ? ' (quick)' : ''}</option>)}
                </select>
              </label>
              <label><span>Difficulty</span>
                <select value={diff} onChange={(e) => setDiff(e.target.value as Settings['diff'])}>
                  <option value="rookie">Rookie: softer, win chance shown</option>
                  <option value="pro">Pro</option>
                  <option value="allpro">All-Pro: tougher defenses</option>
                </select>
              </label>
              <label><span>How much you play (the sim runs the rest)</span>
                <select value={moments} onChange={(e) => setMoments(e.target.value as Settings['moments'])}>
                  <option value="few">Few: the final drive and overtime</option>
                  <option value="normal">Normal: plus the end of the half, red zone, big fourth downs</option>
                  <option value="lots">Lots: most drives of a close second half</option>
                </select>
              </label>
              <label><span>Sim speed</span>
                <select value={speed} onChange={(e) => setSpeed(e.target.value as Settings['speed'])}>
                  <option value="normal">Normal: watch the drives</option>
                  <option value="fast">Fast: get to your moments</option>
                </select>
              </label>
            </div>
          </details>
        </div>

        <aside className="nc-card" style={{ ['--tc' as string]: col[2], ['--tc2' as string]: col[3] }} aria-label="Your quarterback">
          <div className="nc-card-top">
            <span className="nc-school">{col[0]} <small>{col[1]}</small></span>
            <span className="nc-ovr"><b>{ovr}</b><small>OVR</small></span>
          </div>
          <div className="nc-jersey" aria-hidden><span>{(clean.split(' ').slice(-1)[0] || 'Rookie').toUpperCase()}</span><b>{number}</b></div>
          <div className="nc-who">
            <b className={ok ? '' : 'empty'}>{ok ? clean : 'Your name here'}</b>
            <span>Quarterback · {A.name}</span>
          </div>
          <div className="nc-bars">
            {ATTRS.map((k) => (
              <span key={k} className="nc-bar"><em>{ATTR_LABEL[k]}</em><i><b style={{ width: `${(A.attrs[k] - 40) / 0.59}%` }} /></i><strong>{A.attrs[k]}</strong></span>
            ))}
          </div>
          <p className="nc-sig"><b>{ABILITIES[A.sig].name}</b> {ABILITIES[A.sig].blurb}</p>
          <button className="btn primary big nc-go" disabled={!ok} onClick={start}>{ok ? 'Start your career' : 'Name him to start'}</button>
        </aside>
      </div>

      <p className="muted small nc-foot">
        Have a saved career? <label className="cr-linkish">Load it<input type="file" accept="application/json" hidden onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          try { onLoad(await importCareer(f)); } catch (x) { setErr((x as Error).message); }
        }} /></label>
        {err && <span className="cr-err"> {err}</span>}
        {onSlots && <span> · Slot {slot}: <button className="cr-linkish" onClick={onSlots}>your careers</button></span>}
        <span> · A fictional league: every team and player is made up. Not affiliated with the NFL.</span>
      </p>
    </div>
  );
}

function CollegeIntro({ c, onPlay }: { c: Career; onPlay: (m: 'moments' | 'full' | 'sim') => void }) {
  const col = COLLEGES.find((x) => x[0] === c.college.you)!;
  const riv = COLLEGES.find((x) => x[0] === c.college.them)!;
  return (
    <div className="cr-page">
      <section className="cr-card cr-bowl" style={{ ['--tc' as string]: col[2] }}>
        <div className="eyebrow">The bowl game · Scouts in the building</div>
        <h1>{col[0]} <span className="muted">vs</span> {riv[0]}</h1>
        <p className="cr-lede">{c.you.name}, {ARCH[c.you.arch].name.toLowerCase()} out of {col[0]}. One last college game, and every team in the league is watching. How you throw it, whether you win, and how well you call it sets your draft stock: a big game can make you a top-five pick.</p>
        <PlayButtons onPlay={onPlay} sim="Sim it (scouts grade you lower)" />
      </section>
    </div>
  );
}

export function PlayButtons({ onPlay, sim = 'Sim game' }: { onPlay: (m: 'moments' | 'full' | 'sim') => void; sim?: string }) {
  return (
    <div className="cr-play">
      <button className="btn primary big" onClick={() => onPlay('moments')}>Play the moments<small>The sim runs the game and hands you the ball when it's on the line</small></button>
      <button className="btn big cr-full" onClick={() => onPlay('full')}>Play full game<small>Call every snap of your offense</small></button>
      <button className="btn ghost" onClick={() => onPlay('sim')}>{sim}</button>
    </div>
  );
}
