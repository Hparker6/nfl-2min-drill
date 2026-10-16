/**
 * Optional Google Analytics 4. Set VITE_GA_ID (e.g. in .env.local: VITE_GA_ID=G-XXXXXXX) to turn it on; without
 * it nothing is loaded and track() does nothing. No personal data is sent: only game events and their numbers.
 */
declare global {
  interface Window { dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void }
}

const GA_ID = import.meta.env.VITE_GA_ID as string | undefined;

export function initAnalytics() {
  if (!GA_ID || typeof document === 'undefined' || window.gtag) return;
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_ID)}`;
  document.head.appendChild(s);
  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() {
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer!.push(arguments);
  };
  window.gtag('js', new Date());
  window.gtag('config', GA_ID, { anonymize_ip: true });
}

export type EventName = 'game_start' | 'call_made' | 'spot_complete' | 'daily_complete' | 'survivor_end' | 'share';

export function track(name: EventName, params: Record<string, string | number | boolean> = {}) {
  try {
    if (window.gtag) window.gtag('event', name, params);
  } catch {
    /* never in the way */
  }
}
