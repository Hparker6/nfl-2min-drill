import { useEffect, useMemo, useState } from 'react';
import { ARCHETYPES } from '../engine/data';
import { SPOTS_PER_DAY, dailyScenarios, dayNumber, utcDate } from '../engine/scenario';
import { GRADE_INFO } from '../game/grade';
import { archetype, dailyShare, shareText } from '../game/share';
import { rateSpot, rateSpots } from '../game/rating';
import { streak, type Store, type SpotResult } from '../game/storage';
import { track } from '../game/analytics';
import { GameScreen } from './GameScreen';

interface Props {
  store: Store;
  update: (fn: (s: Store) => void) => void;
  toast: (msg: string) => void;
  go: (mode: 'survivor' | 'practice') => void;
  onboarded: () => void;
  openHelp: () => void;
}

export function Daily({ store, update, toast, go, onboarded, openHelp }: Props) {
  const [today] = useState(utcDate);
  const scs = useMemo(() => dailyScenarios(today), [today]);
  const day = store.days[today] ?? { spots: [] };
  const next = day.spots.length;
  // a finished spot stays on screen for its review until you move on
  const [reviewing, setReviewing] = useState<number | null>(null);
  const idx = reviewing ?? next;

  const done = (i: number, r: SpotResult) => {
    setReviewing(i);
    update((s) => {
      const d = (s.days[today] ??= { spots: [] });
      if (d.spots.some((x) => x.id === r.id)) return;
      d.spots.push(r);
      delete d.cur;
      s.history.push(r);
      if (s.history.length > 300) s.history.splice(0, s.history.length - 300);
      if (i === SPOTS_PER_DAY - 1) track('daily_complete', { wins: d.spots.filter((x) => x.win).length, performance: rateSpots(d.spots).performance });
    });
  };

  const meta = (
    <div className="meta">
      <div className="meta-l">
        <h1 className="meta-title">Daily <span>#{dayNumber(today)}</span></h1>
        <span className="meta-sub">{new Date(today + 'T12:00:00Z').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })} · same three spots for everyone</span>
      </div>
      <div className="tiles" aria-label="Today's spots">
        {scs.map((_, i) => {
          const r = day.spots[i];
          return <span key={i} className={`tile${r ? (r.win ? ' won' : ' lost') : ''}${idx === i && !r ? ' on' : ''}`} title={r ? `${r.win ? 'Win' : 'Loss'} ${r.score.join('–')}` : `Spot ${i + 1}`}>{r ? (r.win ? 'W' : 'L') : i + 1}</span>;
        })}
      </div>
    </div>
  );

  if (idx >= SPOTS_PER_DAY) {
    return <div className="page">{meta}<DaySummary date={today} spots={day.spots} streakN={streak(store, today, SPOTS_PER_DAY)} toast={toast} go={go} /></div>;
  }
  const resume = day.cur && day.cur.idx === idx ? day.cur.picks : [];
  return (
    <GameScreen
      key={scs[idx].id}
      sc={scs[idx]}
      saved={resume}
      settings={store.settings}
      hints={false}
      meta={meta}
      label={`Spot ${idx + 1} of ${SPOTS_PER_DAY}`}
      autoStart={!!day.cur && day.cur.idx === idx}
      onStart={() => update((s) => { (s.days[today] ??= { spots: [] }).cur = { idx, picks: [] }; s.seenHelp = true; })}
      welcome={!store.seenHelp && idx === 0 && !day.cur ? (
        <div className="welcome">
          <p className="welcome-lead"><b>You call the plays at the end of a close game.</b> Pick each play, run the clock, win it. Every call is graded against every other option you had.</p>
          <p className="welcome-sub">Three spots a day, the same for everyone. About five minutes.</p>
          <div className="welcome-links">
            <button className="link" onClick={() => { onboarded(); go('practice'); }}>Warm up in Practice</button>
            <span aria-hidden>·</span>
            <button className="link" onClick={openHelp}>How it works</button>
          </div>
        </div>
      ) : undefined}
      onPicks={(p) => update((s) => { const d = (s.days[today] ??= { spots: [] }); if (d.spots.length === idx) d.cur = { idx, picks: p }; })}
      onDone={(r) => done(idx, r)}
      onContinue={() => setReviewing(null)}
      continueLabel={idx < SPOTS_PER_DAY - 1 ? 'Next spot' : 'See your day'}
    />
  );
}

function DaySummary({ date, spots, streakN, toast, go }: { date: string; spots: SpotResult[]; streakN: number; toast: (m: string) => void; go: Props['go'] }) {
  const wins = spots.filter((s) => s.win).length;
  const arch = ARCHETYPES[archetype(spots.flatMap((s) => s.tags))];
  const lost = spots.reduce((a, s) => a + s.lost, 0), aiLost = spots.reduce((a, s) => a + s.aiLost, 0);
  const share = async () => {
    const r = await shareText(dailyShare(date, spots, streakN), 'daily');
    if (r === 'copied') toast('Result copied. Paste it anywhere.');
    else if (r === 'failed') toast('Could not share. Try again.');
  };
  return (
    <section className="summary">
      <div className="sum-stats">
        <div className="stat big"><span className="k">Record</span><b>{wins}–{spots.length - wins}</b></div>
        <div className="stat" title="Average of the three spots. Each spot: 55% decisions + 45% result"><span className="k">Performance</span><b>{rateSpots(spots).performance}</b></div>
        <div className="stat" title="How close your calls were to the best ones, all three spots"><span className="k">Decisions</span><b>{rateSpots(spots).decisions}</b></div>
        <div className="stat"><span className="k">Streak</span><b>{streakN}</b></div>
        <div className="stat"><span className="k">vs AI coach</span><b>{Math.abs(aiLost - lost) < 0.5 ? 'Even' : (aiLost - lost > 0 ? '+' : '') + (aiLost - lost).toFixed(1)}</b></div>
      </div>
      <div className="sum-spots">
        {spots.map((s, i) => {
          const counts = (['g', 'y', 'o', 'r'] as const).map((g) => [g, s.grades.filter((x) => x === g).length] as const);
          return (
            <div key={i} className="sum-spot">
              <span className={`tile ${s.win ? 'won' : 'lost'}`}>{s.win ? 'W' : 'L'}</span>
              <span className="sum-score">{s.teams[0]} {s.score[0]} – {s.score[1]} {s.teams[1]}{s.ot ? ' (OT)' : ''} <em className="sum-perf" title="Performance for this spot: 55% decisions + 45% result">{rateSpot(s).performance} <small>perf</small></em></span>
              <span className="sum-grades">
                {counts.filter(([, n]) => n).map(([g, n]) => <span key={g} className={`gcount g-${g}`}>{GRADE_INFO[g].glyph} {n}</span>)}
              </span>
            </div>
          );
        })}
      </div>
      <div className="arch">
        <span className="k">You call it like</span>
        <span className="arch-name">{arch.name}</span>
        <span className="muted">{arch.blurb}</span>
      </div>
      <div className="sum-actions">
        <button className="btn primary big" onClick={share}>Share result</button>
        <div className="row">
          <button className="btn" onClick={() => go('survivor')}>Play Survivor</button>
          <button className="btn" onClick={() => go('practice')}>Practice</button>
        </div>
        <span className="muted small">Next daily in <Countdown /></span>
      </div>
    </section>
  );
}

function Countdown() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const next = new Date(now);
  next.setUTCHours(24, 0, 0, 0);
  const s = Math.max(0, Math.floor((next.getTime() - now) / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return <b>{h}:{String(m).padStart(2, '0')}:{String(sec).padStart(2, '0')}</b>;
}
