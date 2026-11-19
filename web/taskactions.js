// One-tap actions of a task (P14, 2026-11-19): which actions a task offers by status, the task change each one
// makes and the change that undoes it, due-date chips, and the parties a task can be handed to. Pure: no DOM — tested in node.
import { partyOfEvent, partyName } from './parties.js';

const ACTION_LABELS = { accept: 'Принять', delegate: 'Поручить…', defer: 'Отложить…', wait: 'Жду…', done: 'Готово', verify: 'Проверил', reopen: 'Вернуть в работу', cancel: 'Отменить' };
export const actionLabel = (action) => ACTION_LABELS[action] ?? action;

export function actionsFor(task) {
  switch (task.status) {
    case 'inbox': return ['done', 'accept', 'delegate', 'defer', 'cancel'];
    case 'todo': case 'doing': return ['done', 'delegate', 'wait', 'defer', 'cancel'];
    case 'waiting': return ['done', 'delegate', 'defer', 'cancel'];
    case 'review': return ['verify', 'reopen', 'cancel'];
    case 'deferred': return ['done', 'reopen', 'cancel'];
    default: return ['reopen'];
  }
}

// Closing in one tap (CONCEPT.md §2.9, 2026-11-19): `done` at once; the report fields the template asks for
// (`reportKeys`) stay in `report.missing` for the evening summary and «Не учтено».
// A report filled before (a task reopened and closed again) keeps its values; only the unfilled keys are missing.
export function closeChange(reportKeys = [], report = null) {
  const { missing: _missing, ...filled } = report ?? {};
  const missing = reportKeys.filter((key) => !(key in filled));
  const next = Object.keys(filled).length || missing.length ? { ...filled, missing } : null;
  return { status: 'done', proposed: null, ...(next ? { report: next } : {}) };
}

// The change for an action. `arg` — the party (delegate, wait), the date-time (defer); `reportKeys` — for done.
export function changeFor(action, task, arg, now = new Date(), reportKeys = []) {
  switch (action) {
    case 'accept': return { status: 'todo', roles: { executors: ['me'] } };
    case 'delegate': return { roles: { executors: [arg], controller: 'me' } };
    case 'defer': return { status: 'deferred', remind_at: arg };
    case 'wait': return { status: 'waiting', waiting_for: { party: arg, since: now.toISOString() } };
    case 'done': case 'verify': return closeChange(reportKeys, task.report);
    case 'reopen': return { status: 'todo' };
    case 'cancel': return { status: 'cancelled' };
    default: return null;
  }
}

const FIELD_OF = { remind_at: 'remindAt', waiting_for: 'waitingFor' };

// The change that puts back what `change` replaced, for «Вернуть» — a new event, the journal stays as it was.
// A report cannot be unset (Event v1): a previous one is put back, none stays as written — a task that is not
// done is not «Не учтено» anyway.
export function undoOf(task, change) {
  const undo = {};
  for (const [key, value] of Object.entries(change)) {
    if (key === 'op' || key === 'add' || key === 'remove') continue;
    if (key === 'report') { if (task.report) undo.report = task.report; continue; }
    if (key === 'roles') {
      undo.roles = Object.fromEntries(Object.keys(value).map((role) => [role, task.roles?.[role] ?? (role === 'executors' || role === 'watchers' ? [] : null)]));
      continue;
    }
    if (key === 'resume_note') { undo.resume_note = task.resumeNote ?? ''; continue; } // a string: '' clears
    undo[key] = task[FIELD_OF[key] ?? key] ?? null;
  }
  return undo;
}

const dayOf = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

// Due dates in one tap; «на неделе» is the nearest Friday still ahead (from Friday on — the next one).
export function dueChips(now = new Date()) {
  const at = (days) => { const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days); return dayOf(date); };
  const weekday = now.getDay();
  const toFriday = weekday >= 1 && weekday <= 4 ? 5 - weekday : (5 - weekday + 7) % 7 || 7;
  return [{ label: 'сегодня', due: at(0) }, { label: 'завтра', due: at(1) }, { label: 'на неделе', due: at(toFriday) }];
}

// Who a task can be handed to (or waited for) from its conversations: the authors of its messages — callers of
// incoming calls and SMS too — not me, without repeats.
export function delegateOptions(views) {
  const seen = new Map();
  for (const view of views) {
    const party = partyOfEvent(view.event);
    if (party !== 'me' && !seen.has(party)) seen.set(party, { party, name: partyName(party, views) });
  }
  return [...seen.values()];
}
