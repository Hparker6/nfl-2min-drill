/**
 * What the Worker's environment turns on. Everything is off unless configured, and the production config
 * (wrangler.jsonc, top level) configures none of it: no database binding, so no accounts and no payments.
 *
 * Accounts need: a D1 binding (DB), ACCOUNTS = "on", SITE_ORIGIN, and an AUTH_PEPPER secret of 32+ characters.
 * Sign-in email needs MAIL_MODE: "console" prints it to the log and works on localhost only; "resend" sends it
 * through Resend and needs the RESEND_API_KEY secret and a MAIL_FROM sender. Anything missing or malformed leaves
 * email off, and asking for a sign-in then answers 503: nothing is written down, nothing is sent.
 * Payments need all that, plus PAYMENTS = "on" and the Stripe secrets. Live Stripe keys are refused outright while
 * LIVE_PAYMENTS_ALLOWED below is false: turning on live payments takes a reviewed code change, not just a setting.
 */
import type { D1Database } from './d1';

/** Live payments stay off until the legal and operational launch review says otherwise. */
export const LIVE_PAYMENTS_ALLOWED = false;

export interface AccountsEnv {
  DB?: D1Database;
  ACCOUNTS?: string;
  SITE_ORIGIN?: string;
  /** extra origins allowed to call the API (comma-separated; local development) */
  DEV_ORIGINS?: string;
  MAIL_MODE?: string;
  /** the sender, e.g. "The 4th Call <sign-in@mail.example.com>" (a domain verified with the provider) */
  MAIL_FROM?: string;
  RESEND_API_KEY?: string;
  AUTH_PEPPER?: string;
  PAYMENTS?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRICE_ID?: string;
  /** where support requests go (an address you read); the form still stores requests without it */
  SUPPORT_TO?: string;
  /** Cloudflare Turnstile: set to require the bot check on the sign-in and support forms */
  TURNSTILE_SECRET?: string;
}

export interface Config {
  db: D1Database;
  origin: string;
  origins: string[];
  pepper: string;
  mail: MailConfig;
  payments: PaymentsConfig | null;
  supportTo: string | null;
  turnstile: string | null;
}

/** How sign-in emails go out. `off` says why (for the operator's log; never shown to players). */
export type MailConfig =
  | { kind: 'console' }
  | { kind: 'resend'; apiKey: string; from: string }
  | { kind: 'off'; why: string };

export interface PaymentsConfig {
  secretKey: string;
  webhookSecret: string;
  priceId: string;
  live: boolean;
}

/** The product, its price and currency. A checkout that doesn't match exactly grants nothing. */
export const PRODUCT = { id: 'coach_edition', amount: 499, currency: 'usd' } as const;

export const isLocal = (o: string) => /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o);

/** The accounts config, or null when accounts are off (the routes then answer 404, as if they didn't exist). */
export function accountsConfig(env: AccountsEnv): Config | null {
  if (!env.DB || env.ACCOUNTS !== 'on') return null;
  const origin = (env.SITE_ORIGIN ?? '').replace(/\/+$/, '');
  if (!/^https:\/\/[a-z0-9.-]+$/i.test(origin) && !isLocal(origin)) return null;
  const pepper = env.AUTH_PEPPER ?? '';
  if (pepper.length < 32) return null;
  const extra = (env.DEV_ORIGINS ?? '').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(isLocal);
  const supportTo = (env.SUPPORT_TO ?? '').trim();
  const turnstile = (env.TURNSTILE_SECRET ?? '').trim();
  return {
    db: env.DB, origin, origins: [origin, ...extra], pepper, mail: mailConfig(env, origin), payments: paymentsConfig(env),
    supportTo: /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(supportTo) ? supportTo : null,
    turnstile: /^[A-Za-z0-9_-]{20,}$/.test(turnstile) ? turnstile : null,
  };
}

/** A sender: an address, or a display name and an address in angle brackets. One line, nothing that could add a header. */
const SENDER = /^(?:[A-Za-z0-9 ._'-]{1,64} <)?[a-z0-9._%+-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+>?$/i;

export function mailConfig(env: AccountsEnv, origin: string): MailConfig {
  const mode = env.MAIL_MODE ?? '';
  if (mode === 'console') return isLocal(origin) ? { kind: 'console' } : { kind: 'off', why: 'console mail is for localhost only' };
  if (mode === 'resend') {
    const apiKey = env.RESEND_API_KEY ?? '', from = (env.MAIL_FROM ?? '').trim();
    if (!/^re_[A-Za-z0-9_]{8,}$/.test(apiKey)) return { kind: 'off', why: 'RESEND_API_KEY is missing or malformed' };
    if (!SENDER.test(from) || from.includes('<') !== from.endsWith('>')) return { kind: 'off', why: 'MAIL_FROM is missing or malformed' };
    return { kind: 'resend', apiKey, from };
  }
  return { kind: 'off', why: mode ? `unknown MAIL_MODE ${JSON.stringify(mode.slice(0, 20))}` : 'MAIL_MODE is not set' };
}

export function paymentsConfig(env: AccountsEnv): PaymentsConfig | null {
  if (env.PAYMENTS !== 'on') return null;
  const secretKey = env.STRIPE_SECRET_KEY ?? '', webhookSecret = env.STRIPE_WEBHOOK_SECRET ?? '', priceId = env.STRIPE_PRICE_ID ?? '';
  if (!/^(sk|rk)_(test|live)_[A-Za-z0-9]+$/.test(secretKey) || !/^whsec_[A-Za-z0-9]+$/.test(webhookSecret) || !/^price_[A-Za-z0-9]+$/.test(priceId)) return null;
  const live = /^(sk|rk)_live_/.test(secretKey);
  if (live && !LIVE_PAYMENTS_ALLOWED) return null;
  return { secretKey, webhookSecret, priceId, live };
}
