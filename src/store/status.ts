import type { DatabaseSync } from 'node:sqlite';

// Current state of sources and connectors (System screen, CONCEPT.md §5). A pulse overwrites the row;
// the caller writes a `system` event to the journal only when the state changes.

export type SourceState = 'ok' | 'silent' | 'login_required' | 'error';
export interface SourceStatus {
  source: string; state: SourceState; detail: string | null; pulse_at: string | null; last_event_at: string | null;
  info: Record<string, unknown> | null;
}
interface Row extends Omit<SourceStatus, 'info'> { info: string | null }

const fromRow = (row: Row): SourceStatus => ({ ...row, info: row.info ? JSON.parse(row.info) : null });

export class StatusStore {
  #db: DatabaseSync;
  constructor(db: DatabaseSync) { this.#db = db; }

  get(source: string): SourceStatus | undefined {
    const row = this.#db.prepare('SELECT * FROM source_status WHERE source = ?').get(source) as unknown as Row | undefined;
    return row && fromRow(row);
  }

  all(): SourceStatus[] {
    return (this.#db.prepare('SELECT * FROM source_status ORDER BY source').all() as unknown as Row[]).map(fromRow);
  }

  // Returns the previous state ('unknown' for a first pulse).
  pulse(source: string, state: SourceState, detail: string | null, info: Record<string, unknown> | null, at: string): SourceState | 'unknown' {
    const previous = this.get(source)?.state ?? 'unknown';
    this.#db.prepare(`INSERT INTO source_status (source, state, detail, pulse_at, info) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(source) DO UPDATE SET state = excluded.state, detail = excluded.detail, pulse_at = excluded.pulse_at, info = excluded.info`)
      .run(source, state, detail, at, info && JSON.stringify(info));
    return previous;
  }

  // A source wrote something (the phone has no pulse: its last event is its sign of life).
  seen(source: string, at: string): void {
    this.#db.prepare(`INSERT INTO source_status (source, state, last_event_at) VALUES (?, 'ok', ?)
      ON CONFLICT(source) DO UPDATE SET last_event_at = excluded.last_event_at`).run(source, at);
  }

  // Sources with a pulse that stopped: switched to `silent`; returns the ones that changed now.
  // `skip` — connections switched off on the System screen: quiet on purpose, not silent.
  markSilent(before: string, skip: string[] = []): { source: string; previous: SourceState }[] {
    const rows = (this.#db.prepare("SELECT source, state FROM source_status WHERE pulse_at IS NOT NULL AND pulse_at < ? AND state != 'silent'")
      .all(before) as { source: string; state: SourceState }[]).filter((row) => !skip.includes(row.source));
    for (const row of rows) this.#db.prepare("UPDATE source_status SET state = 'silent' WHERE source = ?").run(row.source);
    return rows.map((row) => ({ source: row.source, previous: row.state }));
  }
}
