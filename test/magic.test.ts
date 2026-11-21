import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { magicItems } from '../web/magic.js';

// ✨ — requests to the AI from the tags row (design 2026-11-21); for now two acts work without AI, two are «скоро».
const task = { id: 't1', title: 'Роутер', status: 'todo' };
test('✨ offers create on an empty or unconfirmed topic, finish on a task; the AI items are «скоро»', () => {
  const pick = (topic: unknown) => magicItems({ topic }).map((item: any) => `${item.id}:${item.enabled}`);
  assert.deepEqual(pick({ state: 'empty', tasks: [] }), ['create:true', 'finish:false', 'suggest:false', 'translate:false']);
  assert.deepEqual(pick({ state: 'unconfirmed', tasks: [{ ...task, unconfirmed: true }] }), ['create:true', 'finish:false', 'suggest:false', 'translate:false']);
  assert.deepEqual(pick({ state: 'task', tasks: [task] }), ['create:false', 'finish:true', 'suggest:false', 'translate:false']);
  assert.deepEqual(pick(null), ['create:false', 'finish:false', 'suggest:false', 'translate:false'], 'outside a conversation or a task');
  assert.deepEqual(magicItems({ topic: null }).map((item: any) => item.title), ['Создать задачу', 'Завершить задачу', 'Подсказать ответ · скоро', 'Перевести · скоро']);
});
