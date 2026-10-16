/**
 * Career mode: create a quarterback, play one college game for your draft stock, get drafted, and play seasons in a
 * fictional league. Saved in this browser.
 */
import { useCallback, useEffect, useState } from 'react';
import type { Settings as AppSettings } from '../../game/storage';
import { track } from '../../game/analytics';
import {
  ARCH, ABILITIES, COLLEGES, joinTeam, newCareer, yourGameThisWeek, type Arch, type Career, type Settings,
} from '../../career/career';
import { closeWeek, finishLive, gameOf, simYourGame, startLive, COLLEGE_GAME } from '../../career/run';
import { endSeason, runOffseason, startNextSeason } from '../../career/offseason';
import { exportCareer, importCareer, loadCareer, saveCareer } from '../../career/save';
import { download } from '../../game/shareImage';
import { LiveGameView } from './LiveGame';
import { Hub } from './Hub';
import { DraftNight, Offseason, Postgame, SeasonDone } from './Screens';
import { CareerBoundary } from './Boundary';
import './career.css';

export type Commit = (fn: (c: Career) => void) => void;

export function CareerMode({ app }: { app: AppSettings }) {
  return <CareerBoundary><CareerInner app={app} /></CareerBoundary>;
}

function CareerInner({ app }: { app: AppSettings }) {
  const [c, setC] = useState<Career | null>(loadCareer);
  const [post, setPost] = useState<string | null>(null);      // the game id whose postgame is showing
  const [busy, setBusy] = useState<string | null>(null);
  const [unsaved, setUnsaved] = useState(false);

  const commit: Commit = useCallback((fn) => {
    setC((prev) => {
      if (!prev) return prev;
      const next = structuredClone(prev);
      fn(next);
      setUnsaved(!saveCareer(next));
      return next;
    });
  }, []);

  useEffect(() => { window.scrollTo({ top: 0 }); }, [c?.phase, post, !!c?.live]);

  /** Long work (a season of other games) off the click, so the button can show it's working. */
  const work = (label: string, fn: () => void) => { setBusy(label); setTimeout(() => { try { fn(); } finally { setBusy(null); } }, 30); };

  if (busy) return <div className="cr-page"><div className="cr-busy"><i /><span>{busy}</span></div></div>;

  if (!c) {
    return <NewCareer onCreate={(o) => work('Building the league: 32 teams, a season of history…', () => {
      const nc = newCareer(o);
      setUnsaved(!saveCareer(nc));
      setC(nc);
      track('career_start', { arch: o.arch });
    })} onLoad={(nc) => { saveCareer(nc); setC(nc); }} />;
  }

  const banner = unsaved ? <p className="notice">This browser isn't letting the game save (storage full or blocked). Your career plays on, but download a save from Settings to keep it.</p> : null;

  // a game in progress
  if (c.live) {
    return (
      <LiveGameView key={c.live.gameId} c={c} app={app}
        save={(live) => commit((x) => { x.live = live; })}
        onLeave={() => commit(() => {})}
        onFinal={(how) => {
          const id = c.live!.gameId;
          commit((x) => { finishLive(x, how); });
          setPost(id);
          track('career_game', { how, id });
        }} />
    );
  }

  if (post && c.last?.gameId === post) {
    return <Postgame c={c} gameId={post} onContinue={() => {
      if (post === 'college') { setPost(null); return; }
      work('Simming the rest of the week…', () => { commit((x) => closeWeek(x)); setPost(null); });
    }} />;
  }

  const play = (mode: 'moments' | 'full' | 'sim') => {
    const g = c.phase === 'college' ? COLLEGE_GAME : yourGameThisWeek(c);
    if (!g) return;
    if (mode === 'sim') {
      work('Simming your game…', () => { commit((x) => { simYourGame(x, gameOf(x, g.id)); }); setPost(g.id); });
      return;
    }
    commit((x) => { startLive(x, gameOf(x, g.id), mode); });
  };

  if (c.phase === 'college') return <>{banner}<CollegeIntro c={c} onPlay={play} /></>;
  if (c.phase === 'draft') return <>{banner}<DraftNight c={c} commit={commit} onDone={() => work('Setting up your rookie season…', () => commit((x) => joinTeam(x)))} /></>;
  if (c.phase === 'offseason') {
    return <>{banner}<Offseason c={c} commit={commit} onNext={() => work('A new season: schedules, rosters, rookies…', () => commit((x) => startNextSeason(x)))} /></>;
  }
  if (c.season.week > 22) {
    return <>{banner}<SeasonDone c={c} onOffseason={() => work('Awards, retirements, free agency…', () => commit((x) => { endSeason(x); runOffseason(x); }))} /></>;
  }
  return <>{banner}<Hub c={c} commit={commit} onPlay={play} onBye={() => work('Simming the week…', () => commit((x) => closeWeek(x)))}
    onRetire={() => { if (confirm('Start over? This career will be deleted from this browser.')) { saveCareer(null); setC(null); } }}
    onExport={() => download(exportCareer(c), `the-4th-call-career-${c.you.name.replace(/\W+/g, '-').toLowerCase()}.json`)} /></>;
}

