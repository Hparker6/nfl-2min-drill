/**
 * Cloudflare Turnstile's widget, shown only when the build has a site key (VITE_TURNSTILE_SITE_KEY). The widget's
 * script is loaded once, from challenges.cloudflare.com (allowed by the CSP in public/_headers). It hands back a
 * token the forms send to the Worker, which verifies it with TURNSTILE_SECRET. No key: the forms work without it.
 */
import { useEffect, useRef } from 'react';

declare global {
  interface Window { turnstile?: { render(el: HTMLElement, o: Record<string, unknown>): string; reset(id?: string): void; remove(id: string): void } }
}

export const TURNSTILE_SITE_KEY = ((import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined) ?? '').trim();
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
export function Turnstile({ onToken, action }: { onToken: (t: string | null) => void; action: string }) {
  const host = useRef<HTMLDivElement>(null);
  const cb = useRef(onToken);
  cb.current = onToken;
  useEffect(() => {
    if (!turnstileOn()) return;
    let id: string | null = null, gone = false;
    loadScript().then(() => {
      if (gone || !host.current || !window.turnstile) return;
      id = window.turnstile.render(host.current, {
        sitekey: TURNSTILE_SITE_KEY, action, theme: 'auto', size: 'flexible',
        callback: (t: string) => cb.current(t),
        'expired-callback': () => cb.current(null),
        'error-callback': () => cb.current(null),
      });
    }).catch(() => cb.current(null));
    return () => { gone = true; if (id) try { window.turnstile?.remove(id); } catch { /* already gone */ } };
  }, [action]);
  if (!turnstileOn()) return null;
  return <div ref={host} className="turnstile" />;
}
