import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { conversationOf, conversations, conversationState } from '../web/conversations.js';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { project } from '../web/projection.js';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { foldTasks, tasksByMessage } from '../web/taskfold.js';

// Conversations: one per chat or number (P14). Names and texts are made up.
const config = { quiet_days: 7, urgent_tags: ['#срочно'], states: ['urgent', 'mine', 'theirs', 'quiet', 'done'] };
const now = new Date('2026-11-18T12:00:00');
let n = 0;
const tg = (account: string, chat: string, ts: string, text: string, extra: Record<string, unknown> = {}, who = `contact:tg:${account}:${chat.replace('-', '')}`, type = 'private') => ({
  id: `m${++n}`, schema_version: 1, source: 'telegram', author: who, ts, kind: 'text',
  payload: { text, ...extra, data: { telegram: { account, chat_id: chat, chat_type: type, chat_title: 'Анна Тестова', from_name: 'Анна' } } },
});
const mine = (chat: string, ts: string, text: string, account = 'by') => ({
  id: `m${++n}`, schema_version: 1, source: 'app', author: 'me', ts, kind: 'text',
  payload: { text, data: { outbound: { connector: `telegram_${account}`, chat_id: chat, chat_title: 'Анна Тестова' } } },
});
const change = (task: string, ts: string, data: Record<string, unknown>) => ({
  id: `c${++n}`, schema_version: 1, source: 'system', author: 'system', ts, kind: 'task_change', payload: { ref: { type: 'task', id: task }, data: { task: data } },
});
const build = (events: any[]) => {
  const tasks = foldTasks(events, { filedTemplates: ['chatter'] });
  const byMessage = tasksByMessage(tasks);
  const views = project(events).map((view: any) => ({ ...view, taskIds: byMessage.get(view.id) ?? [] }));
  return { tasks, views };
};
const run = (events: any[]) => { const { views, tasks } = build(events); return conversations(views, tasks, { now, config }); };

test('one person in BY and PL is one conversation, replied through the last account', () => {
  const list = run([tg('by', '501', '2026-11-18T09:00:00', 'привет'), tg('pl', '501', '2026-11-18T10:00:00', 'ещё тут'), tg('by', '-900', '2026-11-18T08:00:00', 'группа', {}, 'contact:tg:by:7', 'group')]);
  const person = list.find((c: any) => c.key === 'tg:501');
  assert.equal(list.length, 2);
  assert.equal(person.views.length, 2);
  assert.deepEqual([...person.channels].sort(), ['by', 'pl']);
  assert.equal(person.reply.account, 'pl');
  assert.equal(person.group, false);
  assert.equal(list.find((c: any) => c.key === 'tg:-900').group, true);
});

test('keys: chats, numbers, own notes, and events that are not messages', () => {
  assert.equal(conversationOf(tg('by', '501', '2026-11-18T09:00:00', 'x')), 'tg:501');
  assert.equal(conversationOf(mine('501', '2026-11-18T09:00:00', 'x', 'pl')), 'tg:501');
  assert.equal(conversationOf({ source: 'android_phone', kind: 'sms', author: 'x', payload: { data: { sms: { number: '+48 600-100-200' } } } }), 'tel:+48600100200');
  assert.equal(conversationOf({ source: 'android_phone', kind: 'call', author: 'x', payload: { data: { call: { number: '' } } } }), null);
  assert.equal(conversationOf({ source: 'app', author: 'me', kind: 'text', payload: { text: 'идея' } }), 'me');
  assert.equal(conversationOf({ source: 'share', author: 'me', kind: 'text', payload: { text: 'ссылка' } }), 'me');
  for (const kind of ['system', 'correction', 'task_change']) assert.equal(conversationOf({ source: 'system', author: 'system', kind, payload: {} }), null);
});

test('«спасибо» filed as chatter does not wait for me; an untriaged message does', () => {
  const base = [tg('by', '501', '2026-11-18T09:00:00', 'нужен счёт'), mine('501', '2026-11-18T09:10:00', 'пришлю')];
  const thanks = tg('by', '501', '2026-11-18T10:00:00', 'спасибо');
  const filed = [...base, thanks,
    change('t1', '2026-11-18T10:01:00', { op: 'create', title: 'без дела', template: 'chatter', status: 'done', add: [thanks.id] })];
  assert.equal(run(filed)[0].state, 'theirs');
  assert.equal(run([...base, thanks])[0].state, 'mine');
});

test('my last message → theirs; a delegated task I control → theirs', () => {
  assert.equal(run([tg('by', '501', '2026-11-18T09:00:00', 'вопрос'), mine('501', '2026-11-18T09:10:00', 'ответ')])[0].state, 'theirs');
  const ask = mine('502', '2026-11-18T09:00:00', 'привези кабель');
  const ok = tg('by', '502', '2026-11-18T09:01:00', 'ок');
  const events = [ask, ok, change('f1', '2026-11-18T09:02:00', { op: 'create', title: 'без дела', template: 'chatter', status: 'done', add: [ok.id] }), change('d1', '2026-11-18T09:05:00', { op: 'create', title: 'Привезти кабель', status: 'todo', add: [ask.id], roles: { author: 'me', executors: ['tg:502'], controller: 'me' } })];
  assert.equal(build(events).tasks.find((t: any) => t.id === 'd1').roles.controller, 'me');
  assert.equal(run(events)[0].state, 'theirs');
});

