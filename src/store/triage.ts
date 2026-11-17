import type { DatabaseSync } from 'node:sqlite';
import type { JournalEvent } from '../contracts/validate.ts';

// What the task triage reads and remembers (CONCEPT.md §2.8): messages not looked at yet, task events,
// corrections of a message, AI spending.

const MESSAGE_KINDS = ['text', 'voice', 'photo', 'file', 'link', 'call', 'sms'];
interface Row { id: string; schema_version: 1; source: string; author: string; ts: string; received_at: string; kind: string; payload: string; reply_to: string | null; topic_hint: string | null }
const fromRow = (row: Row & { body_hash?: string }): JournalEvent => {
  const { body_hash, payload, ...fields } = row;
  return { ...fields, payload: JSON.parse(payload) };
};

export class TriageStore {
  #db: DatabaseSync;
  constructor(db: DatabaseSync) { this.#db = db; }

  // Messages received since `since` that the triage has not looked at, oldest first.
  pending(since: string): JournalEvent[] {
    const rows = this.#db.prepare(`SELECT * FROM events e WHERE e.received_at >= ? AND e.kind IN (${MESSAGE_KINDS.map(() => '?').join(',')})
        AND e.author != 'system' AND NOT EXISTS (SELECT 1 FROM triaged t WHERE t.event_id = e.id) ORDER BY e.received_at`)
      .all(since, ...MESSAGE_KINDS) as unknown as Row[];
    return rows.map(fromRow);
  }

  corrections(id: string): JournalEvent[] {
    return (this.#db.prepare(`SELECT * FROM events WHERE kind = 'correction' AND json_extract(payload, '$.ref.id') = ? ORDER BY ts, received_at`)
      .all(id) as unknown as Row[]).map(fromRow);
  }

  taskEvents(): JournalEvent[] {
    return (this.#db.prepare(`SELECT * FROM events WHERE kind = 'task_change' ORDER BY ts, received_at`).all() as unknown as Row[]).map(fromRow);
  }

  mark(ids: string[], tasks: number, at: string): void {
    const insert = this.#db.prepare('INSERT OR IGNORE INTO triaged (event_id, run_at, tasks) VALUES (?, ?, ?)');
    for (const id of ids) insert.run(id, at, tasks);
  }

  spent(month: string): number {
    const row = this.#db.prepare('SELECT cost_usd FROM ai_usage WHERE month = ?').get(month) as { cost_usd: number } | undefined;
    return row?.cost_usd ?? 0;
  }

  addUsage(month: string, input: number, output: number, cost: number): void {
    this.#db.prepare(`INSERT INTO ai_usage (month, input_tokens, output_tokens, cost_usd) VALUES (?, ?, ?, ?)
      ON CONFLICT(month) DO UPDATE SET input_tokens = input_tokens + excluded.input_tokens, output_tokens = output_tokens + excluded.output_tokens,
        cost_usd = cost_usd + excluded.cost_usd`).run(month, input, output, cost);
  }
}
