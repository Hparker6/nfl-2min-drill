-- Purchases and what they entitle. Payment state comes only from Stripe, through verified webhooks and Stripe's API;
-- nothing here is ever written from a browser's say-so. No card details are stored (Stripe holds them).

-- Which Stripe customer a user is (set when a checkout completes).
CREATE TABLE stripe_customers (
  user_id            TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  stripe_customer_id TEXT NOT NULL UNIQUE
);

-- One completed checkout. Kept if the account is deleted (user_id becomes NULL): refunds and disputes still need it,
-- and sales records may have to be kept (how long is an open legal question).
CREATE TABLE purchases (
  id                  TEXT PRIMARY KEY,             -- random UUID
  user_id             TEXT REFERENCES users(id) ON DELETE SET NULL,
  product             TEXT NOT NULL,
  checkout_session_id TEXT NOT NULL UNIQUE,
  payment_intent_id   TEXT UNIQUE,
  amount              INTEGER NOT NULL,             -- cents
  currency            TEXT NOT NULL,
  livemode            INTEGER NOT NULL,
  status              TEXT NOT NULL CHECK (status IN ('paid', 'refunded', 'partially_refunded', 'disputed', 'dispute_won', 'dispute_lost')),
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL
);
CREATE INDEX purchases_user ON purchases(user_id);

-- What a user owns, derived from their purchase's state (see server/accounts/purchases.ts entitlementFor).
CREATE TABLE entitlements (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product     TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('active', 'revoked')),
  purchase_id TEXT NOT NULL REFERENCES purchases(id),
  granted_at  INTEGER NOT NULL,
  revoked_at  INTEGER,
  reason      TEXT,
  PRIMARY KEY (user_id, product)
);

-- Every Stripe event handled, by id: a redelivered or replayed event is recognised and changes nothing.
CREATE TABLE webhook_events (
  event_id     TEXT PRIMARY KEY,
  type         TEXT NOT NULL,
  received_at  INTEGER NOT NULL,
  outcome      TEXT NOT NULL
);
