import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { moveChanges, undoChanges, filterGroups } from '../web/topicpicker.js';

// Moving selected messages to another topic (topics design 2026-11-23). Titles are made up.
const record = (id: string, messages: string[], extra: Record<string, unknown> = {}) => ({ id, title: id, kind: 'topic', status: 'todo', messages, ...extra });
const tasksById = new Map([
  ['принтер', record('принтер', ['m1', 'm2', 'm3'])],
  ['счёт', record('счёт', ['m1'])],
  ['выезд', record('выезд', ['m2'], { kind: 'task' })],
  ['цель', record('цель', ['m9'])],
]);
const views = [{ id: 'm1', taskIds: ['принтер', 'счёт'] }, { id: 'm2', taskIds: ['принтер', 'выезд'] }];

test('add puts the messages into the target and leaves them where they were', () => {
  assert.deepEqual(moveChanges(views, 'цель', 'add', tasksById), [{ id: 'цель', change: { op: 'update', add: ['m1', 'm2'] } }]);
});

test('move takes the messages out of every other record', () => {
  const changes = moveChanges(views, 'цель', 'move', tasksById);
  assert.deepEqual(changes[0], { id: 'цель', change: { op: 'update', add: ['m1', 'm2'] } });
  assert.deepEqual(changes.slice(1), [
    { id: 'принтер', change: { op: 'update', remove: ['m1', 'm2'] } },
    { id: 'счёт', change: { op: 'update', remove: ['m1'], status: 'cancelled', reason: 'Убрана из бесед' } },
    { id: 'выезд', change: { op: 'update', remove: ['m2'] } },
  ], 'an emptied topic is closed, an emptied task is not');
});

test('messages already in the target are not added again; it is not removed from itself', () => {
  assert.deepEqual(moveChanges(views, 'принтер', 'move', tasksById), [
    { id: 'счёт', change: { op: 'update', remove: ['m1'], status: 'cancelled', reason: 'Убрана из бесед' } },
    { id: 'выезд', change: { op: 'update', remove: ['m2'] } },
  ]);
});

test('«Вернуть» reverses each change', () => {
  assert.deepEqual(undoChanges(moveChanges(views, 'цель', 'move', tasksById), tasksById), [
    { id: 'цель', change: { op: 'update', remove: ['m1', 'm2'] } },
    { id: 'принтер', change: { op: 'update', add: ['m1', 'm2'] } },
    { id: 'счёт', change: { op: 'update', add: ['m1'], status: 'todo' } },
    { id: 'выезд', change: { op: 'update', add: ['m2'] } },
  ]);
});

test('the search keeps titles that contain the words', () => {
  const groups = { here: [record('Принтер Canon', [])], other: [record('Счёт за ноябрь', [])], tasks: [record('Выезд: принтер', [], { kind: 'task' })] };
  const found = filterGroups(groups, 'принтер');
  assert.deepEqual([found.here.length, found.other.length, found.tasks.length], [1, 0, 1]);
  assert.deepEqual(filterGroups(groups, ''), groups);
});
