/** Everyone's daily stats: how many played each day, how the scores spread out, and the best of each day. */
import { useEffect, useMemo, useState } from 'react';
import { dayNumber, utcDate } from '../engine/scenario';
import { BAND_LABELS, fetchStats, leaderboardOn, type Stats } from '../game/leaderboard';
import { rateSpots, type Rating } from '../game/rating';
import type { Store } from '../game/storage';

const fmtDay = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

export function Everyone({ store, go }: { store: Store; go: (m: 'daily') => void }) {
  const today = utcDate();
  const [stats, setStats] = useState<Stats | null | 'off'>(leaderboardOn() ? null : 'off');
  const [day, setDay] = useState(today);
  const [failed, setFailed] = useState(false);
  useEffect(() => { if (leaderboardOn()) fetchStats().then((s) => { if (s === 'failed') setFailed(true); else setStats(s ?? { days: {} }); }); }, []);

  const days = useMemo(() => (stats && stats !== 'off' ? Object.keys(stats.days).sort() : []), [stats]);
  const mine = useMemo(() => {
    const dailies = store.history.filter((r) => r.mode === 'daily');
    return { n: dailies.length, wins: dailies.filter((r) => r.win).length, rating: rateSpots(dailies) as Rating };
  }, [store.history]);
  const yours = store.days[day]?.spots[0];

  if (stats === 'off') {
    return (
      <div className="page">
        <div className="meta"><div className="meta-l"><h1 className="meta-title">Everyone's daily stats</h1></div></div>
        <section className="summary">
          <p>The live leaderboard isn't connected on this site yet, so there are no shared stats to show. Your own games are counted below.</p>
          <YourLine mine={mine} />
          <button className="btn primary" onClick={() => go('daily')}>Play today</button>
        </section>
      </div>
    );
  }
  if (!stats) return <div className="page"><div className="meta"><div className="meta-l"><h1 className="meta-title">Everyone's daily stats</h1></div></div><section className="summary"><span className="muted">{failed ? 'The leaderboard didn’t answer. Reload to try again.' : 'Loading…'}</span></section></div>;

  const S = stats.days;
  const td = S[today] ?? { count: 0, average: 0, best: [], bands: Array(10).fill(0) };
  const allTime = days.reduce((a, d) => a + S[d].count, 0);
  const most = days.reduce((a, d) => Math.max(a, S[d].count), 0);
  const recent = days.slice(-14);
  const sel = S[day];
  const i = days.indexOf(day);
  const at = i < 0 ? days.length : i;   // a day with no scores (today, early) sits after the last one that has any
  const maxBand = sel ? Math.max(1, ...sel.bands) : 1;
  const yourBand = yours ? Math.min(9, Math.floor(rateSpots([yours]).performance / 10)) : -1;

  return (
    <div className="page">
      <div className="meta">
        <div className="meta-l"><h1 className="meta-title">Everyone's daily stats</h1><span className="meta-sub">the real results from the people who played</span></div>
        <button className="btn primary" onClick={() => go('daily')}>Play today ›</button>
      </div>
      <section className="summary">
        <p className="muted">Every day, everyone plays the same game. These are the results from the people who played it: how many finished each day, how their scores spread out, and the best scores of the day. Tap a day to see it. Scores are the game's Performance rating (0–100).</p>
        <div className="sum-stats">
          <div className="stat"><b>{td.count.toLocaleString()}</b><span className="k">played today</span></div>
          <div className="stat"><b>{td.count ? td.average : '—'}</b><span className="k">average score today</span></div>
          <div className="stat"><b>{allTime.toLocaleString()}</b><span className="k">games played, all time</span></div>
          <div className="stat"><b>{most.toLocaleString()}</b><span className="k">most in one day</span></div>
        </div>
        <YourLine mine={mine} />
        <div className="k">Players per day</div>
        <div className="ppd">
          {recent.map((d) => (
            <button key={d} className={`ppd-bar${d === day ? ' on' : ''}`} style={{ height: `${Math.max(4, (S[d].count / Math.max(1, most)) * 100)}%` }} title={`${fmtDay(d)}: ${S[d].count.toLocaleString()}`} onClick={() => setDay(d)} aria-label={`${fmtDay(d)}, ${S[d].count} players`} />
          ))}
        </div>
        <div className="ppd-axis"><span>{recent[0] ? fmtDay(recent[0]) : ''}</span><span>most {most.toLocaleString()}</span><span>{recent[recent.length - 1] ? fmtDay(recent[recent.length - 1]) : ''}</span></div>

        <div className="dayhead">
          <h2>{fmtDay(day)} <span className="muted">· Daily #{dayNumber(day)}</span></h2>
          <div className="row">
            <button className="icon" disabled={at <= 0} onClick={() => setDay(days[at - 1])} aria-label="Previous day">‹</button>
            <button className="icon" disabled={i < 0 || i >= days.length - 1} onClick={() => setDay(days[i + 1])} aria-label="Next day">›</button>
          </div>
        </div>
        {!sel ? <p className="muted">No scores for this day.</p> : (
          <>
            <div className="sum-stats three">
              <div className="stat"><b>{sel.count.toLocaleString()}</b><span className="k">players</span></div>
              <div className="stat"><b>{sel.average}</b><span className="k">average score</span></div>
              <div className="stat"><b>{sel.best[0]?.score ?? '—'}</b><span className="k">best score</span></div>
            </div>
            <div className="k">How everyone scored</div>
            <div className="hist-v">
              {sel.bands.map((n, b) => (
                <div key={b} className={`hist-col${b === yourBand ? ' mine' : ''}`} title={`${BAND_LABELS[b]}s: ${n}`}>
                  <span className="hist-n">{n.toLocaleString()}</span>
                  <i style={{ height: `${(n / maxBand) * 100}%` }} />
                  <span className="hist-x">{BAND_LABELS[b]}</span>
                </div>
              ))}
            </div>
            {yours && <p className="muted small">Your score that day: <b>{rateSpots([yours]).performance}</b>.</p>}
            {sel.best.length > 0 && (
              <>
                <div className="k">Top ten</div>
                <ol className="best">{sel.best.map((b, k) => <li key={k}><span>{k + 1}</span><span>{b.name}{b.pb && <i className="pb-badge" title="Played with the Coach's Playbook">★</i>}</span><b>{b.score}</b></li>)}</ol>
              </>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function YourLine({ mine }: { mine: { n: number; wins: number; rating: Rating } }) {
  if (!mine.n) return <p className="muted small">You haven't finished a daily on this device yet.</p>;
  return <p className="yours">You, all time: <b>{mine.n}</b> dail{mine.n === 1 ? 'y' : 'ies'} · <b>{mine.wins}–{mine.n - mine.wins}</b> · average performance <b>{mine.rating.performance}</b></p>;
}
