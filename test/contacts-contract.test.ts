import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { validateEvent } from '../src/contracts/validate.ts';
import { temporaryStore, event } from './helpers.ts';

// People and counterparties in the journal (contacts design §3). Names and numbers are made up.
const contact = (data: Record<string, unknown>, ref = { type: 'person', id: randomUUID() }) =>
  event({ kind: 'contact_change', payload: { ref, data: { contact: data } } });
const counterparty = (data: Record<string, unknown>, ref = { type: 'counterparty', id: randomUUID() }) =>
  event({ kind: 'counterparty_change', payload: { ref, data: { counterparty: data } } });
const taskChange = (data: Record<string, unknown>) => event({ kind: 'task_change', payload: { ref: { type: 'task', id: randomUUID() }, data: { task: data } } });

test('a person and a counterparty are journal events; a task names its counterparty', () => {
  const org = randomUUID();
  validateEvent(contact({ op: 'create', name: 'Анна Тестова', phones: ['+48 600 300 400'], telegram: ['501'], roles: [{ counterparty: org, title: 'бухгалтер' }] }));
  validateEvent(contact({ op: 'update', status: 'deleted' }));
  validateEvent(counterparty({ op: 'create', kind: 'org', title: 'ООО Пример', side: 'pl', tax_id: '1234567890' }));
  validateEvent(counterparty({ op: 'create', kind: 'address', title: 'ул. Пробная 1', address: 'ул. Пробная 1, Варшава', side: null }));
  validateEvent(taskChange({ op: 'update', counterparty: org, counterparty_options: [org], counterparty_hint: 'ООО Пример' }));
  validateEvent(taskChange({ op: 'update', counterparty: null, counterparty_hint: null }));
  for (const invalid of [
    counterparty({ op: 'create', kind: 'firm', title: 'ООО' }),
    contact({ op: 'create', name: 'Анна', roles: [{ counterparty: 'x', title: 'бухгалтер' }] }),
    taskChange({ op: 'update', counterparty: 'x' }),
    contact({ op: 'create', name: ' пробел' }),
  ]) assert.throws(() => validateEvent(invalid), /400/);
});

test('the store pairs kinds and refs and wants a name for something new', () => {
  const storage = temporaryStore();
  try {
    const add = (item: ReturnType<typeof event>) => storage.store.appendEvent(item);
    add(contact({ op: 'create', name: 'Анна Тестова' }));
    add(counterparty({ op: 'create', kind: 'org', title: 'ООО Пример' }));
    assert.throws(() => add(contact({ op: 'create', phones: ['+48 600 300 400'] })), /400/);
    assert.throws(() => add(counterparty({ op: 'create', kind: 'org' })), /400/);
    assert.throws(() => add(contact({ op: 'create', name: 'Анна' }, { type: 'task', id: randomUUID() })), /400/);
    assert.throws(() => add(event({ kind: 'task_change', payload: { ref: { type: 'task', id: randomUUID() }, data: { contact: { op: 'create', name: 'Анна' }, task: { op: 'update' } } } })), /400/);
  } finally { storage.cleanup(); }
});

test('directory events are not messages: no bubble, no conversation', async () => {
  // @ts-expect-error Browser modules are deliberately buildless JavaScript.
  const { project } = await import('../web/projection.js');
  // @ts-expect-error Browser modules are deliberately buildless JavaScript.
  const { conversationOf } = await import('../web/conversations.js');
  const events = [contact({ op: 'create', name: 'Анна Тестова' }), counterparty({ op: 'create', kind: 'org', title: 'ООО Пример' })];
  assert.deepEqual(project(events), []);
  assert.deepEqual(events.map(conversationOf), [null, null]);
});

test('/api/directory gives every person, counterparty and project event, whatever the feed page', async () => {
  const { fixture } = await import('./helpers.ts');
  const f = await fixture();
  try {
    const post = (body: unknown) => f.request('/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await post(contact({ op: 'create', name: 'Анна Тестова' }))).status, 201);
    assert.equal((await post(counterparty({ op: 'create', kind: 'org', title: 'ООО Пример' }))).status, 201);
    assert.equal((await post(event({ payload: { text: 'просто сообщение' } }))).status, 201);
    const body = await (await f.request('/api/directory')).json();
    assert.deepEqual(body.events.map((item: any) => item.kind).sort(), ['contact_change', 'counterparty_change']);
  } finally { await f.stop(); }
});
