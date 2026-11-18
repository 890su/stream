import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { temporaryStore, event, fixture } from './helpers.ts';
import { LiveFeed } from '../src/server/live.ts';
import { Triage, streamOf } from '../src/tasks/triage.ts';
import { foldTasks } from '../src/tasks/fold.ts';
import type { PlanInput, PlanOutput } from '../src/tasks/planner.ts';
import type { JournalEvent } from '../src/contracts/validate.ts';

// Task triage (CONCEPT.md §2.8) with a scripted planner instead of AI. Texts are made up.
const QUIET = 60_000;
const CHAT_QUIET = 180_000;
const telegram = (chat: string, text: string): JournalEvent => event({
  source: 'telegram', author: `contact:tg:by:${chat}`, payload: { text, data: { telegram: { account: 'by', chat_id: chat, chat_type: 'private', chat_title: 'Клиент', message_id: Math.floor(Math.random() * 1e6) + 1, sent_at: '2026-11-17T10:00:00.000Z' } } },
});

function setup(plan: (input: PlanInput) => PlanOutput) {
  const storage = temporaryStore();
  const calls: PlanInput[] = [];
  const triage = new Triage({ store: storage.store, live: new LiveFeed(), planner: async (input) => { calls.push(input); return plan(input); } });
  const add = (item: JournalEvent) => storage.store.appendEvent(item).event;
  const tasks = () => foldTasks(storage.store.triage.taskEvents());
  return { ...storage, triage, calls, add, tasks };
}

test('a stream waits for its quiet window; streams are separate batches', async () => {
  const s = setup(() => ({ tasks: [] }));
  try {
    const mine = s.add(event({ payload: { text: 'купить кабель' } }));
    s.add(telegram('7001', 'нужна настройка роутера'));
    assert.equal(s.triage.ready(Date.now()).length, 0, 'nothing before the quiet window');
    const early = s.triage.ready(Date.now() + QUIET + 1000);
    assert.deepEqual(early.map((batch) => streamOf(batch[0]!)), ['me'], 'a chat waits longer than my notes');
    const batches = s.triage.ready(Date.now() + CHAT_QUIET + 1000);
    assert.equal(batches.length, 2);
    assert.deepEqual(batches.map((batch) => streamOf(batch[0]!)).sort(), ['me', 'tg|by|7001']);
    assert.equal(batches.find((batch) => batch[0]!.id === mine.id)!.length, 1);
  } finally { s.cleanup(); }
});

test('one batch becomes several tasks; a message may belong to two; nothing is triaged twice', async () => {
  const s = setup((input) => ({
    tasks: [
      { task_id: null, title: 'Настроить роутер у клиента', assignee: 'me', person: null, template: null, due: null, message_ids: [input.messages[0]!.id, input.messages[1]!.id], confidence: 0.9, note: null, filed: false, done: false },
      { task_id: null, title: 'Записать расход на кабель', assignee: 'ai', person: null, template: 'money', due: null, message_ids: [input.messages[1]!.id], confidence: 0.4, note: null, filed: false, done: false },
    ],
    usage: { input_tokens: 1000, output_tokens: 200 },
  }));
  try {
    const a = s.add(event({ payload: { text: 'завтра к Марку настроить роутер' } }));
    const b = s.add(event({ payload: { text: 'и купил ему кабель за 40 злотых', tags: ['#расход'] } }));
    for (const batch of s.triage.ready(Date.now() + QUIET + 1000)) await s.triage.run(batch);
    const tasks = s.tasks();
    assert.equal(tasks.length, 2);
    const router = tasks.find((task) => task.title.includes('роутер'))!;
    assert.deepEqual(router.messages, [a.id, b.id]);
    assert.equal(router.status, 'todo');
    assert.equal(router.created_by, 'system');
    const money = tasks.find((task) => task.template === 'money')!;
    assert.equal(money.status, 'inbox', 'low confidence waits in the inbox');
    assert.equal(money.assignee, 'ai');
    assert.deepEqual(s.calls[0]!.messages[1]!.tags, ['#расход']);
    assert.ok(s.calls[0]!.templates.some((template) => template.tag === '#дневник'));
    assert.equal(s.triage.ready(Date.now() + QUIET + 1000).length, 0, 'triaged messages are not sent again');
    assert.ok(s.store.triage.spent(new Date().toISOString().slice(0, 7)) > 0);
  } finally { s.cleanup(); }
});

