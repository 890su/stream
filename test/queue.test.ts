import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { conversations } from '../web/conversations.js';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { queueList, ownerLinked, archiveList, handledToday } from '../web/queue.js';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { project } from '../web/projection.js';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { foldTasks, tasksByMessage } from '../web/taskfold.js';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { aiQuestionsByMessage } from '../web/questions.js';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { proposalsByMessage } from '../web/proposals.js';

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
const run = (events: any[], at = now, queue: Record<string, unknown> = {}) => {
  const tasks = foldTasks(events, { filedTemplates: ['chatter'] });
  const byMessage = tasksByMessage(tasks);
  const views = project(events).map((view: any) => ({ ...view, taskIds: byMessage.get(view.id) ?? [] }));
  return conversations(views, tasks, { now: at, config: { queue: { ...config.queue, ...queue } }, questions: aiQuestionsByMessage(events), proposals: proposalsByMessage(events) });
};
const queueOf = (events: any[], at = now, queue: Record<string, unknown> = {}) => run(events, at, queue)[0].queue;

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
  // A reply without a task is «Прочитанные», not the archive (decision 2026-11-25).
  assert.equal(queueOf([ask, mine('501', '2026-11-18T09:10:00', 'да')]).section, 'read');
  const later = tg('501', '2026-11-18T10:00:00', 'во сколько?');
  const again = queueOf([ask, mine('501', '2026-11-18T09:10:00', 'да'), later]);
  assert.deepEqual([again.section, again.waiting, again.moment], ['new', true, later.ts]);
  assert.equal(queueOf([ask, mark(ask.id, '2026-11-18T09:30:00', 'answered')]).section, null);
  const owned = change('t1', '2026-11-18T09:20:00', { op: 'create', title: 'Анна: приезд', status: 'todo', add: [ask.id] }, 'me');
  assert.equal(queueOf([ask, owned]).section, null);
  const thanks = tg('501', '2026-11-18T10:30:00', 'спасибо');
  const filed = change('t2', '2026-11-18T10:31:00', { op: 'create', title: 'без дела', template: 'chatter', status: 'done', add: [thanks.id] });
  const chatter = queueOf([ask, owned, thanks, filed]);
  assert.equal(chatter.section, 'read', '«спасибо» filed as chatter is not «Новые» (decision 2026-11-25)');
  assert.equal(chatter.unread, 0);
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
  assert.equal(queueOf([phone('call', 'missed', '2026-11-18T09:00:00')]).section, 'new');
  assert.equal(queueOf([phone('call', 'rejected', '2026-11-18T09:00:00')]).section, 'new');
  assert.equal(queueOf([phone('call', 'in', '2026-11-18T09:00:00')]).section, 'read', 'an answered call is not new (decision 2026-11-25)');
  assert.equal(queueOf([phone('sms', 'in', '2026-11-18T09:00:00')]).section, 'new');
  assert.equal(queueOf([phone('sms', 'in', '2026-11-18T09:00:00'), phone('call', 'out', '2026-11-18T09:30:00')]).section, 'read');
  assert.equal(queueOf([phone('call', 'missed', '2026-11-18T09:00:00'), phone('sms', 'out', '2026-11-18T09:30:00')]).section, 'read');
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
  assert.equal(queueOf([my, chatter]).section, 'read', 'group chatter is not «Новые» (decision 2026-11-25)');
  const answer = tg('-900', '2026-11-18T09:30:00', 'я свободен', { reply_to: my.id }, 'contact:tg:by:8', 'group');
  assert.equal(queueOf([my, chatter, answer]).waiting, true);
  const task = change('g1', '2026-11-18T09:05:00', { op: 'create', title: 'Моё', status: 'todo', add: [chatter.id], roles: { responsible: 'me', executors: ['me'] } });
  assert.equal(queueOf([my, chatter, task]).waiting, true);
});

