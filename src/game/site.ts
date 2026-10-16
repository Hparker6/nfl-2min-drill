/**
 * Site links and advertising, from build-time environment variables (see .env.example and MONETIZATION.md). Every
 * one is optional: a link with no address is not shown, and ads stay off unless all of their settings are present.
 *
 *   VITE_FEEDBACK_URL   the footer's Feedback link (a form, an issue tracker, or a mailto: address)
 *   VITE_SUPPORT_URL    the footer's Support the developer link (a tip or membership page you own)
 *   VITE_ADS            "adsense" turns the ad slots on; anything else (or nothing) keeps them hidden
 *   VITE_ADSENSE_CLIENT the publisher ID, ca-pub-…, exactly as AdSense shows it
 *   VITE_ADSENSE_SLOT   the ad unit's slot ID, from AdSense → Ads → By ad unit
 */
const env = (k: string) => ((import.meta.env[k] as string | undefined) ?? '').trim();
const url = (k: string) => { const v = env(k); return /^(https:\/\/|mailto:)/.test(v) ? v : ''; };

export const FEEDBACK_URL = url('VITE_FEEDBACK_URL');
export const SUPPORT_URL = url('VITE_SUPPORT_URL');

const client = env('VITE_ADSENSE_CLIENT');
const slot = env('VITE_ADSENSE_SLOT');
/** The approved ad unit, or null: ads on, a real-looking publisher ID and a numeric slot ID, or nothing at all. */
export const AD_UNIT = env('VITE_ADS') === 'adsense' && /^ca-pub-\d{10,20}$/.test(client) && /^\d{6,20}$/.test(slot)
  ? { client, slot } : null;
