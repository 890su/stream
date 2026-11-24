import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { temporaryStore, event, fixture, token } from './helpers.ts';
import { createApp } from '../src/server/http.ts';
import { tasksConfig } from '../src/config.ts';
import { LiveFeed } from '../src/server/live.ts';
import { Triage, streamOf } from '../src/tasks/triage.ts';
import { foldTasks } from '../src/tasks/fold.ts';
import { nameId as nameIdOf } from '../src/ids.ts';
import type { PlanInput, PlanOutput } from '../src/tasks/planner.ts';
import type { JournalEvent } from '../src/contracts/validate.ts';

// Task triage (CONCEPT.md §2.8) with a scripted planner instead of AI. Texts are made up.
const QUIET = 60_000;
const CHAT_QUIET = 180_000;
type ScriptedPlan = Omit<PlanOutput, 'conversation_only'>;
interface Proposal { id: string; task_id: string; message_ids: string[]; reason: string; confidence: number; alternatives: string[]; change: Record<string, unknown> }
const telegram = (chat: string, text: string, from = chat): JournalEvent => event({
  source: 'telegram', author: `contact:tg:by:${from}`, payload: { text, data: { telegram: { account: 'by', chat_id: chat, chat_type: 'private', chat_title: 'Клиент', message_id: Math.floor(Math.random() * 1e6) + 1, sent_at: '2026-11-17T10:00:00.000Z' } } },
});

function setup(plan: (input: PlanInput) => ScriptedPlan, { newTasks = 'confirmed' as 'confirmed' | 'unconfirmed' } = {}) {
  const storage = temporaryStore();
  const calls: PlanInput[] = [];
  const triage = new Triage({ store: storage.store, live: new LiveFeed(), newTasks: () => newTasks, planner: async (input) => { calls.push(input); return { conversation_only: [], ...plan(input) }; } });
  const add = (item: JournalEvent) => storage.store.appendEvent(item).event;
  const tasks = () => foldTasks(storage.store.triage.taskEvents());
  // Changes of existing tasks come as proposals (docs/plans/2026-11-21-ai-proposals-design.md); `accept` answers
  // every one not answered yet as the owner would with ✓.
  const proposals = () => storage.store.triage.results().flatMap((result) => (result.payload.data?.triage as { proposals?: Proposal[] }).proposals ?? []);
  const accepted = new Set<string>();
  const accept = () => {
    for (const proposal of proposals().filter((item) => !accepted.has(item.id))) {
      accepted.add(proposal.id);
      storage.store.appendEvent({ id: randomUUID(), schema_version: 1, source: 'app', author: 'me', ts: new Date().toISOString(), kind: 'task_change',
        payload: { ref: { type: 'task', id: proposal.task_id }, data: { task: { ...proposal.change, proposal: proposal.id } } } });
    }
  };
  return { ...storage, triage, calls, add, tasks, proposals, accept };
}

const lastChange = (s: ReturnType<typeof setup>, title: string) => s.store.triage.taskEvents()
  .map((item) => item.payload.data!.task as Record<string, any>).find((change) => change.title === title)!;
const planned = (data: Partial<PlanOutput['tasks'][number]>): PlanOutput['tasks'][number] => ({ task_id: null, title: 'Дело', responsible: 'me', executors: [], author: null, template: null, due: null, message_ids: [], confidence: 0.9, note: null, filed: false, done: false, alternatives: [], ...data });

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
      { task_id: null, title: 'Настроить роутер у клиента', responsible: 'me', executors: [], author: null, template: null, due: null, message_ids: [input.messages[0]!.id, input.messages[1]!.id], confidence: 0.9, note: null, filed: false, done: false, alternatives: [] },
      { task_id: null, title: 'Записать расход на кабель', responsible: 'me', executors: ['ai'], author: null, template: 'money', due: null, message_ids: [input.messages[1]!.id], confidence: 0.4, note: null, filed: false, done: false, alternatives: [] },
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

