import { EDITION_NAME, EDITION_PRICE } from '../game/edition';

/** What a locked part of the Coach's Edition says. There is nothing to buy yet, so it says so. */
export function EditionLock({ title, blurb, points }: { title: string; blurb: string; points?: string[] }) {
  return (
    <section className="ed-lock">
      <div className="eyebrow">{EDITION_NAME}</div>
      <h3>{title}</h3>
      <p className="muted">{blurb}</p>
      {points && <ul className="ed-points">{points.map((p) => <li key={p}>{p}</li>)}</ul>}
      <p className="ed-price"><b>{EDITION_PRICE}</b> once, no subscription · <span className="muted">not on sale yet</span></p>
    </section>
  );
}

/** Everything the edition holds, for any lock that wants the full list. */
export const EDITION_POINTS = [
  'Career Legacy: retirement, the Hall of Fame vote, the record book and the league’s history',
  'Three career slots',
  'The Gridiron Challenge ladder: eight original spots, three stars each',
];
