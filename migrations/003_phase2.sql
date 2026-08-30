ALTER TABLE watches ADD COLUMN last_checked_at TEXT;
ALTER TABLE watches ADD COLUMN last_in_stock   INTEGER;
ALTER TABLE watches ADD COLUMN paused_reason   TEXT;

CREATE INDEX IF NOT EXISTS idx_watches_expiring
  ON watches (expires_at) WHERE status = 'active';