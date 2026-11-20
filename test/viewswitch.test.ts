import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { counterFor } from '../web/viewswitch.js';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { likelyConversations, likelyTasks } from '../web/linkwindow.js';

// The view switch counter (CONCEPT.md §5) and the order of the link window (§2.9). Names are made up.
const task = (id: string, status = 'todo', extra: Record<string, unknown> = {}) => ({ id, status, filed: false, updatedAt: '2026-11-19T08:00:00', ...extra });
// `moment` — waiting in the queue since then (queue.js); null — out of the queue.
const conv = (key: string, moment: string | null, tasks: any[] = [], last = '2026-11-19T09:00:00') => ({ key, queue: { waiting: Boolean(moment), moment }, tasks, last, title: key, views: [] });
const list = [conv('tg:1', '2026-11-19T09:00:00', [task('a'), task('b', 'done')]), conv('tg:2', '2026-11-19T08:00:00', [task('a')]), conv('tel:+48', null, [task('c', 'todo', { filed: true })]), conv('me', null)];

test('on Беседы the switch counts tasks for today, inside a conversation its open tasks', () => {
  assert.deepEqual(counterFor({ mode: 'conversations', conversations: list, todayCount: 4 }), { target: 'tasks', count: 4, open: null });
  assert.deepEqual(counterFor({ mode: 'conversations', conversationKey: 'tg:1', conversations: list }), { target: 'tasks', count: 1, open: 'tg:1' });
  assert.equal(counterFor({ mode: 'conversations', conversationKey: 'tel:+48', conversations: list }).count, 0, 'filed tasks do not count');
});

test('on Задачи the switch counts conversations waiting for me: all, of an open task, of a filter', () => {
  assert.deepEqual(counterFor({ mode: 'tasks', conversations: list }), { target: 'conversations', count: 2, open: null });
  assert.deepEqual(counterFor({ mode: 'tasks', taskId: 'a', conversations: list }), { target: 'conversations', count: 2, open: 'tg:1' });
  assert.deepEqual(counterFor({ mode: 'tasks', taskId: 'c', conversations: list }), { target: 'conversations', count: 0, open: 'tel:+48' });
  assert.deepEqual(counterFor({ mode: 'feed', conversationKey: 'tel:+48', conversations: list }), { target: 'conversations', count: 0, open: 'tel:+48' });
});

test('the link window lists the open conversation first, then the queue from its oldest, without own notes', () => {
  const ordered = likelyConversations([conv('tg:9', null, [], '2026-11-19T11:00:00'), ...list], 'tel:+48').map((item: any) => item.key);
  assert.deepEqual(ordered, ['tel:+48', 'tg:2', 'tg:1', 'tg:9']);
});

test('the link window lists open tasks: the one in details, the conversation\'s, today\'s, then the latest', () => {
  const tasks = [task('old'), task('new', 'todo', { updatedAt: '2026-11-19T10:00:00' }), task('conv'), task('today'), task('open'), task('done', 'done'), task('filed', 'todo', { filed: true })];
  const ordered = likelyTasks(tasks, { openTask: 'open', conversationTasks: [task('conv')], today: [task('today')] }).map((item: any) => item.id);
  assert.deepEqual(ordered, ['open', 'conv', 'today', 'new', 'old']);
});
