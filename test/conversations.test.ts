import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { conversationOf, conversations } from '../web/conversations.js';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { project } from '../web/projection.js';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { foldTasks, tasksByMessage } from '../web/taskfold.js';

// Conversations: one per chat or number (P14). Names and texts are made up.
const config = { queue: { max_age_days: 7 } };
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

const phone = (kind: 'sms' | 'call', direction: string, ts: string, number = '+48 600 100 200') => ({
  id: `p${++n}`, schema_version: 1, source: 'android_phone', author: 'me', ts, kind, payload: { text: kind === 'sms' ? 'текст' : undefined, data: { [kind]: { number, direction } } },
});

test('a leading 00 is a plus; digits without a prefix stay as they are', () => {
  const list = run([phone('sms', 'in', '2026-11-18T08:00:00', '0048 600 100 200'), phone('call', 'in', '2026-11-18T09:00:00', '+48600100200')]);
  assert.equal(list.length, 1);
  assert.equal(list[0].key, 'tel:+48600100200');
  assert.equal(conversationOf(phone('sms', 'in', '2026-11-18T08:00:00', '600 100 200')), 'tel:600100200');
});

test('a queue tile: channel, task (guessed when the AI linked it), two lines of the last message, how long it waits', async () => {
  // @ts-expect-error Browser modules are deliberately buildless JavaScript.
  const { tileFacts, tasksLabel } = await import('../web/convlist.js');
  // @ts-expect-error Browser modules are deliberately buildless JavaScript.
  const { withWhom } = await import('../web/conversations.js');
  const ask = tg('pl', '777', '2026-11-18T09:00:00', 'когда приедете?', { tags: ['#выезд'] });
  const more = tg('pl', '777', '2026-11-18T09:05:00', 'и захватите кабель');
  const events = [ask, more, change('k1', '2026-11-18T09:06:00', { op: 'create', title: 'Анна: выезд', status: 'inbox', add: [ask.id, more.id], counterparty: 'cp1' })];
  const [person] = run(events);
  const facts = tileFacts(person, { now, hotHours: 2, counterparties: [{ id: 'cp1', title: 'Неоформ' }] });
  assert.deepEqual([facts.kind, facts.channel, facts.title], ['chat', 'TG PL', 'Анна Тестова']);
  assert.deepEqual(facts.task && [facts.task.id, facts.task.title, facts.task.guessed], ['k1', 'Анна: выезд', true]);
  assert.equal(facts.snippet, 'и захватите кабель');
  assert.deepEqual([facts.waited, facts.hot, facts.count], ['3 ч', true, 2]);
  assert.equal(facts.counterparty, 'Неоформ');
  assert.deepEqual(facts.tags, ['#выезд']);
  assert.equal(facts.when, '09:05');
  const call = run([phone('call', 'missed', '2026-11-18T11:30:00')])[0];
  const quiet = tileFacts(call, { now, hotHours: 2, counterparties: [] });
  assert.deepEqual([quiet.kind, quiet.channel, quiet.task, quiet.waited, quiet.hot], ['phone', 'Тел', null, '30 мин', false]);
  assert.deepEqual([1, 3, 5, 21].map(tasksLabel), ['1 задача', '3 задачи', '5 задач', '21 задача']);
  assert.deepEqual(withWhom(person.views), ['Анна Тестова']);
});

