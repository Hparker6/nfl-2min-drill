/**
 * Cloudflare Turnstile's widget, shown only when the build has a site key (VITE_TURNSTILE_SITE_KEY). The widget's
 * script is loaded once, from challenges.cloudflare.com (allowed by the CSP in public/_headers). It hands back a
 * token the forms send to the Worker, which verifies it with TURNSTILE_SECRET. No key: the forms work without it.
 */
import { useEffect, useRef, useState } from 'react';

declare global {
  interface Window { turnstile?: { render(el: HTMLElement, o: Record<string, unknown>): string; reset(id?: string): void; remove(id: string): void } }
}

/** The live site's widget key (public by design: it is in every page). Empty until the widget exists in Cloudflare. */
const LIVE_SITE_KEY = '';
const onLiveSite = typeof location !== 'undefined' && location.hostname === 'nfl-2min-drill.com';
// a build variable wins (staging builds with Cloudflare's test key); otherwise the live key, on the live site only
export const TURNSTILE_SITE_KEY = (((import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined) ?? '').trim() || (onLiveSite ? LIVE_SITE_KEY : '')).trim();
export const turnstileOn = () => /^[A-Za-z0-9_-]{10,}$/.test(TURNSTILE_SITE_KEY);

let loading: Promise<void> | null = null;
function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (!loading) {
    loading = new Promise((ok, no) => {
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true;
      s.onload = () => ok();
      s.onerror = () => { loading = null; no(new Error('turnstile')); };
      document.head.appendChild(s);
    });
  }
  return loading;
}

/** Renders the widget; onToken gets the token (or null when it expires or fails, so the form disables itself). */
/** `nonce`: bump it to reset the widget (a token is single-use: after a failed submit a new one is needed). */
export function Turnstile({ onToken, action, nonce = 0 }: { onToken: (t: string | null) => void; action: string; nonce?: number }) {
  const host = useRef<HTMLDivElement>(null);
  const cb = useRef(onToken);
  cb.current = onToken;
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!turnstileOn()) return;
    let id: string | null = null, gone = false;
    const fail = () => { cb.current(null); setFailed(true); };
    loadScript().then(() => {
      if (gone || !host.current || !window.turnstile) return;
      id = window.turnstile.render(host.current, {
        sitekey: TURNSTILE_SITE_KEY, action, theme: 'auto', size: 'flexible',
        callback: (t: string) => { setFailed(false); cb.current(t); },
        'expired-callback': () => cb.current(null),
        'error-callback': fail,
      });
    }).catch(fail);
    return () => { gone = true; if (id) try { window.turnstile?.remove(id); } catch { /* already gone */ } };
  }, [action, nonce]);
  if (!turnstileOn()) return null;
  return (
    <>
      <div ref={host} className="turnstile" />
      {failed && <p className="acct-err" role="alert">The bot check couldn’t load. An ad blocker or privacy extension may be blocking challenges.cloudflare.com; allow it for this site and reload.</p>}
    </>
  );
}
