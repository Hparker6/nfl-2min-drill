/**
 * A big moment on the field: a flash for a turnover or a touchdown, confetti when it goes your way, and a stamp at the
 * final whistle. Decorative only (aria-hidden: the ribbon and the result card already say what happened). Under
 * prefers-reduced-motion the CSS keeps a short color change and drops the movement.
 */
import { useEffect } from 'react';
import type { ImpactKind } from '../game/fx';

const DUR: Record<ImpactKind, number> = { giveaway: 1300, takeaway: 1500, tdFor: 2000, tdAgainst: 1100, win: 3400, loss: 3000, bigPlay: 1300, converted: 1500, stop: 1500 };
/** The word that bursts onto the field (the ribbon and the result card say the rest). */
const WORD: Partial<Record<ImpactKind, string>> = { tdFor: 'Touchdown', takeaway: 'Takeaway', giveaway: 'Turnover', bigPlay: 'Big play', converted: 'Converted', stop: 'Stopped' };
const COLORS = ['#f5c518', '#63d58a', '#5b9cff', '#ffffff', '#2dd4bf', '#ff7ab8'];

/** Confetti pieces: fixed positions per index, so a re-render never reshuffles them. */
const PIECES = Array.from({ length: 36 }, (_, i) => ({
  x: (i * 37) % 100,
  delay: ((i * 53) % 40) / 100,
  drift: ((i * 29) % 60) - 30,
  spin: 240 + ((i * 71) % 480),
  color: COLORS[i % COLORS.length],
  w: 5 + (i % 3) * 2,
}));

/** Falling confetti, for any positioned container with the .impact class (it sizes the fall). */
export function Confetti({ n, team }: { n: number; team?: [string, string] }) {
  return (
    <div className="confetti">
      {PIECES.slice(0, n).map((p, i) => (
        <i key={i} style={{ left: `${p.x}%`, background: team ? (i % 3 === 2 ? '#ffffff' : team[i % 2]) : p.color, width: p.w, animationDelay: `${p.delay}s`, ['--drift' as string]: `${p.drift}px`, ['--spin' as string]: `${p.spin}deg` }} />
      ))}
    </div>
  );
}

/** `colors`: your team's colors, for the touchdown's confetti and word. */
export function Impact({ kind, onDone, colors }: { kind: ImpactKind; onDone: () => void; colors?: [string, string] }) {
  useEffect(() => {
    const t = setTimeout(onDone, DUR[kind]);
    return () => clearTimeout(t);
  }, [kind]);   // eslint-disable-line react-hooks/exhaustive-deps
  const confetti = kind === 'win' ? 36 : kind === 'tdFor' ? 36 : kind === 'takeaway' || kind === 'converted' || kind === 'stop' ? 18 : 0;
  const word = WORD[kind];
  return (
    <div className={`impact impact-${kind}`} aria-hidden style={colors ? { ['--tc' as string]: colors[0], ['--tc2' as string]: colors[1] } : undefined}>
      {confetti > 0 && <Confetti n={confetti} team={kind === 'tdFor' ? colors : undefined} />}
      {word && <div className={`burst burst-${kind}`}><b>{word}</b></div>}
      {kind === 'win' && <div className="stamp win"><b>You win</b><span>Final</span></div>}
      {kind === 'loss' && <div className="stamp loss"><b>Final</b><span>Not this time</span></div>}
    </div>
  );
}
