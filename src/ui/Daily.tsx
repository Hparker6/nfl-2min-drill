import { useEffect, useMemo, useState } from 'react';
import { ARCHETYPES } from '../engine/data';
import { DAILY_KINDS, dailyScenarios, dayNumber, utcDate } from '../engine/scenario';
import { archetype, dailyShare, profileFacts, shareText } from '../game/share';
import { download, drawCard, shareCard, toBlob } from '../game/shareImage';
import { rateSpot } from '../game/rating';
import { BAND_LABELS, bandOf, fetchBoard, leaderboardOn, submitScore, type Board } from '../game/leaderboard';
import { streak, type Store, type SpotResult } from '../game/storage';
import { track } from '../game/analytics';
import { GameScreen } from './GameScreen';
import percentiles from '../data/percentiles.json';

interface Props {
  store: Store;
  update: (fn: (s: Store) => void) => void;
  toast: (msg: string) => void;
  go: (mode: 'survivor' | 'practice') => void;
  onboarded: () => void;
  openHelp: () => void;
}

/** "Better than X% of simulated play-callers", from the generated population (null until it is generated). */
export function simulatedPercentile(performance: number): number | null {
  const scores = (percentiles as { scores: number[] }).scores;
  if (!scores.length) return null;
  const below = scores.filter((s) => s < performance).length;
  const eq = scores.filter((s) => s === performance).length;
  return Math.round(((below + eq / 2) / scores.length) * 100);
}

export function Daily({ store, update, toast, go, onboarded, openHelp }: Props) {
  const [today] = useState(utcDate);
  const sc = useMemo(() => dailyScenarios(today)[0], [today]);
  const day = store.days[today] ?? { spots: [] };
  const result = day.spots[0];
  // the finished game stays on screen for its review until you move on to the score
  const [reviewing, setReviewing] = useState(false);
  const kind = sc.kind ? DAILY_KINDS[sc.kind] : null;

  const done = (r: SpotResult) => {
    setReviewing(true);
    update((s) => {
      const d = (s.days[today] ??= { spots: [] });
      if (d.spots.some((x) => x.id === r.id)) return;
      d.spots.push(r);
      delete d.cur;
      s.history.push(r);
      if (s.history.length > 300) s.history.splice(0, s.history.length - 300);
      track('daily_complete', { win: r.win, performance: rateSpot(r).performance });
    });
  };

  const meta = (
    <div className="meta">
      <div className="meta-l">
        <h1 className="meta-title">Daily <span>#{dayNumber(today)}</span></h1>
        <span className="meta-sub">{new Date(today + 'T12:00:00Z').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })}{kind ? ` · ${kind.name}` : ''} · one game, the same for everyone</span>
      </div>
      {result && <span className={`tile ${result.win ? 'won' : 'lost'}`} title={`${result.win ? 'Win' : 'Loss'} ${result.score.join('–')}`}>{result.win ? 'W' : 'L'}</span>}
    </div>
  );

  if (result && !reviewing) {
    return <div className="page">{meta}<DayScore date={today} result={result} store={store} update={update} toast={toast} go={go} kind={kind?.name} /></div>;
  }
  return (
    <GameScreen
      key={sc.id}
      sc={sc}
      saved={day.cur?.picks ?? []}
      settings={store.settings}
      hints={false}
      meta={meta}
      label={`Daily #${dayNumber(today)}`}
      autoStart={!!day.cur}
      onStart={() => update((s) => { (s.days[today] ??= { spots: [] }).cur = { idx: 0, picks: [] }; s.seenHelp = true; })}
      briefExtra={kind ? <p className="brief-kind">{kind.tagline}</p> : undefined}
      welcome={!store.seenHelp && !day.cur ? (
        <div className="welcome">
          <p className="welcome-lead"><b>You call the plays at the end of a close game.</b> Pick each play, run the clock, win it. Every call is graded against every other option you had.</p>
          <p className="welcome-sub">One game a day, the same for everyone. About two minutes.</p>
          <div className="welcome-links">
            <button className="link" onClick={() => { track('welcome_link', { to: 'practice' }); onboarded(); go('practice'); }}>Warm up in Practice</button>
            <span aria-hidden>·</span>
            <button className="link" onClick={() => { track('welcome_link', { to: 'help' }); openHelp(); }}>How it works</button>
          </div>
        </div>
      ) : undefined}
      onPicks={(p) => update((s) => { const d = (s.days[today] ??= { spots: [] }); if (!d.spots.length) d.cur = { idx: 0, picks: p }; })}
      onDone={done}
      onContinue={() => setReviewing(false)}
      continueLabel="See your score"
    />
  );
}

