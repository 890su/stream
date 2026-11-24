import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { conversations } from '../web/conversations.js';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { queueList, ownerLinked, archiveList } from '../web/queue.js';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { project } from '../web/projection.js';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { foldTasks, tasksByMessage } from '../web/taskfold.js';

// The queue of conversations (CONCEPT.md §2.5, design 2026-11-20). Names and texts are made up.
const config = { queue: { since: '2026-11-10T00:00:00' } };
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

test('order: the longest waiting first (top), the newest last; a new message moves nothing', () => {
  const events = [tg('1', '2026-11-18T08:00:00', 'a'), tg('2', '2026-11-18T09:00:00', 'b'), tg('3', '2026-11-18T10:00:00', 'c')];
  assert.deepEqual(queueList(run(events)).map((c: any) => c.key), ['tg:1', 'tg:2', 'tg:3']);
  assert.deepEqual(queueList(run([...events, tg('1', '2026-11-18T11:00:00', 'ещё')])).map((c: any) => c.key), ['tg:1', 'tg:2', 'tg:3']);
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

test('messages before the queue started do not wait; one waiting long stays; an old unanswered one does not hide a fresh one', () => {
  const old = tg('501', '2026-11-01T09:00:00', 'давнее');
  assert.equal(queueOf([old]).waiting, false);
  const fresh = tg('501', '2026-11-18T11:00:00', 'вы тут?');
  const queue = queueOf([old, fresh]);
  assert.deepEqual([queue.waiting, queue.moment, queue.since, queue.pending.length], [true, fresh.ts, fresh.ts, 1]);
  const long = tg('502', '2026-11-11T09:00:00', 'ждёт неделю');
  assert.equal(queueOf([long], new Date('2026-11-25T12:00:00')).waiting, true, 'waiting long never drops out');
});

test('«Вернуть» after a task made from the tile brings the conversation back: removed messages are not owner links', () => {
  const ask = tg('501', '2026-11-18T09:00:00', 'вопрос');
  const made = change('t1', '2026-11-18T09:10:00', { op: 'create', title: 'Задача', status: 'todo', add: [ask.id] }, 'me');
  assert.equal(queueOf([ask, made]).waiting, false);
  const undo = change('t1', '2026-11-18T09:11:00', { op: 'update', status: 'cancelled', remove: [ask.id] }, 'me');
  assert.equal(queueOf([ask, made, undo]).waiting, true);
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

// The archive above the queue (owner, 2026-11-21): conversations that wait for nothing, the last handled first —
// a fresh archive mark, reply, own task or snooze puts it nearest the divider.
test('the archive: what waits for nothing, the last handled first; own notes stay out; a snoozed one is there until it ends', () => {
  const a = tg('701', '2026-11-18T08:00:00', 'a');
  const b = tg('702', '2026-11-18T09:00:00', 'b');
  const c = tg('703', '2026-11-18T10:00:00', 'c');
  const d = tg('704', '2026-11-18T11:00:00', 'ждёт');
  const note = { id: `q${++n}`, schema_version: 1, source: 'app', author: 'me', ts: '2026-11-18T11:30:00', kind: 'text', payload: { text: 'идея', data: {} } };
  const events = [a, b, c, d, note,
    mark(a.id, '2026-11-18T11:50:00', 'answered'),                    // archived last: nearest the divider
    mine('702', '2026-11-18T09:30:00', 'ок'),                          // answered by me at 9:30
    change('t9', '2026-11-18T11:40:00', { op: 'create', title: 'Дело', status: 'todo', add: [c.id] }, 'me'),
  ];
  assert.deepEqual(archiveList(run(events)).map((item: any) => item.key), ['tg:701', 'tg:703', 'tg:702']);
  assert.equal(archiveList(run(events))[0].handledAt, '2026-11-18T11:50:00');
  const snoozed = [d, mark(d.id, '2026-11-18T11:55:00', 'snooze', { until: '2026-11-18T18:00:00' })];
  assert.deepEqual(archiveList(run(snoozed)).map((item: any) => item.key), ['tg:704'], 'snoozed: in the archive until it ends');
  assert.deepEqual(archiveList(run(snoozed, new Date('2026-11-18T19:00:00'))), [], 'snooze over: back in the queue');
});

// Unfinished (owner, 2026-11-21): a task appeared — the conversation may leave; no task and the other side still waits
// for me — it stays, even after my reply.
const verdict = (ids: string[], last: string, ts: string, unfinished: string | null) => ({
  id: `q${++n}`, schema_version: 1, source: 'system', author: 'system', ts, kind: 'triage_result',
  payload: { data: { triage: { processor: 'triage-ai-v18', conversation_only: ids, last_message: last, unfinished } } },
});

test('unfinished: the other side waits for me and no task covers it — my reply does not take the conversation out', () => {
  const ask = tg('950', '2026-11-18T10:00:00', 'приедете в субботу в 14?');
  const ok = mine('950', '2026-11-18T10:05:00', 'ок');
  const base = [ask, ok, verdict([ask.id, ok.id], ok.id, '2026-11-18T10:08:00', 'ждёт выезд в субботу в 14:00')];
  const queue = run(base).find((c: any) => c.key === 'tg:950').queue;
  assert.equal(queue.waiting, true);
  assert.equal(queue.open, 'ждёт выезд в субботу в 14:00');
  assert.equal(queue.moment, ask.ts, 'its place is the last incoming');
  assert.deepEqual(queue.pending, []);
  // The archive mark after the verdict takes it out.
  assert.equal(run([...base, mark(ok.id, '2026-11-18T10:20:00', 'answered')]).find((c: any) => c.key === 'tg:950').queue.waiting, false);
  // A task made by me for its messages takes it out.
  assert.equal(run([...base, change('tv', '2026-11-18T10:20:00', { op: 'create', title: 'Выезд', status: 'todo', add: [ask.id] }, 'me')]).find((c: any) => c.key === 'tg:950').queue.waiting, false);
  // A later verdict «finished» takes it out.
  const thanks = mine('950', '2026-11-18T10:30:00', 'до субботы');
  assert.equal(run([...base, thanks, verdict([thanks.id], thanks.id, '2026-11-18T10:33:00', null)]).find((c: any) => c.key === 'tg:950').queue.waiting, false);
  // A snooze hides it until the time.
  const snoozed = run([...base, mark(ok.id, '2026-11-18T10:20:00', 'snooze', { until: '2026-11-18T15:00:00' })]).find((c: any) => c.key === 'tg:950').queue;
  assert.equal(snoozed.waiting, false);
  assert.equal(snoozed.snoozedUntil, '2026-11-18T15:00:00');
});

test('an unconfirmed AI task keeps its conversation in the queue until ✓ or ✕', () => {
  const ask = tg('951', '2026-11-18T10:00:00', 'нужен счёт');
  const ok = mine('951', '2026-11-18T10:05:00', 'сделаю');
  const made = change('tu', '2026-11-18T10:08:00', { op: 'create', title: 'Счёт', status: 'todo', add: [ask.id, ok.id], unconfirmed: true });
  const queue = run([ask, ok, made]).find((c: any) => c.key === 'tg:951').queue;
  assert.equal(queue.waiting, true);
  assert.equal(queue.open, 'ИИ предлагает задачу');
  assert.equal(run([ask, ok, made, change('tu', '2026-11-18T10:20:00', { unconfirmed: false }, 'me')]).find((c: any) => c.key === 'tg:951').queue.waiting, false, '✓');
  assert.equal(run([ask, ok, made, change('tu', '2026-11-18T10:20:00', { status: 'cancelled' }, 'me')]).find((c: any) => c.key === 'tg:951').queue.waiting, false, '✕');
});

test('the archive or my task hides a conversation until its task day: on that day it waits again', () => {
  const ask = tg('960', '2026-11-15T09:00:00', 'приедете в среду?');
  const made = change('td', '2026-11-15T09:05:00', { op: 'create', title: 'Выезд', status: 'todo', due: '2026-11-18', roles: { author: 'me', responsible: 'me', executors: ['me'] }, add: [ask.id] }, 'me');
  const before = run([ask, made], new Date('2026-11-17T20:00:00')).find((c: any) => c.key === 'tg:960').queue;
  assert.equal(before.waiting, false, 'before the day it stays out');
  const onDay = run([ask, made], new Date('2026-11-18T08:00:00')).find((c: any) => c.key === 'tg:960').queue;
  assert.equal(onDay.waiting, true, 'on the task day it is back');
  assert.match(onDay.open, /Выезд/);
  assert.equal(Date.parse(onDay.moment), new Date(2026, 10, 18).getTime(), 'its place — the start of the day');
  // Archived on that day: out again.
  const archived = run([ask, made, mark(ask.id, '2026-11-18T08:30:00', 'answered')], new Date('2026-11-18T09:00:00')).find((c: any) => c.key === 'tg:960').queue;
  assert.equal(archived.waiting, false, 'handled on the day');
  // A finished task brings nothing back.
  const done = change('td', '2026-11-16T10:00:00', { status: 'done' }, 'me');
  assert.equal(run([ask, made, done], new Date('2026-11-18T08:00:00')).find((c: any) => c.key === 'tg:960').queue.waiting, false);
});

test('a planned start or a reminder is the task day too; without a day the archive waits for a new incoming', () => {
  const ask = tg('961', '2026-11-15T09:00:00', 'когда созвонимся?');
  const made = change('tp', '2026-11-15T09:05:00', { op: 'create', title: 'Звонок', status: 'todo', plan: { start: '2026-11-18T15:00:00' }, roles: { author: 'me', responsible: 'me', executors: ['me'] }, add: [ask.id] }, 'me');
  assert.equal(run([ask, made], new Date('2026-11-18T07:00:00')).find((c: any) => c.key === 'tg:961').queue.waiting, true);
  const bare = change('tb', '2026-11-15T09:05:00', { op: 'create', title: 'Без дня', status: 'todo', roles: { author: 'me', responsible: 'me', executors: ['me'] }, add: [ask.id] }, 'me');
  assert.equal(run([ask, bare], new Date('2026-11-20T07:00:00')).find((c: any) => c.key === 'tg:961').queue.waiting, false);
});

// Back from the archive (owner, 2026-11-22): a swipe on an archive tile puts the conversation at the end of the queue.
test('a requeue after the conversation was handled brings it back to the end of the queue', () => {
  const ask = tg('970', '2026-11-18T09:00:00', 'спасибо');
  const reply = mine('970', '2026-11-18T09:10:00', 'пожалуйста');
  assert.equal(queueOf([ask, reply]).waiting, false);
  const back = mark(reply.id, '2026-11-18T11:00:00', 'requeue');
  const queue = queueOf([ask, reply, back]);
  assert.deepEqual([queue.waiting, queue.moment], [true, '2026-11-18T11:00:00']);
  // «Вернуть» takes it back to the archive.
  assert.equal(queueOf([ask, reply, back, mark(reply.id, '2026-11-18T11:01:00', 'unrequeue')]).waiting, false);
  // Archived again or answered again: out.
  assert.equal(queueOf([ask, reply, back, mark(reply.id, '2026-11-18T11:30:00', 'answered')]).waiting, false);
});

test('back from the archive: the archive mark is lifted and a snooze is cancelled', () => {
  const ask = tg('971', '2026-11-18T09:00:00', 'вопрос');
  const archived = mark(ask.id, '2026-11-18T09:30:00', 'answered');
  assert.equal(queueOf([ask, archived]).waiting, false);
  assert.equal(queueOf([ask, archived, mark(ask.id, '2026-11-18T11:00:00', 'requeue')]).waiting, true);
  const snoozed = mark(ask.id, '2026-11-18T10:00:00', 'snooze', { until: '2026-11-19T09:00:00' });
  assert.equal(queueOf([ask, snoozed]).waiting, false);
  assert.equal(queueOf([ask, snoozed, mark(ask.id, '2026-11-18T11:00:00', 'requeue')]).waiting, true, 'the snooze is cancelled');
});
