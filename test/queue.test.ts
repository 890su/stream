import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { conversations } from '../web/conversations.js';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { queueList, ownerLinked } from '../web/queue.js';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { project } from '../web/projection.js';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { foldTasks, tasksByMessage } from '../web/taskfold.js';

// The queue of conversations (CONCEPT.md §2.5, design 2026-11-20). Names and texts are made up.
const config = { queue: { max_age_days: 7 } };
const now = new Date('2026-11-18T12:00:00');
let n = 0;
const tg = (chat: string, ts: string, text: string, extra: Record<string, unknown> = {}, who = `contact:tg:by:${chat.replace('-', '')}`, type = 'private') => ({
  id: `q${++n}`, schema_version: 1, source: 'telegram', author: who, ts, kind: 'text',
  payload: { text, data: { telegram: { account: 'by', chat_id: chat, chat_type: type, chat_title: 'Анна Тестова', from_name: 'Анна' } } }, ...extra,
});
const mine = (chat: string, ts: string, text: string) => ({
  id: `q${++n}`, schema_version: 1, source: 'app', author: 'me', ts, kind: 'text',
  payload: { text, data: { outbound: { connector: 'telegram_by', chat_id: chat, chat_title: 'Анна Тестова' } } },
});
const change = (task: string, ts: string, data: Record<string, unknown>, author = 'system') => ({
  id: `q${++n}`, schema_version: 1, source: author === 'me' ? 'app' : 'system', author, ts, kind: 'task_change', payload: { ref: { type: 'task', id: task }, data: { task: data } },
});
const mark = (target: string, ts: string, op: string, extra: Record<string, unknown> = {}) => ({
  id: `q${++n}`, schema_version: 1, source: 'app', author: 'me', ts, kind: 'correction', payload: { ref: { type: 'event', id: target }, data: { op, ...extra } },
});
const phone = (kind: 'sms' | 'call', direction: string, ts: string) => ({
  id: `q${++n}`, schema_version: 1, source: 'android_phone', author: 'me', ts, kind, payload: { text: kind === 'sms' ? 'текст' : undefined, data: { [kind]: { number: '+48 600 100 200', direction } } },
});
const run = (events: any[], at = now) => {
  const tasks = foldTasks(events, { filedTemplates: ['chatter'] });
  const byMessage = tasksByMessage(tasks);
  const views = project(events).map((view: any) => ({ ...view, taskIds: byMessage.get(view.id) ?? [] }));
  return conversations(views, tasks, { now: at, config });
};
const queueOf = (events: any[], at = now) => run(events, at)[0].queue;

test('a new message in a queued conversation keeps its moment', () => {
  const first = tg('501', '2026-11-18T09:00:00', 'нужен счёт');
  const queue = queueOf([first, tg('501', '2026-11-18T11:00:00', 'и акт')]);
  assert.equal(queue.waiting, true);
  assert.equal(queue.moment, first.ts);
  assert.equal(queue.pending.length, 2);
});

test('order: the newest moment first (top), the oldest last (by the input); a new message moves nothing', () => {
  const events = [tg('1', '2026-11-18T08:00:00', 'a'), tg('2', '2026-11-18T09:00:00', 'b'), tg('3', '2026-11-18T10:00:00', 'c')];
  assert.deepEqual(queueList(run(events)).map((c: any) => c.key), ['tg:3', 'tg:2', 'tg:1']);
  assert.deepEqual(queueList(run([...events, tg('1', '2026-11-18T11:00:00', 'ещё')])).map((c: any) => c.key), ['tg:3', 'tg:2', 'tg:1']);
});

test('my reply, the archive mark or an owner task link close what came before; a later incoming waits again', () => {
  const ask = tg('501', '2026-11-18T09:00:00', 'можно сегодня?');
  assert.equal(queueOf([ask, mine('501', '2026-11-18T09:10:00', 'да')]).waiting, false);
  const later = tg('501', '2026-11-18T10:00:00', 'во сколько?');
  const again = queueOf([ask, mine('501', '2026-11-18T09:10:00', 'да'), later]);
  assert.deepEqual([again.waiting, again.moment], [true, later.ts]);
  assert.equal(queueOf([ask, mark(ask.id, '2026-11-18T09:30:00', 'answered')]).waiting, false);
  const owned = change('t1', '2026-11-18T09:20:00', { op: 'create', title: 'Анна: приезд', status: 'todo', add: [ask.id] }, 'me');
  assert.equal(queueOf([ask, owned]).waiting, false);
  const thanks = tg('501', '2026-11-18T10:30:00', 'спасибо');
  const filed = change('t2', '2026-11-18T10:31:00', { op: 'create', title: 'без дела', template: 'chatter', status: 'done', add: [thanks.id] });
  assert.equal(queueOf([ask, owned, thanks, filed]).waiting, false, '«спасибо» filed as chatter waits for nothing');
});

