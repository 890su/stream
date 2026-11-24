import type { JournalStore } from '../store/store.ts';
import type { LiveFeed } from '../server/live.ts';
import { foldTasks } from './fold.ts';
import { nameId } from '../ids.ts';

// One-time start-up migration after topics were dropped (docs/plans/2026-11-23-conversation-records-design.md,
// decisions.md 2026-11-24). A topic was a task record whose last `kind` is 'topic'. The ones the owner made stay open
// tasks (nothing is written). The AI's topics with an `offer` become unconfirmed tasks; the rest are cancelled with
// «Темы убраны». Event ids are `topics-gone|<task>`, so a second run writes nothing; pending AI-log decisions of the
// topic kinds become `replaced`. The journal is only appended to; old `kind`/`offer` keys stay readable and are ignored.

const GONE_KINDS = ['topic', 'topic_link', 'propose_task'];
const CLOSED = new Set(['done', 'cancelled']);

type Flags = { kind?: string; offer?: boolean };

export function migrateTopics({ store, live, at }: { store: JournalStore; live: LiveFeed; at: string }): { tasks: number; cancelled: number; unconfirmed: number } {
  const events = store.triage.taskEvents();
  const flags = new Map<string, Flags>();
  for (const event of events) {
    const change = (event.payload.data?.task ?? {}) as Flags;
    const current = flags.get(event.payload.ref!.id) ?? {};
    if (change.kind !== undefined) current.kind = change.kind;
    if (change.offer !== undefined) current.offer = change.offer;
    flags.set(event.payload.ref!.id, current);
  }
  const result = { tasks: 0, cancelled: 0, unconfirmed: 0 };
  for (const task of foldTasks(events)) {
    if (flags.get(task.id)?.kind !== 'topic' || task.created_by === 'me' || CLOSED.has(task.status)) continue;
    const offer = flags.get(task.id)?.offer === true;
    const data = offer ? { op: 'update', kind: 'task', unconfirmed: true } : { op: 'update', status: 'cancelled', reason: 'Темы убраны' };
    const written = store.appendEvent({ id: nameId(`topics-gone|${task.id}`), schema_version: 1, source: 'system', author: 'system', ts: at, kind: 'task_change',
      payload: { ref: { type: 'task', id: task.id }, data: { task: data } } });
    if (!written.created) continue;
    live.publish(written.event);
    if (offer) { result.tasks += 1; result.unconfirmed += 1; } else result.cancelled += 1;
  }
  store.ailog.replaceKinds(GONE_KINDS, at);
  return result;
}