test('task plaques: open tasks only, executor in words, due date', async () => {
  // @ts-expect-error Browser modules are deliberately buildless JavaScript.
  const { plaqueFacts } = await import('../web/convtasks.js');
  // @ts-expect-error Browser modules are deliberately buildless JavaScript.
  const { partyName } = await import('../web/parties.js');
  const ask = tg('by', '778', '2026-11-18T09:00:00', 'нужен счёт');
  const events = [ask,
    change('q1', '2026-11-18T09:05:00', { op: 'create', title: 'Выставить счёт', status: 'todo', due: '2026-11-17', add: [ask.id], roles: { responsible: 'me', executors: ['tg:778'] } }),
    change('q2', '2026-11-18T09:06:00', { op: 'create', title: 'Старое', status: 'done', add: [ask.id] })];
  const [person] = run(events);
  const plaques = plaqueFacts(person, now);
  assert.deepEqual(plaques.map((item: any) => item.title), ['Выставить счёт']);
  assert.match(plaques[0].facts, /^сделать · Анна Тестова · просрочено, до/);
  assert.equal(plaques[0].overdue, true);
  assert.equal(partyName('me', person.views), 'Я');
  assert.equal(partyName('name:Пётр', person.views), 'Пётр');
  assert.equal(partyName('tel:+48111', person.views), '+48111', 'an unknown number as it is');
});

test('own notes that continue or answer a message join its conversation, through chains', () => {
  const call = phone('call', 'missed', '2026-11-18T09:00:00', '+48 600 300 400');
  const note = (ts: string, extra: Record<string, unknown>, target?: string) => ({ id: `n${++n}`, schema_version: 1, source: 'app', author: 'me', ts, kind: 'text',
    payload: { text: 'заметка', data: target ? { continuation: { on: true, target } } : {} }, ...extra });
  const describe = note('2026-11-18T09:10:00', {}, call.id); // «Описать» continues the call
  const more = note('2026-11-18T09:12:00', {}, describe.id);
  const ask = tg('pl', '880', '2026-11-18T10:00:00', 'можно счёт?');
  const answer = note('2026-11-18T10:05:00', { reply_to: ask.id });
  const plain = note('2026-11-18T10:30:00', {});
  const { views, tasks } = build([call, describe, more, ask, answer, plain]);
  const list = conversations(views, tasks, { now, config });
  const byKey = new Map<string, any>(list.map((item: any) => [item.key, item]));
  assert.deepEqual(byKey.get('tel:+48600300400').views.map((view: any) => view.id), [call.id, describe.id, more.id], 'the description and its follow-up stay with the call');
  assert.equal(byKey.get('tel:+48600300400').title, '+48600300400', 'the title comes from the call, not the note');
  assert.equal(byKey.get('tel:+48600300400').queue.waiting, true, 'a description is not an answer to the caller');
  assert.deepEqual(byKey.get('tg:880').views.map((view: any) => view.id), [ask.id, answer.id], 'a reply without a recipient stays in the chat');
  assert.deepEqual(byKey.get('me').views.map((view: any) => view.id), [plain.id]);
});

const answered = (target: string, ts: string, op = 'answered') => ({
  id: `a${++n}`, schema_version: 1, source: 'app', author: 'me', ts, kind: 'correction', payload: { ref: { type: 'event', id: target }, data: { op } },
});

test('the archive mark on the latest message stops a conversation waiting for me; a newer message brings it back', () => {
  const ask = tg('by', '501', '2026-11-18T09:00:00', 'можно сегодня?');
  const task = change('t1', '2026-11-18T09:05:00', { op: 'create', title: 'ответить', status: 'inbox', roles: { author: 'tg:501', responsible: 'me', executors: [] }, add: [ask.id] });
  assert.equal(run([ask, task])[0].queue.waiting, true);
  const marked = [ask, task, answered(ask.id, '2026-11-18T09:30:00')];
  assert.equal(run(marked)[0].queue.waiting, false);
  assert.equal(run([...marked, answered(ask.id, '2026-11-18T09:40:00', 'unanswered')])[0].queue.waiting, true);
  assert.equal(run([...marked, tg('by', '501', '2026-11-18T10:00:00', 'алло?')])[0].queue.waiting, true);
});

