/**
 * One display ad, never next to the play-calling controls. Two places use it:
 *   footer  below the page, and nothing at all while a game is on screen
 *   end     the end-of-game screen (the game is over; the summary and its buttons sit above it, with space between)
 * It renders nothing unless an ad unit is configured (AD_UNIT, src/game/site.ts). Google's ad script is loaded here,
 * once, the first time an ad is actually drawn, and never before the first screen. The label only shows once AdSense has filled
 * the slot, so a blocked or unfilled slot leaves nothing behind.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { AD_UNIT } from '../game/site';

declare global { interface Window { adsbygoogle?: unknown[] } }

// whether a game screen is mounted (GameScreen reports it), so App can keep ads off the game
let games = 0;
const subs = new Set<() => void>();
export function gameOnScreen(on: boolean) { games += on ? 1 : -1; subs.forEach((f) => f()); }
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export const useGameOnScreen = () => useSyncExternalStore(subscribe, () => games > 0);

let loading = false;
/** Google's ad script, once per page (an ad blocker makes it fail quietly; the slot then stays empty). */
function loadAdScript(client: string) {
  if (loading || typeof document === 'undefined') return;
  loading = true;
  const s = document.createElement('script');
  s.async = true;
  s.crossOrigin = 'anonymous';
  s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(client)}`;
  document.head.appendChild(s);
}

export function AdSlot({ where = 'footer' }: { where?: 'footer' | 'end' }) {
  const playing = useGameOnScreen();
  // a moment after the page draws: the game screen has said it's up by then (no flash of an ad, no script loaded for
  // it), and the ad never competes with the first screen
  const [settled, setSettled] = useState(false);
  useEffect(() => { const id = setTimeout(() => setSettled(true), 1500); return () => clearTimeout(id); }, []);
  if (!settled || !AD_UNIT || (where === 'footer' && playing)) return null;
  return <AdUnit client={AD_UNIT.client} slot={AD_UNIT.slot} where={where} />;
}

function AdUnit({ client, slot, where }: { client: string; slot: string; where: 'footer' | 'end' }) {
  useEffect(() => {
    loadAdScript(client);
    // each <ins> is filled once; a remount is a new slot (the queue works before the script arrives)
    try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch { /* ad blocked or not loaded: the slot stays empty */ }
  }, [client]);
  return (
    <aside className={`ad-slot ad-${where}`} aria-label="Advertisement">
      <span className="ad-k">Advertisement</span>
      <ins className="adsbygoogle" style={{ display: 'block' }} data-ad-client={client} data-ad-slot={slot} data-ad-format="auto" data-full-width-responsive="true" />
    </aside>
  );
}
