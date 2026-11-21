import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { backTarget } from '../web/viewswitch.js';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { likelyConversations, likelyTasks } from '../web/linkwindow.js';

// The system back of the centre (design 2026-11-21) and the order of the link window (§2.9). Names are made up.
const task = (id: string, status = 'todo', extra: Record<string, unknown> = {}) => ({ id, status, filed: false, updatedAt: '2026-11-19T08:00:00', ...extra });
// `moment` — waiting in the queue since then (queue.js); null — out of the queue.
const conv = (key: string, moment: string | null, tasks: any[] = [], last = '2026-11-19T09:00:00') => ({ key, queue: { waiting: Boolean(moment), moment }, tasks, last, title: key, views: [] });
const list = [conv('tg:1', '2026-11-19T09:00:00', [task('a'), task('b', 'done')]), conv('tg:2', '2026-11-19T08:00:00', [task('a')]), conv('tel:+48', null, [task('c', 'todo', { filed: true })]), conv('me', null)];

test('back lands on the dashboard from a list, a conversation or the Лента; on the view under a conversation', () => {
  assert.equal(backTarget('tasks', null), 'home');
  assert.equal(backTarget('conversations', null), 'home');
  assert.equal(backTarget('feed', { overlay: 1, page: 'x' }), 'home');
  assert.equal(backTarget('conversations', { view: 'tasks' }), 'tasks', 'a conversation opened over a list goes back to it');
  assert.equal(backTarget('home', null), null, 'the dashboard is the root: the system leaves the app');
  assert.equal(backTarget('tasks', { view: 'tasks' }), null, 'landed on the view\'s own entry: a panel above it closed');
  assert.equal(backTarget('tasks', { drawer: true }), null);
  assert.equal(backTarget('home', { conversation: true }), null);
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


test('favourites in the left panel: pinned chats, opened as their conversations', async () => {
  // @ts-expect-error Browser modules are deliberately buildless JavaScript.
  const { favourites } = await import('../web/favourites.js');
  const items = [{ key: 'by:501', title: 'Анна', pinned: true, item: { chat_id: '501' } }, { key: 'pl:7', title: 'Борис', pinned: false, item: { chat_id: '7' } }];
  assert.deepEqual(favourites(items), [{ key: 'tg:501', title: 'Анна' }]);
});

test('home takes the view\'s or the conversation\'s history entry away instead of leaving a dead one', async () => {
  // @ts-expect-error Browser modules are deliberately buildless JavaScript.
  const { toHome } = await import('../web/viewswitch.js');
  assert.equal(toHome({ view: 'tasks' }), 'back', 'Задачи → home pops the entry Задачи pushed');
  assert.equal(toHome({ conversation: true }), 'back');
  assert.equal(toHome(null), 'stay');
  assert.equal(toHome({ drawer: true }), 'stay');
});

test('drawer search finds conversations outside the queue and shows nothing without a query', async () => {
  // @ts-expect-error Browser modules are deliberately buildless JavaScript.
  const { searchConversations } = await import('../web/favourites.js');
  const list = [
    { ...conv('tg:1', null, [], '2026-11-19T08:00:00'), title: 'Олег Пример' },
    { ...conv('tel:+48500000002', null, [], '2026-11-19T10:00:00'), title: 'Олег Тест', archived: true },
    { ...conv('task:x', null), title: 'Олег из заметки' },
  ];
  assert.deepEqual(searchConversations(list, '  ОЛЕГ ').map((item: any) => item.key), ['tel:+48500000002', 'tg:1']);
  assert.deepEqual(searchConversations(list, '+48 (500)').map((item: any) => item.key), ['tel:+48500000002']);
  assert.deepEqual(searchConversations(list, '  '), []);
});

test('back from a task card stays where the card was opened: its entry is the card\'s own', async () => {
  // @ts-expect-error Browser modules are deliberately buildless JavaScript.
  const { backTarget } = await import('../web/viewswitch.js');
  assert.equal(backTarget('tasks', { task: true }), null);
});
