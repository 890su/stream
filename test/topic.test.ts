import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { topicOf } from '../web/topic.js';

// A conversation's tasks for its head (design 2026-11-21). Texts and ids are made up.
const task = (id: string, title: string, extra: Record<string, unknown> = {}) => ({ id, title, status: 'todo', filed: false, messages: [], updatedAt: '2026-11-21T09:00:00Z', ...extra });

test('topic state: empty, unconfirmed, task; real tasks first, the urgent one leading', () => {
  const now = new Date('2026-11-21T12:00:00');
  assert.deepEqual(topicOf({ tasks: [] }, now), { state: 'empty', tasks: [] });
  assert.equal(topicOf({ tasks: [task('u', 'От ИИ', { unconfirmed: true })] }, now).state, 'unconfirmed');
  const mixed = topicOf({ tasks: [task('u', 'От ИИ', { unconfirmed: true }), task('later', 'Потом'), task('due', 'Сегодня', { due: '2026-11-21' }), task('gone', 'Закрыта', { status: 'done' }), task('note', 'Заметка', { filed: true })] }, now);
  assert.equal(mixed.state, 'task');
  assert.deepEqual(mixed.tasks.map((item: any) => item.id), ['due', 'later', 'u']);
});

test('why the AI made a task: the reason of its first change, else its note', async () => {
  // @ts-expect-error Browser modules are deliberately buildless JavaScript.
  const { reasonOf } = await import('../web/cardhead.js');
  assert.equal(reasonOf({ history: [{ change: { op: 'create' } }, { change: { reason: 'тот же сайт' } }], note: 'заметка' }), 'тот же сайт');
  assert.equal(reasonOf({ history: [], note: 'заметка' }), 'заметка');
  assert.equal(reasonOf({}), '');
});