test('overdue task of mine → urgent; a team task without me changes nothing', () => {
  const m = tg('by', '501', '2026-11-18T09:00:00', 'починить');
  const overdue = [m, change('u1', '2026-11-18T09:05:00', { op: 'create', title: 'Починить', status: 'todo', due: '2026-11-17', add: [m.id], roles: { responsible: 'me', executors: ['me'] } })];
  assert.equal(run(overdue)[0].state, 'urgent');
  const team = [m, mine('501', '2026-11-18T09:30:00', 'ок'), change('u2', '2026-11-18T09:05:00', { op: 'create', title: 'Чужое', status: 'todo', due: '2026-11-10', add: [m.id], roles: { responsible: 'tg:7', executors: ['tg:8'] } })];
  assert.equal(run(team)[0].state, 'theirs');
  assert.equal(run([tg('by', '503', '2026-11-18T09:00:00', 'ломается', { tags: ['#срочно'] })])[0].state, 'urgent');
});

test('quiet and done: open tasks or a fresh last message keep it quiet', () => {
  const old = tg('by', '501', '2026-11-01T09:00:00', 'ок');
  const reply = mine('501', '2026-11-01T09:30:00', 'ага');
  assert.equal(run([old, reply])[0].state, 'theirs');
  const chat = tg('by', '-900', '2026-11-10T09:00:00', 'болтовня', {}, 'contact:tg:by:7', 'group');
  const team = [chat, change('w1', '2026-11-10T10:00:00', { op: 'create', title: 'Чужое дело', status: 'todo', add: [chat.id], roles: { responsible: 'tg:9', executors: ['tg:9'] } })];
  assert.equal(run(team)[0].state, 'quiet', 'an open team task without me, and nothing addressed to me');
  const closed = [old, reply, change('w2', '2026-11-01T10:00:00', { op: 'create', title: 'Готово', status: 'done', add: [old.id, reply.id] })];
  const c = run(closed)[0];
  assert.equal(conversationState({ ...c, views: c.views.slice(0, 1) }, { now, config }), 'mine', 'incoming last message, even if old');
  assert.equal(conversationState({ ...c, views: [], last: '2026-11-01T09:30:00' }, { now, config }), 'done');
  assert.equal(conversationState({ ...c, views: [], last: '2026-11-17T09:30:00' }, { now, config }), 'quiet');
});

test('order: urgent, mine, theirs, quiet, done; newest first inside', () => {
  const events = [
    tg('by', '1', '2026-11-18T08:00:00', 'a'),
    tg('by', '2', '2026-11-18T09:00:00', 'b'),
    mine('3', '2026-11-18T07:00:00', 'c'),
    mine('4', '2026-11-18T07:30:00', 'd'),
    tg('by', '5', '2026-11-18T06:00:00', 'e', { tags: ['#срочно'] }),
  ];
  assert.deepEqual(run(events).map((c: any) => c.key), ['tg:5', 'tg:2', 'tg:1', 'tg:4', 'tg:3']);
  assert.deepEqual(run(events).map((c: any) => c.state), ['urgent', 'mine', 'mine', 'theirs', 'theirs']);
});

test('a busy group waits for me only when it answers me or is in my task', () => {
  const my = mine('-900', '2026-11-18T08:00:00', 'кто свободен?');
  const chatter = tg('by', '-900', '2026-11-18T09:00:00', 'всем привет', {}, 'contact:tg:by:7', 'group');
  assert.equal(run([my, chatter])[0].state, 'theirs');
  const answer = { ...tg('by', '-900', '2026-11-18T09:30:00', 'я свободен', {}, 'contact:tg:by:8', 'group'), reply_to: my.id };
  assert.equal(run([my, chatter, answer])[0].state, 'mine');
  const task = [my, chatter, change('g1', '2026-11-18T09:05:00', { op: 'create', title: 'Моё', status: 'todo', add: [chatter.id], roles: { responsible: 'me', executors: ['me'] } })];
  assert.equal(run(task)[0].state, 'mine');
});

const phone = (kind: 'sms' | 'call', direction: string, ts: string, number = '+48 600 100 200') => ({
  id: `p${++n}`, schema_version: 1, source: 'android_phone', author: 'me', ts, kind, payload: { text: kind === 'sms' ? 'текст' : undefined, data: { [kind]: { number, direction } } },
});

test('phone events are all authored by me: direction decides who spoke last', () => {
  assert.equal(run([phone('sms', 'in', '2026-11-18T09:00:00')])[0].state, 'mine');
  assert.equal(run([phone('sms', 'out', '2026-11-18T08:00:00'), phone('call', 'missed', '2026-11-18T09:00:00')])[0].state, 'mine', 'a missed call waits for me');
  assert.equal(run([phone('call', 'rejected', '2026-11-18T08:00:00')])[0].state, 'mine');
  assert.equal(run([phone('sms', 'in', '2026-11-18T08:00:00'), phone('sms', 'out', '2026-11-18T09:00:00')])[0].state, 'theirs');
  assert.equal(run([phone('sms', 'out', '2026-11-18T08:00:00'), phone('call', 'unknown', '2026-11-18T09:00:00')])[0].state, 'theirs', 'unknown is neither');
});

test('a leading 00 is a plus; digits without a prefix stay as they are', () => {
  const list = run([phone('sms', 'in', '2026-11-18T08:00:00', '0048 600 100 200'), phone('call', 'in', '2026-11-18T09:00:00', '+48600100200')]);
  assert.equal(list.length, 1);
  assert.equal(list[0].key, 'tel:+48600100200');
  assert.equal(conversationOf(phone('sms', 'in', '2026-11-18T08:00:00', '600 100 200')), 'tel:600100200');
});
