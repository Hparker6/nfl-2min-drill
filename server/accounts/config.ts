/**
 * What the Worker's environment turns on. Everything is off unless configured, and the production config
 * (wrangler.jsonc, top level) configures none of it: no database binding, so no accounts and no payments.
 *
 * Accounts need: a D1 binding (DB), ACCOUNTS = "on", SITE_ORIGIN, and an AUTH_PEPPER secret of 32+ characters.
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
  AUTH_PEPPER?: string;
  PAYMENTS?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRICE_ID?: string;
}

export interface Config {
  db: D1Database;
  origin: string;
  origins: string[];
  pepper: string;
  mail: 'console' | 'off';
  payments: PaymentsConfig | null;
}

export interface PaymentsConfig {
  secretKey: string;
  webhookSecret: string;
  priceId: string;
  live: boolean;
}

/** The product, its price and currency. A checkout that doesn't match exactly grants nothing. */
export const PRODUCT = { id: 'coach_edition', amount: 499, currency: 'usd' } as const;

const isLocal = (o: string) => /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o);

/** The accounts config, or null when accounts are off (the routes then answer 404, as if they didn't exist). */
export function accountsConfig(env: AccountsEnv): Config | null {
  if (!env.DB || env.ACCOUNTS !== 'on') return null;
  const origin = (env.SITE_ORIGIN ?? '').replace(/\/+$/, '');
  if (!/^https:\/\/[a-z0-9.-]+$/i.test(origin) && !isLocal(origin)) return null;
  const pepper = env.AUTH_PEPPER ?? '';
  if (pepper.length < 32) return null;
  const extra = (env.DEV_ORIGINS ?? '').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(isLocal);
  // printing sign-in links to the log is for a local machine only
  const mail = env.MAIL_MODE === 'console' && isLocal(origin) ? 'console' : 'off';
  return { db: env.DB, origin, origins: [origin, ...extra], pepper, mail, payments: paymentsConfig(env) };
}

export function paymentsConfig(env: AccountsEnv): PaymentsConfig | null {
  if (env.PAYMENTS !== 'on') return null;
  const secretKey = env.STRIPE_SECRET_KEY ?? '', webhookSecret = env.STRIPE_WEBHOOK_SECRET ?? '', priceId = env.STRIPE_PRICE_ID ?? '';
  if (!/^(sk|rk)_(test|live)_[A-Za-z0-9]+$/.test(secretKey) || !/^whsec_[A-Za-z0-9]+$/.test(webhookSecret) || !/^price_[A-Za-z0-9]+$/.test(priceId)) return null;
  const live = /^(sk|rk)_live_/.test(secretKey);
  if (live && !LIVE_PAYMENTS_ALLOWED) return null;
  return { secretKey, webhookSecret, priceId, live };
}
