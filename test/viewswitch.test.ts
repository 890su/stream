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

test('the switch is an icon: ☑ leads to Задачи, 💬 to Беседы', async () => {
  // @ts-expect-error Browser modules are deliberately buildless JavaScript.
  const { switchIcon } = await import('../web/viewswitch.js');
  assert.deepEqual([switchIcon('tasks'), switchIcon('conversations')], ['☑', '💬']);
});

test('the system back leads to the queue: from Задачи or Лента with nothing open on top; never past it', async () => {
  // @ts-expect-error Browser modules are deliberately buildless JavaScript.
  const { rootBack } = await import('../web/viewswitch.js');
  assert.equal(rootBack('tasks', null), 'conversations');
  assert.equal(rootBack('feed', { overlay: 1, page: 'x' }), 'conversations');
  assert.equal(rootBack('tasks', { view: 'tasks' }), null, 'landed on the view\'s own entry: a panel above it closed');
  assert.equal(rootBack('tasks', { drawer: true }), null);
  assert.equal(rootBack('conversations', null), null, 'the queue is the root: the system leaves the app');
});

test('favourites in the left panel: pinned chats, opened as their conversations', async () => {
  // @ts-expect-error Browser modules are deliberately buildless JavaScript.
  const { favourites } = await import('../web/favourites.js');
  const items = [{ key: 'by:501', title: 'Анна', pinned: true, item: { chat_id: '501' } }, { key: 'pl:7', title: 'Борис', pinned: false, item: { chat_id: '7' } }];
  assert.deepEqual(favourites(items), [{ key: 'tg:501', title: 'Анна' }]);
});

test('back to the queue takes the view\'s history entry away instead of leaving a dead one', async () => {
  // @ts-expect-error Browser modules are deliberately buildless JavaScript.
  const { toQueue } = await import('../web/viewswitch.js');
  assert.equal(toQueue({ view: 'tasks' }), 'back', 'Задачи → the queue pops the entry Задачи pushed');
  assert.equal(toQueue(null), 'stay');
  assert.equal(toQueue({ drawer: true }), 'stay');
});

test('«Недавние» in the left panel: every conversation with someone, latest first, also archived and snoozed ones', async () => {
  // @ts-expect-error Browser modules are deliberately buildless JavaScript.
  const { recent } = await import('../web/favourites.js');
  const list = [conv('tg:1', null, [], '2026-11-19T08:00:00'), conv('me', null, [], '2026-11-19T12:00:00'), conv('task:x', null, [], '2026-11-19T12:00:00'),
    { ...conv('tel:+48', null, [], '2026-11-19T10:00:00'), archived: true }, conv('wa:9@lid', '2026-11-19T09:00:00', [], '2026-11-19T09:00:00')];
  assert.deepEqual(recent(list, 3).map((item: any) => item.key), ['tel:+48', 'wa:9@lid', 'tg:1']);
  assert.equal(recent(list, 2).length, 2);
});

test('back from a task card stays where the card was opened: its entry is the card\'s own', async () => {
  // @ts-expect-error Browser modules are deliberately buildless JavaScript.
  const { rootBack } = await import('../web/viewswitch.js');
  assert.equal(rootBack('tasks', { task: true }), null);
});
