import { fmtClock } from '../game/describe';
import { GRADE_INFO } from '../game/grade';
import type { Session } from '../game/session';
import { rating } from '../game/share';
import type { SpotResult } from '../game/storage';
import { Spark } from './Scoreboard';

interface Props {
  result: SpotResult;
  session: Session;
  trail: number[];
  onContinue: () => void;
  continueLabel: string;
  lastPlay?: string;
}

export function SpotReview({ result, session, trail, onContinue, continueLabel, lastPlay }: Props) {
  const graded = session.records.filter((r) => r.grade);
  const beatAi = result.aiLost - result.lost;
  return (
    <section className={`review ${result.win ? 'win' : 'loss'}`}>
      <div className="rv-head">
        <span className="rv-res">{result.win ? 'Win' : 'Loss'}{result.ot ? ' · OT' : ''}</span>
        <span className="rv-score">{result.score[0]}–{result.score[1]}</span>
      </div>
      {lastPlay && <p className="rv-last"><span className="k">Final play</span>{lastPlay}</p>}
      {result.ot && <p className="muted small">Tied at the gun. Overtime: {result.win ? 'your kicker won it.' : 'they kicked the winner.'}</p>}
      <div className="rv-stats">
        <div className="stat"><span className="k">Rating</span><b>{graded.length ? rating([result]) : '—'}</b></div>
        <div className="stat"><span className="k">Calls</span><b>{graded.length}</b></div>
        <div className="stat"><span className="k">vs AI</span><b className={beatAi > 0.5 ? 'pos' : beatAi < -0.5 ? 'neg' : ''}>{Math.abs(beatAi) < 0.5 ? 'Even' : (beatAi > 0 ? '+' : '') + beatAi.toFixed(1)}</b></div>
      </div>
      {trail.length > 1 && <div className="rv-spark"><span className="k">Your win chance, call by call</span><Spark values={trail} h={36} /></div>}
      <ol className="rv-calls">
        {graded.map((rec, i) => {
          const g = rec.grade!;
          return (
            <li key={i} className={`g-${g.g}`}>
              <details>
                <summary>
                  <span className="grade-dot">{GRADE_INFO[g.g].glyph}</span>
                  <span className="rv-t">{fmtClock(rec.t)}</span>
                  <span className="rv-call">{rec.label}</span>
                  {g.lost >= 0.05 ? <span className="rv-best">{g.bestLabel} <em>+{g.lost.toFixed(1)}</em></span> : <span className="rv-best ok">best</span>}
                </summary>
                <p className="rv-why">{g.why.join(' ')}</p>
              </details>
            </li>
          );
        })}
      </ol>
      <button className="btn primary big" onClick={onContinue}>{continueLabel}</button>
    </section>
  );
}
