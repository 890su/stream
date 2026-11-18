import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { fixture } from './helpers.ts';
import { isParty, partyOf } from '../src/tasks/parties.ts';

const change = (data: Record<string, unknown>) => ({
  id: randomUUID(), schema_version: 1, source: 'app', author: 'me', ts: new Date().toISOString(), kind: 'task_change',
  payload: { ref: { type: 'task', id: '7c1f6a52-3c55-4a0b-9e0a-6a1f2b3c4d5e' }, data: { task: data } },
});

test('parties: authors become parties, one Telegram user across accounts', () => {
  assert.equal(partyOf('me'), 'me');
  assert.equal(partyOf('contact:tg:by:4242'), 'tg:4242');
  assert.equal(partyOf('contact:tg:pl:4242'), 'tg:4242');
  assert.equal(partyOf('Марек'), 'name:Марек');
  assert.ok(isParty('tel:+48500100200') && isParty('group:tg:-1001') && isParty('name:Марек') && isParty('ai') && isParty('system'));
  assert.ok(!isParty('tg:') && !isParty('boss') && !isParty('') && !isParty('name:') && !isParty(5));
});

test('a task change with roles is accepted; a wrong party or role is refused', async () => {
  const f = await fixture();
  const post = (body: unknown) => f.request('/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const since = new Date().toISOString();
    const first = await post(change({
      op: 'create', title: 'Проверить роутер', status: 'review',
      roles: { responsible: 'me', executors: ['tg:4242'], controller: 'me', counterparty: null },
      waiting_for: { party: 'tg:4242', since }, plan: { start: since, duration_min: 30 }, remind_at: since,
      promise: { by: 'tg:4242', due: '2026-11-20', message: randomUUID() }, filed: false,
    }));
    assert.equal(first.status, 201, await first.clone().text());
    assert.equal((await post(change({ op: 'update', status: 'deferred', waiting_for: null, plan: null, promise: null }))).status, 201);
    assert.equal((await post(change({ op: 'update', roles: { executors: ['boss'] } }))).status, 400, 'wrong party');
    assert.equal((await post(change({ op: 'update', roles: { judge: 'me' } }))).status, 400, 'unknown role');
    assert.equal((await post(change({ op: 'update', roles: { controller: ['me'] } }))).status, 400, 'controller is one party');
    assert.equal((await post(change({ op: 'update', status: 'paused' }))).status, 400, 'unknown status');
    assert.equal((await post(change({ op: 'update', waiting_for: { party: 'boss', since } }))).status, 400, 'waiting_for party');
    assert.equal((await post(change({ op: 'update', promise: { by: 'x', due: '2026-11-20', message: randomUUID() } }))).status, 400, 'promise party');
  } finally { await f.stop(); }
});

test('server fold: roles from old fields, merge by key, derived assignee, filed templates', async () => {
  const { foldTasks, isOpen } = await import('../src/tasks/fold.ts');
  const at = (ts: string, data: Record<string, unknown>, author = 'me') => ({ ...change(data), ts, author });
  const old = foldTasks([at('2026-11-18T08:00:00Z', { op: 'create', title: 'A', assignee: 'person', person: 'Марек' }) as any])[0]!;
  assert.deepEqual(old.roles.executors, ['name:Марек']);
  assert.equal(old.roles.responsible, 'me');
  assert.equal(old.roles.author, 'me');
  const task = foldTasks([
    at('2026-11-18T08:00:00Z', { op: 'create', title: 'B', template: 'diary', roles: { responsible: 'me' }, remind_at: '2026-11-19T07:00:00Z', status: 'review' }),
    at('2026-11-18T09:00:00Z', { op: 'update', roles: { executors: ['tg:4242'], controller: 'me' } }),
    at('2026-11-18T10:00:00Z', { op: 'update', roles: { controller: null } }),
  ] as any, { filedTemplates: ['diary'] })[0]!;
  assert.deepEqual(task.roles.executors, ['tg:4242']);
  assert.equal(task.roles.controller, null);
  assert.equal(task.assignee, 'person');
  assert.equal(task.filed, true);
  assert.equal(task.remind_at, '2026-11-19T07:00:00Z');
  assert.ok(isOpen(task));
});
