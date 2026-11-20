import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { pickTask, sourceOf, anchorOf } from '../web/convquick.js';

// Swipes on a conversation row (CONCEPT.md §5): which task opens, which message «Отвечено» and a new task use.
const now = new Date('2026-11-19T12:00:00');
const view = (id: string, author: string, ts: string, extra: Record<string, unknown> = {}) => ({ id, deleted: false, event: { id, author, ts, kind: 'text', source: author === 'me' ? 'app' : 'telegram', payload: {} }, ...extra });
const task = (id: string, status: string, extra: Record<string, unknown> = {}) => ({ id, status, filed: false, updatedAt: '2026-11-19T08:00:00', roles: { responsible: 'me', executors: [] }, ...extra });

test('a swipe opens the most urgent open task: overdue, today, a decision, then the latest change', () => {
  const conversation = { views: [], tasks: [task('a', 'todo', { updatedAt: '2026-11-19T11:00:00' }), task('b', 'inbox'), task('c', 'todo', { due: '2026-11-18' }), task('d', 'done'), task('e', 'todo', { filed: true, due: '2026-11-10' })] };
  assert.equal(pickTask(conversation, now).id, 'c');
  assert.equal(pickTask({ views: [], tasks: [task('a', 'todo', { updatedAt: '2026-11-19T11:00:00' }), task('b', 'inbox')] }, now).id, 'b');
  assert.equal(pickTask({ views: [], tasks: [task('d', 'done')] }, now), null);
});

test('«Отвечено» goes on the latest message; a new task starts from the latest incoming one', () => {
  const views = [view('m1', 'contact:tg:by:5', '2026-11-19T09:00:00'), view('m2', 'me', '2026-11-19T09:05:00'), view('m3', 'contact:tg:by:5', '2026-11-19T09:10:00', { deleted: true })];
  assert.equal(anchorOf({ views }).id, 'm2');
  assert.equal(sourceOf({ views }).id, 'm1');
  assert.equal(sourceOf({ views: [views[1]] }).id, 'm2');
});

test('a swipe right on a queue tile: confirms the task the AI chose, opens the owner\'s, or makes one from what waits', async () => {
  // @ts-expect-error Browser modules are deliberately buildless JavaScript.
  const { swipePlan } = await import('../web/convquick.js');
  const waiting = [view('m1', 'contact:tg:by:5', '2026-11-19T09:00:00'), view('m2', 'contact:tg:by:5', '2026-11-19T09:05:00')];
  const queue = { waiting: true, moment: '2026-11-19T09:00:00', pending: waiting };
  const guessed = task('ai', 'inbox', { messages: ['m1', 'm2'] });
  assert.deepEqual(swipePlan({ views: waiting, tasks: [guessed], queue }, now), { type: 'confirm', task: guessed, add: ['m1', 'm2'] });
  const owned = task('own', 'todo', { messages: ['m0'] });
  assert.deepEqual(swipePlan({ views: waiting, tasks: [owned], queue }, now), { type: 'open', task: owned });
  const made = swipePlan({ views: waiting, tasks: [], queue }, now);
  assert.deepEqual([made.type, made.source.id, made.add], ['create', 'm2', ['m1', 'm2']]);
});