test('a later message is added to an open task instead of a new one; «готово» asks instead of closing', async () => {
  let round = 0;
  const s = setup((input) => {
    round += 1;
    if (round === 1) return { tasks: [{ task_id: null, title: 'Перезвонить Марку', assignee: 'me', person: null, template: 'callback', due: null, message_ids: [input.messages[0]!.id], confidence: 0.9, note: null, filed: false, done: false }] };
    assert.equal(input.open_tasks.length, 1, 'open tasks are given as context');
    return { tasks: [{ task_id: input.open_tasks[0]!.id, title: 'Перезвонить Марку', assignee: 'me', person: null, template: null, due: null, message_ids: [input.messages[0]!.id], confidence: 0.8, note: null, filed: false, done: true }] };
  });
  try {
    const first = s.add(event({ payload: { text: 'перезвонить Марку' } }));
    for (const batch of s.triage.ready(Date.now() + QUIET + 1000)) await s.triage.run(batch);
    const second = s.add(event({ payload: { text: 'перезвонил, готово' }, ts: '2026-11-11T10:05:00.000Z' }));
    for (const batch of s.triage.ready(Date.now() + QUIET + 1000)) await s.triage.run(batch);
    const tasks = s.tasks();
    assert.equal(tasks.length, 1);
    assert.deepEqual(tasks[0]!.messages, [first.id, second.id]);
    assert.deepEqual([tasks[0]!.status, tasks[0]!.proposed], ['todo', 'done'], 'still open, the owner is asked');
  } finally { s.cleanup(); }
});

test('without a planner or over budget the triage only reports why', async () => {
  const storage = temporaryStore();
  try {
    const off = new Triage({ store: storage.store, live: new LiveFeed(), planner: null, reason: 'нет ключа ИИ' });
    storage.store.appendEvent(event({ payload: { text: 'что-то' } }));
    await off.tick(Date.now() + QUIET + 1000);
    assert.equal(storage.store.status.get('ai_triage')!.state, 'login_required');
    let called = false;
    const spent = new Triage({ store: storage.store, live: new LiveFeed(), planner: async () => { called = true; return { tasks: [] }; } });
    storage.store.triage.addUsage(new Date().toISOString().slice(0, 7), 0, 0, 1000);
    await spent.tick(Date.now() + QUIET + 1000);
    assert.equal(called, false);
    assert.match(storage.store.status.get('ai_triage')!.detail!, /лимит/);
  } finally { storage.cleanup(); }
});