test('a conversation is archived until a newer message, theirs or mine', () => {
  const ask = tg('by', '501', '2026-11-18T09:00:00', 'вопрос');
  const marked = [ask, answered(ask.id, '2026-11-18T09:30:00')];
  assert.equal(run([ask])[0].archived, false);
  assert.equal(run(marked)[0].archived, true);
  assert.equal(run([...marked, answered(ask.id, '2026-11-18T09:40:00', 'unanswered')])[0].archived, false);
  assert.equal(run([...marked, tg('by', '501', '2026-11-18T10:00:00', 'ещё')])[0].archived, false);
  assert.equal(run([...marked, mine('501', '2026-11-18T10:00:00', 'отвечу')])[0].archived, false);
});

test('an own note in a task of its own is a conversation named by the task; filed or untriaged notes stay in «Заметки»', () => {
  const note = (ts: string, text: string, extra: Record<string, unknown> = {}) => ({ id: `n${++n}`, schema_version: 1, source: 'app', author: 'me', ts, kind: 'text', payload: { text, data: {} }, ...extra });
  const a = note('2026-11-18T09:00:00', 'купить кабель');
  const b = note('2026-11-18T09:05:00', 'и коннекторы');
  const c = note('2026-11-18T09:10:00', 'заказ на Dzika 11');
  const mood = note('2026-11-18T09:20:00', 'выспался');
  const loose = note('2026-11-18T09:30:00', 'мысль');
  const events = [a, b, c, mood, loose,
    change('t-cable', '2026-11-18T09:06:00', { op: 'create', title: 'Купить кабель и коннекторы', status: 'todo', add: [a.id, b.id] }),
    change('t-order', '2026-11-18T09:11:00', { op: 'create', title: 'Заказ Dzika 11', status: 'todo', add: [c.id] }),
    change('t-mood', '2026-11-18T09:21:00', { op: 'create', title: 'Самочувствие', status: 'done', template: 'chatter', add: [mood.id] })];
  const byKey = new Map<string, any>(run(events).map((item: any) => [item.key, item]));
  assert.deepEqual(byKey.get('task:t-cable').views.map((view: any) => view.id), [a.id, b.id]);
  assert.equal(byKey.get('task:t-cable').title, 'Купить кабель и коннекторы');
  assert.deepEqual(byKey.get('task:t-order').views.map((view: any) => view.id), [c.id]);
  assert.deepEqual(byKey.get('me').views.map((view: any) => view.id), [mood.id, loose.id]);
  assert.equal(byKey.get('me').title, 'Заметки');
});

test('a message split off its chat is a conversation of its own, with what continues it; the chat keeps the rest', () => {
  const first = tg('by', '777', '2026-11-18T09:00:00', 'привет');
  const ask = tg('by', '777', '2026-11-18T09:01:00', 'настройте принтер');
  const more = tg('by', '777', '2026-11-18T09:02:00', 'модель 426', { reply_to: ask.id });
  const split = { id: `s${++n}`, schema_version: 1, source: 'app', author: 'me', ts: '2026-11-18T09:05:00', kind: 'correction', payload: { ref: { type: 'event', id: ask.id }, data: { op: 'split' } } };
  const events = [first, ask, { ...more, reply_to: ask.id }, split, change('t-print', '2026-11-18T09:06:00', { op: 'create', title: 'Анна: настройка принтера', status: 'todo', add: [ask.id] })];
  const byKey = new Map<string, any>(run(events).map((item: any) => [item.key, item]));
  assert.deepEqual(byKey.get('tg:777').views.map((view: any) => view.id), [first.id]);
  const own = byKey.get(`split:${ask.id}`);
  assert.deepEqual(own.views.map((view: any) => view.id), [ask.id, more.id]);
  assert.equal(own.title, 'Анна: настройка принтера', 'named by its task');
  assert.equal(own.reply.chat_id, '777', 'answers still go to the chat');
  const unsplit = { ...split, id: `s${++n}`, ts: '2026-11-18T09:10:00', payload: { ...split.payload, data: { op: 'unsplit' } } };
  assert.ok(run([...events, unsplit]).every((item: any) => !item.key.startsWith('split:')), '«Вернуть в беседу» puts it back');
});
