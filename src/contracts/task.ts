import { HttpError } from '../server/errors.ts';
import { tasksConfig } from '../config.ts';
import { isDateTime } from './validate.ts';
import { ROLE_KEYS, isParty } from '../tasks/parties.ts';
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
  const report = (task as { report?: Record<string, unknown> }).report;
  if (report !== undefined) checkReport(report);
  const extra = task as { roles?: Record<string, unknown>; waiting_for?: { party: string } | null; promise?: { by: string } | null };
  if (extra.roles) checkRoles(extra.roles);
  if (extra.waiting_for && !isParty(extra.waiting_for.party)) throw new HttpError(400, 'Задача ждёт неизвестную сторону');
  if (extra.promise && !isParty(extra.promise.by)) throw new HttpError(400, 'Обещание дано неизвестной стороной');
}

// Roles of a task (P14): only ROLE_KEYS; every value is a party (lists for executors and watchers) or null.
function checkRoles(roles: Record<string, unknown>): void {
  const fail = (reason: string): never => { throw new HttpError(400, `Роли задачи: ${reason}`); };
  for (const [key, value] of Object.entries(roles)) {
    if (!(ROLE_KEYS as readonly string[]).includes(key)) fail(`нет роли ${key}`);
    const many = key === 'executors' || key === 'watchers';
    const ok = many ? Array.isArray(value) && value.every(isParty) : value === null || isParty(value);
    if (!ok) fail(`роль ${key} заполнена неверно`);
  }
}

// A closing report (CONCEPT.md §2.9): only fields declared in registry/tasks.json, each of its type.
function checkReport(report: Record<string, unknown>): void {
  const fail = (reason: string): never => { throw new HttpError(400, `Отчёт о задаче: ${reason}`); };
  for (const [key, value] of Object.entries(report)) {
    if (key === 'currency') { if (!tasksConfig.currencies.includes(value as string)) fail('неизвестная валюта'); continue; }
    if (key === 'missing') {
      if (!Array.isArray(value) || value.some((item) => !Object.hasOwn(tasksConfig.report_fields, item))) fail('missing — список полей отчёта');
      continue;
    }
    const field = tasksConfig.report_fields[key];
    if (!field) fail(`нет поля ${key}`);
    const ok = field!.type === 'minutes' || field!.type === 'money' ? typeof value === 'number' && Number.isFinite(value) && value >= 0
      : field!.type === 'datetime' ? typeof value === 'string' && isDateTime(value)
      : field!.type === 'tags' ? Array.isArray(value) && value.every((tag) => typeof tag === 'string' && /^#[\p{L}0-9_-]+$/u.test(tag))
      : typeof value === 'string' && value.length <= 500;
    if (!ok) fail(`поле «${field!.title}» заполнено неверно`);
  }
}
