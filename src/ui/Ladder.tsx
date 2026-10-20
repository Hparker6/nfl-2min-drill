/**
 * The Gridiron Challenge ladder (Coach's Edition): eight original spots between the game's fictional teams, in four
 * tiers. Each rung opens once the one below it has a star; the first is free to try. Not part of the Daily, its
 * leaderboard, the badges or the stats (it keeps its own record, store.ladder).
 */
import { useMemo, useState } from 'react';
import { fmtClock } from '../game/describe';
import { ownsEdition } from '../game/edition';
import {
  LADDER, MAX_STARS, STAR_RULES, recordAttempt, rungScenario, rungTeams, starsFor, starsOf, totalStars, unlocked, type Rung, type Stars,
} from '../game/ladder';
import { utcDate } from '../engine/scenario';
import type { Store } from '../game/storage';
import { EDITION_POINTS, EditionLock } from './EditionLock';
import { GameScreen } from './GameScreen';

interface Props {
  store: Store;
  update: (fn: (s: Store) => void) => void;
}

/** The first rung is open to everyone the edition is shown to; the rest need it. */
const FREE_RUNGS = 1;

export const StarRow = ({ n, label }: { n: number; label?: string }) => (
  <span className="ld-stars" aria-label={label ?? `${n} of 3 stars`}>{[1, 2, 3].map((k) => <i key={k} className={k <= n ? 'on' : ''} aria-hidden>★</i>)}</span>
);

/** The spot in a few words: the score, the clock, the ball. */
export function situation(r: Rung): string {
  const d = r.score[0] - r.score[1];
  const lead = d === 0 ? 'Tied' : d > 0 ? `Up ${d}` : `Down ${-d}`;
  const ours = r.side === 'off' ? r.yl : 100 - r.yl;   // where the ball is, from your own goal
  const spot = ours === 50 ? 'midfield' : ours < 50 ? `your ${ours}` : `their ${100 - ours}`;
  const down = `${['1st', '2nd', '3rd', '4th'][r.down - 1]} & ${r.dist >= 100 - r.yl ? 'goal' : r.dist}`;
  return `${lead} · ${fmtClock(r.t)} · ${r.side === 'off' ? 'your ball' : 'their ball'}, ${down} at ${spot}`;
}

export function Ladder({ store, update }: Props) {
  const [run, setRun] = useState<{ i: number; attempt: number } | null>(null);
  const [last, setLast] = useState<{ i: number; stars: Stars; prev: Stars; win: boolean } | null>(null);
  const prog = store.ladder;
  const owned = ownsEdition();
  const sc = useMemo(() => (run ? rungScenario(LADDER[run.i], run.attempt) : null), [run]);
  const total = totalStars(prog);

  if (run && sc) {
    const r = LADDER[run.i];
    const meta = (
      <div className="meta">
        <div className="meta-l">
          <h2 className="meta-title">Rung {run.i + 1}: {r.title}</h2>
          <span className="meta-sub">Gridiron Challenge · {r.tier} · {r.lesson}</span>
        </div>
        <div className="ld-meta-r"><StarRow n={starsOf(prog, r.id)} label="Your best on this rung" /></div>
      </div>
    );
    return (
      <GameScreen key={sc.id} sc={sc} saved={[]} settings={store.settings} hints={false} meta={meta} label={`Rung ${run.i + 1} of ${LADDER.length}`} autoStart={false}
        startLabel="Play it" briefExtra={<><p className="ld-brief">{r.brief}</p><button className="btn ghost" onClick={() => setRun(null)}>Back to the ladder</button></>}
        onPicks={() => {}}
        onDone={(res) => {
          setLast({ i: run.i, stars: starsFor(res.win, res.lost), prev: starsOf(prog, r.id), win: res.win });
          update((s) => { recordAttempt((s.ladder ??= {}), r.id, res.win, res.lost, utcDate()); });
        }}
        onContinue={() => setRun(null)} continueLabel="Back to the ladder" />
    );
  }

  const play = (i: number) => { setLast(null); setRun({ i, attempt: (prog?.[LADDER[i].id]?.tries ?? 0) + 1 }); window.scrollTo({ top: 0 }); };
  const tiers = [...new Set(LADDER.map((r) => r.tier))];
  return (
    <div className="page ld">
      <div className="meta">
        <div className="meta-l"><h2 className="meta-title">Gridiron Challenge</h2><span className="meta-sub">Eight late-game spots, harder as you climb. Win for a star; call it well for three.</span></div>
        <div className="ld-total" aria-label={`${total} of ${MAX_STARS} stars`}><b>{total}</b><span>/ {MAX_STARS} ★</span></div>
      </div>

      {last && <LastResult r={LADDER[last.i]} {...last} onAgain={() => play(last.i)} onNext={last.i + 1 < LADDER.length && (last.stars > 0 || unlocked(prog, last.i + 1)) ? () => play(last.i + 1) : undefined} canNext={owned || last.i + 1 < FREE_RUNGS} />}

      <section className="ld-rules" aria-label="How stars are earned">
        {STAR_RULES.map(([n, text]) => <span key={n}><StarRow n={n} label={`${n} star${n === 1 ? '' : 's'}`} /> {text}</span>)}
        <span className="muted small">Decisions: 100 means you never gave up win chance against the best call. Coach mode's win chances are off here, and every attempt gets new bounces.</span>
      </section>

      {tiers.map((tier) => (
        <section key={tier} className="ld-tier">
          <h3 className="ld-tier-h">{tier}</h3>
          <div className="ld-rungs">
            {LADDER.map((r, i) => (r.tier !== tier ? null : <RungCard key={r.id} r={r} i={i} store={store} locked={!unlocked(prog, i)} paid={!owned && i >= FREE_RUNGS} onPlay={() => play(i)} />))}
          </div>
        </section>
      ))}

      {!owned && <EditionLock title="Climb the whole ladder" blurb={`Rung 1 is free to try. The other ${LADDER.length - FREE_RUNGS}, from the fourth-down call to a two-score comeback, come with the Coach's Edition.`} points={EDITION_POINTS} />}
      <p className="muted small">Every team on the ladder is fictional. Your ladder record is kept in this browser.</p>
    </div>
  );
}

