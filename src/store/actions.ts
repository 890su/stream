import type { DatabaseSync } from 'node:sqlite';
import type { JournalEvent } from '../contracts/validate.ts';
import { nameId } from '../ids.ts';
import { HttpError } from '../server/errors.ts';

// Actions (contracts/action.schema.json, CONCEPT.md §3.1). For now only replies to messengers:
// an owner's text with payload.data.outbound becomes an approved class C `send_message` —
// sending with a recipient chosen in the «кому» row is the confirmation (CONCEPT.md §2.9, §8.2).

export type ActionStatus = 'proposed' | 'approved' | 'running' | 'done' | 'failed' | 'rejected';
export interface Action {
  id: string; connector: string; operation: string; params: Record<string, unknown>; risk_class: 'A' | 'B' | 'C';
  status: ActionStatus; idempotency_key: string; source_event: string | null;
  external_id: string | null; error: string | null; created_at: string; updated_at: string;
}
interface ActionRow extends Omit<Action, 'params'> { params: string }

const fromRow = (row: ActionRow): Action => ({ ...row, params: JSON.parse(row.params) });

export class ActionStore {
  #db: DatabaseSync;
  constructor(db: DatabaseSync) { this.#db = db; }

  get(id: string): Action | undefined {
    const row = this.#db.prepare('SELECT * FROM actions WHERE id = ?').get(id) as unknown as ActionRow | undefined;
    return row && fromRow(row);
  }

  // Called inside the event's write transaction: the reply and its action exist together or not at all.
  fromEvent(event: JournalEvent, at: string): void {
    const outbound = event.payload.data?.outbound as { connector: string; chat_id: string; reply_to_message_id?: number } | undefined;
    if (!outbound) return;
    const params: Record<string, unknown> = { chat_id: outbound.chat_id, text: event.payload.text };
    if (outbound.reply_to_message_id) params.reply_to_message_id = outbound.reply_to_message_id;
    this.#db.prepare(`INSERT OR IGNORE INTO actions (id, connector, operation, params, risk_class, status, idempotency_key, source_event, created_at, updated_at)
      VALUES (?, ?, 'send_message', ?, 'C', 'approved', ?, ?, ?, ?)`)
      .run(nameId(`action|${event.id}`), outbound.connector, JSON.stringify(params), event.id, event.id, at, at);
  }

  // Sending through the Bot API is not idempotent: an action left `running` by a restart may or may not have
  // gone out, so it is not sent again — it fails with a request to check in Telegram (CONCEPT.md §8.2).
  // `before` — only those taken before that moment (the phone: a send it never confirmed).
  failRunning(connector: string, error: string, before?: string): Action[] {
    const rows = (before
      ? this.#db.prepare("SELECT id FROM actions WHERE connector = ? AND status = 'running' AND updated_at < ?").all(connector, before)
      : this.#db.prepare("SELECT id FROM actions WHERE connector = ? AND status = 'running'").all(connector)) as { id: string }[];
    const now = new Date().toISOString();
    for (const row of rows) this.#db.prepare("UPDATE actions SET status = 'failed', error = ?, updated_at = ? WHERE id = ?").run(error, now, row.id);
    return rows.map((row) => this.get(row.id)!);
  }

  // The next approved action becomes running.
  take(connector: string): Action | undefined {
    const row = this.#db.prepare("SELECT id FROM actions WHERE connector = ? AND status = 'approved' ORDER BY created_at LIMIT 1").get(connector) as { id: string } | undefined;
    if (!row) return undefined;
    this.#db.prepare("UPDATE actions SET status = 'running', updated_at = ? WHERE id = ?").run(new Date().toISOString(), row.id);
    return this.get(row.id);
  }

  hasWork(connector: string): boolean {
    return Boolean(this.#db.prepare("SELECT 1 FROM actions WHERE connector = ? AND status = 'approved' LIMIT 1").get(connector));
  }

  // Returns the action and whether this call changed it (a repeated result is not a new change).
  finish(id: string, connector: string, status: 'done' | 'failed', externalId: string | null, error: string | null): { action: Action; changed: boolean } {
    const action = this.get(id);
    if (!action || action.connector !== connector) throw new HttpError(404, 'Действие не найдено');
    if (action.status === status && action.external_id === externalId) return { action, changed: false };
    if (action.status === 'done') return { action, changed: false }; // done is final
    const now = new Date().toISOString();
    this.#db.prepare('UPDATE actions SET status = ?, external_id = ?, error = ?, updated_at = ? WHERE id = ?').run(status, externalId, error, now, id);
    return { action: this.get(id)!, changed: true };
  }

  retry(id: string): Action {
    const action = this.get(id);
    if (!action) throw new HttpError(404, 'Действие не найдено');
    if (action.status !== 'failed') throw new HttpError(409, 'Повторить можно только неудавшееся действие');
    this.#db.prepare("UPDATE actions SET status = 'approved', error = NULL, updated_at = ? WHERE id = ?").run(new Date().toISOString(), id);
    return this.get(id)!;
  }

  byExternal(connector: string, externalId: string): Action | undefined {
    const row = this.#db.prepare('SELECT * FROM actions WHERE connector = ? AND external_id = ?').get(connector, externalId) as unknown as ActionRow | undefined;
    return row && fromRow(row);
  }

  recent(limit: number): Action[] {
    return (this.#db.prepare('SELECT * FROM actions ORDER BY updated_at DESC LIMIT ?').all(limit) as unknown as ActionRow[]).map(fromRow);
  }

  failedSince(connector: string, since: string): number {
    return (this.#db.prepare("SELECT COUNT(*) AS n FROM actions WHERE connector = ? AND status = 'failed' AND updated_at >= ?").get(connector, since) as { n: number }).n;
  }
}
