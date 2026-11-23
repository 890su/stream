import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { foldTasks as foldClient } from '../web/taskfold.js';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { isTopic, isTask, hasOffer } from '../web/topickind.js';
import { foldTasks as foldServer, isTopic as isTopicServer } from '../src/tasks/fold.ts';
import { validateEvent } from '../src/contracts/validate.ts';

// Topics (docs/plans/2026-11-23-topics-design.md): a topic is a task record with kind 'topic'; both folds agree.
// Texts are made up.
let n = 0;
const change = (task: string, data: Record<string, unknown>, author = 'system') => ({
  id: crypto.randomUUID(), schema_version: 1, source: author === 'me' ? 'app' : 'system', author,
  ts: `2026-11-23T10:00:${String(n++ % 60).padStart(2, '0')}Z`, kind: 'task_change', payload: { ref: { type: 'task', id: task }, data: { task: data } },
});
const folds = [['client', (events: unknown[]) => foldClient(events)], ['server', (events: unknown[]) => foldServer(events as never)]] as const;

for (const [side, fold] of folds) {
  test(`${side}: legacy unconfirmed reads as a topic with an offer`, () => {
    const [task] = fold([change('t', { op: 'create', title: 'Принтер', add: ['m1'], unconfirmed: true })]);
    assert.equal(task.kind, 'topic');
    assert.equal(task.offer, true);
  });

  test(`${side}: an owner add to an explicit topic keeps it a topic`, () => {
    const [task] = fold([change('t', { op: 'create', title: 'Принтер', kind: 'topic', add: ['m1'] }, 'me'), change('t', { op: 'update', add: ['m2'] }, 'me')]);
    assert.equal(task.kind, 'topic');
    assert.deepEqual(task.messages, ['m1', 'm2']);
  });

  test(`${side}: kind task and back keeps due and items`, () => {
    const [task] = fold([
      change('t', { op: 'create', title: 'Выезд', due: '2026-11-29', items_add: [{ id: 'i1', text: 'кабель' }] }, 'me'),
      change('t', { op: 'update', kind: 'topic' }, 'me'),
      change('t', { op: 'update', kind: 'task' }, 'me'),
    ]);
    assert.equal(task.kind, 'task');
    assert.equal(task.due, '2026-11-29');
    assert.deepEqual(task.items.map((item: { text: string }) => item.text), ['кабель']);
  });

  test(`${side}: offer false keeps the topic open`, () => {
    const [task] = fold([change('t', { op: 'create', title: 'Счёт', kind: 'topic', offer: true }), change('t', { op: 'update', offer: false }, 'me')]);
    assert.equal(task.kind, 'topic');
    assert.equal(task.offer, false);
    assert.equal(task.status, 'todo');
  });

  test(`${side}: an owner change still confirms a legacy unconfirmed task`, () => {
    const [task] = fold([change('t', { op: 'create', title: 'Счёт', unconfirmed: true }), change('t', { op: 'update', due: '2026-11-30' }, 'me')]);
    assert.equal(task.kind, 'task');
    assert.equal(task.offer, false);
  });

  test(`${side}: no kind anywhere is a task`, () => {
    const [task] = fold([change('t', { op: 'create', title: 'Дело' }, 'me')]);
    assert.equal(task.kind, 'task');
    assert.equal(task.offer, false);
  });
}

test('isTopic, isTask, hasOffer', () => {
  assert.equal(isTopic({ kind: 'topic' }), true);
  assert.equal(isTask({ kind: 'topic' }), false);
  assert.equal(isTask({}), true, 'no kind is a task');
  assert.equal(hasOffer({ kind: 'topic', offer: true, status: 'todo' }), true);
  assert.equal(hasOffer({ kind: 'topic', offer: true, status: 'cancelled' }), false);
  assert.equal(hasOffer({ kind: 'task', offer: true, status: 'todo' }), false);
  assert.equal(isTopicServer({ kind: 'topic' } as never), true);
});

test('the contract accepts kind and offer on a task change', () => {
  assert.doesNotThrow(() => validateEvent(change('00000000-0000-4000-8000-000000000001', { op: 'create', title: 'Тема', kind: 'topic', offer: true })));
  assert.throws(() => validateEvent(change('00000000-0000-4000-8000-000000000001', { op: 'create', title: 'Тема', kind: 'idea' })));
});
