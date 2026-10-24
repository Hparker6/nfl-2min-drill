import { EDITION_NAME, EDITION_PRICE, editionShown, ownsEdition } from '../game/edition';
import { track } from '../game/analytics';
import { lastKnownPayments } from '../game/account';
import { Icon } from './Icon';

/** The edition is on sale here and this player doesn't own it: the only time any pitch shows. */
export const pitchable = () => editionShown() && !ownsEdition() && lastKnownPayments() !== 'off';

/** Open the account panel, which lists everything and sells it (App listens for this). */
export function openEdition(where: string) {
  track('edition_promo', { where, action: 'open' });
  window.dispatchEvent(new Event('4c:account'));
}

/** The gold mark that names the edition wherever it appears. */
export const EditionBadge = () => <span className="ed-badge"><Icon name="star" /> {EDITION_NAME}</span>;

/** What a locked part of the Coach's Edition says: what it holds, the price, and the way to buy it (once it's on sale). */
export function EditionLock({ title, blurb, points }: { title: string; blurb: string; points?: string[] }) {
  return (
    <section className="ed-lock ed-gold">
      <h3>{title} <EditionBadge /></h3>
      <p className="muted">{blurb}</p>
      {points && <ul className="ed-points">{points.map((p) => <li key={p}>{p}</li>)}</ul>}
      {lastKnownPayments() === 'off'
        ? <p className="ed-price"><b>{EDITION_PRICE}</b> once, no subscription · <span className="muted">not on sale yet</span></p>
        : <p className="ed-price"><b>{EDITION_PRICE}</b> once, no subscription <button className="btn ed-cta small" onClick={() => openEdition('lock')}>Get the {EDITION_NAME}</button></p>}
    </section>
  );
}

type Where = 'brief' | 'after' | 'loss' | 'survivor';

/** The pitch for each moment: a plain offer before a game, and the comeback tools right after one gets away. */
const PITCH: Record<Where, { head?: (d?: string) => string; body: string; cta: string }> = {
  brief: { body: 'Six trick plays and kicks, no ads, Career Legacy and the Hall of Fame, three career slots, and the Gridiron Challenge.', cta: 'See what’s inside' },
  after: { head: () => 'Want more?', body: 'Six trick plays and kicks, no ads, Career Legacy and the Hall of Fame, three career slots, and the Gridiron Challenge.', cta: 'See what’s inside' },
  loss: {
    head: () => 'Need a comeback?',
    body: 'The Coach’s Playbook adds six calls built for spots like this: hook and ladder, Statue of Liberty, halfback pass, fake punt, a surprise onside and a squib kick. Plus no ads, Career Legacy and the Gridiron Challenge.',
    cta: 'Unlock the Playbook',
  },
  survivor: {
    head: (d) => (d && d !== '0' ? `Run over after ${d}?` : 'Run over?'),
    body: 'Sharpen up in the Gridiron Challenge, eight hand-built spots with three stars each, and take six trick plays and kicks into the next run. No ads, too.',
    cta: 'Unlock the Coach’s Edition',
  },
};

/**
 * The Coach's Edition, in one gold card: on the Daily's brief, after a game (the comeback pitch after a loss), and at
 * the end of a Survivor run. Only while it's on sale, and never for an owner.
 */
export function EditionPromo({ where, detail }: { where: Where; detail?: string }) {
  if (!pitchable()) return null;
  const p = PITCH[where];
  return (
    <aside className={`ed-promo ed-gold ed-promo-${where}`} aria-label={EDITION_NAME}>
      <div className="ed-promo-head">
        <span className="ed-promo-star"><Icon name="star" /></span>
        <b>{EDITION_NAME}</b>
        <span className="ed-promo-price">{EDITION_PRICE} once</span>
      </div>
      {p.head && <p className="ed-promo-hook">{p.head(detail)}</p>}
      <p>{p.body}</p>
      <button className="btn ed-cta small" onClick={() => openEdition(where)}>{p.cta}</button>
    </aside>
  );
}

/** In the Trick tab, the six plays a player doesn't have yet: one locked row at the end of the list. */
export function PlaybookTeaser() {
  if (!pitchable()) return null;
  return (
    <button type="button" className="pb-teaser ed-gold" onClick={() => openEdition('playbook')}>
      <span className="pb-teaser-lock" aria-hidden><Icon name="star" /></span>
      <span className="pb-teaser-txt">
        <b>Coach’s Playbook: 6 more calls</b>
        <span>Hook and ladder, Statue of Liberty, halfback pass, fake punt, surprise onside, squib kick</span>
      </span>
      <span className="pb-teaser-go">Unlock · {EDITION_PRICE}</span>
    </button>
  );
}

/** Under a filled ad: the way to never see one. */
export function RemoveAds() {
  if (!pitchable()) return null;
  return <button type="button" className="link ad-remove" onClick={() => openEdition('ads')}>Remove ads</button>;
}

/** Everything the edition holds, for any lock that wants the full list. */
export const EDITION_POINTS = [
  'No ads, anywhere in the game',
  'The Coach’s Playbook: hook and ladder, Statue of Liberty, halfback pass, fake punt, surprise onside and squib kicks',
  'Career Legacy: retirement, the Hall of Fame vote, the record book and the league’s history',
  'Three career slots',
  'The Gridiron Challenge ladder: eight original spots, three stars each',
];
