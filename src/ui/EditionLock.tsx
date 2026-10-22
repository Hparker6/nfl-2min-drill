import { EDITION_NAME, EDITION_PRICE, editionShown, ownsEdition } from '../game/edition';
import { track } from '../game/analytics';
import { lastKnownPayments } from '../game/account';

/** What a locked part of the Coach's Edition says: what it holds, the price, and the way to buy it (once it's on sale). */
export function EditionLock({ title, blurb, points }: { title: string; blurb: string; points?: string[] }) {
  return (
    <section className="ed-lock">
      <div className="eyebrow">{EDITION_NAME}</div>
      <h3>{title}</h3>
      <p className="muted">{blurb}</p>
      {points && <ul className="ed-points">{points.map((p) => <li key={p}>{p}</li>)}</ul>}
      {lastKnownPayments() === 'off'
        ? <p className="ed-price"><b>{EDITION_PRICE}</b> once, no subscription · <span className="muted">not on sale yet</span></p>
        : <p className="ed-price"><b>{EDITION_PRICE}</b> once, no subscription <button className="btn primary small" onClick={() => window.dispatchEvent(new Event('4c:account'))}>Get the {EDITION_NAME}</button></p>}
    </section>
  );
}

/**
 * The Coach's Edition, in one small card: on the Daily's brief and after a game. Only while it's on sale, and never
 * for an owner. The button opens the account panel, which lists everything and sells it.
 */
export function EditionPromo({ where }: { where: 'brief' | 'after' }) {
  if (!editionShown() || ownsEdition() || lastKnownPayments() === 'off') return null;
  const open = () => { track('edition_promo', { where, action: 'open' }); window.dispatchEvent(new Event('4c:account')); };
  return (
    <aside className={`ed-promo ed-promo-${where}`} aria-label={EDITION_NAME}>
      <div className="ed-promo-head">
        <span className="ed-promo-star" aria-hidden>★</span>
        <b>{EDITION_NAME}</b>
        <span className="ed-promo-price">{EDITION_PRICE} once</span>
      </div>
      <p>{where === 'after' ? 'Want more? ' : ''}Six trick plays and kicks, no ads, Career Legacy and the Hall of Fame, three career slots, and the Gridiron Challenge.</p>
      <button className="btn small" onClick={open}>See what’s inside</button>
    </aside>
  );
}

/** Everything the edition holds, for any lock that wants the full list. */
export const EDITION_POINTS = [
  'No ads, anywhere in the game',
  'The Coach’s Playbook: hook and ladder, Statue of Liberty, halfback pass, fake punt, surprise onside and squib kicks',
  'Career Legacy: retirement, the Hall of Fame vote, the record book and the league’s history',
  'Three career slots',
  'The Gridiron Challenge ladder: eight original spots, three stars each',
];