function RungCard({ r, i, store, locked, paid, onPlay }: { r: Rung; i: number; store: Store; locked: boolean; paid: boolean; onPlay: () => void }) {
  const rec = store.ladder?.[r.id];
  const [a, b] = useMemo(() => rungTeams(r), [r]);
  const closed = locked || paid;
  return (
    <article className={`ld-rung${closed ? ' closed' : ''}${(rec?.stars ?? 0) === 3 ? ' done' : ''}`}>
      <header>
        <span className="ld-n">{i + 1}</span>
        <div><h4>{r.title}</h4><span className="small muted">{r.lesson}</span></div>
        <StarRow n={rec?.stars ?? 0} />
      </header>
      <p className="ld-sit">{situation(r)}{r.weather ? ` · ${r.weather}` : ''}</p>
      <p className="ld-match">
        <span className="ld-team" style={{ ['--tc' as string]: a.color, ['--tc2' as string]: a.color2 }}><i>{a.id}</i>{a.city} {a.name}</span>
        <span className="muted"> vs </span>
        <span className="ld-team" style={{ ['--tc' as string]: b.color, ['--tc2' as string]: b.color2 }}><i>{b.id}</i>{b.city} {b.name}</span>
      </p>
      <footer>
        <span className="small muted">{rec ? `${rec.tries} attempt${rec.tries === 1 ? '' : 's'} · ${rec.wins} win${rec.wins === 1 ? '' : 's'}${rec.best ? ` · best Decisions ${rec.best}` : ''}` : `AI coach wins ${Math.round(r.wp * 100)}% from here`}</span>
        {paid ? <span className="ld-lock">Coach's Edition</span>
          : locked ? <span className="ld-lock">Earn a star on rung {i} to open</span>
          : <button className="btn primary" onClick={onPlay}>{rec ? 'Play again' : 'Play'}</button>}
      </footer>
    </article>
  );
}

function LastResult({ r, i, stars, prev, win, onAgain, onNext, canNext }: { r: Rung; i: number; stars: Stars; prev: Stars; win: boolean; onAgain: () => void; onNext?: () => void; canNext: boolean }) {
  const better = stars > prev;
  return (
    <section className={`ld-last${stars ? ' win' : ''}`} aria-live="polite">
      <div>
        <span className="eyebrow">Rung {i + 1} · {r.title}</span>
        <h3>{!win ? 'Not this time' : stars === 3 ? 'Three stars' : stars === 2 ? 'Two stars' : 'One star'}</h3>
        <p className="muted small">{!win ? 'A loss earns no stars. New bounces every attempt.' : better ? (prev ? `New best (was ${prev}).` : 'First stars on this rung.') : `Your best here is still ${prev}.`}{stars > 0 && stars < 3 ? ` Next star: ${STAR_RULES[stars][1].toLowerCase()}.` : ''}</p>
      </div>
      <StarRow n={stars} />
      <div className="row">
        <button className="btn" onClick={onAgain}>Try it again</button>
        {onNext && canNext && <button className="btn primary" onClick={onNext}>Next rung ▸</button>}
      </div>
    </section>
  );
}
