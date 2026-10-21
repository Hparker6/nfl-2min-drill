/**
 * A first-game tour: a few short notes, each pointing at one part of the screen with the rest dimmed. Steps whose
 * part isn't on screen are skipped (the defense has no playbook tabs, say). It blocks clicks while it's up, so a
 * note can't be dismissed by calling a play by accident, and Escape or "Skip tour" ends it.
 */
import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

export interface TourStep { sel?: string; title: string; text: string }

interface Box { top: number; left: number; width: number; height: number }
const PAD = 6, GAP = 12, POP_W = 320;

export function Tour({ steps, onDone }: { steps: TourStep[]; onDone: (finished: boolean) => void }) {
  // the steps whose target exists now (decided once, when the tour opens)
  const shown = useMemo(() => steps.filter((s) => !s.sel || document.querySelector(s.sel)), []);   // eslint-disable-line react-hooks/exhaustive-deps
  const [i, setI] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const step = shown[i];

  useLayoutEffect(() => {
    if (!step) return;
    const el = step.sel ? document.querySelector<HTMLElement>(step.sel) : null;
    if (!el) { setBox(null); return; }
    const r0 = el.getBoundingClientRect();
    if (r0.top < 70 || r0.bottom > window.innerHeight - 40) el.scrollIntoView({ block: 'center', behavior: 'auto' });
    const measure = () => { const r = el.getBoundingClientRect(); setBox({ top: r.top, left: r.left, width: r.width, height: r.height }); };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => { window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true); };
  }, [step]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onDone(false); } };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onDone]);

  if (!step) { queueMicrotask(() => onDone(true)); return null; }
  const last = i === shown.length - 1;
  const next = () => (last ? onDone(true) : setI(i + 1));

  // the note goes below its target when there's room, above it otherwise; centered when there's no target
  const vw = window.innerWidth, vh = window.innerHeight;
  const w = Math.min(POP_W, vw - 24);
  let pos: React.CSSProperties, arrow: 'up' | 'down' | null = null, ax = 0;
  if (box) {
    const left = Math.max(12, Math.min(vw - w - 12, box.left + box.width / 2 - w / 2));
    ax = Math.max(18, Math.min(w - 18, box.left + box.width / 2 - left));
    const below = box.top + box.height + GAP + 170 < vh || box.top < 190;
    pos = below ? { top: Math.min(vh - 180, box.top + box.height + GAP), left, width: w } : { top: Math.max(12, box.top - GAP), left, width: w, transform: 'translateY(-100%)' };
    arrow = below ? 'up' : 'down';
  } else pos = { top: '50%', left: '50%', width: w, transform: 'translate(-50%, -50%)' };

  return createPortal(
    <div className="tour" aria-live="polite">
      <div className="tour-block" onClick={(e) => e.stopPropagation()} />
      {box ? <div className="tour-spot" style={{ top: box.top - PAD, left: box.left - PAD, width: box.width + 2 * PAD, height: box.height + 2 * PAD }} />
        : <div className="tour-dim" />}
      <div className={`tour-pop${arrow ? ` arrow-${arrow}` : ''}`} style={{ ...pos, ['--ax' as string]: `${ax}px` }} role="dialog" aria-modal="true" aria-labelledby="tour-h">
        <div className="tour-top"><h3 id="tour-h">{step.title}</h3><span className="tour-n">{i + 1} of {shown.length}</span></div>
        <p>{step.text}</p>
        <div className="tour-row">
          {!last ? <button className="link" onClick={() => onDone(false)}>Skip tour</button> : <span />}
          <button className="btn primary" onClick={next} autoFocus>{last ? 'Let’s play' : 'Got it'}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** The first Daily's tour: where things are, and how calls are judged. */
export const FIRST_GAME_TOUR: TourStep[] = [
  { sel: '.sb', title: 'Your spot', text: 'The score, the clock, the ball and both teams’ timeouts. The bar on the right is your chance to win from here.' },
  { sel: '.stage', title: 'The field', text: 'Your players are circles, theirs are diamonds, colored by rating. Tap one for his ratings. The play you pick is drawn here before you snap it.' },
  { sel: '.side .tempo', title: 'The clock', text: 'Pick a tempo with each play: hurry up, huddle, or milk the clock. Timeouts and spikes are here too.' },
  { sel: '.side .tabs5', title: 'Your playbook', text: '27 calls in five tabs: runs, short and deep passes, RPOs and trick plays. Pick one, then Snap (or press Enter).' },
  { sel: '.side .def-list', title: 'Your defense', text: 'When they have the ball, you call the defense: 19 coverages and blitzes. Pick one, then call it.' },
  { title: 'Every call is graded', text: 'The game plays your call out thousands of times against every option you had: great call, close, costly or big miss. A good call that doesn’t work out still counts as good.' },
];
