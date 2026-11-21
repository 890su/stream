import type { DatabaseSync } from 'node:sqlite';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { JournalEvent } from '../contracts/validate.ts';

// The AI log (docs/plans/2026-11-21-ai-proposals-design.md): every triage run — what the AI was shown and answered,
// gzipped — and every decision with its reason and what the owner made of it, so the triage can be measured and
// improved (CONCEPT.md §9). A proposal (`link`) waits for the owner: `accepted`, `redirected` (another or a new task),
// `rejected`; what the AI did by itself (`auto`) becomes `undone` when the owner cancels that task or takes its
// messages out. The owner's answers are read from the journal as they are appended (`observe`), buttons or not.
// Derived state: the journal holds the proposals and answers; this log adds what the journal does not keep.

export type DecisionKind = 'link' | 'create' | 'filed' | 'conversation_only' | 'unsorted';
export interface AiRun { id: string; at: string; processor: string; model: string; stream: string; messages: number;
  input_tokens: number; output_tokens: number; cost_usd: number; input: unknown; output: unknown }
export interface AiDecision { id: string; run_id: string; at: string; kind: DecisionKind; task_id: string | null; message_ids: string[];
  confidence: number | null; reason: string | null; status: 'pending' | 'auto' | 'accepted' | 'redirected' | 'rejected' | 'undone' }
interface DecisionRow { id: string; run_id: string; at: string; kind: string; task_id: string | null; message_ids: string; confidence: number | null;
  reason: string | null; status: string; resolved_at: string | null; resolved_task_id: string | null }

const pack = (value: unknown) => gzipSync(Buffer.from(JSON.stringify(value ?? null)));
const unpack = (blob: Uint8Array | null) => (blob ? JSON.parse(gunzipSync(blob).toString('utf8')) : null);

export class AiLog {
  #db: DatabaseSync;
  constructor(db: DatabaseSync) { this.#db = db; }

  run(run: AiRun): void {
    this.#db.prepare(`INSERT OR IGNORE INTO ai_runs (id, at, processor, model, stream, messages, input_tokens, output_tokens, cost_usd, input, output)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(run.id, run.at, run.processor, run.model, run.stream, run.messages,
      run.input_tokens, run.output_tokens, run.cost_usd, pack(run.input), pack(run.output));
  }

  // { input, output } of a run, or null when it is unknown or wiped by `prune`.
  runInput(id: string): { input: unknown; output: unknown } | null {
    const row = this.#db.prepare('SELECT input, output FROM ai_runs WHERE id = ?').get(id) as { input: Uint8Array | null; output: Uint8Array | null } | undefined;
    return row?.input ? { input: unpack(row.input), output: unpack(row.output) } : null;
  }

  decide(decisions: AiDecision[]): void {
    const insert = this.#db.prepare(`INSERT OR IGNORE INTO ai_decisions (id, run_id, at, kind, task_id, message_ids, confidence, reason, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const item of decisions) insert.run(item.id, item.run_id, item.at, item.kind, item.task_id, JSON.stringify(item.message_ids), item.confidence, item.reason, item.status);
  }

  decision(id: string): (Omit<DecisionRow, 'message_ids'> & { message_ids: string[] }) | null {
    const row = this.#db.prepare('SELECT * FROM ai_decisions WHERE id = ?').get(id) as DecisionRow | undefined;
    return row ? { ...row, message_ids: JSON.parse(row.message_ids) } : null;
  }

  #settle(id: string, status: string, at: string, task: string | null, from: string[]): void {
    this.#db.prepare(`UPDATE ai_decisions SET status = ?, resolved_at = ?, resolved_task_id = ? WHERE id = ? AND status IN (${from.map(() => '?').join(',')})`)
      .run(status, at, task, id, ...from);
  }

  #open(kind: 'link' | 'create', status: string): { id: string; task_id: string | null; message_ids: string[] }[] {
    const rows = this.#db.prepare('SELECT id, task_id, message_ids FROM ai_decisions WHERE kind = ? AND status = ?').all(kind, status) as unknown as DecisionRow[];
    return rows.map((row) => ({ id: row.id, task_id: row.task_id, message_ids: JSON.parse(row.message_ids) as string[] }));
  }

  // A new journal event: the owner's answer to a proposal, a hand link of a waiting message, or an undo of what the AI made.
  observe(event: JournalEvent): void {
    if (event.author !== 'me') return;
    const data = event.payload.data as { op?: string; proposal?: string; task?: { proposal?: string; add?: string[]; remove?: string[]; status?: string } } | undefined;
    if (event.kind === 'correction' && data?.op === 'reject_proposal' && data.proposal) { this.#settle(data.proposal, 'rejected', event.ts, null, ['pending']); return; }
    if (event.kind !== 'task_change' || !data?.task) return;
    const task = event.payload.ref!.id;
    const change = data.task;
    const answer = (decision: { id: string; task_id: string | null }) => this.#settle(decision.id, decision.task_id === task ? 'accepted' : 'redirected', event.ts, task, ['pending']);
    if (change.proposal) {
      const decision = this.decision(change.proposal);
      if (decision) answer(decision);
    } else if (change.add?.length) {
      const added = new Set(change.add);
      for (const decision of this.#open('link', 'pending')) if (decision.message_ids.some((id) => added.has(id))) answer(decision);
    }
    const removed = new Set(change.remove ?? []);
    for (const decision of this.#open('create', 'auto')) {
      if (decision.task_id !== task) continue;
      if (change.status === 'cancelled' || decision.message_ids.some((id) => removed.has(id))) this.#settle(decision.id, 'undone', event.ts, task, ['auto']);
    }
  }

  // { kind: { status: count } } of decisions made since `since`.
  stats(since: string): Record<string, Record<string, number>> {
    const rows = this.#db.prepare('SELECT kind, status, COUNT(*) AS n FROM ai_decisions WHERE at >= ? GROUP BY kind, status ORDER BY kind, status').all(since) as { kind: string; status: string; n: number }[];
    const result: Record<string, Record<string, number>> = {};
    for (const row of rows) (result[row.kind] ??= {})[row.status] = Number(row.n);
    return result;
  }

  // Wipes what the AI was shown and answered in runs before `before`; the runs and decisions stay. → runs wiped.
  prune(before: string): number {
    return Number(this.#db.prepare('UPDATE ai_runs SET input = NULL, output = NULL WHERE at < ? AND input IS NOT NULL').run(before).changes);
  }
}
