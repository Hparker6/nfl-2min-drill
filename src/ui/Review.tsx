import { fmtClock } from '../game/describe';
import { GRADE_INFO } from '../game/grade';
import type { Session } from '../game/session';
import { rateSpot } from '../game/rating';
import type { SpotResult } from '../game/storage';
import { Spark } from './Scoreboard';
import { keyMoments } from '../game/recap';

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
  const rt = rateSpot(result);
  const moments = keyMoments(session.records);
  return (
    <section className={`review ${result.win ? 'win' : 'loss'}`}>
      <div className="rv-head">
        <span className="rv-res">{result.win ? 'Win' : 'Loss'}{result.ot ? ' · OT' : ''}</span>
        <span className="rv-score">{result.score[0]}–{result.score[1]}</span>
      </div>
      {lastPlay && <p className="rv-last"><span className="k">Final play</span>{lastPlay}</p>}
      {result.ot && <p className="muted small">Tied at the end of regulation. {result.win ? 'You won it in overtime.' : 'They won it in overtime.'}</p>}
      <div className="rv-stats">
        <div className="stat big" title="Performance = 55% Decisions + 45% Result"><span className="k">Performance</span><b>{rt.performance}</b></div>
        <div className="stat" title="100 = you never gave up win chance versus the best call"><span className="k">Decisions</span><b>{graded.length ? rt.decisions : '—'}</b></div>
        <div className="stat" title="A win scores 75-100, a loss 0-25; harder spots score higher"><span className="k">Result</span><b>{rt.result}</b></div>
        <div className="stat"><span className="k">vs AI</span><b className={beatAi > 0.5 ? 'pos' : beatAi < -0.5 ? 'neg' : ''}>{Math.abs(beatAi) < 0.5 ? 'Even' : (beatAi > 0 ? '+' : '') + beatAi.toFixed(1)}</b></div>
      </div>
      <p className="rv-how">Performance blends your decisions (55%) with the result (45%). You gave up {result.lost.toFixed(1)} points of win chance across {graded.length} call{graded.length === 1 ? '' : 's'}.</p>
      {trail.length > 1 && <div className="rv-spark"><span className="k">Your win chance, call by call</span><Spark values={trail} h={36} /></div>}
      {moments.length > 0 && (
        <div className="rv-key">
          <span className="k">Key moments</span>
          {moments.map((m) => (
            <div key={m.kind} className={`rv-moment ${m.kind}`}>
              <span className="rv-m-k">{m.title}</span>
              <b>{m.call}</b>
              <small>{m.when}</small>
              <p>{m.text}</p>
            </div>
          ))}
        </div>
      )}
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
