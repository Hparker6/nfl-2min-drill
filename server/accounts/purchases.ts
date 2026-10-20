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
import { stripeClient, verifyStripeSignature, type StripeError } from './stripe';
import type { Session } from './sessions';

export type PurchaseStatus = 'paid' | 'refunded' | 'partially_refunded' | 'disputed' | 'dispute_won' | 'dispute_lost';
const ACTIVE: PurchaseStatus[] = ['paid', 'partially_refunded', 'dispute_won'];
export const entitlementFor = (s: PurchaseStatus): 'active' | 'revoked' => (ACTIVE.includes(s) ? 'active' : 'revoked');

/** The products a user owns now. */
export async function entitlementsOf(db: D1Database, userId: string): Promise<string[]> {
  const r = await db.prepare("SELECT product FROM entitlements WHERE user_id = ? AND status = 'active'").bind(userId).all<{ product: string }>();
  return r.results.map((x) => x.product);
}

/** Start a checkout for the signed-in user (409 when they already own it). The price is ours, fixed on the server. */
export async function createCheckout(db: D1Database, pay: PaymentsConfig, origin: string, s: Session, now: number, f: typeof fetch): Promise<Response> {
  if (!(await hit(db, LIMITS.checkoutPerUser, s.userId, now))) return fail(429, 'Too many checkout attempts. Try again later.');
  if ((await entitlementsOf(db, s.userId)).includes(PRODUCT.id)) return fail(409, 'You already own the Coach’s Edition.');
  const cust = await db.prepare('SELECT stripe_customer_id FROM stripe_customers WHERE user_id = ?').bind(s.userId).first<{ stripe_customer_id: string }>();
  const meta = { user_id: s.userId, product: PRODUCT.id };
  const stripe = stripeClient(pay.secretKey, f);
  const cs = await stripe.post<{ id: string; url: string }>('/v1/checkout/sessions', {
    mode: 'payment',
    line_items: [{ price: pay.priceId, quantity: 1 }],
    payment_method_types: ['card'],
    client_reference_id: s.userId,
    ...(cust ? { customer: cust.stripe_customer_id } : { customer_email: s.email, customer_creation: 'always' }),
    metadata: meta,
    payment_intent_data: { metadata: meta },
    success_url: `${origin}/#purchase={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/#account`,
  }, `checkout:${s.userId}:${Math.floor(now / 60_000)}`);
  if (!cs?.url || !/^https:\/\/checkout\.stripe\.com\//.test(cs.url)) return fail(502, 'Checkout could not be started.');
  return json({ url: cs.url });
}

/** What our records say about a checkout of this user's (the success page polls this). */
export async function checkoutStatus(db: D1Database, userId: string, sessionId: string | null) {
  if (!sessionId || !/^cs_(test|live)_[A-Za-z0-9]{10,200}$/.test(sessionId)) return { found: false, owns: false };
  const p = await db.prepare('SELECT status FROM purchases WHERE checkout_session_id = ? AND user_id = ?').bind(sessionId, userId).first<{ status: PurchaseStatus }>();
  const owns = (await entitlementsOf(db, userId)).includes(PRODUCT.id);
  return p ? { found: true, status: p.status, owns } : { found: false, owns };
}

// ---- webhooks ----

interface StripeEvent { id: string; type: string; livemode: boolean; data: { object: { id: string } } }
interface CheckoutSession {
  id: string; object: 'checkout.session'; mode: string; status: string; payment_status: string; livemode: boolean;
  amount_total: number | null; currency: string | null; client_reference_id: string | null; customer: string | null;
  payment_intent: string | null; metadata: Record<string, string> | null;
  line_items?: { data: { quantity: number; price: { id: string } | null }[] };
}
interface Charge { id: string; payment_intent: string | null; amount: number; amount_refunded: number; refunded: boolean }
interface Dispute { id: string; payment_intent: string | null; charge: string; status: string }

/** Why an event changed nothing, or what it did (kept with the event's id). */
type Outcome = string;
/** Not ready: answer 5xx so Stripe sends it again later (it retries for days). */
class RetryLater extends Error {}

export async function handleWebhook(db: D1Database, pay: PaymentsConfig, req: Request, now: number, f: typeof fetch): Promise<Response> {
  const body = await readCapped(req, 256 * 1024);
  if (body === null) return fail(413, 'too large');
  if (!(await verifyStripeSignature(body, req.headers.get('stripe-signature'), pay.webhookSecret, now))) return fail(400, 'bad signature');
  let ev: StripeEvent;
  try { ev = JSON.parse(body); } catch { return fail(400, 'bad json'); }
  if (!ev?.id || typeof ev.type !== 'string' || !ev.data?.object?.id) return fail(400, 'bad event');
  if (ev.livemode !== pay.live) return fail(400, 'wrong mode');
  if (await db.prepare('SELECT 1 FROM webhook_events WHERE event_id = ?').bind(ev.id).first()) return json({ received: true, duplicate: true });

  const stripe = stripeClient(pay.secretKey, f);
  let stmts: D1PreparedStatement[] = [];
  let outcome: Outcome;
  try {
    ({ stmts, outcome } = await apply(db, pay, stripe, ev, now));
  } catch (e) {
    if (e instanceof RetryLater) return fail(503, e.message);
    // signed by Stripe, but about something Stripe doesn't have (another account's object, or deleted): nothing to do
    if ((e as StripeError)?.status === 404) { stmts = []; outcome = 'ignored: Stripe has no such object'; }
    else if ((e as StripeError)?.status >= 500 || (e as StripeError)?.status === 429) return fail(503, 'stripe unavailable');
    else throw e;
  }
  stmts.push(db.prepare('INSERT INTO webhook_events (event_id, type, received_at, outcome) VALUES (?, ?, ?, ?)').bind(ev.id, ev.type, now, outcome));
  try {
    await db.batch(stmts);
  } catch (e) {
    // the same event processed at the same moment by another delivery: its transaction won, this one changed nothing
    if (/UNIQUE|constraint/i.test(String((e as Error)?.message)) && (await db.prepare('SELECT 1 FROM webhook_events WHERE event_id = ?').bind(ev.id).first())) return json({ received: true, duplicate: true });
    throw e;
  }
  return json({ received: true, outcome });
}

async function apply(db: D1Database, pay: PaymentsConfig, stripe: ReturnType<typeof stripeClient>, ev: StripeEvent, now: number): Promise<{ stmts: D1PreparedStatement[]; outcome: Outcome }> {
  switch (ev.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded': {
      const cs = await stripe.get<CheckoutSession>(`/v1/checkout/sessions/${encodeURIComponent(ev.data.object.id)}`, { expand: ['line_items'] });
      const why = checkoutProblem(cs, pay);
      if (why) return { stmts: [], outcome: `ignored: ${why}` };
      const userId = cs.client_reference_id!;
      const user = await db.prepare('SELECT id FROM users WHERE id = ?').bind(userId).first();
      const existing = await db.prepare('SELECT id FROM purchases WHERE checkout_session_id = ?').bind(cs.id).first<{ id: string }>();
      const purchaseId = existing?.id ?? crypto.randomUUID();
      const stmts = [
        db.prepare(`INSERT INTO purchases (id, user_id, product, checkout_session_id, payment_intent_id, amount, currency, livemode, status, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'paid', ?, ?) ON CONFLICT (checkout_session_id) DO NOTHING`)
          .bind(purchaseId, user ? userId : null, PRODUCT.id, cs.id, cs.payment_intent, cs.amount_total!, cs.currency!, cs.livemode ? 1 : 0, now, now),
      ];
      if (user && cs.customer) stmts.push(db.prepare('INSERT INTO stripe_customers (user_id, stripe_customer_id) VALUES (?, ?) ON CONFLICT DO NOTHING').bind(userId, cs.customer));
      if (user) stmts.push(recompute(db, purchaseId, now, 'purchase'));
      return { stmts, outcome: user ? 'granted' : 'paid: the account no longer exists' };
    }
    case 'charge.refunded': {
      const ch = await stripe.get<Charge>(`/v1/charges/${encodeURIComponent(ev.data.object.id)}`);
      const p = await purchaseByIntent(db, ch.payment_intent);
      const full = ch.refunded || ch.amount_refunded >= ch.amount;
      const status: PurchaseStatus = full ? 'refunded' : ch.amount_refunded > 0 ? (p.status === 'paid' ? 'partially_refunded' : p.status) : p.status;
      return { stmts: setStatus(db, p.id, status, now, full ? 'refunded' : 'partial refund'), outcome: status };
    }
    case 'charge.dispute.created':
    case 'charge.dispute.updated':
    case 'charge.dispute.closed':
    case 'charge.dispute.funds_withdrawn':
    case 'charge.dispute.funds_reinstated': {
      const d = await stripe.get<Dispute>(`/v1/disputes/${encodeURIComponent(ev.data.object.id)}`);
      const p = await purchaseByIntent(db, d.payment_intent);
      if (p.status === 'refunded') return { stmts: [], outcome: 'ignored: already refunded' };
      const status: PurchaseStatus = d.status === 'won' ? 'dispute_won' : d.status === 'lost' ? 'dispute_lost' : 'disputed';
      return { stmts: setStatus(db, p.id, status, now, `dispute ${d.status}`), outcome: status };
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

async function purchaseByIntent(db: D1Database, pi: string | null): Promise<{ id: string; status: PurchaseStatus }> {
  const p = pi ? await db.prepare('SELECT id, status FROM purchases WHERE payment_intent_id = ?').bind(pi).first<{ id: string; status: PurchaseStatus }>() : null;
  // its checkout hasn't been recorded yet (events can arrive in any order): ask Stripe to send this one again later
  if (!p) throw new RetryLater('purchase not recorded yet');
  return p;
}

function setStatus(db: D1Database, purchaseId: string, status: PurchaseStatus, now: number, reason: string): D1PreparedStatement[] {
  return [
    db.prepare('UPDATE purchases SET status = ?, updated_at = ? WHERE id = ?').bind(status, now, purchaseId),
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