test('task changes from the owner go through /api/events with the task contract', async () => {
  const f = await fixture();
  try {
    const post = (body: unknown) => f.request('/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const message = event({ payload: { text: 'забрать посылку' } });
    await post(message);
    const id = randomUUID();
    const change = (data: Record<string, unknown>, extra: Partial<JournalEvent> = {}) => event({ kind: 'task_change', payload: { ref: { type: 'task', id }, data: { task: data } }, ...extra });
    assert.equal((await post(change({ op: 'create', title: 'Забрать посылку', assignee: 'me', status: 'todo', add: [message.id] }))).status, 201);
    assert.equal((await post(change({ op: 'update', status: 'done' }))).status, 201);
    assert.equal((await post(change({ op: 'create' }))).status, 400, 'a new task needs a title');
    assert.equal((await post(event({ payload: { text: 'x', data: { task: { op: 'create', title: 'x' } } } }))).status, 400);
    assert.equal((await post(change({ op: 'update', assignee: 'robot' }))).status, 400);
    const tasks = foldTasks(f.store.triage.taskEvents());
    assert.equal(tasks[0]!.status, 'done');
    assert.deepEqual(tasks[0]!.messages, [message.id]);
  } finally { await f.stop(); }
});

test('every message gets an outcome: filed ones are done at once, a missed one becomes «Разобрать» for me', async () => {
  const s = setup((input) => {
    const [mood, job, , idea] = input.messages.map((message) => message.id);
    return {
      tasks: [
        { task_id: null, title: 'Самочувствие', assignee: 'ai', person: null, template: 'diary', due: null, message_ids: [mood!], confidence: 0.9, note: null, filed: true, done: false },
        { task_id: null, title: 'Поменять роутер у клиента', assignee: 'me', person: null, template: null, due: null, message_ids: [job!], confidence: 0.9, note: null, filed: false, done: false },
        { task_id: null, title: 'Идея для ленты', assignee: 'ai', person: null, template: 'plan', due: null, message_ids: [idea!], confidence: 0.3, note: null, filed: true, done: false },
      ],
    };
  });
  try {
    s.add(event({ payload: { text: 'выспался, энергия 4 из 5' } }));
    s.add(event({ payload: { text: 'клиенту поменять роутер в пятницу' } }));
    const ok = s.add(event({ payload: { text: 'ок' } }));
    s.add(event({ payload: { text: 'в ленте нужен поиск по дате' } }));
    for (const batch of s.triage.ready(Date.now() + QUIET + 1000)) await s.triage.run(batch);
    const byTitle = new Map(s.tasks().map((task) => [task.title, task]));
    assert.equal(byTitle.get('Самочувствие')!.status, 'done', 'filed — closed at once');
    assert.equal(byTitle.get('Самочувствие')!.template, 'diary');
    assert.equal(byTitle.get('Поменять роутер у клиента')!.status, 'todo');
    assert.equal(byTitle.get('Идея для ленты')!.status, 'inbox', 'low confidence is not closed');
    const unsorted = byTitle.get('Разобрать')!;
    assert.deepEqual(unsorted.messages, [ok.id]);
    assert.equal(unsorted.assignee, 'me');
    assert.equal(unsorted.status, 'inbox');
    assert.equal(s.tasks().filter((task) => task.processor === 'triage-ai-v4').length, 4);
  } finally { s.cleanup(); }
});

test('a later batch of a conversation sees its earlier messages as context, other chats stay out', async () => {
  const s = setup((input) => {
    if (!input.context.length) return { tasks: input.messages.map((message, index) => ({ task_id: null, title: `Дело ${index}`, assignee: 'me' as const, person: null, template: null, due: null, message_ids: [message.id], confidence: 0.9, note: null, filed: false, done: false })) };
    return { tasks: [{ task_id: input.context[0]!.in_tasks[0]!, title: 'Дело 0', assignee: 'me', person: null, template: null, due: null, message_ids: [input.messages[0]!.id], confidence: 0.9, note: null, filed: false, done: false }] };
  });
  try {
    const first = s.add(telegram('7001', 'нужна настройка роутера'));
    s.add(telegram('7002', 'другой клиент'));
    for (const batch of s.triage.ready(Date.now() + CHAT_QUIET + 1000)) await s.triage.run(batch);
    const later = s.add(telegram('7001', 'в пятницу после 17'));
    for (const batch of s.triage.ready(Date.now() + CHAT_QUIET + 1000)) await s.triage.run(batch);
    const call = s.calls.at(-1)!;
    assert.deepEqual(call.context.map((message) => message.id), [first.id], 'only this chat');
    assert.equal(call.context[0]!.in_tasks.length, 1, 'context carries its task');
    const task = s.tasks().find((item) => item.messages.includes(first.id))!;
    assert.deepEqual(task.messages, [first.id, later.id]);
  } finally { s.cleanup(); }
});