test('a later message is linked to an open task instead of a new one; «готово» asks instead of closing', async () => {
  let round = 0;
  const s = setup((input) => {
    round += 1;
    if (round === 1) return { tasks: [{ task_id: null, title: 'Перезвонить Марку', responsible: 'me', executors: [], author: null, template: 'callback', due: null, message_ids: [input.messages[0]!.id], confidence: 0.9, note: null, filed: false, done: false, alternatives: [] }] };
    assert.equal(input.open_tasks.length, 1, 'open tasks are given as context');
    return { tasks: [{ task_id: input.open_tasks[0]!.id, title: 'Перезвонить Марку', responsible: 'me', executors: [], author: null, template: null, due: null, message_ids: [input.messages[0]!.id], confidence: 0.8, note: null, filed: false, done: true, alternatives: [] }] };
  });
  try {
    const first = s.add(event({ payload: { text: 'перезвонить Марку' } }));
    for (const batch of s.triage.ready(Date.now() + QUIET + 1000)) await s.triage.run(batch);
    const second = s.add(event({ payload: { text: 'перезвонил, готово' }, ts: '2026-11-11T10:05:00.000Z' }));
    for (const batch of s.triage.ready(Date.now() + QUIET + 1000)) await s.triage.run(batch);
    assert.deepEqual(s.tasks()[0]!.messages, [first.id, second.id], 'the link is applied at once (v21)');
    assert.equal(s.tasks()[0]!.proposed, undefined, '«done» is only proposed');
    s.accept();
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
    const spent = new Triage({ store: storage.store, live: new LiveFeed(), planner: async () => { called = true; return { tasks: [], conversation_only: [] }; } });
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

test('filed ones are done at once; a message the AI left out gets no task (v21)', async () => {
  const s = setup((input) => {
    const [mood, job, , idea] = input.messages.map((message) => message.id);
    return {
      tasks: [
        { task_id: null, title: 'Самочувствие', responsible: 'me', executors: ['ai'], author: null, template: 'diary', due: null, message_ids: [mood!], confidence: 0.9, note: null, filed: true, done: false, alternatives: [] },
        { task_id: null, title: 'Поменять роутер у клиента', responsible: 'me', executors: [], author: null, template: null, due: null, message_ids: [job!], confidence: 0.9, note: null, filed: false, done: false, alternatives: [] },
        { task_id: null, title: 'Идея для ленты', responsible: 'me', executors: ['ai'], author: null, template: 'plan', due: null, message_ids: [idea!], confidence: 0.3, note: null, filed: true, done: false, alternatives: [] },
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
    assert.equal(s.tasks().some((task) => task.messages.includes(ok.id)), false, 'no «Разобрать»');
    assert.equal(s.tasks().filter((task) => task.processor === tasksConfig.ai.processor).length, 3);
  } finally { s.cleanup(); }
});

test('a later batch of a conversation sees its earlier messages as context, other chats stay out', async () => {
  const s = setup((input) => {
    if (!input.context.length) return { tasks: input.messages.map((message, index) => ({ task_id: null, title: `Дело ${index}`, responsible: 'me', executors: [], author: null, template: null, due: null, message_ids: [message.id], confidence: 0.9, note: null, filed: false, done: false, alternatives: [] })) };
    return { tasks: [{ task_id: input.context[0]!.in_tasks[0]!, title: 'Дело 0', responsible: 'me', executors: [], author: null, template: null, due: null, message_ids: [input.messages[0]!.id], confidence: 0.9, note: null, filed: false, done: false, alternatives: [] }] };
  });
  try {
    const first = s.add(telegram('7001', 'нужна настройка роутера'));
    s.add(telegram('7002', 'другой клиент'));
    for (const batch of s.triage.ready(Date.now() + CHAT_QUIET + 1000)) await s.triage.run(batch);
    const later = s.add(telegram('7001', 'в пятницу после 17'));
    for (const batch of s.triage.ready(Date.now() + CHAT_QUIET + 1000)) await s.triage.run(batch);
    s.accept();
    const call = s.calls.at(-1)!;
    assert.deepEqual(call.context.map((message) => message.id), [first.id], 'only this chat');
    assert.equal(call.context[0]!.in_tasks.length, 1, 'context carries its task');
    const task = s.tasks().find((item) => item.messages.includes(first.id))!;
    assert.deepEqual(task.messages, [first.id, later.id]);
  } finally { s.cleanup(); }
});

test('a closed case is not reopened: a thank-you is linked to it, the record stays closed (v21)', async () => {
  let round = 0;
  const s = setup((input) => {
    round += 1;
    const m = input.messages[0]!.id;
    if (round === 1) return { tasks: [planned({ title: 'Wi-Fi у клиента', template: 'todo', message_ids: [m] })] };
    assert.equal(input.closed_tasks.length, 1, 'recently closed cases are given');
    return { tasks: [planned({ task_id: input.closed_tasks[0]!.id, title: 'Wi-Fi у клиента', message_ids: [m], alternatives: ['not-a-task'] })] };
  });
  try {
    s.add(event({ payload: { text: 'не работает Wi-Fi' } }));
    for (const batch of s.triage.ready(Date.now() + QUIET + 1000)) await s.triage.run(batch);
    const wifi = s.tasks()[0]!;
    s.add({ id: randomUUID(), schema_version: 1, source: 'app', author: 'me', ts: new Date().toISOString(), kind: 'task_change', payload: { ref: { type: 'task', id: wifi.id }, data: { task: { op: 'update', status: 'done' } } } });
    const later = s.add(event({ payload: { text: 'спасибо, всё работает' }, ts: '2026-11-11T10:10:00.000Z' }));
    for (const batch of s.triage.ready(Date.now() + QUIET + 1000)) await s.triage.run(batch);
    const back = s.tasks().find((task) => task.id === wifi.id)!;
    assert.equal(back.status, 'done', 'not back at work');
    assert.ok(back.messages.includes(later.id), 'linked');
    assert.equal(s.tasks().length, 1);
    assert.deepEqual(s.proposals(), [], 'nothing to propose');
  } finally { s.cleanup(); }
});

test('triage writes roles: a client asks me, a partner asks a partner', async () => {
  const s = setup((input) => {
    const first = input.messages[0]!;
    return { tasks: [first.party === 'tg:10'
      ? planned({ title: 'Настроить роутер', responsible: 'me', executors: ['me'], author: 'tg:10', message_ids: [first.id] })
      : planned({ title: 'Съездить к клиенту', responsible: 'tg:30', executors: [], author: 'tg:20', message_ids: [first.id] })] };
  });
  try {
    s.add(telegram('10', 'настройте роутер'));
    s.add(telegram('-500', 'Паша, съезди к клиенту', '20'));
    s.add(telegram('-500', 'ок', '30'));
    for (const batch of s.triage.ready(Date.now() + CHAT_QUIET + 1000)) await s.triage.run(batch);
    assert.equal(s.calls[0]!.messages[0]!.party, 'tg:10');
    const mine = lastChange(s, 'Настроить роутер');
    assert.deepEqual(mine.roles, { author: 'tg:10', responsible: 'me', executors: ['me'] });
    assert.equal('assignee' in mine, false);
    const theirs = s.tasks().find((task) => task.title === 'Съездить к клиенту')!;
    assert.equal(theirs.roles.responsible, 'tg:30');
    assert.equal(theirs.roles.author, 'tg:20');
    assert.ok(!JSON.stringify(theirs.roles).includes('"me"'), 'no me in any role');
  } finally { s.cleanup(); }
});

test('a party the planner made up is dropped; the owner controls what others do for him', async () => {
  const s = setup((input) => ({ tasks: [
    planned({ title: 'Дело А', responsible: 'tg:777', executors: ['tg:999', 'name:Паша'], author: 'tg:555', message_ids: [input.messages[0]!.id] }),
    planned({ title: 'Дело Б', responsible: 'me', executors: ['tg:10'], author: 'me', message_ids: [input.messages[1]!.id] }),
  ] }));
  try {
    s.add(telegram('10', 'сделайте А'));
    s.add(telegram('10', 'и Б'));
    for (const batch of s.triage.ready(Date.now() + CHAT_QUIET + 1000)) await s.triage.run(batch);
    assert.deepEqual(lastChange(s, 'Дело А').roles, { author: 'tg:10', responsible: 'me', executors: ['name:Паша'], controller: 'me' });
    assert.deepEqual(lastChange(s, 'Дело Б').roles, { author: 'me', responsible: 'me', executors: ['tg:10'], controller: 'me' });
  } finally { s.cleanup(); }
});

test('a filed template gets its executor from the registry', async () => {
  const s = setup((input) => ({ tasks: [planned({ title: 'Самочувствие', template: 'diary', filed: true, executors: [], message_ids: [input.messages[0]!.id] })] }));
  try {
    s.add(event({ payload: { text: 'выспался' } }));
    s.add(event({ payload: { text: 'ок' } }));
    for (const batch of s.triage.ready(Date.now() + QUIET + 1000)) await s.triage.run(batch);
    assert.deepEqual(lastChange(s, 'Самочувствие').roles, { author: 'me', responsible: 'me', executors: ['ai'], controller: 'me' });
  } finally { s.cleanup(); }
});

test('an incoming SMS is the caller\'s: party tel:, from by name; a tel: responsible from the AI is kept', async () => {
  const s = setup((input) => ({ tasks: [planned({ title: 'Перезвонить', responsible: 'tel:+48600100200', executors: [], author: input.messages[0]!.party, message_ids: [input.messages[0]!.id] })] }));
  try {
    s.add(event({ source: 'android_phone', kind: 'sms', payload: { text: 'перезвоните', data: { sms: { direction: 'in', number: '+48 600 100 200', name: 'Ян Тестовый', sent_at: '2026-11-18T09:00:00.000Z' } } } }));
    for (const batch of s.triage.ready(Date.now() + 3_600_000)) await s.triage.run(batch);
    assert.equal(s.calls[0]!.messages[0]!.party, 'tel:+48600100200');
    assert.equal(s.calls[0]!.messages[0]!.from, 'Ян Тестовый');
    assert.deepEqual(lastChange(s, 'Перезвонить').roles, { author: 'tel:+48600100200', responsible: 'tel:+48600100200', executors: [] });
  } finally { s.cleanup(); }
});

test('what I ask someone else to answer for is under my control', async () => {
  const s = setup((input) => ({ tasks: [planned({ title: 'Счёт от Паши', responsible: 'tg:10', executors: [], author: 'me', message_ids: [input.messages[0]!.id] })] }));
  try {
    s.add(telegram('10', 'пришли счёт'));
    for (const batch of s.triage.ready(Date.now() + CHAT_QUIET + 1000)) await s.triage.run(batch);
    assert.deepEqual(lastChange(s, 'Счёт от Паши').roles, { author: 'me', responsible: 'tg:10', executors: [], controller: 'me' });
  } finally { s.cleanup(); }
});

test('a follow-up request becomes a checklist item of the job, which gets a general title; an owner title stays', async () => {
  let round = 0;
  const base = { responsible: 'me', executors: [], author: null, template: null, due: null, confidence: 0.9, note: null, filed: false, done: false, alternatives: [] };
  const s = setup((input) => {
    round += 1;
    const ids = [input.messages[0]!.id];
    if (round === 1) return { tasks: [{ ...base, task_id: null, title: 'Установить программу', message_ids: ids, items: ['установить программу'], rename: null }] };
    const job = input.open_tasks[0]!;
    if (round === 2) assert.deepEqual(job.items, [{ text: 'установить программу', done: false }], 'the checklist is given as context');
    assert.equal(input.job_days, 14);
    return { tasks: [{ ...base, task_id: job.id, title: job.title, message_ids: ids, items: ['установить программу', 'настроить почту', '  '], rename: 'Клиент: настройка компьютера' }] };
  });
  try {
    s.add(telegram('7002', 'поставьте программу'));
    for (const batch of s.triage.ready(Date.now() + CHAT_QUIET + 1000)) await s.triage.run(batch);
    s.add(telegram('7002', 'и почту настройте'));
    for (const batch of s.triage.ready(Date.now() + CHAT_QUIET + 1000)) await s.triage.run(batch);
    s.accept();
    const [job] = s.tasks();
    assert.equal(job!.title, 'Клиент: настройка компьютера');
    assert.deepEqual(job!.items.map((item) => item.text), ['установить программу', 'настроить почту'], 'no duplicate, no empty item');
    // The owner names the task: the next rename is ignored.
    s.add({ ...event({ kind: 'task_change', payload: { ref: { type: 'task', id: job!.id }, data: { task: { op: 'update', title: 'Мой заголовок' } } } }), ts: new Date(Date.now() + 1000).toISOString(), source: 'app', author: 'me' } as JournalEvent);
    s.add(telegram('7002', 'и принтер ещё'));
    for (const batch of s.triage.ready(Date.now() + CHAT_QUIET + 1000)) await s.triage.run(batch);
    s.accept();
    assert.equal(s.tasks()[0]!.title, 'Мой заголовок');
  } finally { s.cleanup(); }
});

test('triage puts tasks into projects: the planner\'s choice by the project scope, never the source default alone, options when unsure; a placed task stays', async () => {
  const P1 = '11111111-1111-4111-8111-111111111111';
  const P2 = '22222222-2222-4222-8222-222222222222';
  const base = { responsible: 'me', executors: [], author: null, template: null, due: null, confidence: 0.9, note: null, filed: false, done: false, alternatives: [], items: [], rename: null };
  let reply: (input: PlanInput) => ScriptedPlan = () => ({ tasks: [] });
  const s = setup((input) => reply(input));
  const project = (id: string, data: Record<string, unknown>) => s.add({ ...event({ kind: 'project_change', payload: { ref: { type: 'project', id }, data: { project: { op: 'create', ...data } } } }), source: 'app', author: 'me' } as JournalEvent);
  try {
    project(P1, { title: 'Удалёнка BY', kind: 'stream', sources: ['tg:by'], scope: 'удалённая IT-поддержка клиентов в Беларуси' });
    project(P2, { title: 'Сайт', kind: 'goal', sections: [{ id: 'ideas', title: 'Идеи', role: 'ideas' }, { id: 'next', title: 'Следующее', role: 'next' }] });
    // A chat of the BY account: the planner sees each project's scope and the source as a hint; what it leaves
    // empty stays without a project — the source alone puts nothing into a project (owner, 2026-11-20).
    reply = (input) => {
      assert.deepEqual(input.projects.map((item) => item.title).sort(), ['Сайт', 'Удалёнка BY']);
      assert.equal(input.projects.find((item) => item.id === P1)!.scope, 'удалённая IT-поддержка клиентов в Беларуси');
      assert.equal(input.messages[0]!.default_project, P1);
      return { tasks: [
        { ...base, task_id: null, title: 'Настроить принтер', message_ids: [input.messages[0]!.id], project: P1, section: null, project_options: [] },
        { ...base, task_id: null, title: 'Купить подарок маме', message_ids: [input.messages[1]!.id], project: null, section: null, project_options: [] },
      ] };
    };
    s.add(telegram('7101', 'не печатает принтер'));
    s.add(telegram('7101', 'и напомни купить подарок маме'));
    for (const batch of s.triage.ready(Date.now() + CHAT_QUIET + 1000)) await s.triage.run(batch);
    // An idea of my own goes to the project's ideas; a doubtful one gets options; a made-up section is dropped.
    reply = (input) => ({ tasks: [
      { ...base, task_id: null, title: 'Тёмная тема', message_ids: [input.messages[0]!.id], project: P2, section: 'ideas', project_options: [] },
      { ...base, task_id: null, title: 'Что-то общее', message_ids: [input.messages[1]!.id], project: null, section: null, project_options: [P1, P2, 'xx'] },
      { ...base, task_id: null, title: 'Шаг', message_ids: [input.messages[2]!.id], project: P2, section: 'nope', project_options: [] },
    ] });
    s.add(event({ payload: { text: 'идея: тёмная тема для сайта' } }));
    s.add(event({ payload: { text: 'надо разобраться' } }));
    s.add(event({ payload: { text: 'сделать шаг' } }));
    for (const batch of s.triage.ready(Date.now() + QUIET + 1000)) await s.triage.run(batch);
    const byTitle = new Map(s.tasks().map((task) => [task.title, task]));
    assert.deepEqual([byTitle.get('Настроить принтер')!.project, byTitle.get('Настроить принтер')!.section], [P1, null]);
    assert.equal(byTitle.get('Купить подарок маме')!.project, undefined, 'not put into the project of its source');
    assert.deepEqual([byTitle.get('Тёмная тема')!.project, byTitle.get('Тёмная тема')!.section], [P2, 'ideas']);
    assert.equal(byTitle.get('Что-то общее')!.project, undefined);
    assert.deepEqual(byTitle.get('Что-то общее')!.project_options, [P1, P2]);
    assert.deepEqual([byTitle.get('Шаг')!.project, byTitle.get('Шаг')!.section], [P2, null]);
    // A task already in a project is not moved by a later batch.
    const printer = byTitle.get('Настроить принтер')!;
    reply = (input) => ({ tasks: [{ ...base, task_id: printer.id, title: printer.title, message_ids: [input.messages[0]!.id], project: P2, section: 'next', project_options: [] }] });
    s.add(telegram('7101', 'всё ещё не печатает'));
    for (const batch of s.triage.ready(Date.now() + CHAT_QUIET + 1000)) await s.triage.run(batch);
    s.accept();
    assert.equal(s.tasks().find((task) => task.id === printer.id)!.project, P1);
  } finally { s.cleanup(); }
});

test('a request about a filed note becomes a new task; the note stays as it was', async () => {
  let round = 0;
  const base = { responsible: 'me', executors: [], author: null, template: null, due: null, confidence: 0.9, note: null, done: false, alternatives: [] };
  const s = setup((input) => {
    round += 1;
    const ids = [input.messages[0]!.id];
    if (round === 1) return { tasks: [{ ...base, task_id: null, title: 'Записать: принтер у клиента офисный', template: 'note', filed: true, message_ids: ids, items: [], rename: null }] };
    const note = input.closed_tasks[0]!;
    return { tasks: [{ ...base, task_id: note.id, title: 'Клиент: настройка принтера', filed: false, message_ids: ids, items: ['настроить принтер'], rename: 'Клиент: настройка принтера' }] };
  });
  try {
    s.add(telegram('7003', 'печатаю из дома на офисный принтер'));
    for (const batch of s.triage.ready(Date.now() + CHAT_QUIET + 1000)) await s.triage.run(batch);
    const later = s.add(telegram('7003', 'настройте мне принтер, пожалуйста'));
    for (const batch of s.triage.ready(Date.now() + CHAT_QUIET + 1000)) await s.triage.run(batch);
    const tasks = s.tasks();
    const note = tasks.find((task) => task.template === 'note')!;
    assert.equal(note.title, 'Записать: принтер у клиента офисный', 'the note is not renamed');
    assert.deepEqual(note.items, [], 'no work items in a filed note');
    const work = tasks.find((task) => task.id !== note.id)!;
    assert.ok(work, 'the request is a task of its own');
    assert.equal(work.status, 'todo');
    assert.equal(work.title, 'Клиент: настройка принтера');
    assert.deepEqual(work.messages, [later.id]);
    assert.deepEqual(work.items.map((item) => item.text), ['настроить принтер']);
  } finally { s.cleanup(); }
});

test('«готово» with what was done drafts the report; the owner still confirms the closing', async () => {
  let round = 0;
  const base = { responsible: 'me', executors: [], author: null, template: null, due: null, confidence: 0.9, note: null, filed: false, alternatives: [], items: [], rename: null };
  const s = setup((input) => {
    round += 1;
    const ids = [input.messages[0]!.id];
    if (round === 1) return { tasks: [{ ...base, task_id: null, title: 'Настроить принтер', done: false, message_ids: ids }] };
    return { tasks: [{ ...base, task_id: input.open_tasks[0]!.id, title: 'Настроить принтер', done: true, message_ids: ids,
      report: { note: 'Настроил печать из дома на офисный принтер', duration_min: 30, cost: 120, expenses: -5, currency: 'XYZ' } }] };
  });
  try {
    s.add(telegram('7004', 'настройте принтер'));
    for (const batch of s.triage.ready(Date.now() + CHAT_QUIET + 1000)) await s.triage.run(batch);
    s.add(telegram('7004', 'готово, настроил печать из дома, полчаса, 120 злотых', 'me'));
    for (const batch of s.triage.ready(Date.now() + CHAT_QUIET + 1000)) await s.triage.run(batch);
    s.accept();
    const [task] = s.tasks();
    assert.equal(task!.status, 'todo', 'not closed silently');
    assert.equal(task!.proposed, 'done');
    assert.deepEqual((task as any).report, { note: 'Настроил печать из дома на офисный принтер', duration_min: 30, cost: 120 }, 'only valid fields; a made-up currency and a negative sum are dropped');
  } finally { s.cleanup(); }
});

test('triage sets the counterparty of a task, or options and a hint; a set one stays; archived ones are not offered', async () => {
  const C1 = '33333333-3333-4333-8333-333333333333';
  const C2 = '44444444-4444-4444-8444-444444444444';
  const C3 = '55555555-5555-4555-8555-555555555555';
  const base = { responsible: 'me', executors: [], author: null, template: null, due: null, confidence: 0.9, note: null, filed: false, done: false, alternatives: [], items: [], rename: null, project: null, section: null, project_options: [] };
  let reply: (input: PlanInput) => ScriptedPlan = () => ({ tasks: [] });
  const s = setup((input) => reply(input));
  const firm = (id: string, data: Record<string, unknown>) => s.add({ ...event({ kind: 'counterparty_change', payload: { ref: { type: 'counterparty', id }, data: { counterparty: data } } }), source: 'app', author: 'me' } as JournalEvent);
  const person = (data: Record<string, unknown>) => s.add({ ...event({ kind: 'contact_change', payload: { ref: { type: 'person', id: randomUUID() }, data: { contact: data } } }), source: 'app', author: 'me' } as JournalEvent);
  try {
    firm(C1, { op: 'create', kind: 'org', title: 'ООО Пример', side: 'by' });
    firm(C2, { op: 'create', kind: 'address', title: 'ул. Пробная 1' });
    firm(C3, { op: 'create', kind: 'org', title: 'Старая фирма' });
    firm(C3, { op: 'update', status: 'archived' });
    person({ op: 'create', name: 'Анна Тестова', telegram: ['7201'], roles: [{ counterparty: C1, title: 'бухгалтер' }] });
    reply = (input) => {
      assert.deepEqual(input.counterparties.map((item) => item.title).sort(), ['ООО Пример', 'ул. Пробная 1'], 'archived ones are not offered');
      assert.deepEqual(input.counterparties.find((item) => item.id === C1)!.people, ['Анна Тестова (бухгалтер)']);
      assert.equal(input.messages[0]!.person, 'Анна Тестова');
      return { tasks: [
        { ...base, task_id: null, title: 'ООО Пример: счёт', message_ids: [input.messages[0]!.id], counterparty: C1, counterparty_options: [], counterparty_hint: null },
        { ...base, task_id: null, title: 'Новый клиент: роутер', message_ids: [input.messages[1]!.id], counterparty: 'made-up', counterparty_options: [C2, C3, 'xx'], counterparty_hint: 'ООО Новое' },
      ] };
    };
    s.add(telegram('7201', 'пришлите счёт'));
    s.add(telegram('7201', 'и ещё роутер соседу'));
    for (const batch of s.triage.ready(Date.now() + CHAT_QUIET + 1000)) await s.triage.run(batch);
    const byTitle = new Map(s.tasks().map((task) => [task.title, task as any]));
    assert.equal(byTitle.get('ООО Пример: счёт').counterparty, C1);
    assert.equal(byTitle.get('Новый клиент: роутер').counterparty, undefined, 'an unknown id is dropped');
    assert.deepEqual(byTitle.get('Новый клиент: роутер').counterparty_options, [C2], 'only known active options');
    assert.equal(byTitle.get('Новый клиент: роутер').counterparty_hint, 'ООО Новое');
    // A task with a counterparty keeps it.
    const bill = byTitle.get('ООО Пример: счёт');
    reply = (input) => ({ tasks: [{ ...base, task_id: bill.id, title: bill.title, message_ids: [input.messages[0]!.id], counterparty: C2, counterparty_options: [], counterparty_hint: null }] });
    s.add(telegram('7201', 'счёт на другую фирму?'));
    for (const batch of s.triage.ready(Date.now() + CHAT_QUIET + 1000)) await s.triage.run(batch);
    s.accept();
    assert.equal((s.tasks().find((task) => task.id === bill.id) as any).counterparty, C1);
  } finally { s.cleanup(); }
});

test('the triage treats a request of family like any other; consultations stay in the conversation; items are steps still to do', async () => {
  const { PLAN_INSTRUCTIONS } = await import('../src/tasks/planner.ts');
  for (const rule of ['родные или друзья', 'консультация', 'Пункт — только', 'conversation_only']) {
    assert.ok(PLAN_INSTRUCTIONS.includes(rule), rule);
  }
});

test('the triage keeps a question or consultation answered by message or call in the conversation: it is not billed', async () => {
  const { PLAN_INSTRUCTIONS } = await import('../src/tasks/planner.ts');
  for (const rule of ['вопрос или консультация', 'решается ответом в переписке или звонком', 'в оплату не идёт']) {
    assert.ok(PLAN_INSTRUCTIONS.includes(rule), rule);
  }
});

test('the content of an existing task is never changed by the AI: a proposal with its reason waits for the owner; the log keeps both', async () => {
  let round = 0;
  const s = setup((input) => {
    round += 1;
    const ids = [input.messages[0]!.id];
    if (round === 1) return { tasks: [planned({ title: 'Надежда: правки сайта', message_ids: ids, reason: 'просит поправить тексты' })] };
    return { tasks: [planned({ task_id: input.open_tasks[0]!.id, title: 'Надежда: правки сайта', message_ids: ids, done: true, confidence: 0.6, reason: 'упомянут тот же сайт' })] };
  });
  try {
    s.add(telegram('7301', 'поправьте тексты на сайте'));
    for (const batch of s.triage.ready(Date.now() + CHAT_QUIET + 1000)) await s.triage.run(batch);
    const [site] = s.tasks();
    const other = s.add(telegram('7302', 'сайт сделал', 'me'));
    for (const batch of s.triage.ready(Date.now() + CHAT_QUIET + 1000)) await s.triage.run(batch);
    const after = s.tasks().find((task) => task.id === site!.id)!;
    assert.deepEqual([after.messages.length, after.proposed], [2, undefined], 'linked at once (v21), «done» only proposed');
    const [proposal] = s.proposals();
    assert.deepEqual([proposal!.task_id, proposal!.message_ids, proposal!.reason, (proposal!.change as any).proposed], [site!.id, [other.id], 'упомянут тот же сайт', 'done']);
    assert.equal(s.store.ailog.decision(proposal!.id)!.status, 'pending');
    const created = s.store.triage.taskEvents().find((item) => (item.payload.data!.task as any).op === 'create')!;
    assert.equal((created.payload.data!.task as any).reason, 'просит поправить тексты', 'a created task carries its reason');
    assert.deepEqual(s.store.ailog.stats('2000-01-01T00:00:00.000Z'), { create: { auto: 1 }, link: { auto: 1 }, update: { pending: 1 } });
    s.accept();
    assert.equal(s.store.ailog.decision(proposal!.id)!.status, 'accepted');
    assert.equal(s.tasks().find((task) => task.id === site!.id)!.proposed, 'done');
  } finally { s.cleanup(); }
});

test('triage v16 makes new tasks unconfirmed unless the owner chose otherwise; filed notes never wait', async () => {
  for (const mode of ['unconfirmed', 'confirmed'] as const) {
    const storage = temporaryStore();
    try {
      const plan = (input: PlanInput): PlanOutput => ({ conversation_only: [], tasks: [
        { task_id: null, title: 'Настроить роутер', responsible: 'me', executors: [], author: null, template: null, due: null, message_ids: [input.messages[0]!.id], confidence: 0.9, note: null, filed: false, done: false, alternatives: [] },
        { task_id: null, title: 'Дневник', responsible: 'me', executors: [], author: null, template: 'diary', due: null, message_ids: [input.messages[1]!.id], confidence: 0.9, note: null, filed: true, done: false, alternatives: [] },
      ] });
      const triage = new Triage({ store: storage.store, live: new LiveFeed(), planner: async (input) => plan(input), newTasks: () => mode });
      storage.store.appendEvent(event({ payload: { text: 'роутер у клиента' } }));
      storage.store.appendEvent(event({ payload: { text: 'сегодня был у клиента' } }));
      for (const batch of triage.ready(Date.now() + QUIET + 1000)) await triage.run(batch);
      const tasks = foldTasks(storage.store.triage.taskEvents());
      const router = tasks.find((task) => task.title === 'Настроить роутер')!;
      const diary = tasks.find((task) => task.title === 'Дневник')!;
      assert.equal(router.unconfirmed, mode === 'unconfirmed' ? true : undefined, mode);
      assert.equal(diary.unconfirmed, undefined, 'a filed note is not asked about');
    } finally { storage.cleanup(); }
  }
});

test('the triage result always says whether the conversation is over: «unfinished» on the batch\'s last message', async () => {
  let round = 0;
  const s = setup((input) => {
    round += 1;
    const ids = input.messages.map((message) => message.id);
    return round === 1
      ? { tasks: [], conversation_only: ids, unfinished: 'ждёт выезд в субботу в 14:00' }
      : { tasks: [planned({ title: 'Клиент: выезд', message_ids: ids })], unfinished: null };
  });
  try {
    s.add(telegram('7301', 'договорились на субботу?'));
    const last = s.add(telegram('7301', 'тогда в 14:00'));
    for (const batch of s.triage.ready(Date.now() + CHAT_QUIET + 1000)) await s.triage.run(batch);
    const first = s.store.triage.results().at(-1)!.payload.data!.triage as Record<string, unknown>;
    assert.equal(first.unfinished, 'ждёт выезд в субботу в 14:00');
    assert.equal(first.last_message, last.id);
    // A batch that became a task still writes its verdict: finished.
    const next = s.add(telegram('7301', 'жду'));
    for (const batch of s.triage.ready(Date.now() + 2 * CHAT_QUIET + 1000)) await s.triage.run(batch);
    const second = s.store.triage.results().at(-1)!.payload.data!.triage as Record<string, unknown>;
    assert.equal(second.unfinished, null);
    assert.equal(second.last_message, next.id);
  } finally { s.cleanup(); }
});

test('the instructions: an agreed visit or meeting is a task; «unfinished» when the other side still waits and no task covers it', async () => {
  const { PLAN_INSTRUCTIONS, PLAN_SCHEMA } = await import('../src/tasks/planner.ts');
  for (const rule of ['Договорились о выезде', 'unfinished', 'ни одна задача']) assert.ok(PLAN_INSTRUCTIONS.includes(rule), rule);
  assert.ok((PLAN_SCHEMA.required as readonly string[]).includes('unfinished'));
});

// triage-ai-v19 (CONCEPT.md §2.8): conversations as in the queue, the last session as context, steps back on request.
const phoneCall = (number: string, ts: string) => event({ source: 'android_phone', kind: 'call', ts, payload: { data: { call: { direction: 'in', number, duration_s: 40, started_at: ts } } } });
const leave = (input: PlanInput): ScriptedPlan => ({ tasks: [], conversation_only: input.messages.map((message) => message.id) } as ScriptedPlan);

test('v19: calls of two numbers are two batches, not one «phone» stream', async () => {
  const s = setup(leave);
  try {
    s.add(phoneCall('+48600100200', '2026-11-20T10:00:00.000Z'));
    s.add(phoneCall('+48600100300', '2026-11-20T10:01:00.000Z'));
    assert.equal(s.triage.ready(Date.now() + QUIET + 1000).length, 2);
  } finally { s.cleanup(); }
});

test('v19: context is the last session of the conversation, however old; other chats stay out', async () => {
  const s = setup(leave);
  try {
    s.add({ ...telegram('7001', 'давно: про камеры'), ts: '2026-11-15T10:00:00.000Z' });
    s.add({ ...telegram('7001', 'вечером: выезд в субботу?'), ts: '2026-11-19T20:00:00.000Z' });
    s.add({ ...telegram('7001', 'да, в 14'), ts: '2026-11-19T20:05:00.000Z' }); s.add({ ...telegram('7002', 'другой клиент'), ts: '2026-11-19T20:06:00.000Z' });
    for (const batch of s.triage.ready(Date.now() + CHAT_QUIET + 1000)) await s.triage.run(batch);
    s.calls.length = 0;
    s.add({ ...telegram('7001', 'ок, тогда до субботы'), ts: '2026-11-20T09:00:00.000Z' });
    for (const batch of s.triage.ready(Date.now() + CHAT_QUIET + 1000)) await s.triage.run(batch);
    const call = s.calls.at(-1)!;
    assert.deepEqual(call.context.map((message) => message.text), ['вечером: выезд в субботу?', 'да, в 14'], 'the session before, not the older one, not the other chat');
    assert.equal(call.earlier_available, true);
  } finally { s.cleanup(); }
});

test('v19: «need_earlier» brings the session before, at most twice', async () => {
  const s = setup(() => ({ tasks: [], need_earlier: true, conversation_only: [] } as unknown as ScriptedPlan));
  try {
    for (const [ts, text] of [['2026-11-10T10:00:00.000Z', 'первая тема'], ['2026-11-12T10:00:00.000Z', 'вторая тема'], ['2026-11-14T10:00:00.000Z', 'третья тема']] as const) {
      s.add({ ...telegram('7001', text), ts });
    }
    s.store.triage.mark(s.store.triage.messages(new Date(0).toISOString()).map((item) => item.id), 0, new Date().toISOString());
    const fresh = s.add({ ...telegram('7001', 'сделал?'), ts: '2026-11-20T10:00:00.000Z' });
    for (const batch of s.triage.ready(Date.now() + CHAT_QUIET + 1000)) await s.triage.run(batch);
    assert.equal(s.calls.length, 3, 'the first look and two steps back');
    assert.deepEqual(s.calls.map((call) => call.context.length), [1, 2, 3]);
    assert.deepEqual(s.calls.map((call) => call.earlier_available), [true, true, false]);
    assert.equal(s.tasks().some((task) => task.messages.includes(fresh.id)), false, 'still unclear — no «Разобрать» (v21)');
  } finally { s.cleanup(); }
});

test('v19 instructions and schema: need_earlier only when the session does not say what the new messages are about', async () => {
  const { PLAN_INSTRUCTIONS, PLAN_SCHEMA } = await import('../src/tasks/planner.ts');
  for (const rule of ['need_earlier', 'earlier_available', 'сессия']) assert.ok(PLAN_INSTRUCTIONS.includes(rule), rule);
  assert.ok((PLAN_SCHEMA.required as readonly string[]).includes('need_earlier'));
  assert.equal(tasksConfig.ai.processor, 'triage-ai-v21');
});

test('an open record of the interlocutor whose messages are older than history_days is still in context', async () => {
  const s = setup(leave);
  const saved = tasksConfig.history_days;
  try {
    const old = s.add({ ...telegram('7001', 'давно: нужна настройка'), ts: '2026-01-10T10:00:00.000Z' });
    for (const batch of s.triage.ready(Date.now() + CHAT_QUIET + 1000)) await s.triage.run(batch); // the old message is triaged: not in the next batch
    const change = (id: string, ts: string, task: Record<string, unknown>) => s.add({ id: randomUUID(), schema_version: 1, source: 'app', author: 'me', ts, kind: 'task_change',
      payload: { ref: { type: 'task', id }, data: { task } } } as JournalEvent);
    change(randomUUID(), '2026-01-10T10:01:00.000Z', { op: 'create', title: 'Старое дело клиента', add: [old.id] });
    for (let i = 0; i < 12; i++) change(randomUUID(), `2026-11-2${i % 5}T10:00:00.000Z`, { op: 'create', title: `Чужое ${i}` });
    tasksConfig.history_days = -1; // every stored message is outside the history window, as a 30-day-old one would be
    s.add({ ...telegram('7001', 'как там?'), ts: '2026-11-24T09:00:00.000Z' });
    for (const batch of s.triage.ready(Date.now() + CHAT_QUIET + 1000)) await s.triage.run(batch);
    const call = s.calls.at(-1)!;
    assert.ok(call.open_tasks.some((task) => task.title === 'Старое дело клиента'));
    assert.ok(call.open_tasks.length <= 11, 'others stay capped');
  } finally { tasksConfig.history_days = saved; s.cleanup(); }
});

// triage-ai-v21 (docs/plans/2026-11-23-conversation-records-design.md): links at once, content as proposals, repeats,
// done work, questions, directive tags.
test('a continuation is linked at once and its new item is only proposed', async () => {
  let round = 0;
  const s = setup((input) => {
    round += 1;
    const ids = [input.messages[0]!.id];
    if (round === 1) return { tasks: [planned({ title: 'Клиент: компьютер', message_ids: ids })] };
    return { tasks: [planned({ task_id: input.open_tasks[0]!.id, title: 'Клиент: компьютер', message_ids: ids, items: ['настроить почту'], reason: 'тот же компьютер' })] };
  });
  try {
    const first = s.add(telegram('7401', 'поставьте программу'));
    for (const batch of s.triage.ready(Date.now() + CHAT_QUIET + 1000)) await s.triage.run(batch);
    const second = s.add(telegram('7401', 'и почту настройте'));
    for (const batch of s.triage.ready(Date.now() + CHAT_QUIET + 1000)) await s.triage.run(batch);
    const [job] = s.tasks();
    assert.deepEqual(job!.messages, [first.id, second.id], 'linked by the system');
    assert.deepEqual(job!.items, [], 'the item waits for the owner');
    const link = s.store.triage.taskEvents().at(-1)!;
    assert.equal(link.author, 'system');
    assert.deepEqual(link.payload.data!.task, { op: 'update', add: [second.id], reason: 'тот же компьютер' });
    const [proposal] = s.proposals();
    assert.deepEqual([proposal!.task_id, proposal!.message_ids, Object.keys(proposal!.change).sort()], [job!.id, [second.id], ['items_add', 'op']]);
    s.accept();
    assert.deepEqual(s.tasks()[0]!.items.map((item) => item.text), ['настроить почту']);
  } finally { s.cleanup(); }
});

test('a message the owner removed from a task is not linked back to it', async () => {
  let round = 0;
  const s = setup((input) => {
    round += 1;
    const ids = input.messages.map((message) => message.id);
    if (round === 1) return { tasks: [planned({ title: 'Клиент: принтер', message_ids: ids })] };
    return { tasks: [planned({ task_id: input.open_tasks[0]!.id, title: 'Клиент: принтер', message_ids: ids, due: '2026-11-30' })] };
  });
  try {
    const a = s.add(telegram('7402', 'не печатает принтер'));
    const b = s.add(telegram('7402', 'а в субботу у меня день рождения'));
    for (const batch of s.triage.ready(Date.now() + CHAT_QUIET + 1000)) await s.triage.run(batch);
    const [job] = s.tasks();
    s.add({ id: randomUUID(), schema_version: 1, source: 'app', author: 'me', ts: new Date().toISOString(), kind: 'task_change', payload: { ref: { type: 'task', id: job!.id }, data: { task: { op: 'update', remove: [b.id] } } } });
    await s.triage.run([a, b], { again: 'second-look' });
    assert.deepEqual(s.tasks()[0]!.messages, [a.id], 'not linked back');
    assert.deepEqual(s.proposals().map((proposal) => proposal.message_ids), [[a.id]], 'nor proposed with it');
  } finally { s.cleanup(); }
});

test('a closed task asked again → a new unconfirmed task with repeat_of', async () => {
  let round = 0;
  const s = setup((input) => {
    round += 1;
    const ids = [input.messages[0]!.id];
    if (round === 1) return { tasks: [planned({ title: 'Клиент: Wi-Fi', message_ids: ids })] };
    const old = input.closed_tasks[0]!;
    return { tasks: [planned({ task_id: old.id, repeat_of: old.id, title: 'Клиент: Wi-Fi снова', message_ids: ids })] };
  }, { newTasks: 'unconfirmed' });
  try {
    const first = s.add(telegram('7403', 'не работает Wi-Fi'));
    for (const batch of s.triage.ready(Date.now() + CHAT_QUIET + 1000)) await s.triage.run(batch);
    const [old] = s.tasks();
    s.add({ id: randomUUID(), schema_version: 1, source: 'app', author: 'me', ts: new Date().toISOString(), kind: 'task_change', payload: { ref: { type: 'task', id: old!.id }, data: { task: { op: 'update', status: 'done', unconfirmed: false } } } });
    const again = s.add(telegram('7403', 'опять не работает Wi-Fi'));
    for (const batch of s.triage.ready(Date.now() + CHAT_QUIET + 1000)) await s.triage.run(batch);
    const before = s.tasks().find((task) => task.id === old!.id)!;
    assert.deepEqual([before.status, before.messages], ['done', [first.id]], 'the closed record stays as it was');
    const repeat = s.tasks().find((task) => task.id !== old!.id)!;
    assert.deepEqual([repeat.title, repeat.status, repeat.unconfirmed, repeat.repeat_of, repeat.messages], ['Клиент: Wi-Fi снова', 'todo', true, old!.id, [again.id]]);
  } finally { s.cleanup(); }
});

test('work done in the conversation → a done task with a report draft', async () => {
  const s = setup((input) => ({ tasks: [planned({ title: 'Клиент: настройка почты', template: 'lead', done: true, message_ids: input.messages.map((message) => message.id),
    report: { note: 'Настроил почту удалённо', duration_min: 30, cost: 80, expenses: null, currency: 'PLN' } })] }), { newTasks: 'unconfirmed' });
  try {
    s.add(telegram('7404', 'почта не приходит, подключитесь?'));
    s.add(telegram('7404', 'готово, проверьте — полчаса, 80 злотых', 'me'));
    for (const batch of s.triage.ready(Date.now() + CHAT_QUIET + 1000)) await s.triage.run(batch);
    const [done] = s.tasks();
    assert.deepEqual([done!.status, done!.template, done!.proposed, done!.messages.length], ['done', 'lead', undefined, 2]);
    assert.deepEqual(done!.report, { note: 'Настроил почту удалённо', duration_min: 30, cost: 80, currency: 'PLN' });
  } finally { s.cleanup(); }
});

test('messages the AI left out create no «Разобрать» task', async () => {
  const s = setup(() => ({ tasks: [] }));
  try {
    const a = s.add(telegram('7405', 'как дела у вас?'));
    s.add(telegram('7405', 'у нас всё по-старому'));
    for (const batch of s.triage.ready(Date.now() + CHAT_QUIET + 1000)) await s.triage.run(batch);
    assert.deepEqual(s.tasks(), []);
    const result = s.store.triage.results().at(-1)!.payload.data!.triage as Record<string, unknown>;
    assert.ok((result.messages as string[]).includes(a.id), 'the result still covers the batch');
    assert.equal(s.triage.ready(Date.now() + CHAT_QUIET + 1000).length, 0, 'not triaged again');
  } finally { s.cleanup(); }
});

test('questions are written in the triage result with ids', async () => {
  let round = 0;
  const s = setup((input) => {
    round += 1;
    if (round === 1) return { tasks: [planned({ title: 'Клиент: камеры', message_ids: [input.messages[0]!.id] })] };
    const known = input.open_tasks[0]!.id;
    return { tasks: [], questions: [{ message_ids: [input.messages[0]!.id], text: 'О каком деле речь?', options: [
      { label: 'Клиент: камеры', task_id: known, title: null, template: null, nothing: false },
      { label: 'Новое: роутер', task_id: null, title: 'Клиент: роутер', template: 'todo', nothing: false },
      { label: 'Выдумка', task_id: randomUUID(), title: null, template: null, nothing: false },
      { label: 'Ничего', task_id: null, title: null, template: null, nothing: true },
    ] }] };
  });
  try {
    s.add(telegram('7406', 'поставьте камеры'));
    for (const batch of s.triage.ready(Date.now() + CHAT_QUIET + 1000)) await s.triage.run(batch);
    const vague = s.add(telegram('7406', 'а там ещё вот это бы'));
    for (const batch of s.triage.ready(Date.now() + CHAT_QUIET + 1000)) await s.triage.run(batch);
    const result = s.store.triage.results().at(-1)!.payload.data!.triage as { questions: { id: string; message_ids: string[]; text: string; options: { label: string }[] }[] };
    const [question] = result.questions;
    assert.match(question!.id, /^[0-9a-f-]{36}$/);
    assert.deepEqual([question!.message_ids, question!.text, question!.options.map((option) => option.label)], [[vague.id], 'О каком деле речь?', ['Клиент: камеры', 'Новое: роутер', 'Ничего']]);
    assert.equal(s.store.ailog.decision(question!.id)!.status, 'pending');
    assert.equal(s.store.ailog.decision(question!.id)!.kind, 'question');
    assert.equal(s.tasks().length, 1, 'nothing chosen for the owner');
  } finally { s.cleanup(); }
});

test('a directive tag added after triage reruns that session once', async () => {
  const storage = temporaryStore();
  const calls: PlanInput[] = [];
  const server = createApp({ store: storage.store, ownerToken: token, triage: { planner: async (input) => { calls.push(input); return { tasks: [], conversation_only: [] }; }, everyMs: 3_600_000 } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (body: unknown) => fetch(`${base}/api/events`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const edit = (target: string, tags: string[]) => event({ kind: 'correction', payload: { ref: { type: 'event', id: target }, text: 'надо бы посылку отправить', tags, data: { op: 'edit' } } });
  const settle = async (count: number) => { for (let i = 0; i < 100 && calls.length < count; i++) await new Promise((resolve) => setTimeout(resolve, 20)); };
  try {
    const before = storage.store.appendEvent(telegram('7407', 'привет')).event;
    const message = storage.store.appendEvent(telegram('7407', 'надо бы посылку отправить')).event;
    const fresh = storage.store.appendEvent(telegram('7408', 'другой чат, ещё не разобран')).event;
    storage.store.triage.mark([before.id, message.id], 0, new Date().toISOString());
    const tagged = edit(message.id, ['#задача']);
    assert.equal((await post(tagged)).status, 201);
    await settle(1);
    assert.equal(calls.length, 1, 'the session went again at once');
    assert.deepEqual(calls[0]!.messages.map((item) => item.id), [before.id, message.id]);
    assert.deepEqual(calls[0]!.messages[1]!.directive, ['#задача']);
    assert.equal(calls[0]!.messages[0]!.directive, undefined);
    assert.equal((await post(tagged)).status, 200, 'the same correction again');
    assert.equal((await post(edit(message.id, ['#задача', '#naserwis']))).status, 201, 'a plain tag added');
    assert.equal((await post(edit(fresh.id, ['#задача']))).status, 201, 'a message not triaged yet waits for its window');
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(calls.length, 1, 'run once');
  } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); storage.cleanup(); }
});

test('a rerun withdraws its session\'s waiting questions, proposals, links and unconfirmed AI records', async () => {
  let round = 0;
  const mine = randomUUID();
  const s = setup((input) => {
    round += 1;
    const [a, b, c] = input.messages.map((message) => message.id);
    if (round === 1) return { tasks: [planned({ title: 'Клиент: камеры', message_ids: [a!] }), planned({ task_id: mine, title: 'Клиент: роутер', message_ids: [b!], items: ['проверить блок'] })],
      questions: [{ message_ids: [c!], text: 'О каком деле речь?', options: [{ label: 'Клиент: роутер', task_id: mine, title: null, template: null, nothing: false }, { label: 'Ничего', task_id: null, title: null, template: null, nothing: true }] }] };
    assert.equal(input.open_tasks.some((task) => task.title === 'Клиент: камеры'), false, 'the record it replaces is not shown');
    return { tasks: [planned({ title: 'Клиент: посылка', message_ids: [c!] })] };
  }, { newTasks: 'unconfirmed' });
  try {
    s.add({ id: randomUUID(), schema_version: 1, source: 'app', author: 'me', ts: '2026-11-10T10:00:00.000Z', kind: 'task_change', payload: { ref: { type: 'task', id: mine }, data: { task: { op: 'create', title: 'Клиент: роутер' } } } });
    s.add(telegram('7501', 'камеры бы поставить'));
    s.add(telegram('7501', 'роутер мигает'));
    const c = s.add(telegram('7501', 'и посылку отправь'));
    for (const batch of s.triage.ready(Date.now() + CHAT_QUIET + 1000)) await s.triage.run(batch);
    const first = s.store.triage.results().at(-1)!.payload.data!.triage as { proposals: { id: string }[]; questions: { id: string }[] };
    const cameras = s.tasks().find((task) => task.title === 'Клиент: камеры')!;
    await s.triage.rerun(c.id, 'tag-1');
    const again = s.store.triage.results().at(-1)!.payload.data!.triage as { withdrawn: string[] };
    assert.deepEqual([...again.withdrawn].sort(), [first.proposals[0]!.id, first.questions[0]!.id].sort());
    assert.equal(s.tasks().find((task) => task.id === cameras.id)!.status, 'cancelled');
    assert.deepEqual(s.tasks().find((task) => task.id === mine)!.messages, [], 'the untouched system link is taken back');
    assert.ok(s.tasks().some((task) => task.title === 'Клиент: посылка' && task.unconfirmed));
    assert.equal(s.store.ailog.decision(first.questions[0]!.id)!.status, 'replaced');
  } finally { s.cleanup(); }
});

test('a rerun and a round take turns: the round does not triage the session\'s messages under another key', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const s = setup(() => ({ tasks: [] }));
  const plan = s.calls; // filled by the scripted planner below
  const slow = new Triage({ store: s.store, live: new LiveFeed(), planner: async (input) => { plan.push(input); await gate; return { tasks: [], conversation_only: [] }; } });
  try {
    const old = s.add(telegram('7502', 'посылку отправь'));
    s.store.triage.mark([old.id], 0, new Date().toISOString());
    const fresh = s.add(telegram('7502', 'и коробку возьми побольше'));
    const rerun = slow.rerun(old.id, 'tag-2');
    for (let i = 0; i < 20 && !plan.length; i++) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(plan.length, 1, 'the rerun asks the AI');
    const round = slow.tick(Date.now() + CHAT_QUIET + 1000);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(plan.length, 1, 'the round waits for the rerun');
    release();
    await Promise.all([rerun, round]);
    assert.deepEqual(plan.map((input) => input.messages.map((message) => message.id)), [[old.id, fresh.id]], 'the round found nothing left: one look');
  } finally { s.cleanup(); }
});

test('removing all tags is seen; adding a directive tag again reruns', async () => {
  const s = setup(() => ({ tasks: [] }));
  const { directiveAdded } = await import('../src/tasks/directive.ts');
  const edit = (target: string, tags?: string[]) => s.add(event({ kind: 'correction', ts: new Date().toISOString(), payload: { ref: { type: 'event', id: target }, text: 'посылку отправить', ...(tags ? { tags } : {}), data: { op: 'edit' } } }));
  try {
    const message = s.add(event({ payload: { text: 'посылку отправить', tags: ['#задача'] } }));
    s.store.triage.mark([message.id], 0, new Date().toISOString());
    const removed = edit(message.id);
    assert.equal(directiveAdded(s.store, removed), null);
    await s.triage.rerun(message.id, 'removed');
    assert.equal(s.calls.at(-1)!.messages[0]!.directive, undefined, 'no tags left, no directive');
    assert.deepEqual(s.calls.at(-1)!.messages[0]!.tags, []);
    assert.equal(directiveAdded(s.store, edit(message.id, ['#задача'])), message.id, 'added again: a rerun');
  } finally { s.cleanup(); }
});

test('a message tagged with a directive tag does not wait for the quiet window', () => {
  const s = setup(() => ({ tasks: [] }));
  try {
    const tagged = s.add(event({ payload: { text: 'отправить посылку маме', tags: ['#задача'] } }));
    s.add(telegram('7503', 'вопрос по роутеру', '7503'));
    s.add(telegram('7504', '#naserwis без указания'));
    assert.deepEqual(s.triage.ready(Date.now()).map((batch) => batch.map((item) => item.id)), [[tagged.id]]);
  } finally { s.cleanup(); }
});

test('#поручить: a known person gets a task with a draft; an unknown one a question; nothing is ever sent', async () => {
  const base = { responsible: 'me', author: null, template: null, due: null, confidence: 0.9, note: null, filed: false, done: false, alternatives: [], items: [], rename: null, project: null, section: null, project_options: [] };
  let executors = ['tg:7410'];
  const s = setup((input) => ({ tasks: [planned({ ...base, title: 'Привезти роутер', executors, draft: 'Алекс, привези роутер завтра к 10', message_ids: [input.messages.at(-1)!.id] })] }));
  const tagged = (chat: string, text: string) => telegram(chat, text, chat);
  try {
    s.add({ ...event({ kind: 'contact_change', payload: { ref: { type: 'person', id: randomUUID() }, data: { contact: { op: 'create', name: 'Алекс', telegram: ['7410'] } } } }), source: 'app', author: 'me' } as JournalEvent);
    const known = s.add({ ...tagged('7410', 'пусть Алекс привезёт роутер'), payload: { text: 'пусть Алекс привезёт роутер', tags: ['#поручить'], data: tagged('7410', 'x').payload.data } } as JournalEvent);
    for (const batch of s.triage.ready(Date.now() + CHAT_QUIET + 1000)) await s.triage.run(batch);
    assert.deepEqual(s.calls[0]!.messages[0]!.directive, ['#поручить']);
    const [made] = s.tasks();
    assert.deepEqual([made!.roles.executors, made!.draft, made!.messages], [['tg:7410'], 'Алекс, привези роутер завтра к 10', [known.id]]);
    // An unknown person: a question and no task.
    executors = ['tg:7411'];
    s.add({ ...tagged('7411', 'пусть он привезёт'), payload: { text: 'пусть он привезёт', tags: ['#поручить'], data: tagged('7411', 'x').payload.data } } as JournalEvent);
    for (const batch of s.triage.ready(Date.now() + CHAT_QUIET + 1000)) await s.triage.run(batch);
    assert.equal(s.tasks().length, 1, 'no second task');
    const result = s.store.triage.results().at(-1)!.payload.data!.triage as { questions: { text: string; options: { nothing: boolean }[] }[] };
    assert.match(result.questions[0]!.text, /Кому поручить/);
    // Nothing outbound: no event with an outbound mark, no action.
    const all = s.store.listEvents({ limit: 500 }).events;
    assert.equal(all.some((item) => item.payload.data?.outbound), false);
    assert.equal(all.filter((item) => item.kind === 'task_change').every((item) => item.author === 'system' || item.author === 'me'), true);
    assert.equal(s.store.actions.get(nameIdOf(`action|${known.id}`)), undefined);
  } finally { s.cleanup(); }
});
