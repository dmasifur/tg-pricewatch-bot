CREATE TABLE IF NOT EXISTS users (
  chat_id        INTEGER PRIMARY KEY,
  first_seen     TEXT    NOT NULL,
  watch_count    INTEGER NOT NULL DEFAULT 0,
  pitch_shown_at TEXT,
  hire_started_at TEXT,
  is_blocked     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS watches (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id         INTEGER NOT NULL REFERENCES users(chat_id) ON DELETE CASCADE,
  url             TEXT    NOT NULL,
  host            TEXT    NOT NULL,
  title           TEXT,
  currency        TEXT,
  last_price      REAL,
  target_price    REAL,
  notify_mode     TEXT    NOT NULL DEFAULT 'any_drop',   -- any_drop | target | restock
  selector        TEXT,
  selector_source TEXT,                                   -- jsonld | meta | microdata | embedded | user_tap | user_css
  interval_minutes INTEGER NOT NULL DEFAULT 60,
  next_check_at   TEXT    NOT NULL,
  expires_at      TEXT    NOT NULL,
  extended_count  INTEGER NOT NULL DEFAULT 0,
  status          TEXT    NOT NULL DEFAULT 'active',      -- active | paused | failing | expired
  fail_count      INTEGER NOT NULL DEFAULT 0,
  is_demo         INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_watches_due
  ON watches (next_check_at) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_watches_chat ON watches (chat_id);

CREATE TABLE IF NOT EXISTS price_points (
  watch_id    INTEGER NOT NULL REFERENCES watches(id) ON DELETE CASCADE,
  checked_at  TEXT    NOT NULL,
  price       REAL,
  in_stock    INTEGER,
  http_status INTEGER
);

CREATE INDEX IF NOT EXISTS idx_points_watch ON price_points (watch_id, checked_at);

CREATE TABLE IF NOT EXISTS alerts (
  watch_id INTEGER NOT NULL REFERENCES watches(id) ON DELETE CASCADE,
  sent_at  TEXT    NOT NULL,
  kind     TEXT    NOT NULL,   -- drop | target | restock | expiring
  price    REAL
);

CREATE INDEX IF NOT EXISTS idx_alerts_watch ON alerts (watch_id, sent_at);

CREATE TABLE IF NOT EXISTS rate_limits (
  chat_id       INTEGER NOT NULL,
  window_start  TEXT    NOT NULL,
  registrations INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (chat_id, window_start)
);

CREATE TABLE IF NOT EXISTS leads (
  chat_id    INTEGER PRIMARY KEY,
  use_case   TEXT,
  contact    TEXT,
  created_at TEXT NOT NULL
);