/**
 * The Coach's Edition purchase, on Stripe Checkout (hosted: card details never touch this site).
 *
 * The only thing that grants ownership is a Stripe webhook whose signature checks out, about a checkout that Stripe's
 * own API, asked again by us, says is complete and paid, for our price, once, at $4.99, for a user who exists. A
 * browser coming back from Stripe proves nothing: the success page only asks our records (checkoutStatus).
 *
 * Every event is recorded by id in the same transaction as what it changed, so a redelivered or replayed event
 * changes nothing. Events are applied from the object's current state at Stripe (fetched), not from the order they
 * arrive in. Ownership is recomputed from all of the user's purchases each time:
 *   active   paid, partially refunded, or a dispute won
 *   revoked  fully refunded, under dispute, or a dispute lost
 */
import type { D1Database, D1PreparedStatement } from './d1';
import { PRODUCT, type PaymentsConfig } from './config';
import { fail, json, readCapped } from './http';
import { hit, LIMITS } from './ratelimit';
import { StripeError, stripeClient, verifyStripeSignature } from './stripe';
import type { Session } from './sessions';
import { audit } from './audit';
import { sha256 } from './crypto';

export type PurchaseStatus = 'paid' | 'refunded' | 'partially_refunded' | 'disputed' | 'dispute_won' | 'dispute_lost';
const ACTIVE: PurchaseStatus[] = ['paid', 'partially_refunded', 'dispute_won'];
/** The past that closes the door (with `purchases.fraud`, a refund we made on the issuer's fraud warning): a chargeback, or a dispute still open. */
const CLOSES: PurchaseStatus[] = ['dispute_lost', 'disputed'];
/** The buyer's address as the one-way hash kept on purchases (the same hash as the support form's rate limit). */
export const emailHash = (pepper: string, email: string) => sha256(`${pepper}:email:${email}`);
export const entitlementFor = (s: PurchaseStatus): 'active' | 'revoked' => (ACTIVE.includes(s) ? 'active' : 'revoked');

/** The products a user owns now. */
export async function entitlementsOf(db: D1Database, userId: string): Promise<string[]> {
  const r = await db.prepare("SELECT product FROM entitlements WHERE user_id = ? AND status = 'active'").bind(userId).all<{ product: string }>();
  return r.results.map((x) => x.product);
}

/** Shown on Stripe's checkout page above the pay button (Stripe caps it at 1200 characters). The full terms are at /terms/. */
export const TERMS_TEXT = 'One-time purchase of the Coach’s Edition for this account; no subscription. Delivered instantly, so refunds aren’t owed, but we’ll refund one purchase per account on request within 14 days: use Help & refunds in the game rather than your bank. Terms: nfl-2min-drill.com/terms';
export const TERMS_TEXT_FINAL = 'One-time purchase of the Coach’s Edition for this account; no subscription. This account has had a refund before, so this purchase is final: no refund. Terms: nfl-2min-drill.com/terms';

