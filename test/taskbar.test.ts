import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { barActions, moreActions } from '../web/taskbar.js';

// One action bar for a task (task card design §3): the card's bottom, the long-press sheet. Tasks are made up.
const ids = (task: object, ctx: object) => barActions(task, ctx).map((action: any) => action.id);
const mine = { roles: { responsible: 'me', executors: ['me'] } };

test('an open task of mine: Готово, В работу, Когда, Поручить, Ответить, Ещё', () => {
  assert.deepEqual(ids({ status: 'todo', ...mine }, { mine: true, hasChat: true }), ['done', 'start', 'when', 'delegate', 'reply', 'more']);
  assert.deepEqual(barActions({ status: 'todo', ...mine }, { mine: true, hasChat: true }).map((action: any) => action.label),
    ['Готово', 'В работу', 'Когда', 'Поручить', 'Ответить', 'Ещё']);
});

test('in work → Пауза; no chat → no Ответить; not mine → no В работу', () => {
  assert.deepEqual(ids({ status: 'doing', ...mine }, { mine: true, hasChat: false }), ['done', 'pause', 'when', 'delegate', 'more']);
  assert.deepEqual(ids({ status: 'todo', roles: { responsible: 'me', executors: ['tg:1'] } }, { mine: false, hasChat: true }), ['done', 'when', 'delegate', 'reply', 'more']);
});

test('on review for me → Проверил; closed → Вернуть and Ответить only', () => {
  assert.deepEqual(ids({ status: 'review', roles: { controller: 'me', executors: ['tg:1'] } }, { mine: false, hasChat: false }).slice(0, 1), ['verify']);
  assert.deepEqual(ids({ status: 'done', ...mine }, { mine: true, hasChat: true }), ['reopen', 'reply']);
});

test('«Ещё»: Принять only for a new task; Жду, Отложить, Отменить', () => {
  assert.deepEqual(moreActions({ status: 'inbox' }).map((action: any) => action.id), ['accept', 'wait', 'defer', 'cancel']);
  assert.deepEqual(moreActions({ status: 'todo' }).map((action: any) => action.id), ['wait', 'defer', 'cancel']);
});
