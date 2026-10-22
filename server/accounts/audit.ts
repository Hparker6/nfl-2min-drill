/**
 * The audit log: one JSON line per security-relevant event, for Cloudflare's Worker logs (`wrangler tail`, or Logs
 * in the dashboard). What it answers: how many sign-ins, failures, checkouts, webhooks, deletions and support
 * requests happened, and when. What it never carries: an email address, a token, a code, a key, a card detail, a
 * message body. Fields with those names are dropped here no matter what a caller passes, so a future call can't leak
 * one by mistake.
 */
const FORBIDDEN = /^(email|to|from|link|token|code|key|secret|cookie|message|card|password|pepper)$/i;
const MAX_VALUE = 120;

export type AuditFields = Record<string, string | number | boolean | null | undefined>;

export function auditLine(event: string, fields: AuditFields = {}, at = Date.now()): string {
  const out: Record<string, string | number | boolean | null> = { audit: event, at: new Date(at).toISOString() };
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || FORBIDDEN.test(k)) continue;
    out[k] = typeof v === 'string' ? v.slice(0, MAX_VALUE) : v;
  }
  return JSON.stringify(out);
}

export function audit(event: string, fields: AuditFields = {}) {
  console.log(auditLine(event, fields));
}
