-- Accounts: a verified email address, sign-in tokens, sessions and rate-limit counters.
-- Times are milliseconds since the epoch (Date.now()). Secrets are never stored: only SHA-256/HMAC hashes of them.

-- One person: an email address they have proven they control.
CREATE TABLE users (
  id                TEXT PRIMARY KEY,               -- random UUID
  email             TEXT NOT NULL UNIQUE,           -- lowercased, trimmed
  email_verified_at INTEGER NOT NULL,
  created_at        INTEGER NOT NULL
);

-- How a user signs in. Email now; Google later ('google', its stable subject id).
CREATE TABLE identities (
  provider   TEXT NOT NULL CHECK (provider IN ('email', 'google')),
  subject    TEXT NOT NULL,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (provider, subject)
);
CREATE INDEX identities_user ON identities(user_id);

-- A signed-in browser. The cookie holds a random token; only its hash is stored.
CREATE TABLE sessions (
  token_hash   TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE INDEX sessions_expiry ON sessions(expires_at);

-- An emailed sign-in: a link token and a 6-digit code, both single use, both short-lived.
CREATE TABLE login_tokens (
  token_hash TEXT PRIMARY KEY,
  email      TEXT NOT NULL,
  code_hash  TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at    INTEGER,
  attempts   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX login_tokens_email ON login_tokens(email, created_at);

-- Fixed-window counters. Keys are hashes (of an email or an address), never the values.
CREATE TABLE rate_limits (
  key    TEXT NOT NULL,
  win    INTEGER NOT NULL,              -- the window's start time
  count  INTEGER NOT NULL,
  PRIMARY KEY (key, win)
);
