/**
 * The support form: refund requests, bug reports, account problems. Open to everyone (a player locked out of their
 * account still has to be able to ask for help), so it is the most exposed input on the site:
 *   - every field is validated and bounded; the message is plain text with control characters removed
 *   - a hidden honeypot field (`website`): bots fill it, people never see it; a filled one is accepted and dropped
 *   - rate limits per caller and per address (ratelimit.ts), on top of the optional Turnstile check in routes.ts
 *   - the request is stored before anyone is emailed, so a mail failure never loses a refund request
 *   - the notification to the owner is plain text, and the HTML version escapes everything
 * Nothing the player types is ever interpreted: not as SQL (bound parameters), not as HTML (escaped), not as a
 * header (the message is the body only; the reply address is validated as an address).
 */
import type { D1Database } from './d1';
import { normalizeEmail } from './auth';
import { hit, LIMITS } from './ratelimit';
import { sha256 } from './crypto';
import { sendNotice, type Notice } from './mailer';
import type { MailConfig } from './config';
import { audit } from './audit';

export const KINDS = ['refund', 'bug', 'account', 'other'] as const;
export type SupportKind = (typeof KINDS)[number];
export const MESSAGE_MIN = 10, MESSAGE_MAX = 2000, PAGE_MAX = 120;

export interface SupportInput { kind: SupportKind; email: string; message: string; page: string | null }
export type SupportResult = { ok: true; ref: string } | { ok: false; error: 'invalid' | 'rate-limited'; field?: string };

/** Printable text only: no control characters (which could fake line breaks or headers in a log or an email). */
export const cleanText = (s: string, max: number) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, '').replace(/\r\n?/g, '\n').trim().slice(0, max);

/** The fields from the body, or the first thing wrong with them. */
export function parseSupport(body: Record<string, unknown> | null): { ok: true; input: SupportInput; honeypot: boolean } | { ok: false; field: string } {
  if (!body) return { ok: false, field: 'body' };
  const kind = body.kind;
  if (typeof kind !== 'string' || !(KINDS as readonly string[]).includes(kind)) return { ok: false, field: 'kind' };
  const email = normalizeEmail(body.email);
  if (!email) return { ok: false, field: 'email' };
  if (typeof body.message !== 'string') return { ok: false, field: 'message' };
  const message = cleanText(body.message, MESSAGE_MAX + 1);
  if (message.length < MESSAGE_MIN || message.length > MESSAGE_MAX) return { ok: false, field: 'message' };
  const page = typeof body.page === 'string' ? cleanText(body.page, PAGE_MAX) || null : null;
  const honeypot = typeof body.website === 'string' && body.website.trim() !== '';
  return { ok: true, input: { kind: kind as SupportKind, email, message, page }, honeypot };
}

export interface SupportDeps { db: D1Database; pepper: string; mail: MailConfig; supportTo: string | null; now: number; fetch: typeof fetch; notifier?: (n: Notice) => Promise<boolean> }

/**
 * Store the request and tell the owner. `userId` is the signed-in account, if any (a refund can be matched to a
 * purchase). Returns a short reference the player can quote.
 */
export async function submitSupport(d: SupportDeps, body: Record<string, unknown> | null, addr: string, userId: string | null): Promise<SupportResult> {
  const parsed = parseSupport(body);
  if (!parsed.ok) return { ok: false, error: 'invalid', field: parsed.field };
  if (parsed.honeypot) { audit('support.honeypot', {}); return { ok: true, ref: 'received' }; }   // a bot gets a polite nothing
  const { kind, email, message, page } = parsed.input;
  if (!(await hit(d.db, LIMITS.supportPerAddress, addr, d.now))) return { ok: false, error: 'rate-limited' };
  if (!(await hit(d.db, LIMITS.supportPerEmailDay, await sha256(`${d.pepper}:email:${email}`), d.now))) return { ok: false, error: 'rate-limited' };

  const id = crypto.randomUUID();
  const ref = id.slice(0, 8).toUpperCase();
  await d.db.prepare('INSERT INTO support_requests (id, kind, email, user_id, message, page, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, kind, email, userId, message, page, d.now).run();

  // the purchase state is what a refund request needs; it comes from our records, not from the form
  let purchase = 'no account signed in';
  if (userId) {
    const p = await d.db.prepare('SELECT status, amount, currency, created_at FROM purchases WHERE user_id = ? ORDER BY created_at DESC LIMIT 1').bind(userId)
      .first<{ status: string; amount: number; currency: string; created_at: number }>();
    purchase = p ? `${p.status}, ${(p.amount / 100).toFixed(2)} ${p.currency.toUpperCase()}, ${new Date(p.created_at).toISOString().slice(0, 10)}` : 'signed in, no purchase';
  }
  const subject = `[4th Call support] ${kind} · ${ref}`;
  const text = [
    `Reference: ${ref}`, `Kind: ${kind}`, `From: ${email}`, `Signed in: ${userId ? 'yes' : 'no'}`, `Purchase: ${purchase}`, `Page: ${page ?? '-'}`,
    `Received: ${new Date(d.now).toISOString()}`, '', 'Message:', message, '',
    'Reply to the player by email. Refunds are issued in the Stripe dashboard; the game revokes the edition on its own when Stripe reports the refund.',
  ].join('\n');
  const notice: Notice = { to: d.supportTo ?? '', replyTo: email, subject, text };
  const sent = d.supportTo ? await (d.notifier ? d.notifier(notice) : sendNotice(d.mail, notice, d.fetch)) : false;
  if (sent) await d.db.prepare('UPDATE support_requests SET notified_at = ? WHERE id = ?').bind(d.now, id).run();
  audit('support.received', { kind, signedIn: !!userId, notified: sent });
  return { ok: true, ref };
}
