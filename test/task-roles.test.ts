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
    assert.equal((await post(change({ op: 'update', roles: { members: ['tg:8', 'name:Марек'] }, muted: ['tg:8'] }))).status, 201, 'plain participants, a switched-off one');
    assert.equal((await post(change({ op: 'update', roles: { members: 'tg:8' } }))).status, 400, 'members is a list');
    assert.equal((await post(change({ op: 'update', muted: ['boss'] }))).status, 400, 'muted holds parties');
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

test('server fold: an old task handed to someone is under my control; the first roles change keeps the old roles', async () => {
  const { foldTasks } = await import('../src/tasks/fold.ts');
  const at = (ts: string, data: Record<string, unknown>, author = 'system') => ({ ...change(data), ts, author });
  const one = (data: Record<string, unknown>) => foldTasks([at('2026-11-18T08:00:00Z', { op: 'create', title: 'A', ...data }) as any])[0]!;
  assert.equal(one({ assignee: 'person', person: 'Марек' }).roles.controller, 'me');
  assert.equal(one({ assignee: 'ai' }).roles.controller, 'me');
  assert.equal(one({ assignee: 'system' }).roles.controller, 'me');
  assert.equal(one({ assignee: 'me' }).roles.controller, null);
  assert.equal(one({ assignee: 'person' }).roles.controller, null, 'nobody named: mine to sort out');
  const accepted = foldTasks([
    at('2026-11-18T08:00:00Z', { op: 'create', title: 'Разобрать', status: 'inbox', assignee: 'me' }),
    at('2026-11-18T09:00:00Z', { op: 'update', status: 'todo', roles: { executors: ['me'] } }, 'me'),
  ] as any)[0]!;
  assert.equal(accepted.roles.responsible, 'me');
  assert.deepEqual(accepted.roles.executors, ['me']);
  assert.equal(accepted.roles.author, 'system', 'the author is kept');
});

test('parties: a name starts with a non-space; a party is at most 120 characters', () => {
  assert.ok(!isParty('name: Паша') && !isParty('name:\tПаша'));
  assert.ok(isParty(`name:${'я'.repeat(115)}`));
  assert.ok(!isParty(`name:${'я'.repeat(116)}`));
});

test('the event contract refuses a name party with a leading space or over 120 characters', async () => {
  const f = await fixture();
  const post = (body: unknown) => f.request('/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const task = randomUUID();
    const make = (roles: Record<string, unknown>) => ({ ...change({ op: 'create', title: 'Б', roles }), payload: { ref: { type: 'task', id: task }, data: { task: { op: 'create', title: 'Б', roles } } } });
    assert.equal((await post(make({ executors: ['name: Паша'] }))).status, 400);
    assert.equal((await post(make({ executors: [`name:${'я'.repeat(116)}`] }))).status, 400);
    assert.equal((await post(make({ author: 'me', responsible: 'me', executors: ['me'] }))).status, 201);
  } finally { await f.stop(); }
});

test('server partyOfEvent: incoming calls and SMS are the caller, not me', async () => {
  const { partyOfEvent } = await import('../src/tasks/parties.ts');
  const phone = (kind: string, direction: string, number?: string, name?: string) => ({ author: 'me', source: 'android_phone', kind, payload: { data: { [kind]: { direction, ...(number ? { number } : {}), ...(name ? { name } : {}) } } } }) as any;
  assert.equal(partyOfEvent(phone('sms', 'in', '+48 600 100 200')), 'tel:+48600100200');
  assert.equal(partyOfEvent(phone('call', 'missed', '0048 600 100 200')), 'tel:+48600100200');
  assert.equal(partyOfEvent(phone('call', 'rejected', '600100200')), 'name:600100200');
  assert.equal(partyOfEvent(phone('call', 'out', '+48600100200')), 'me');
  assert.equal(partyOfEvent(phone('sms', 'out', '+48600100200')), 'me');
  assert.equal(partyOfEvent({ author: 'contact:tg:by:42', kind: 'text', payload: {} } as any), 'tg:42');
});

test('a task the owner makes from a message carries his roles and passes the contract', async () => {
  // @ts-expect-error Browser modules are deliberately buildless JavaScript.
  const { makeTaskChange, ownTask } = await import('../web/shared.js');
  const created = ownTask('Позвонить поставщику', randomUUID());
  assert.deepEqual(created.roles, { author: 'me', responsible: 'me', executors: ['me'] });
  assert.equal('assignee' in created, false);
  const f = await fixture();
  try {
    const response = await f.request('/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(makeTaskChange(randomUUID(), created).event) });
    assert.equal(response.status, 201, await response.clone().text());
  } finally { await f.stop(); }
});

test('a checklist change is accepted; a multi-line item or a bad id is refused', async () => {
  const f = await fixture();
  const post = (body: unknown) => f.request('/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    assert.equal((await post(change({ op: 'create', title: 'Клиент А: настройка', items_add: [{ id: 'i-1', text: 'установить программу' }] }))).status, 201);
    assert.equal((await post(change({ op: 'update', items_set: [{ id: 'i-1', done: true }], items_remove: ['i-2'] }))).status, 201);
    assert.equal((await post(change({ op: 'update', items_add: [{ id: 'i-3', text: 'две\nстроки' }] }))).status, 400);
    assert.equal((await post(change({ op: 'update', items_add: [{ id: 'I 3', text: 'x' }] }))).status, 400);
    assert.equal((await post(change({ op: 'update', items_set: [{ id: 'i-1', done: 'yes' }] }))).status, 400);
  } finally { await f.stop(); }
});
