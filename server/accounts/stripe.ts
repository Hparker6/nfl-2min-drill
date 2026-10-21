/**
 * The little of Stripe's API the purchase needs, over fetch (no SDK): form-encoded requests with the secret key, and
 * webhook signature checks (Stripe-Signature: t=timestamp, v1=HMAC-SHA256 of "t.body" with the endpoint's secret).
 */
import { hmacSha256, safeEqual } from './crypto';

export const WEBHOOK_TOLERANCE_SEC = 300;

/** Is this body really from Stripe, signed within the last 5 minutes? */
export async function verifyStripeSignature(body: string, header: string | null, secret: string, nowMs: number, toleranceSec = WEBHOOK_TOLERANCE_SEC): Promise<boolean> {
  if (!header || header.length > 2048) return false;
  let t = NaN;
  const sigs: string[] = [];
  for (const part of header.split(',')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim(), v = part.slice(i + 1).trim();
    if (k === 't') t = Number(v);
    else if (k === 'v1' && /^[a-f0-9]{64}$/.test(v)) sigs.push(v);
  }
  if (!Number.isInteger(t) || !sigs.length) return false;
  if (Math.abs(nowMs / 1000 - t) > toleranceSec) return false;
  const want = await hmacSha256(secret, `${t}.${body}`);
  return sigs.some((s) => safeEqual(s, want));
}

type Form = { [k: string]: string | number | boolean | undefined | Form | Form[] | string[] };

/** Stripe's form encoding: a[b]=1, items[0][price]=… */
export function encodeForm(o: Form, prefix = ''): string {
  const out: string[] = [];
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((x, i) => out.push(typeof x === 'object' ? encodeForm(x as Form, `${key}[${i}]`) : `${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(x))}`));
    else if (typeof v === 'object') out.push(encodeForm(v, key));
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
  }
  return out.filter(Boolean).join('&');
}

export class StripeError extends Error { constructor(public status: number, message: string) { super(message); } }

export function stripeClient(key: string, f: typeof fetch) {
  const call = async <T>(method: 'GET' | 'POST', path: string, form?: Form, idem?: string): Promise<T> => {
    if (!/^\/v1\/(checkout\/sessions|charges|disputes|refunds|radar\/early_fraud_warnings)(\/[A-Za-z0-9_]{1,130})?$/.test(path)) throw new StripeError(0, 'path not allowed');
    const headers: Record<string, string> = { authorization: `Bearer ${key}`, 'stripe-version': '2024-06-20' };
    if (form) headers['content-type'] = 'application/x-www-form-urlencoded';
    if (idem) headers['idempotency-key'] = idem;
    const qs = method === 'GET' && form ? `?${encodeForm(form)}` : '';
    const r = await f(`https://api.stripe.com${path}${qs}`, { method, headers, body: method === 'POST' && form ? encodeForm(form) : undefined });
    const data = await r.json().catch(() => ({})) as T & { error?: { message?: string } };
    if (!r.ok) throw new StripeError(r.status, data?.error?.message ?? `Stripe ${r.status}`);
    return data;
  };
  return {
    get: <T>(path: string, query?: Form) => call<T>('GET', path, query),
    post: <T>(path: string, form: Form, idem?: string) => call<T>('POST', path, form, idem),
  };
}
