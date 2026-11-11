PRAGMA journal_mode = WAL;
PRAGMA synchronous = FULL;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL,
  source TEXT NOT NULL,
  author TEXT NOT NULL,
  ts TEXT NOT NULL,
  received_at TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  reply_to TEXT,
  topic_hint TEXT,
  body_hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_received ON events(received_at);
CREATE TRIGGER IF NOT EXISTS events_no_update BEFORE UPDATE ON events
BEGIN SELECT RAISE(ABORT, 'events are append-only'); END;
CREATE TRIGGER IF NOT EXISTS events_no_delete BEFORE DELETE ON events
BEGIN SELECT RAISE(ABORT, 'events are append-only'); END;

CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY,
  mime TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  path TEXT NOT NULL,
  created_at TEXT NOT NULL
);
