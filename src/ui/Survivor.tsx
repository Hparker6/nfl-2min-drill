import { useMemo, useState } from 'react';
import { survivorScenario } from '../engine/scenario';
import { hash } from '../engine/rng';
import { rating, shareText, survivorShare } from '../game/share';
import type { Store, SpotResult } from '../game/storage';
import { track } from '../game/analytics';
import { GameScreen } from './GameScreen';

interface Props {
  store: Store;
  update: (fn: (s: Store) => void) => void;
  toast: (msg: string) => void;
}

export function Survivor({ store, update, toast }: Props) {
  const run = store.surv.run;
  const live = run && !run.over ? run : null;
  // the game on screen stays up through its review, even once a loss has ended the run
  const [reviewing, setReviewing] = useState<number | null>(null);
  const idx = reviewing ?? (live ? live.results.length : null);
  const sc = useMemo(() => (run && idx != null ? survivorScenario(run.id, idx) : null), [run?.id, idx]); // eslint-disable-line react-hooks/exhaustive-deps

  const newRun = () => {
    setReviewing(null);
    update((s) => {
      s.surv.runs++;
      s.surv.run = { id: hash(Date.now(), Math.random()), results: [], over: false };
    });
  };

  const done = (i: number, r: SpotResult) => {
    setReviewing(i);
    update((s) => {
      const R = s.surv.run;
      if (!R || R.results.some((x) => x.id === r.id)) return;
      R.results.push(r);
      delete R.cur;
      s.history.push(r);
      if (s.history.length > 300) s.history.splice(0, s.history.length - 300);
      if (!r.win) {
        R.over = true;
        const wins = R.results.length - 1;
        s.surv.best = Math.max(s.surv.best, wins);
        track('survivor_end', { wins, rating: rating(R.results) });
      }
    });
  };

  const survived = run ? run.results.filter((r) => r.win).length : 0;
  const meta = (
    <div className="meta">
      <div className="meta-l">
        <h1 className="meta-title">Survivor</h1>
        <span className="meta-sub">One loss ends the run · best {store.surv.best}</span>
      </div>
      {run && <div className="streak-pips" aria-label={`${survived} survived`}>{run.results.map((r, i) => <i key={i} className={r.win ? 'w' : 'l'} />)}<b>{survived}</b></div>}
    </div>
  );

  if (run && sc && idx != null) {
    return (
      <GameScreen
        key={sc.id}
        sc={sc}
        saved={reviewing == null ? run.cur ?? [] : []}
        settings={store.settings}
        hints={false}
        meta={meta}
        label={`Game ${idx + 1}`}
        autoStart={reviewing == null && !!run.cur}
        startLabel="Play it"
        onStart={() => update((s) => { if (s.surv.run) s.surv.run.cur = []; })}
        onPicks={(p) => update((s) => { if (s.surv.run && !s.surv.run.over) s.surv.run.cur = p; })}
        onDone={(r) => done(idx, r)}
        onContinue={() => setReviewing(null)}
        continueLabel={run.over ? 'See the run' : 'Next game'}
      />
    );
  }
  if (run && run.over) {
    const share = async () => {
      const r = await shareText(survivorShare(run.results), 'survivor');
      if (r === 'copied') toast('Result copied. Paste it anywhere.');
    };
    return (
      <div className="page">
        {meta}
        <section className="summary">
          <div className="sum-stats">
            <div className="stat big"><span className="k">Survived</span><b>{survived}</b></div>
            <div className="stat"><span className="k">Best run</span><b>{store.surv.best}</b></div>
            <div className="stat"><span className="k">Coach rating</span><b>{rating(run.results)}</b></div>
          </div>
          <div className="sum-spots">
            {run.results.map((r, i) => (
              <div key={i} className="sum-spot">
                <span className={`tile ${r.win ? 'won' : 'lost'}`}>{r.win ? 'W' : 'L'}</span>
                <span className="sum-score">{r.teams[0]} {r.score[0]} – {r.score[1]} {r.teams[1]}{r.ot ? ' (OT)' : ''}</span>
              </div>
            ))}
          </div>
          <div className="sum-actions">
            <button className="btn primary big" onClick={share}>Share run</button>
            <button className="btn big" onClick={newRun}>Start a new run</button>
          </div>
        </section>
      </div>
    );
  }
  return (
    <div className="page">
      {meta}
      <section className="summary rules">
        <h2>One loss and you're out</h2>
        <ul>
          <li>Random late-game spots, back to back, on offense or defense.</li>
          <li><b>Win the game to keep going.</b> Lose once and the run is over. A tie goes to overtime, settled by a coin weighted to the stronger team.</li>
          <li>The holes get deeper and the clock shorter the longer you last.</li>
          <li>Every call is still graded, so you can see what to do better next run.</li>
        </ul>
        <div className="sum-stats">
          <div className="stat"><span className="k">Best run</span><b>{store.surv.best}</b></div>
          <div className="stat"><span className="k">Runs played</span><b>{store.surv.runs}</b></div>
        </div>
        <button className="btn primary big" onClick={newRun}>Start a run</button>
      </section>
    </div>
  );
}
