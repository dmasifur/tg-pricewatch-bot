

CREATE TABLE IF NOT EXISTS ops_daily (
  day            TEXT PRIMARY KEY,
  checks_ok      INTEGER NOT NULL DEFAULT 0,
  checks_failed  INTEGER NOT NULL DEFAULT 0,
  alerts_sent    INTEGER NOT NULL DEFAULT 0,
  sweeps         INTEGER NOT NULL DEFAULT 0,
  budget_exhausted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS ops_state (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);