/** Start a checkout for the signed-in user (409 when they already own it). The price is ours, fixed on the server. */
export async function createCheckout(db: D1Database, pay: PaymentsConfig, origin: string, s: Session, now: number, f: typeof fetch, pepper: string): Promise<Response> {
  if (!(await hit(db, LIMITS.checkoutPerUser, s.userId, now))) return fail(429, 'Too many checkout attempts. Try again later.');
  if ((await entitlementsOf(db, s.userId)).includes(PRODUCT.id)) return fail(409, 'You already own the Coach’s Edition.');
  // the past with this account, or with this address under an account since deleted: a chargeback or an issuer's
  // fraud warning closes the door (another one costs more than the sale); a refund leaves it open, with the next
  // purchase final (the terms say so)
  const past = await purchaseHistory(db, s.userId, await emailHash(pepper, s.email));
  if (past.closed) { audit('checkout.refused', { why: 'closed' }); return fail(403, 'Purchases aren’t available for this account. Use Help & refunds if you think that’s wrong.'); }
  const again = past.refunds > 0;
  const cust = await db.prepare('SELECT stripe_customer_id FROM stripe_customers WHERE user_id = ?').bind(s.userId).first<{ stripe_customer_id: string }>();
  const meta = { user_id: s.userId, product: PRODUCT.id, ...(again ? { final: '1' } : {}) };
  const stripe = stripeClient(pay.secretKey, f);
  const cs = await stripe.post<{ id: string; url: string }>('/v1/checkout/sessions', {
    mode: 'payment',
    line_items: [{ price: pay.priceId, quantity: 1 }],
    payment_method_types: ['card'],
    client_reference_id: s.userId,
    ...(cust ? { customer: cust.stripe_customer_id } : { customer_email: s.email, customer_creation: 'always' }),
    metadata: meta,
    payment_intent_data: { metadata: meta },
    // the terms, where the buyer sees them before paying (a dispute asks whether they could)
    custom_text: { submit: { message: again ? TERMS_TEXT_FINAL : TERMS_TEXT } },
    success_url: `${origin}/#purchase={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/#account`,
  }, `checkout:${s.userId}:${cust ? 'c' : 'e'}:${again ? 'f' : 'n'}:${Math.floor(now / 60_000)}`);
  if (!cs?.url || !/^https:\/\/checkout\.stripe\.com\//.test(cs.url)) return fail(502, 'Checkout could not be started.');
  return json({ url: cs.url });
}

/** Refunds and fraud in the past of this account, and of this address under any account since deleted. */
export async function purchaseHistory(db: D1Database, userId: string | null, emailHash: string): Promise<{ refunds: number; disputes: number; closed: boolean }> {
  const closes = CLOSES.map((s) => `'${s}'`).join(', ');
  const r = await db.prepare(
    `SELECT SUM(status IN ('refunded', 'partially_refunded')) AS refunds,
            SUM(status IN ('disputed', 'dispute_won', 'dispute_lost')) AS disputes,
            SUM(status IN (${closes}) OR fraud = 1) AS closed
       FROM purchases WHERE user_id = ? OR email_hash = ?`,
  ).bind(userId, emailHash).first<{ refunds: number | null; disputes: number | null; closed: number | null }>();
  return { refunds: r?.refunds ?? 0, disputes: r?.disputes ?? 0, closed: !!r?.closed };
}

/** What our records say about a checkout of this user's (the success page polls this). */
export async function checkoutStatus(db: D1Database, userId: string, sessionId: string | null) {
  if (!sessionId || !/^cs_(test|live)_[A-Za-z0-9]{10,200}$/.test(sessionId)) return { found: false, owns: false };
  const p = await db.prepare('SELECT status FROM purchases WHERE checkout_session_id = ? AND user_id = ?').bind(sessionId, userId).first<{ status: PurchaseStatus }>();
  const owns = (await entitlementsOf(db, userId)).includes(PRODUCT.id);
  return p ? { found: true, status: p.status, owns } : { found: false, owns };
}

// ---- webhooks ----

interface StripeEvent { id: string; type: string; livemode: boolean; created?: number; data: { object: { id: string } } }
/** Stripe retries a failed delivery for days; a purchase missing this long after its event was created is not one of ours. */
const RETRY_WINDOW_MS = 60 * 60_000;
interface CheckoutSession {
  id: string; object: 'checkout.session'; mode: string; status: string; payment_status: string; livemode: boolean;
  amount_total: number | null; currency: string | null; client_reference_id: string | null; customer: string | null;
  payment_intent: string | null; metadata: Record<string, string> | null;
  line_items?: { data: { quantity: number; price: { id: string } | null }[] };
}
interface Charge { id: string; payment_intent: string | null; amount: number; amount_refunded: number; refunded: boolean }
interface Dispute { id: string; payment_intent: string | null; charge: string; status: string }
/** Radar's early fraud warning: the card's bank says the charge is likely fraud, usually days before a chargeback. */
interface FraudWarning { id: string; payment_intent: string | null; charge: string; actionable: boolean; fraud_type: string }

/** Why an event changed nothing, or what it did (kept with the event's id). */
type Outcome = string;
/** Not ready: answer 5xx so Stripe sends it again later (it retries for days). */
class RetryLater extends Error {}

export async function handleWebhook(db: D1Database, pay: PaymentsConfig, req: Request, now: number, f: typeof fetch, pepper: string): Promise<Response> {
  const body = await readCapped(req, 256 * 1024);
  if (body === null) return fail(413, 'too large');
  if (!(await verifyStripeSignature(body, req.headers.get('stripe-signature'), pay.webhookSecret, now))) return fail(400, 'bad signature');
  let ev: StripeEvent;
  try { ev = JSON.parse(body); } catch { return fail(400, 'bad json'); }
  const STRIPE_ID = /^[a-z]{2,10}_[A-Za-z0-9_]{1,130}$/;   // the same bound as the Stripe client's path check
  if (!ev?.id || typeof ev.type !== 'string' || typeof ev.data?.object?.id !== 'string' || !STRIPE_ID.test(ev.id) || !STRIPE_ID.test(ev.data.object.id)) return fail(400, 'bad event');
  if (ev.livemode !== pay.live) return fail(400, 'wrong mode');
  if (await db.prepare('SELECT 1 FROM webhook_events WHERE event_id = ?').bind(ev.id).first()) return json({ received: true, duplicate: true });

  const stripe = stripeClient(pay.secretKey, f);
  let stmts: D1PreparedStatement[] = [];
  let outcome: Outcome;
  let guard: { id: string; status: PurchaseStatus } | undefined;
  try {
    ({ stmts, outcome, guard } = await apply(db, pay, stripe, ev, now, pepper));
  } catch (e) {
    if (e instanceof RetryLater) return fail(503, e.message);
    if (e instanceof NotOurs) { stmts = []; outcome = `ignored: ${e.message}`; }
    // signed by Stripe, but about something Stripe doesn't have (another account's object, or deleted): nothing to do
    else if ((e as StripeError)?.status === 404) { stmts = []; outcome = 'ignored: Stripe has no such object'; }
    else if ((e as StripeError)?.status >= 500 || (e as StripeError)?.status === 429) return fail(503, 'stripe unavailable');
    else throw e;   // anything else (a network failure, a bug): 500, and Stripe sends the event again
  }
  stmts.push(guard
    ? db.prepare('INSERT INTO webhook_events (event_id, type, received_at, outcome) SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM purchases WHERE id = ? AND status = ?)').bind(ev.id, ev.type, now, outcome, guard.id, guard.status)
    : db.prepare('INSERT INTO webhook_events (event_id, type, received_at, outcome) VALUES (?, ?, ?, ?)').bind(ev.id, ev.type, now, outcome));
  try {
    await db.batch(stmts);
    if (guard && !(await db.prepare('SELECT 1 FROM webhook_events WHERE event_id = ?').bind(ev.id).first())) return fail(503, 'the purchase changed under this event; send it again');
  } catch (e) {
    // the same event processed at the same moment by another delivery: its transaction won, this one changed nothing
    if (/UNIQUE|constraint/i.test(String((e as Error)?.message)) && (await db.prepare('SELECT 1 FROM webhook_events WHERE event_id = ?').bind(ev.id).first())) return json({ received: true, duplicate: true });
    throw e;
  }
  audit('webhook', { type: ev.type, outcome });
  return json({ received: true, outcome });
}

/** `guard`: the event row is only written if the purchase ended in this state; otherwise another delivery won the race and Stripe is asked to send this one again. */
async function apply(db: D1Database, pay: PaymentsConfig, stripe: ReturnType<typeof stripeClient>, ev: StripeEvent, now: number, pepper: string): Promise<{ stmts: D1PreparedStatement[]; outcome: Outcome; guard?: { id: string; status: PurchaseStatus } }> {
  switch (ev.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded': {
      const cs = await stripe.get<CheckoutSession>(`/v1/checkout/sessions/${encodeURIComponent(ev.data.object.id)}`, { expand: ['line_items'] });
      const why = checkoutProblem(cs, pay);
      if (why) return { stmts: [], outcome: `ignored: ${why}` };
      const userId = cs.client_reference_id!;
      const user = await db.prepare('SELECT id, email FROM users WHERE id = ?').bind(userId).first<{ id: string; email: string }>();
      const existing = await db.prepare('SELECT id FROM purchases WHERE checkout_session_id = ?').bind(cs.id).first<{ id: string }>();
      const purchaseId = existing?.id ?? crypto.randomUUID();
      const stmts = [
        db.prepare(`INSERT INTO purchases (id, user_id, email_hash, product, checkout_session_id, payment_intent_id, amount, currency, livemode, status, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'paid', ?, ?) ON CONFLICT (checkout_session_id) DO NOTHING`)
          .bind(purchaseId, user ? userId : null, user ? await emailHash(pepper, user.email) : null, PRODUCT.id, cs.id, cs.payment_intent, cs.amount_total!, cs.currency!, cs.livemode ? 1 : 0, now, now),
      ];
      if (user && cs.customer) stmts.push(db.prepare('INSERT INTO stripe_customers (user_id, stripe_customer_id) VALUES (?, ?) ON CONFLICT DO NOTHING').bind(userId, cs.customer));
      if (user) stmts.push(recompute(db, purchaseId, now, 'purchase'));
      return { stmts, outcome: user ? 'granted' : 'paid: the account no longer exists' };
    }
    case 'charge.refunded': {
      const ch = await stripe.get<Charge>(`/v1/charges/${encodeURIComponent(ev.data.object.id)}`);
      const p = await purchaseByIntent(db, ch.payment_intent, ev, now);
      const full = ch.refunded || ch.amount_refunded >= ch.amount;
      const status: PurchaseStatus = full ? 'refunded' : ch.amount_refunded > 0 ? (p.status === 'paid' ? 'partially_refunded' : p.status) : p.status;
      return { stmts: setStatus(db, p.id, p.status, status, now, full ? 'refunded' : 'partial refund'), outcome: status, guard: { id: p.id, status } };
    }
    case 'charge.dispute.created':
    case 'charge.dispute.updated':
    case 'charge.dispute.closed':
    case 'charge.dispute.funds_withdrawn':
    case 'charge.dispute.funds_reinstated': {
      const d = await stripe.get<Dispute>(`/v1/disputes/${encodeURIComponent(ev.data.object.id)}`);
      const p = await purchaseByIntent(db, d.payment_intent, ev, now);
      // a refunded purchase has nothing left to suspend; a chargeback lost on top of it still closes the door
      if (p.status === 'refunded') {
        if (d.status !== 'lost') return { stmts: [], outcome: 'ignored: already refunded' };
        return { stmts: setStatus(db, p.id, p.status, 'dispute_lost', now, 'dispute lost after a refund'), outcome: 'dispute_lost', guard: { id: p.id, status: 'dispute_lost' } };
      }
      // an inquiry (warning_*) withdraws no funds and often closes without becoming a chargeback: it changes nothing
      if (d.status.startsWith('warning_')) return { stmts: [], outcome: `ignored: inquiry ${d.status}` };
      const status: PurchaseStatus = d.status === 'won' ? 'dispute_won' : d.status === 'lost' ? 'dispute_lost' : d.status === 'charge_refunded' ? 'refunded' : 'disputed';
      return { stmts: setStatus(db, p.id, p.status, status, now, `dispute ${d.status}`), outcome: status, guard: { id: p.id, status } };
    }
    case 'radar.early_fraud_warning.created': {
      // the bank is about to charge it back ($15 on top of the sale): refund it first, which costs the sale alone,
      // and take the edition away. A buyer can't trigger one of these; only the card's bank can.
      const w = await stripe.get<FraudWarning>(`/v1/radar/early_fraud_warnings/${encodeURIComponent(ev.data.object.id)}`);
      const p = await purchaseByIntent(db, w.payment_intent, ev, now);
      if (!w.actionable) return { stmts: [], outcome: 'ignored: fraud warning not actionable (already refunded or disputed)' };
      if (p.status !== 'paid' && p.status !== 'partially_refunded') return { stmts: [], outcome: `ignored: fraud warning on a ${p.status} purchase` };
      try {
        await stripe.post('/v1/refunds', { payment_intent: w.payment_intent!, reason: 'fraudulent', metadata: { why: 'early_fraud_warning', warning: w.id } }, `efw:${ev.id}`);
      } catch (e) {
        // not Stripe's answer (the network failed, or the request never left): 500, so Stripe sends the event again
        if (!(e instanceof StripeError)) throw e;
        // Stripe is down, throttling, or still working on this same key from another delivery: later
        if (e.status >= 500 || e.status === 429 || e.status === 409) throw new RetryLater('refund not accepted yet');
        // Stripe refused (already refunded, or the charge is under dispute): the matching event changes the status
        audit('webhook.fraud_warning', { refunded: false, status: e.status });
        return { stmts: [], outcome: `fraud warning: refund refused (${e.status})` };
      }
      audit('webhook.fraud_warning', { refunded: true, type: w.fraud_type });
      const stmts = setStatus(db, p.id, p.status, 'refunded', now, 'refunded on a fraud warning');
      stmts.unshift(db.prepare('UPDATE purchases SET fraud = 1 WHERE id = ?').bind(p.id));   // closes purchases for this buyer
      return { stmts, outcome: 'refunded: fraud warning', guard: { id: p.id, status: 'refunded' } };
    }
    default:
      return { stmts: [], outcome: 'ignored: not handled' };
  }
}