test('an AI link does not take a conversation out of the queue; owner links are found in task history', () => {
  const ask = tg('501', '2026-11-18T09:00:00', 'почините принтер');
  const ai = change('t1', '2026-11-18T09:05:00', { op: 'create', title: 'Принтер', status: 'inbox', add: [ask.id] });
  assert.equal(queueOf([ask, ai]).waiting, true);
  const tasks = foldTasks([ask, ai, change('t1', '2026-11-18T09:10:00', { op: 'update', add: [ask.id] }, 'me')], {});
  assert.deepEqual([...ownerLinked(tasks)], [ask.id]);
  assert.deepEqual([...ownerLinked(foldTasks([ask, ai], {}))], []);
});

test('calls: missed waits, answered does not, my outgoing call or SMS answers', () => {
  assert.equal(queueOf([phone('call', 'missed', '2026-11-18T09:00:00')]).waiting, true);
  assert.equal(queueOf([phone('call', 'rejected', '2026-11-18T09:00:00')]).waiting, true);
  assert.equal(queueOf([phone('call', 'in', '2026-11-18T09:00:00')]).waiting, false);
  assert.equal(queueOf([phone('sms', 'in', '2026-11-18T09:00:00')]).waiting, true);
  assert.equal(queueOf([phone('sms', 'in', '2026-11-18T09:00:00'), phone('call', 'out', '2026-11-18T09:30:00')]).waiting, false);
  assert.equal(queueOf([phone('call', 'missed', '2026-11-18T09:00:00'), phone('sms', 'out', '2026-11-18T09:30:00')]).waiting, false);
});

test('requeue lifts the moment to its time; unrequeue restores the first incoming', () => {
  const ask = tg('501', '2026-11-18T09:00:00', 'вопрос');
  const lift = mark(ask.id, '2026-11-18T11:00:00', 'requeue');
  assert.equal(queueOf([ask, lift]).moment, lift.ts);
  assert.equal(queueOf([ask, lift, mark(ask.id, '2026-11-18T11:30:00', 'unrequeue')]).moment, ask.ts);
});

test('snooze hides until "until", then waits with moment = until; unsnooze restores the old moment', () => {
  const ask = tg('501', '2026-11-18T09:00:00', 'вопрос');
  const until = '2026-11-18T13:00:00';
  const snooze = mark(ask.id, '2026-11-18T09:30:00', 'snooze', { until });
  const hidden = queueOf([ask, snooze]);
  assert.deepEqual([hidden.waiting, hidden.snoozedUntil], [false, until]);
  const back = queueOf([ask, snooze], new Date('2026-11-18T14:00:00'));
  assert.deepEqual([back.waiting, back.moment], [true, until]);
  const undone = queueOf([ask, snooze, mark(ask.id, '2026-11-18T09:31:00', 'unsnooze')]);
  assert.deepEqual([undone.waiting, undone.moment], [true, ask.ts]);
});

test('a new incoming during a snooze brings it back at once with that message as the moment', () => {
  const ask = tg('501', '2026-11-18T09:00:00', 'вопрос');
  const again = tg('501', '2026-11-18T10:00:00', 'алло?');
  const queue = queueOf([ask, mark(ask.id, '2026-11-18T09:30:00', 'snooze', { until: '2026-11-18T18:00:00' }), again]);
  assert.deepEqual([queue.waiting, queue.moment, queue.since], [true, again.ts, ask.ts]);
});

test('older than max_age_days does not wait; a requeue within the window does', () => {
  const old = tg('501', '2026-11-01T09:00:00', 'давнее');
  assert.equal(queueOf([old]).waiting, false);
  const lift = mark(old.id, '2026-11-18T08:00:00', 'requeue');
  assert.deepEqual([queueOf([old, lift]).waiting, queueOf([old, lift]).moment], [true, lift.ts]);
});

test('a group waits only for a message answering me or in my task', () => {
  const my = mine('-900', '2026-11-18T08:00:00', 'кто свободен?');
  const chatter = tg('-900', '2026-11-18T09:00:00', 'всем привет', {}, 'contact:tg:by:7', 'group');
  assert.equal(queueOf([my, chatter]).waiting, false);
  const answer = tg('-900', '2026-11-18T09:30:00', 'я свободен', { reply_to: my.id }, 'contact:tg:by:8', 'group');
  assert.equal(queueOf([my, chatter, answer]).waiting, true);
  const task = change('g1', '2026-11-18T09:05:00', { op: 'create', title: 'Моё', status: 'todo', add: [chatter.id], roles: { responsible: 'me', executors: ['me'] } });
  assert.equal(queueOf([my, chatter, task]).waiting, true);
});

test('own notes never wait', () => {
  const note = { id: `q${++n}`, schema_version: 1, source: 'app', author: 'me', ts: '2026-11-18T09:00:00', kind: 'text', payload: { text: 'идея', data: {} } };
  assert.equal(queueOf([note]).waiting, false);
});
