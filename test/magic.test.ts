import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { magicItems } from '../web/magic.js';

// ✨ — requests to the AI from the tags row (design 2026-11-21); for now two acts work without AI, two are «скоро».
const task = { id: 't1', title: 'Роутер', status: 'todo' };
test('✨ offers create on an empty or unconfirmed topic, finish on a task; the AI items are «скоро»', () => {
  const pick = (topic: unknown) => magicItems({ topic }).map((item: any) => `${item.id}:${item.enabled}`);
  assert.deepEqual(pick({ state: 'empty', tasks: [] }), ['create:true', 'finish:false', 'again:false', 'suggest:false', 'translate:false']);
  assert.deepEqual(pick({ state: 'unconfirmed', tasks: [{ ...task, kind: 'topic', offer: true }] }), ['create:true', 'finish:false', 'again:false', 'suggest:false', 'translate:false']);
  assert.deepEqual(pick({ state: 'task', tasks: [task] }), ['create:false', 'finish:true', 'again:false', 'suggest:false', 'translate:false']);
  assert.deepEqual(pick(null), ['create:false', 'finish:false', 'again:false', 'suggest:false', 'translate:false'], 'outside a conversation or a task');
  assert.deepEqual(magicItems({ topic: null }).map((item: any) => item.title), ['Создать задачу', 'Завершить задачу', 'Разобрать заново', 'Подсказать ответ · скоро', 'Перевести · скоро']);
});

test('✨ «Разобрать заново» — only in an open conversation', () => {
  const again = (args: unknown) => magicItems(args).find((item: any) => item.id === 'again');
  assert.equal(again({ topic: { state: 'empty', tasks: [] }, conversation: true }).enabled, true);
  assert.equal(again({ topic: { state: 'task', tasks: [task] }, conversation: false }).enabled, false, 'not on a task card');
  assert.equal(again({ topic: null }).title, 'Разобрать заново');
});
