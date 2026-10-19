/**
 * Badges on screen: the toast when you earn one, and the case in Your stats (every badge, earned or not, your coach
 * title and the field looks they unlock).
 */
import { useEffect, useState } from 'react';
import { BADGES, LOOKS_FIELD, TITLES, titleFor, type Badge } from '../game/badges';
import { audio } from '../game/audio';
import type { Store } from '../game/storage';

/** A toast for each new badge, a few seconds each (listens for announce()). */
export function BadgeToast() {
  const [q, setQ] = useState<Badge[]>([]);
  useEffect(() => {
    const on = (e: Event) => {
      const list = (e as CustomEvent<Badge[]>).detail;
      setQ((cur) => [...cur, ...list.filter((b) => !cur.some((c) => c.id === b.id))]);
      audio.play('chime');
    };
    window.addEventListener('the4thcall:badges', on);
    return () => window.removeEventListener('the4thcall:badges', on);
  }, []);
  useEffect(() => {
    if (!q.length) return;
    const t = setTimeout(() => setQ((cur) => cur.slice(1)), 4200);
    return () => clearTimeout(t);
  }, [q]);
  const b = q[0];
  if (!b) return null;
  return (
    <div className="badge-toast" role="status" key={b.id}>
      <span className="bt-icon" aria-hidden>{b.icon}</span>
      <div><span className="bt-k">Badge unlocked</span><b>{b.name}</b><small>{b.how}</small></div>
    </div>
  );
}

const fmt = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/** Your badges, your title, what's next. */
export function BadgeCase({ store }: { store: Store }) {
  const got = store.badges ?? {};
  const n = Object.keys(got).length;
  const next = TITLES.find(([k]) => k > n);
  const look = LOOKS_FIELD.find((l) => l.need > n);
  return (
    <section className="badges" aria-label="Badges">
      <div className="bc-head">
        <h3>Badges · {n} of {BADGES.length}</h3>
        <span className="bc-title">{titleFor(n)}</span>
      </div>
      <p className="muted small">
        {next ? `${next[0] - n} more for ${next[1].toLowerCase()}.` : 'Every title earned.'}{' '}
        {look ? `${look.need - n} more unlocks the ${look.name} field (Settings).` : 'Every field look unlocked.'}
      </p>
      <ul className="bc-grid">
        {BADGES.map((b) => (
          <li key={b.id} className={got[b.id] ? 'on' : ''}>
            <span className="bc-icon" aria-hidden>{b.icon}</span>
            <div><b>{b.name}</b><small>{got[b.id] ? `Earned ${fmt(got[b.id])}` : b.how}</small></div>
          </li>
        ))}
      </ul>
    </section>
  );
}