function NewCareer({ onCreate, onLoad }: { onCreate: (o: { name: string; number: number; arch: Arch; college: number; settings: Partial<Settings> }) => void; onLoad: (c: Career) => void }) {
  const [name, setName] = useState('');
  const [number, setNumber] = useState(7);
  const [arch, setArch] = useState<Arch>('pocket');
  const [college, setCollege] = useState(0);
  const [qLen, setQLen] = useState(2);
  const [diff, setDiff] = useState<Settings['diff']>('pro');
  const [err, setErr] = useState<string | null>(null);
  const clean = name.trim().replace(/\s+/g, ' ').slice(0, 24);
  const ok = clean.length >= 2;
  return (
    <div className="cr-page cr-new">
      <header className="cr-hero">
        <div className="eyebrow">New · Career mode (beta)</div>
        <h1>Become the <em>franchise</em> quarterback</h1>
        <p className="cr-lede">Create your quarterback. Play one college game in front of the scouts, hear your name on draft night, then play a full 17-game season, the playoffs and the Gridiron Bowl. Call your own plays when the game's on the line. Get better every week.</p>
      </header>
      <section className="cr-card">
        <h2>Your quarterback</h2>
        <div className="cr-form">
          <label className="cr-field"><span className="k">Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="First Last" maxLength={24} autoComplete="off" />
          </label>
          <label className="cr-field cr-num"><span className="k">Number</span>
            <select value={number} onChange={(e) => setNumber(Number(e.target.value))}>
              {Array.from({ length: 19 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        </div>
        <h3 className="cr-sub">Style of play</h3>
        <div className="cr-arch" role="radiogroup" aria-label="Style of play">
          {(Object.keys(ARCH) as Arch[]).map((k) => {
            const A = ARCH[k];
            return (
              <button key={k} role="radio" aria-checked={arch === k} className={`cr-archcard${arch === k ? ' on' : ''}`} onClick={() => setArch(k)}>
                <span className="cr-arch-name">{A.name}</span>
                <span className="cr-arch-tag">{A.tag}</span>
                <span className="cr-arch-blurb">{A.blurb}</span>
                <span className="cr-bars">
                  {(['accuracy', 'arm', 'decision', 'mobility'] as const).map((a) => (
                    <span key={a} className="cr-bar"><span className="k">{a === 'decision' ? 'Decisions' : a[0].toUpperCase() + a.slice(1)}</span><i><b style={{ width: `${(A.attrs[a] - 40) / 0.59}%` }} /></i><em>{A.attrs[a]}</em></span>
                  ))}
                </span>
                <span className="cr-arch-sig">Starts with <b>{ABILITIES[A.sig].name}</b>: {ABILITIES[A.sig].blurb}</span>
              </button>
            );
          })}
        </div>
        {/* phones: the cards are compact, so the pick's description sits under them */}
        <p className="cr-arch-pick"><b>{ARCH[arch].name}.</b> {ARCH[arch].blurb} Starts with <b>{ABILITIES[ARCH[arch].sig].name}</b>: {ABILITIES[ARCH[arch].sig].blurb}</p>
        <h3 className="cr-sub">College</h3>
        <div className="cr-colleges">
          {COLLEGES.map((col, i) => (
            <button key={col[0]} className={`cr-col${college === i ? ' on' : ''}`} onClick={() => setCollege(i)} aria-pressed={college === i} style={{ ['--tc' as string]: col[2], ['--tc2' as string]: col[3] }}>
              <i /><span>{col[0]}</span><em>{col[1]}</em>
            </button>
          ))}
        </div>
        <h3 className="cr-sub">Game settings</h3>
        <div className="cr-form">
          <label className="cr-field"><span className="k">Quarter length (full games)</span>
            <select value={qLen} onChange={(e) => setQLen(Number(e.target.value))}>
              {[2, 3, 4, 5, 6, 8, 10, 12].map((m) => <option key={m} value={m}>{m} minutes{m === 2 ? ' (quick)' : ''}</option>)}
            </select>
          </label>
          <label className="cr-field"><span className="k">Difficulty</span>
            <select value={diff} onChange={(e) => setDiff(e.target.value as Settings['diff'])}>
              <option value="rookie">Rookie: softer defenses, win chance on every call</option>
              <option value="pro">Pro</option>
              <option value="allpro">All-Pro: tougher defenses</option>
            </select>
          </label>
        </div>
        <button className="btn primary big" disabled={!ok} onClick={() => onCreate({ name: clean, number, arch, college, settings: { qLen: qLen * 60, diff } })}>Start your career</button>
        {!ok && <p className="muted small">Give him a name to start.</p>}
      </section>
      <p className="muted small cr-loadline">
        Have a saved career file? <label className="cr-linkish">Load it<input type="file" accept="application/json" hidden onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          try { onLoad(await importCareer(f)); } catch (x) { setErr((x as Error).message); }
        }} /></label>
        {err && <span className="cr-err"> {err}</span>}
      </p>
      <p className="muted small">A fictional league: every team and player is made up. Not affiliated with the NFL.</p>
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
