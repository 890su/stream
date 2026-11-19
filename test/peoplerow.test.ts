import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { conversationTask, chatParties } from '../web/peoplerow.js';

// A conversation and its task have one set of participants (owner's design, 2026-11-19). Data is made up.
const task = (id: string, data: Record<string, unknown> = {}) => ({ id, status: 'todo', filed: false, updatedAt: '2026-11-19T10:00:00Z', ...data });

test('the task of a conversation: the one it is named after, else the latest changed open one', () => {
  assert.equal(conversationTask({ key: 'task:b', tasks: [task('a'), task('b', { status: 'done' })] }).id, 'b');
  const tasks = [task('old'), task('new', { updatedAt: '2026-11-19T12:00:00Z' }), task('closed', { status: 'done', updatedAt: '2026-11-19T13:00:00Z' }), task('note', { filed: true, updatedAt: '2026-11-19T14:00:00Z' })];
  assert.equal(conversationTask({ key: 'by|501', tasks }).id, 'new');
  assert.equal(conversationTask({ key: 'by|501', tasks: [task('x', { status: 'cancelled' })] }), null, 'no open task — none');
  assert.equal(conversationTask(null), null);
});

test('without a task the line shows me and every other author once', () => {
  const view = (author: string, deleted = false) => ({ deleted, event: { author, kind: 'text', payload: { text: 'привет' } } });
  assert.deepEqual(chatParties({ views: [view('contact:tg:by:501'), view('me'), view('contact:tg:pl:501'), view('contact:tg:by:7', true)] }), ['me', 'tg:501']);
});
