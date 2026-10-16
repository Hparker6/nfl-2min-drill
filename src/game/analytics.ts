/**
 * Google Analytics 4. The site's tag is built in (GA_DEFAULT); VITE_GA_ID overrides it, and VITE_GA_ID=off turns it
 * off (say, for a local build). No personal data is sent: only game events, their numbers, and where in the game
 * the player was, so a funnel shows where people get stuck or leave.
 *
 * What gets tracked (all as GA4 events):
 *   screen_view        mode changes (daily / survivor / practice / everyone)
 *   modal_open         help, stats, settings, about
 *   brief_shown        the pre-game brief is on screen (mode, kind)
 *   game_start         the player took the headset (mode, resumed)
 *   phase              every phase change on the game screen (deciding, snapping, result, over…)
 *   decision_shown     a decision is on the board (step, options, n = how many so far)
 *   call_made          a call (step, call, tempo, side, signals, edited routes, secs to decide, n)
 *   result_shown       the play's result card (grade, lost, secs the grade took)
 *   replay, next_play  result-card actions
 *   grade_failed       grading could not finish (the play stood)
 *   spot_complete      a game ended (mode, win, calls): the game_complete event, kept under its first name so GA
 *                      history stays continuous
 *   play_again         the player chose another game after finishing one (from, to)
 *   daily_complete, survivor_new_run, survivor_end, practice_setup, leaderboard_submit, share
 *   leave              the tab was hidden or closed, with where the player was (mode, phase, step, calls, secs)
 *   app_error          an uncaught error (message only)
 */
declare global {
  interface Window { dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void }
}

const GA_DEFAULT = 'G-WVFFZZWS61';
const env = (import.meta.env.VITE_GA_ID as string | undefined)?.trim();
const GA_ID = env === 'off' ? '' : env || GA_DEFAULT;

/** Where the player is right now, sent with leave events and errors. */
const ctx: Record<string, string | number | boolean> = {};
let since = Date.now();
export function setContext(c: Record<string, string | number | boolean | undefined | null>) {
  let changed = false;
  for (const k in c) {
    const v = c[k];
    if (v == null) { if (k in ctx) { delete ctx[k]; changed = true; } continue; }
    if (ctx[k] !== v) { ctx[k] = v; changed = true; }
  }
  if (changed) since = Date.now();
}
const secsHere = () => Math.round((Date.now() - since) / 1000);

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
  window.gtag('config', GA_ID, { anonymize_ip: true, send_page_view: true });
  try {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const coarse = matchMedia('(pointer: coarse)').matches;
    window.gtag('set', 'user_properties', { device_class: coarse ? 'touch' : 'pointer', reduced_motion: reduced ? 'yes' : 'no', viewport: innerWidth < 600 ? 'phone' : innerWidth < 1000 ? 'tablet' : 'desktop' });
  } catch { /* fine */ }
  // where people leave: the tab goes hidden or the page unloads
  const leave = () => track('leave', { ...ctx, secs_here: secsHere() });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') leave(); });
  window.addEventListener('pagehide', leave);
  window.addEventListener('error', (e) => track('app_error', { ...ctx, message: String(e.message ?? 'error').slice(0, 120) }));
  window.addEventListener('unhandledrejection', (e) => track('app_error', { ...ctx, message: String((e.reason && (e.reason.message || e.reason)) ?? 'rejection').slice(0, 120) }));
}

export type EventName =
  | 'screen_view' | 'modal_open' | 'brief_shown' | 'game_start' | 'phase' | 'decision_shown' | 'call_made' | 'result_shown'
  | 'replay' | 'next_play' | 'grade_failed' | 'spot_complete' | 'play_again' | 'daily_complete' | 'survivor_new_run' | 'survivor_end'
  | 'practice_setup' | 'leaderboard_submit' | 'share' | 'leave' | 'app_error' | 'welcome_link' | 'career_start' | 'career_game';

export function track(name: EventName, params: Record<string, string | number | boolean | undefined | null> = {}) {
  try {
    if (!window.gtag) return;
    const p: Record<string, string | number | boolean> = {};
    for (const k in params) { const v = params[k]; if (v != null) p[k] = v; }
    window.gtag('event', name, p);
  } catch {
    /* never in the way */
  }
}

/** Set once the store is loaded: how many days this player has played, so new and returning players separate. */
export function setPlayerProperties(p: { days_played: number; survivor_runs: number; theme: string }) {
  try { window.gtag?.('set', 'user_properties', p); } catch { /* fine */ }
}