/** Everything a checkout must be before it grants anything. Null when it's all right. */
export function checkoutProblem(cs: CheckoutSession, pay: PaymentsConfig): string | null {
  if (cs?.object !== 'checkout.session') return 'not a checkout';
  if (cs.livemode !== pay.live) return 'wrong mode';
  if (cs.mode !== 'payment') return 'not a payment';
  if (cs.status !== 'complete' || cs.payment_status !== 'paid') return 'not paid';
  if (cs.amount_total !== PRODUCT.amount || cs.currency !== PRODUCT.currency) return 'wrong amount';
  const items = cs.line_items?.data ?? [];
  if (items.length !== 1 || items[0].quantity !== 1 || items[0].price?.id !== pay.priceId) return 'wrong item';
  if (cs.metadata?.product !== PRODUCT.id) return 'wrong product';
  if (!cs.client_reference_id || cs.metadata?.user_id !== cs.client_reference_id) return 'no user';
  if (!cs.payment_intent) return 'no payment';
  return null;
}

/** Not ours after all: a charge made some other way in the same Stripe account, or a checkout we ignored on purpose. */
class NotOurs extends Error {}

async function purchaseByIntent(db: D1Database, pi: string | null, ev: StripeEvent, now: number): Promise<{ id: string; status: PurchaseStatus }> {
  if (!pi) throw new NotOurs('no payment intent');   // our checkouts always have one
  const p = await db.prepare('SELECT id, status FROM purchases WHERE payment_intent_id = ?').bind(pi).first<{ id: string; status: PurchaseStatus }>();
  if (p) return p;
  // its checkout may not be recorded yet (events can arrive in any order): ask Stripe to send this one again later.
  // Past the window it never will be: the charge isn't from one of our checkouts. Record it and stop the retries.
  const age = ev.created ? now - ev.created * 1000 : 0;
  if (age > RETRY_WINDOW_MS) throw new NotOurs('no such purchase');
  throw new RetryLater('purchase not recorded yet');
}

