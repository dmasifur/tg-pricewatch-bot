

ALTER TABLE watches ADD COLUMN demo_stage   INTEGER;  -- NULL for real watches
ALTER TABLE watches ADD COLUMN demo_next_at TEXT;
ALTER TABLE leads  ADD COLUMN username      TEXT;

CREATE INDEX IF NOT EXISTS idx_watches_demo
  ON watches (demo_next_at) WHERE demo_stage IS NOT NULL;