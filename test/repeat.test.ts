// Checks recurrence dates and journal behavior through the HTTP API.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nextOccurrence } from '../src/tasks/repeat.ts';
import { fixture, event } from './helpers.ts';
import type { JournalEvent } from '../src/contracts/validate.ts';
import { foldTasks, type Task } from '../src/tasks/fold.ts';

// A repeating task (owner, 2026-11-20): closing it makes the next one — the same title, roles, project, counterparty
// and checklist (unticked), the dates moved by the step. Names are made up.
const base: Task = { id: 't1', title: 'Обслуживание сервера', status: 'done', roles: { author: 'me', responsible: 'me', executors: ['me'], controller: null, watchers: [], counterparty: null, members: [] },
  project: 'p1', section: 's1', counterparty: 'c1', note: 'проверить бэкапы', items: [{ id: 'a', text: 'бэкап', done: true }],
  assignee: 'me', filed: false, messages: [], owner_titled: true, kind: 'task', offer: false, created_by: 'me', created_at: '2026-11-10T10:00:00Z', updated_at: '2026-11-20T10:00:00Z' };

test('the next one: the due date moves by the step; the checklist comes back unticked; nothing without a repeat', () => {
  const weekly = nextOccurrence({ ...base, due: '2026-11-20', repeat: { every: 'week', n: 1 } } as any, new Date('2026-11-20T15:00:00Z'))!;
  assert.equal(weekly.op, 'create');
  assert.equal(weekly.due, '2026-11-27');
  assert.deepEqual([weekly.title, weekly.project, weekly.section, weekly.counterparty, weekly.note, weekly.status], ['Обслуживание сервера', 'p1', 's1', 'c1', 'проверить бэкапы', 'todo']);
  assert.deepEqual((weekly.items_add as any[]).map((item) => item.text), ['бэкап']);
  assert.deepEqual(weekly.repeat, { every: 'week', n: 1 });
  const monthly = nextOccurrence({ ...base, due: '2026-01-31', repeat: { every: 'month', n: 1 } } as any, new Date('2026-01-31T10:00:00Z'))!;
  assert.equal(monthly.due, '2026-02-28', 'the end of a shorter month');
  const planned = nextOccurrence({ ...base, plan: { start: '2026-11-20T09:00:00.000Z', duration_min: 90 }, repeat: { every: 'day', n: 2 } } as any, new Date('2026-11-20T12:00:00Z'))!;
  assert.deepEqual(planned.plan, { start: '2026-11-22T09:00:00.000Z', duration_min: 90 });
  const undated = nextOccurrence({ ...base, due: 'unknown', repeat: { every: 'week', n: 1 } }, new Date('2026-11-20T15:00:00Z'))!;
  assert.equal(undated.due, '2026-11-27', 'without dates — a step from the day it was closed');
  assert.equal(nextOccurrence({ ...base, due: '2026-11-20' } as any, new Date()), null);
});

test('closing a repeating task through the API makes the next one once; a repeated close does not make another', async () => {
  const f = await fixture();
  const post = (body: unknown) => f.request('/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const originalId = 'aaaaaaaa-1111-4111-8111-111111111111';
  const change = (task: Record<string, unknown>, taskId = originalId) => event({ kind: 'task_change', payload: { ref: { type: 'task', id: taskId }, data: { task } } });
  try {
    assert.equal((await post(change({ op: 'create', title: 'Полив цветов', status: 'todo', due: '2026-11-20', repeat: { every: 'week', n: 1 } }))).status, 201);
    const close = change({ op: 'update', status: 'done' });
    assert.equal((await post(close)).status, 201);
    assert.equal((await post(close)).status, 200, 'a retry is idempotent');
    assert.equal((await post(change({ op: 'update', status: 'done' }))).status, 201, 'a second close can have a different event id');
    const { events } = await (await f.request('/api/events?limit=50')).json() as { events: JournalEvent[] };
    const creates = events.filter((item) => item.kind === 'task_change' && (item.payload.data!.task as any).op === 'create');
    assert.equal(creates.length, 2);
    const next = creates.find((item) => item.payload.ref!.id !== originalId)!;
    assert.deepEqual([(next.payload.data!.task as any).title, (next.payload.data!.task as any).due], ['Полив цветов', '2026-11-27']);
    const nextId = next.payload.ref!.id;
    const nextStatus = () => foldTasks(f.store.triage.taskEvents(nextId))[0]?.status;
    assert.equal((await post(change({ op: 'update', status: 'todo' }))).status, 201);
    assert.equal(nextStatus(), 'cancelled', 'undo hides a successor nobody has touched');
    assert.equal((await post(change({ op: 'update', status: 'done' }))).status, 201);
    assert.equal(nextStatus(), 'todo', 'closing again restores the same successor');
    assert.equal((await post(change({ op: 'update', note: 'Проверить влажность' }, nextId))).status, 201);
    assert.equal((await post(change({ op: 'update', status: 'todo' }))).status, 201);
    assert.equal(nextStatus(), 'todo', 'undo preserves a successor someone has changed');
  } finally { await f.stop(); }
});

test('a repeat must be a known step', async () => {
  const f = await fixture();
  const post = (body: unknown) => f.request('/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const bad = { ...event({ kind: 'task_change', payload: { ref: { type: 'task', id: 'bbbbbbbb-1111-4111-8111-111111111111' }, data: { task: { op: 'create', title: 'x', repeat: { every: 'hour', n: 1 } } } } }), source: 'app', author: 'me' };
    assert.equal((await post(bad)).status, 400);
  } finally { await f.stop(); }
});
