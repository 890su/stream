import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { topicOf, cutSegments } from '../web/topic.js';

// A conversation's topic and the cuts of its messages by task (design 2026-11-21). Texts and ids are made up.
const view = (id: string, taskIds: string[] = []) => ({ id, taskIds, event: { ts: `2026-11-21T10:0${id.slice(1)}:00Z` } });
const task = (id: string, title: string, extra: Record<string, unknown> = {}) => ({ id, title, status: 'todo', filed: false, messages: [], updatedAt: '2026-11-21T09:00:00Z', ...extra });
const tasksById = new Map([
  ['a', task('a', 'Роутер')],
  ['b', task('b', 'Счёт')],
  ['n', task('n', 'Дневник', { filed: true })],
  ['u', task('u', 'От ИИ', { unconfirmed: true })],
]);
const shape = (segments: any[]) => segments.map((item) => (item.kind === 'open' ? `open:${item.views.map((v: any) => v.id).join(',')}` : `cut:${item.taskId}:${item.title}:${item.views.map((v: any) => v.id).join(',')}:${item.open ? 'open' : 'shut'}`));
const views = [view('m1'), view('m2', ['a']), view('m3', ['a']), view('m4', ['n']), view('m5', ['b']), view('m6', ['u']), view('m7', ['a', 'b'])];

test('conversation mode: task runs fold, loose, filed and unconfirmed messages stay open', () => {
  assert.deepEqual(shape(cutSegments(views, { tasksById })), [
    'open:m1', 'cut:a:Роутер:m2,m3:shut', 'open:m4', 'cut:b:Счёт:m5:shut', 'open:m6', 'cut:a:Роутер:m7:shut',
  ]);
});

test('task mode: the focus task open, others fold, a message shared with it is open', () => {
  assert.deepEqual(shape(cutSegments(views, { tasksById, focus: 'b' })), [
    'cut:null:Без задачи:m1:shut', 'cut:a:Роутер:m2,m3:shut', 'cut:null:Без задачи:m4:shut', 'open:m5', 'cut:null:Без задачи:m6:shut', 'open:m7',
  ]);
});

test('opened cuts and «all» unfold; the run stays one segment', () => {
  const segments = cutSegments(views, { tasksById });
  const key = segments.find((item: any) => item.kind === 'cut').key;
  assert.equal(shape(cutSegments(views, { tasksById, open: new Set([key]) }))[1], 'cut:a:Роутер:m2,m3:open');
  assert.ok(shape(cutSegments(views, { tasksById, all: true })).filter((line) => line.startsWith('cut:')).every((line) => line.endsWith(':open')));
});

test('topic state: empty, unconfirmed, task; real tasks first, the urgent one leading', () => {
  const now = new Date('2026-11-21T12:00:00');
  assert.deepEqual(topicOf({ tasks: [] }, now), { state: 'empty', tasks: [] });
  assert.equal(topicOf({ tasks: [task('u', 'От ИИ', { unconfirmed: true })] }, now).state, 'unconfirmed');
  const mixed = topicOf({ tasks: [task('u', 'От ИИ', { unconfirmed: true }), task('later', 'Потом'), task('due', 'Сегодня', { due: '2026-11-21' }), task('gone', 'Закрыта', { status: 'done' }), task('note', 'Заметка', { filed: true })] }, now);
  assert.equal(mixed.state, 'task');
  assert.deepEqual(mixed.tasks.map((item: any) => item.id), ['due', 'later', 'u']);
});
