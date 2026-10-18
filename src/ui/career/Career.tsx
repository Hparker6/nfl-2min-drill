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
import { Offseason, Postgame, SeasonDone } from './Screens';
import { DraftNight } from './Draft';
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
  const [hubTab, setHubTab] = useState<'home' | 'player'>('home');   // the postgame's Spend points opens the Player tab

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
    return <Postgame c={c} gameId={post} onContinue={(upgrade) => {
      if (post === 'college') { setPost(null); return; }
      setHubTab(upgrade ? 'player' : 'home');
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
  return <>{banner}<Hub key={hubTab} initialTab={hubTab} c={c} commit={commit} onPlay={play} onBye={() => work('Simming the week…', () => commit((x) => closeWeek(x)))}
    onRetire={() => { if (confirm('Start over? This career will be deleted from this browser.')) { saveCareer(null); setC(null); } }}
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
  const A = ARCH[arch];
  const col = COLLEGES[college];
  const ovr = Math.round(ATTRS.reduce((s, k) => s + A.attrs[k], 0) / ATTRS.length);
  const start = () => ok && onCreate({ name: clean, number, arch, college, settings: { qLen: qLen * 60, diff } });
  const nums = Array.from({ length: 19 }, (_, i) => i + 1);
  const step = (d: number) => setNumber((n) => nums[(nums.indexOf(n) + d + nums.length) % nums.length]);
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
                <b aria-live="polite">#{number}</b>
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
            <summary><h2><i>4</i>Game settings</h2><span>{qLen}-minute quarters · {diff === 'allpro' ? 'All-Pro' : diff === 'rookie' ? 'Rookie' : 'Pro'}</span></summary>
            <div className="nc-set">
              <label><span>Quarter length (full games)</span>
                <select value={qLen} onChange={(e) => setQLen(Number(e.target.value))}>
                  {[2, 3, 4, 5, 6, 8, 10, 12].map((m) => <option key={m} value={m}>{m} minutes{m === 2 ? ' (quick)' : ''}</option>)}
                </select>
              </label>
              <label><span>Difficulty</span>
                <select value={diff} onChange={(e) => setDiff(e.target.value as Settings['diff'])}>
                  <option value="rookie">Rookie: softer defenses, win chance on every call</option>
                  <option value="pro">Pro</option>
                  <option value="allpro">All-Pro: tougher defenses</option>
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