function DayScore({ date, result, store, update, toast, go, kind }: { date: string; result: SpotResult; store: Store; update: Props['update']; toast: (m: string) => void; go: Props['go']; kind?: string }) {
  const rt = rateSpot(result);
  const streakN = streak(store, date, 1);
  const arch = ARCHETYPES[archetype(result.tags)];
  const facts = profileFacts(result.tags);
  const vsAi = result.aiLost - result.lost;
  const pct = simulatedPercentile(rt.performance);
  const [board, setBoard] = useState<Board | null>(null);
  const [name, setName] = useState(store.settings.nickname ?? '');
  const [editing, setEditing] = useState(!store.settings.nickname);
  const on = leaderboardOn();

  // submit once per finished game (re-submitting with a new name just renames)
  useEffect(() => {
    if (!on) return;
    let live = true;
    const nick = store.settings.nickname;
    if (nick) track('leaderboard_submit', { performance: rt.performance, win: result.win });
    (nick ? submitScore(date, nick, rt.performance, result.grades.join(''), result.win) : fetchBoard(date)).then((b) => { if (live && b) setBoard(b); });
    return () => { live = false; };
  }, [on, date, rt.performance, store.settings.nickname]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveName = () => {
    const n = name.trim().slice(0, 20);
    if (!n) return;
    update((s) => { s.settings.nickname = n; });
    setEditing(false);
  };
  const shareTxt = dailyShare(date, [result], streakN, { percentile: pct, coach: arch.name, rank: board?.rank ? { rank: board.rank, count: board.count } : null });
  // the result card as an image, redrawn when the rank comes in
  const [card, setCard] = useState<{ blob: Blob; url: string } | null>(null);
  const rankLine = board?.rank ? `#${board.rank.toLocaleString()} of ${board.count.toLocaleString()} today` : pct != null ? `Better than ${pct}% of play-callers` : `${result.win ? 'Won' : 'Lost'} the game`;
  useEffect(() => {
    let live = true, url = '';
    drawCard({
      day: dayNumber(date), dateLabel: new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }),
      title: kind, performance: rt.performance, rankLine, teams: result.teams, score: result.score, win: result.win, ot: result.ot,
      grades: result.grades, coach: arch.name, streak: streakN, site: location.host || 'nfl-2min-drill.com',
    }).then(toBlob).then((blob) => {
      if (!live || !blob) return;
      url = URL.createObjectURL(blob);
      setCard({ blob, url });
    }).catch(() => { /* the text share still works */ });
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [rankLine, date]); // eslint-disable-line react-hooks/exhaustive-deps
  const share = async () => {
    if (card) {
      const r = await shareCard(card.blob, shareTxt);
      if (r === 'shared') { track('share', { what: 'daily', method: 'image' }); return; }
      if (r === 'cancelled') return;
    }
    const r = await shareText(shareTxt, 'daily');
    if (r === 'copied') toast('Result copied. Paste it anywhere.');
    else if (r === 'failed') toast('Could not share. Try again.');
  };
  const save = () => { if (card) { download(card.blob, `the-4th-call-${dayNumber(date)}.png`); track('share', { what: 'daily', method: 'download' }); } };
  const maxBand = board ? Math.max(1, ...board.bands) : 1;

  return (
    <section className="score">
      <div className="score-top">
        <span className="k">Day {dayNumber(date)} · your score</span>
        <div className="score-big">{rt.performance}</div>
        <div className="score-line">
          {board?.rank ? `#${board.rank.toLocaleString()} of ${board.count.toLocaleString()} today` : pct != null ? `Better than ${pct}% of simulated play-callers` : `Decisions ${rt.decisions} · Result ${rt.result}`}
        </div>
        <div className="score-sub">
          <span><em>{result.win ? 'Win' : 'Loss'}</em> {result.score[0]}–{result.score[1]}{result.ot ? ' OT' : ''}</span>
          <span><em>Decisions</em> {rt.decisions}</span>
          <span><em>vs the AI coach</em> {Math.abs(vsAi) < 0.5 ? 'Same' : vsAi > 0 ? 'Better' : 'Worse'}</span>
        </div>
        <div className="score-streak">{streakN > 1 ? `Day ${streakN} of your streak` : 'Day 1 of your streak'} · come back tomorrow</div>
      </div>

      <div className="coach">
        <span className="k">Today you coached like</span>
        <span className="coach-name">{arch.name}</span>
        <span className="coach-why">{facts.length ? `Like them, you ${facts.join(', and ')}.` : arch.blurb}</span>
      </div>

      <div className="share-card">
        {card ? <img className="share-img" src={card.url} alt={`Daily #${dayNumber(date)}: performance ${rt.performance} out of 100, ${rankLine}`} /> : <pre>{shareTxt}</pre>}
        <div className="share-btns">
          <button className="btn primary big" onClick={share}>Share your score</button>
          {card && <button className="btn big" onClick={save}>Save image</button>}
        </div>
      </div>

      <div className="board">
        <div className="board-head"><span className="k">Everyone today</span><button className="link" onClick={() => location.hash = 'everyone'}>All days ›</button></div>
        {!on ? (
          <p className="muted small">The live leaderboard isn't connected on this site yet. Your score is compared with simulated play-callers above.</p>
        ) : (
          <>
            {editing ? (
              <form className="nick" onSubmit={(e) => { e.preventDefault(); saveName(); }}>
                <label htmlFor="nick">Your name on the board</label>
                <div className="row">
                  <input id="nick" value={name} maxLength={20} placeholder="Coach name" onChange={(e) => setName(e.target.value)} />
                  <button className="btn primary" type="submit" disabled={!name.trim()}>Post my score</button>
                </div>
              </form>
            ) : (
              <div className="board-rank">
                <b>{board?.rank ? `#${board.rank.toLocaleString()} of ${board.count.toLocaleString()}` : board ? `${board.count.toLocaleString()} played` : 'Loading…'}</b>
                {board?.tied ? <span className="muted"> (tied with {board.tied.toLocaleString()})</span> : null}
                <button className="link" onClick={() => setEditing(true)}>as {store.settings.nickname}</button>
              </div>
            )}
            {board && (
              <>
                <div className="hist">
                  {board.bands.map((n, i) => (
                    <div key={i} className={`hist-row${bandOf(rt.performance) === i ? ' mine' : ''}`}>
                      <span className="hist-k">{BAND_LABELS[i]}</span>
                      <span className="hist-bar"><i style={{ width: `${(n / maxBand) * 100}%` }} /><b>{n.toLocaleString()}</b></span>
                    </div>
                  ))}
                </div>
                <p className="muted small">Today's average: {board.average} · yours: {rt.performance}</p>
                {board.best.length > 0 && (
                  <ol className="best">
                    <span className="k">Today's best</span>
                    {board.best.map((b, i) => <li key={i}><span>{i + 1}</span><span>{b.name}</span><b>{b.score}</b></li>)}
                  </ol>
                )}
              </>
            )}
          </>
        )}
      </div>

      <div className="sum-actions">
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
