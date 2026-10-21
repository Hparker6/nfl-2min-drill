-- The buyer's email as a one-way hash (pepper + address), kept on the purchase: the refund and chargeback history
-- follows the address, so deleting the account and signing in again with the same email starts with the same past.
ALTER TABLE purchases ADD COLUMN email_hash TEXT;
CREATE INDEX IF NOT EXISTS purchases_email_hash ON purchases (email_hash);
-- Refunded by us on the card issuer's early fraud warning (Stripe Radar): it closes purchases for that buyer, like a
-- lost chargeback, and the owner sees it on a support request. (A column rather than a status: the status CHECK can't
-- be altered in place.)
ALTER TABLE purchases ADD COLUMN fraud INTEGER NOT NULL DEFAULT 0;
