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

-- Telegram business connections of the account bots (CONCEPT.md §8.2). Anyone who knows a bot's name can
-- connect it; only accounts the owner trusted on the System screen are read and answered.
CREATE TABLE IF NOT EXISTS tg_connections (
  id TEXT PRIMARY KEY,
  account TEXT NOT NULL,
  user_id TEXT NOT NULL,
  user_name TEXT,
  can_reply INTEGER NOT NULL,
  enabled INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tg_trust (
  account TEXT NOT NULL,
  user_id TEXT NOT NULL,
  trusted INTEGER NOT NULL,
  decided_at TEXT NOT NULL,
  PRIMARY KEY (account, user_id)
);
-- Groups a bot is a member of; a group is read while the account that added the bot is trusted.
CREATE TABLE IF NOT EXISTS tg_groups (
  account TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  title TEXT,
  added_by TEXT,
  member INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (account, chat_id)
);

-- Messages already looked at by the task triage (CONCEPT.md §2.8): derived state, so a rerun is possible.
CREATE TABLE IF NOT EXISTS triaged (
  event_id TEXT PRIMARY KEY,
  run_at TEXT NOT NULL,
  tasks INTEGER NOT NULL
);
-- AI spending per month against the limit in registry/tasks.json.
CREATE TABLE IF NOT EXISTS ai_usage (
  month TEXT PRIMARY KEY,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cost_usd REAL NOT NULL
);
-- The AI log (docs/plans/2026-11-21-ai-proposals-design.md, src/store/ailog.ts): triage runs and their decisions with
-- reasons and the owner's verdicts — for measuring and improving the triage. Inputs and outputs are gzipped JSON.
CREATE TABLE IF NOT EXISTS ai_runs (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  processor TEXT NOT NULL,
  model TEXT NOT NULL,
  stream TEXT NOT NULL,
  messages INTEGER NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cost_usd REAL NOT NULL,
  input BLOB,
  output BLOB
);
CREATE TABLE IF NOT EXISTS ai_decisions (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  at TEXT NOT NULL,
  kind TEXT NOT NULL,
  task_id TEXT,
  message_ids TEXT NOT NULL,
  confidence REAL,
  reason TEXT,
  status TEXT NOT NULL,
  resolved_at TEXT,
  resolved_task_id TEXT
);
CREATE INDEX IF NOT EXISTS ai_decisions_open ON ai_decisions (kind, status);
CREATE INDEX IF NOT EXISTS ai_decisions_at ON ai_decisions (at);