test('own notes never wait', () => {
  const note = { id: `q${++n}`, schema_version: 1, source: 'app', author: 'me', ts: '2026-11-18T09:00:00', kind: 'text', payload: { text: 'идея', data: {} } };
  assert.equal(queueOf([note]).waiting, false);
});

// The archive above the queue (owner, 2026-11-21): conversations in no section, the last handled first.
// A reply is «Прочитанные», not the archive (decision 2026-11-25).
test('the archive: what waits for nothing, the last handled first; own notes stay out; a snoozed one is there until it ends', () => {
  const a = tg('701', '2026-11-18T08:00:00', 'a');
  const b = tg('702', '2026-11-18T09:00:00', 'b');
  const c = tg('703', '2026-11-18T10:00:00', 'c');
  const d = tg('704', '2026-11-18T11:00:00', 'ждёт');
  const note = { id: `q${++n}`, schema_version: 1, source: 'app', author: 'me', ts: '2026-11-18T11:30:00', kind: 'text', payload: { text: 'идея', data: {} } };
  const events = [a, b, c, d, note,
    mark(a.id, '2026-11-18T11:50:00', 'answered'),                    // archived last: nearest the divider
    mine('702', '2026-11-18T09:30:00', 'ок'),                          // a reply: «Прочитанные», not the archive
    change('t9', '2026-11-18T11:40:00', { op: 'create', title: 'Дело', status: 'todo', add: [c.id] }, 'me'),
  ];
  assert.deepEqual(archiveList(run(events)).map((item: any) => item.key), ['tg:701', 'tg:703']);
  assert.equal(run(events).find((item: any) => item.key === 'tg:702').queue.section, 'read');
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
  // A later verdict «finished» moves it to «Прочитанные», not the archive (decision 2026-11-25).
  const thanks = mine('950', '2026-11-18T10:30:00', 'до субботы');
  assert.equal(run([...base, thanks, verdict([thanks.id], thanks.id, '2026-11-18T10:33:00', null)]).find((c: any) => c.key === 'tg:950').queue.section, 'read');
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
  // ✓ / ✕ end the AI wait; the reply keeps the conversation in «Прочитанные» (decision 2026-11-25).
  assert.equal(run([ask, ok, made, change('tu', '2026-11-18T10:20:00', { unconfirmed: false }, 'me')]).find((c: any) => c.key === 'tg:951').queue.section, 'read', '✓');
  assert.equal(run([ask, ok, made, change('tu', '2026-11-18T10:20:00', { status: 'cancelled' }, 'me')]).find((c: any) => c.key === 'tg:951').queue.section, 'read', '✕');
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
  // A reply is already «Прочитанные» (decision 2026-11-25); «↧» only lifts its moment.
  assert.equal(queueOf([ask, reply]).section, 'read');
  const back = mark(reply.id, '2026-11-18T11:00:00', 'requeue');
  const queue = queueOf([ask, reply, back]);
  assert.deepEqual([queue.waiting, queue.section, queue.moment], [true, 'read', '2026-11-18T11:00:00']);
  // «Вернуть» drops the lift; the reply still keeps it in «Прочитанные».
  const undone = queueOf([ask, reply, back, mark(reply.id, '2026-11-18T11:01:00', 'unrequeue')]);
  assert.equal(undone.section, 'read');
  assert.equal(undone.moment, reply.ts);
  // 🗄 after the lift archives it.
  assert.equal(queueOf([ask, reply, back, mark(reply.id, '2026-11-18T11:30:00', 'answered')]).section, null);
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

// «Всё распределено» (design 2026-11-23, «Очередь — всё распределено»): the archive means read and sorted out. A
// conversation stays while the AI waits for me — a question, an update proposal, an unconfirmed record; my reply to
// the other side takes out only the waiting incoming. Ids and texts are made up.
const result = (ts: string, triage: Record<string, unknown>) => ({
  id: `q${++n}`, schema_version: 1, source: 'system', author: 'system', ts, kind: 'triage_result',
  payload: { data: { triage: { processor: 'triage-ai-v21', conversation_only: [], ...triage } } },
});
const options = [
  { label: 'Задача: отправить посылку', task_id: null, title: 'Отправить посылку', template: null, nothing: false },
  { label: 'Ничего', task_id: null, title: null, template: null, nothing: true },
];
const asking = (id: string, messages: string[], ts: string) => result(ts, { questions: [{ id, message_ids: messages, text: 'Это задача?', options }] });
const queueIn = (events: any[], key: string, at = now) => run(events, at).find((c: any) => c.key === key)?.queue;

test('my reply does not take a conversation out while a question waits', () => {
  const ask = tg('980', '2026-11-18T09:00:00', 'отправь посылку маме');
  const ok = mine('980', '2026-11-18T09:05:00', 'ок');
  assert.equal(queueOf([ask, ok]).section, 'read', 'no question: my reply is «Прочитанные» (decision 2026-11-25)');
  const question = asking('qq1', [ask.id], '2026-11-18T09:10:00');
  const queue = queueOf([ask, ok, question]);
  assert.deepEqual([queue.section, queue.waiting, queue.open, queue.moment], ['decide', true, 'ИИ спрашивает', ask.ts]);
  assert.equal(queueOf([ask, ok, question, mark(ask.id, '2026-11-18T09:20:00', 'answer_question', { question: 'qq1', option: 0 })]).section, 'read', 'answered');
  assert.equal(queueOf([ask, ok, question, result('2026-11-18T09:20:00', { again: true, withdrawn: ['qq1'] })]).section, 'read', 'withdrawn');
});

test('a waiting update proposal holds the conversation', () => {
  const linked = change('tp1', '2026-11-18T08:00:00', { op: 'create', title: 'Принтер', status: 'todo', add: [] }, 'me');
  const ask = tg('981', '2026-11-18T09:00:00', 'и ещё картридж поменяйте');
  const link = change('tp1', '2026-11-18T09:10:00', { op: 'update', add: [ask.id] });
  const ok = mine('981', '2026-11-18T09:15:00', 'хорошо');
  const proposal = result('2026-11-18T09:10:00', { proposals: [{ id: 'pp1', task_id: 'tp1', message_ids: [ask.id], reason: 'новый пункт', confidence: 0.8,
    alternatives: [], change: { items_add: [{ id: 'i1', text: 'картридж' }] } }] });
  assert.equal(queueOf([linked, ask, link, ok]).section, 'read', 'linked to an open record and answered (decision 2026-11-25)');
  const queue = queueOf([linked, ask, link, ok, proposal]);
  assert.deepEqual([queue.section, queue.waiting, queue.open], ['decide', true, 'ИИ предлагает правку']);
  assert.equal(queueOf([linked, ask, link, ok, proposal, mark(ask.id, '2026-11-18T09:20:00', 'reject_proposal', { proposal: 'pp1' })]).section, 'read', '✕');
  assert.equal(queueOf([linked, ask, link, ok, proposal, change('tp1', '2026-11-18T09:20:00', { op: 'update', proposal: 'pp1', items_add: [{ id: 'i1', text: 'картридж' }] }, 'me')]).section, 'read', '✓');
});

test('an old (v20) unanswered proposal does not hold after my reply; a v21 one does', () => {
  const ask = tg('985', '2026-11-18T09:00:00', 'это тот же сайт?');
  const ok = mine('985', '2026-11-18T09:15:00', 'да');
  const proposal = (id: string, processor: string) => result('2026-11-18T09:10:00', { processor, proposals: [{ id, task_id: 'tp9', message_ids: [ask.id],
    reason: 'тот же сайт', confidence: 0.7, alternatives: [], change: { op: 'update', add: [ask.id] } }] });
  assert.equal(queueOf([ask, ok, proposal('pp8', 'triage-ai-v20')]).section, 'read', 'v20: my reply moves it to «Прочитанные» (decision 2026-11-25)');
  assert.equal(queueOf([ask, proposal('pp8', 'triage-ai-v20')]).waiting, true, 'v20: the incoming itself still waits');
  assert.equal(queueOf([ask, ok, proposal('pp9', 'triage-ai-v21')]).open, 'ИИ предлагает правку', 'v21: holds after my reply');
});

test('a done-work record does not hold the conversation', () => {
  const ask = tg('982', '2026-11-18T09:00:00', 'подключитесь, не печатает');
  const ok = mine('982', '2026-11-18T09:30:00', 'готово');
  const thanks = tg('982', '2026-11-18T09:35:00', 'спасибо, работает');
  const done = change('td1', '2026-11-18T09:40:00', { op: 'create', title: 'Анна: настройка печати', status: 'done', unconfirmed: true,
    report: { text: 'настроил печать' }, add: [ask.id, ok.id, thanks.id] });
  assert.equal(queueOf([ask, ok, thanks, done]).section, 'read', 'done work is not «Новые» (decision 2026-11-25)');
});

test('a message linked to a closed record does not wait; linked to an open one it does', () => {
  const made = change('tc1', '2026-11-17T09:00:00', { op: 'create', title: 'Анна: принтер', status: 'todo', add: [] }, 'me');
  const closed = change('tc1', '2026-11-17T18:00:00', { op: 'update', status: 'done' }, 'me');
  const thanks = tg('983', '2026-11-18T09:00:00', 'спасибо, работает');
  const link = change('tc1', '2026-11-18T09:05:00', { op: 'update', add: [thanks.id] });
  assert.equal(queueOf([made, closed, thanks, link]).section, 'read', 'a closed record is not «Новые» (decision 2026-11-25)');
  assert.equal(queueOf([made, thanks, link]).waiting, true, 'open record');
});

test('🗄 takes it out; the question stays in aiQuestionsByMessage', () => {
  const ask = tg('984', '2026-11-18T09:00:00', 'позвони вечером');
  const question = asking('qq2', [ask.id], '2026-11-18T09:10:00');
  const archived = mark(ask.id, '2026-11-18T09:30:00', 'answered');
  assert.equal(queueOf([ask, question, archived]).waiting, false);
  assert.equal(aiQuestionsByMessage([ask, question, archived]).get(ask.id)?.id, 'qq2', 'still answerable');
  const later = asking('qq3', [ask.id], '2026-11-18T10:00:00');
  assert.equal(queueOf([ask, question, archived, later]).open, 'ИИ спрашивает', 'a new question after 🗄 holds it again');
});

test('the «Я» conversation waits while an AI record or question from it waits, else not', () => {
  const note = (ts: string, text: string) => ({ id: `q${++n}`, schema_version: 1, source: 'app', author: 'me', ts, kind: 'text', payload: { text, data: {} } });
  const idea = note('2026-11-18T08:00:00', 'идея: рассылка');
  const parcel = note('2026-11-18T09:00:00', 'отправить посылку');
  assert.equal(queueIn([idea, parcel], 'me').waiting, false, 'no incoming waits in my own notes');
  const made = change('tm1', '2026-11-18T09:05:00', { op: 'create', title: 'Отправить посылку', status: 'todo', unconfirmed: true, processor: 'triage-ai-v21', add: [parcel.id] });
  const queue = queueIn([idea, parcel, made], 'me');
  assert.deepEqual([queue.waiting, queue.open], [true, 'ИИ предлагает задачу'], 'the note stays in «Я» while the record waits');
  assert.equal(queueIn([idea, parcel, made, change('tm1', '2026-11-18T09:20:00', { unconfirmed: false }, 'me')], 'me').waiting, false, '✓');
  const legacy = change('tm2', '2026-11-18T09:05:00', { op: 'create', title: 'Посылка', status: 'todo', unconfirmed: true, processor: 'triage-ai-v20', add: [parcel.id] });
  assert.equal(queueIn([idea, parcel, legacy], 'me').waiting, false, 'an older unconfirmed record keeps its note in its task, «Я» does not wait');
  assert.equal(run([idea, parcel, legacy]).some((c: any) => c.key === 'task:tm2'), true);
  const question = asking('qq4', [parcel.id], '2026-11-18T09:05:00');
  const asked = queueIn([idea, parcel, question], 'me');
  assert.deepEqual([asked.waiting, asked.open], [true, 'ИИ спрашивает']);
  assert.equal(queueIn([idea, parcel, question, mark(parcel.id, '2026-11-18T09:20:00', 'answer_question', { question: 'qq4', text: 'ничего' })], 'me').waiting, false);
  assert.equal(queueIn([idea, parcel, question, mark(parcel.id, '2026-11-18T09:20:00', 'answered')], 'me').waiting, false, '🗄');
});

test('answering a question handles its incoming messages: no reply needed after «Ничего» or words', () => {
  const ask = tg('986', '2026-11-18T09:00:00', 'посылку маме отправишь?');
  const question = asking('qq5', [ask.id], '2026-11-18T09:10:00');
  assert.deepEqual([queueOf([ask, question]).waiting, queueOf([ask, question]).pending.length], [true, 1], 'the incoming waits too');
  const nothing = mark(ask.id, '2026-11-18T09:20:00', 'answer_question', { question: 'qq5', option: 1 });
  assert.equal(queueOf([ask, question, nothing]).section, 'read', 'answered: «Прочитанные», not the archive (decision 2026-11-25)');
  const words = mark(ask.id, '2026-11-18T09:20:00', 'answer_question', { question: 'qq5', text: 'это подарок' });
  assert.equal(queueOf([ask, question, words]).section, 'read');
  const later = tg('986', '2026-11-18T10:00:00', 'и ещё одно');
  assert.equal(queueOf([ask, question, nothing, later]).waiting, true, 'a later incoming waits again');
});

test('handled today: conversations out of the queue that I acted on today', () => {
  const yesterday = '2026-11-17T09:00:00';
  const replied = [tg('991', yesterday, 'счёт пришлёте?'), mine('991', '2026-11-18T08:00:00', 'да, сегодня')];
  const thanks = tg('992', yesterday, 'спасибо');
  const quietToday = [thanks, mark(thanks.id, '2026-11-17T09:30:00', 'answered')];
  const chatter = tg('992', '2026-11-18T09:00:00', 'хорошего дня');
  const filed = change('th1', '2026-11-18T09:01:00', { op: 'create', title: 'болтовня', template: 'chatter', status: 'done', add: [chatter.id] });
  const decided = tg('993', yesterday, 'посылку отправишь?');
  const answer = mark(decided.id, '2026-11-18T08:30:00', 'answer_question', { question: 'qq9', option: 1 });
  const snoozed = tg('994', yesterday, 'перезвоните');
  const later = mark(snoozed.id, '2026-11-18T08:40:00', 'snooze', { until: '2026-11-19T09:00:00' });
  const waiting = tg('995', '2026-11-18T10:00:00', 'когда приедете?');
  const tasked = tg('996', yesterday, 'нужна настройка роутера');
  const myTask = change('th2', '2026-11-18T09:30:00', { op: 'create', title: 'Роутер', status: 'todo', add: [tasked.id] }, 'me');
  const note = { id: `q${++n}`, schema_version: 1, source: 'app', author: 'me', ts: '2026-11-18T07:00:00', kind: 'text', payload: { text: 'идея', data: {} } };
  const events = [...replied, ...quietToday, chatter, filed, decided, answer, snoozed, later, waiting, tasked, myTask, note];
  const list = run(events);
  assert.equal(list.find((c: any) => c.key === 'tg:992').queue.section, 'read', 'chatter on a closed record is not «Новые» (decision 2026-11-25)');
  assert.equal(handledToday(list, now), 2, 'a reply and an answered question sit in «Прочитанные», not the archive (decision 2026-11-25); counted: my snooze and my task');
  assert.equal(handledToday(list, new Date('2026-11-19T12:00:00')), 0, 'tomorrow nothing yet');
});

test('a waiting proposal on a record cancelled or closed since holds nothing', () => {
  const linked = change('tp7', '2026-11-18T08:00:00', { op: 'create', title: 'Принтер', status: 'todo', add: [] }, 'me');
  const ask = tg('987', '2026-11-18T09:00:00', 'и ещё картридж поменяйте');
  const link = change('tp7', '2026-11-18T09:10:00', { op: 'update', add: [ask.id] });
  const ok = mine('987', '2026-11-18T09:15:00', 'хорошо');
  const proposal = result('2026-11-18T09:10:00', { proposals: [{ id: 'pp7', task_id: 'tp7', message_ids: [ask.id], reason: 'новый пункт', confidence: 0.8,
    alternatives: [], change: { items_add: [{ id: 'i7', text: 'картридж' }] } }] });
  assert.equal(queueOf([linked, ask, link, ok, proposal]).waiting, true, 'holds while the record is open');
  for (const status of ['cancelled', 'done']) {
    assert.equal(queueOf([linked, ask, link, ok, proposal, change('tp7', '2026-11-18T09:30:00', { op: 'update', status }, 'me')]).section, 'read', status);
  }
});

// Sections (decision 2026-11-25): «Новые» · «Ждут решения» · «Прочитанные». A reply no longer archives.
test('unread incoming is new; a read mark on the last one is read', () => {
  const first = tg('530', '2026-11-18T09:00:00', 'раз');
  const second = tg('530', '2026-11-18T10:00:00', 'два');
  const fresh = queueOf([first, second]);
  assert.deepEqual([fresh.section, fresh.unread, fresh.waiting], ['new', 2, true]);
  const opened = queueOf([first, second, mark(second.id, '2026-11-18T10:05:00', 'read')]);
  assert.deepEqual([opened.section, opened.unread, opened.waiting], ['read', 0, true]);
});

test('a read mark covers messages up to its target, not up to the time of the mark', () => {
  const early = tg('531', '2026-11-18T09:00:00', 'рано');
  const late = tg('531', '2026-11-18T10:00:00', 'позже');
  const queue = queueOf([early, late, mark(early.id, '2026-11-18T11:00:00', 'read')]);
  assert.equal(queue.section, 'new');
  assert.equal(queue.unread, 1);
  assert.equal(queue.pending[0].id, late.id);
});

test('deleting the read anchor does not make the conversation new', () => {
  const first = tg('532', '2026-11-18T09:00:00', 'первое');
  const last = tg('532', '2026-11-18T10:00:00', 'второе');
  const queue = queueOf([first, last, mark(last.id, '2026-11-18T10:05:00', 'read'), mark(last.id, '2026-11-18T10:06:00', 'delete')]);
  assert.equal(queue.section, 'read');
  assert.equal(queue.unread, 0);
});

test('my reply without a task is read, not the archive; with an unconfirmed task it is decide', () => {
  const ask = tg('533', '2026-11-18T09:00:00', 'можно сегодня?');
  const reply = queueOf([ask, mine('533', '2026-11-18T09:10:00', 'да')]);
  assert.equal(reply.section, 'read');
  assert.equal(reply.waiting, true);
  const made = change('tu2', '2026-11-18T09:20:00', { op: 'create', title: 'Приезд', status: 'todo', unconfirmed: true, add: [ask.id] });
  const waiting = queueOf([ask, mine('533', '2026-11-18T09:10:00', 'да'), made]);
  assert.equal(waiting.section, 'decide');
  assert.equal(waiting.open, 'ИИ предлагает задачу');
});

test('a finished verdict is read, not the archive; 🗄 archives, and a new incoming is new again', () => {
  const ask = tg('534', '2026-11-18T09:00:00', 'приедете?');
  const ok = mine('534', '2026-11-18T09:10:00', 'да');
  const finished = queueOf([ask, ok, verdict([ask.id, ok.id], ok.id, '2026-11-18T09:20:00', null)]);
  assert.equal(finished.section, 'read');
  const archived = queueOf([ask, mark(ask.id, '2026-11-18T09:30:00', 'answered')]);
  assert.equal(archived.section, null);
  assert.equal(archived.waiting, false);
  const again = queueOf([ask, mark(ask.id, '2026-11-18T09:30:00', 'answered'), tg('534', '2026-11-18T10:00:00', 'алло?')]);
  assert.equal(again.section, 'new');
  const mineBack = queueOf([ask, mark(ask.id, '2026-11-18T09:30:00', 'answered'), mine('534', '2026-11-18T10:00:00', 'я на связи')]);
  assert.equal(mineBack.section, 'read', 'my own message returns it to read, not new');
  assert.equal(mineBack.unread, 0);
});

test('read and quiet for the term archives; just short of it stays; zero days never archives', () => {
  const ask = tg('535', '2026-11-15T12:00:00', 'давно');
  const read = (ts: string) => mark(ask.id, ts, 'read');
  assert.equal(queueOf([ask, read('2026-11-15T12:00:00')]).section, null, 'exactly 3 quiet days');
  assert.equal(queueOf([ask, read('2026-11-15T13:00:00')]).section, 'read', '2 days 23 h');
  const month = new Date('2026-12-18T12:00:00');
  assert.equal(queueOf([ask, read('2026-11-18T12:00:00')], month, { archive_read_days: 0 }).section, 'read', '0 never archives');
  assert.equal(queueOf([ask, read('2026-11-18T12:00:00')], month).section, null, 'the default still archives a month of quiet');
});

test('a snoozed read conversation stays hidden until the snooze ends, then read at that time', () => {
  const ask = tg('536', '2026-11-18T09:00:00', 'вопрос');
  const until = '2026-11-18T15:00:00';
  const events = [ask, mark(ask.id, '2026-11-18T09:05:00', 'read'), mark(ask.id, '2026-11-18T09:10:00', 'snooze', { until })];
  const hidden = queueOf(events);
  assert.equal(hidden.waiting, false);
  assert.equal(hidden.snoozedUntil, until);
  const back = queueOf(events, new Date('2026-11-18T16:00:00'));
  assert.equal(back.section, 'read');
  assert.equal(back.moment, until);
});

test('group chatter that is not a reply to me is not new', () => {
  const my = mine('-910', '2026-11-18T08:00:00', 'кто свободен?');
  const chatter = tg('-910', '2026-11-18T09:00:00', 'всем привет', {}, 'contact:tg:by:7', 'group');
  assert.notEqual(queueOf([my, chatter]).section, 'new');
  const answer = tg('-910', '2026-11-18T09:30:00', 'я свободен', { reply_to: my.id }, 'contact:tg:by:8', 'group');
  assert.equal(queueOf([my, chatter, answer]).section, 'new');
});

test('queueList orders new, then decide, then read; inside read the freshest is last', async () => {
  // @ts-expect-error Browser modules are deliberately buildless JavaScript.
  const { SECTION_TITLES } = await import('../web/queue.js');
  assert.deepEqual(SECTION_TITLES, { new: 'Новые', decide: 'Ждут решения', read: 'Прочитанные' });
  const ask = tg('3', '2026-11-18T09:00:00', 'decide');
  const reply = mine('3', '2026-11-18T09:10:00', 'ок');
  const events = [
    tg('2', '2026-11-18T08:00:00', 'new early'),
    tg('1', '2026-11-18T11:00:00', 'new late'),
    ask, reply,
    verdict([ask.id, reply.id], reply.id, '2026-11-18T09:12:00', 'ждёт ответ'),
    tg('4', '2026-11-18T07:00:00', 'read old'),
    mine('4', '2026-11-18T07:30:00', 'да'),
    tg('5', '2026-11-18T10:30:00', 'read new'),
    mine('5', '2026-11-18T10:40:00', 'да'),
  ];
  assert.deepEqual(queueList(run(events)).map((item: any) => item.key), ['tg:2', 'tg:1', 'tg:3', 'tg:4', 'tg:5']);
});
