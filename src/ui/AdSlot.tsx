/**
 * One display ad, outside the game. It renders nothing unless an approved ad unit is configured (AD_UNIT, see
 * src/game/site.ts), nothing while a game is on screen, so no ad sits near the play-calling controls, and nothing for
 * an owner of the Coach's Edition (no ads is part of what it buys). The label only shows once AdSense has filled the
 * slot, so a blocked or unfilled slot leaves nothing behind.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { AD_UNIT } from '../game/site';
import { ownsEdition } from '../game/edition';

declare global { interface Window { adsbygoogle?: unknown[] } }

// whether a game screen is mounted (GameScreen reports it), so App can keep ads off the game
let games = 0;
const subs = new Set<() => void>();
export function gameOnScreen(on: boolean) { games += on ? 1 : -1; subs.forEach((f) => f()); }
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export const useGameOnScreen = () => useSyncExternalStore(subscribe, () => games > 0);

export function AdSlot() {
  const playing = useGameOnScreen();
  if (!AD_UNIT || playing || ownsEdition()) return null;
  return <AdUnit client={AD_UNIT.client} slot={AD_UNIT.slot} />;
}

function AdUnit({ client, slot }: { client: string; slot: string }) {
  useEffect(() => {
    // each <ins> is filled once; a remount is a new slot
    try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch { /* ad blocked or not loaded: the slot stays empty */ }
  }, []);
  return (
    <aside className="ad-slot" aria-label="Advertisement">
      <span className="ad-k">Advertisement</span>
      <ins className="adsbygoogle" style={{ display: 'block' }} data-ad-client={client} data-ad-slot={slot} data-ad-format="auto" data-full-width-responsive="true" />
    </aside>
  );
}