function setStatus(db: D1Database, purchaseId: string, from: PurchaseStatus, status: PurchaseStatus, now: number, reason: string): D1PreparedStatement[] {
  return [
    // only from the state that was read: two events about the same purchase arriving together can't undo each other
    db.prepare('UPDATE purchases SET status = ?, updated_at = ? WHERE id = ? AND status = ?').bind(status, now, purchaseId, from),
    recompute(db, purchaseId, now, reason),
  ];
}

/** The owner's entitlement to this purchase's product, recomputed from all their purchases of it. */
function recompute(db: D1Database, purchaseId: string, now: number, reason: string): D1PreparedStatement {
  const active = ACTIVE.map((s) => `'${s}'`).join(', ');
  return db.prepare(
    `INSERT INTO entitlements (user_id, product, status, purchase_id, granted_at, revoked_at, reason)
     SELECT p.user_id, p.product,
            CASE WHEN EXISTS (SELECT 1 FROM purchases q WHERE q.user_id = p.user_id AND q.product = p.product AND q.status IN (${active})) THEN 'active' ELSE 'revoked' END,
            p.id, ?, NULL, ?
       FROM purchases p WHERE p.id = ? AND p.user_id IS NOT NULL
     ON CONFLICT (user_id, product) DO UPDATE SET
       granted_at = CASE WHEN entitlements.status = 'revoked' AND excluded.status = 'active' THEN excluded.granted_at ELSE entitlements.granted_at END,
       revoked_at = CASE WHEN excluded.status = 'active' THEN NULL WHEN entitlements.status = 'active' THEN excluded.granted_at ELSE entitlements.revoked_at END,
       status = excluded.status,
       purchase_id = excluded.purchase_id,
       reason = excluded.reason`,
  ).bind(now, reason, purchaseId);
}
