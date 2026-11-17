import { HttpError } from '../server/errors.ts';
import type { JournalEvent } from './validate.ts';

// Task changes (CONCEPT.md §2.8): `task_change` events name their task in payload.ref and carry
// payload.data.task. The JSON Schema checks the shape; this checks the pairing and what a creation needs.
export function checkTask(event: JournalEvent): void {
  const task = event.payload.data?.task as { op: string; title?: string } | undefined;
  if (task && event.kind !== 'task_change') throw new HttpError(400, 'payload.data.task бывает только у task_change');
  if (event.kind !== 'task_change') return;
  if (!task) throw new HttpError(400, 'У task_change нет payload.data.task');
  const ref = event.payload.ref;
  if (ref?.type !== 'task' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref.id)) throw new HttpError(400, 'task_change ссылается на задачу: payload.ref {type: task, id}');
  if (task.op === 'create' && !task.title?.trim()) throw new HttpError(400, 'У новой задачи нет названия');
}
