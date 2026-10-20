-- Support requests from the in-game form: refunds, bug reports, account problems. Stored first, then the owner is
-- notified by email; a mail failure never loses a request. Messages are plain text, capped at 2000 characters.
CREATE TABLE support_requests (
  id          TEXT PRIMARY KEY,                 -- random UUID; the first 8 characters are the reference shown to the player
  kind        TEXT NOT NULL CHECK (kind IN ('refund', 'bug', 'account', 'other')),
  email       TEXT NOT NULL,                    -- lowercased, trimmed; how the owner answers
  user_id     TEXT REFERENCES users(id) ON DELETE SET NULL,   -- when sent while signed in
  message     TEXT NOT NULL,
  page        TEXT,                             -- where in the game they were (a short path or mode name)
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  notified_at INTEGER,                          -- when the owner's email went out (NULL: it didn't; check this table)
  created_at  INTEGER NOT NULL
);
CREATE INDEX support_requests_open ON support_requests(status, created_at);
