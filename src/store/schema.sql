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

-- Actions (contracts/action.schema.json): only status and result change; every change is also an
-- action_result event in the journal. Derived from events, so this table is not the source of truth.
CREATE TABLE IF NOT EXISTS actions (
  id TEXT PRIMARY KEY,
  connector TEXT NOT NULL,
  operation TEXT NOT NULL,
  params TEXT NOT NULL,
  risk_class TEXT NOT NULL,
  status TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  source_event TEXT,
  external_id TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS actions_queue ON actions(connector, status);
CREATE INDEX IF NOT EXISTS actions_external ON actions(connector, external_id);

-- Current state of sources and connectors for the System screen: the last pulse, not history.
-- Only state transitions go to the journal (kind: system).
CREATE TABLE IF NOT EXISTS source_status (
  source TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  detail TEXT,
  pulse_at TEXT,
  last_event_at TEXT,
  info TEXT
);
