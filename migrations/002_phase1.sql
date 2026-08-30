ALTER TABLE watches ADD COLUMN candidates TEXT;      -- JSON array, pending rows only
ALTER TABLE users  ADD COLUMN pending_action TEXT;   -- e.g. "target:42"

CREATE INDEX IF NOT EXISTS idx_watches_status ON watches (chat_id, status);