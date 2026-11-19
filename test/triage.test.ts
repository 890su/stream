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
const telegram = (chat: string, text: string, from = chat): JournalEvent => event({
  source: 'telegram', author: `contact:tg:by:${from}`, payload: { text, data: { telegram: { account: 'by', chat_id: chat, chat_type: 'private', chat_title: 'Клиент', message_id: Math.floor(Math.random() * 1e6) + 1, sent_at: '2026-11-17T10:00:00.000Z' } } },
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

test('a later message is added to an open task instead of a new one; «готово» asks instead of closing', async () => {
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
    const unsorted = byTitle.get('Разобрать')!;
    assert.deepEqual(unsorted.messages, [ok.id]);
    assert.equal(unsorted.assignee, 'me');
    assert.equal(unsorted.status, 'inbox');
    assert.equal(s.tasks().filter((task) => task.processor === 'triage-ai-v12').length, 4);
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
    const call = s.calls.at(-1)!;
    assert.deepEqual(call.context.map((message) => message.id), [first.id], 'only this chat');
    assert.equal(call.context[0]!.in_tasks.length, 1, 'context carries its task');
    const task = s.tasks().find((item) => item.messages.includes(first.id))!;
    assert.deepEqual(task.messages, [first.id, later.id]);
  } finally { s.cleanup(); }
});

test('a closed case comes back when a message continues it; a doubtful message carries alternatives', async () => {
  let round = 0;
  const s = setup((input) => {
    round += 1;
    const m = input.messages[0]!.id;
    const plan = (data: Partial<PlanOutput['tasks'][number]>) => ({ tasks: [{ task_id: null, title: 'Wi-Fi у клиента', responsible: 'me', executors: [], author: null, template: 'todo', due: null, message_ids: [m], confidence: 0.9, note: null, filed: false, done: false, alternatives: [], ...data }] });
    if (round === 1) return plan({});
    if (round === 2) return plan({ title: 'Камеры у соседа' });
    assert.equal(input.closed_tasks.length, 1, 'recently closed cases are given');
    assert.ok(input.open_tasks[0]!.chats.length && input.open_tasks[0]!.last_at, 'a task comes with its chats and last activity');
    return plan({ task_id: input.closed_tasks[0]!.id, alternatives: [input.open_tasks[0]!.id, 'not-a-task'] });
  });
  try {
    s.add(event({ payload: { text: 'не работает Wi-Fi' } }));
    for (const batch of s.triage.ready(Date.now() + QUIET + 1000)) await s.triage.run(batch);
    const wifi = s.tasks()[0]!;
    s.add({ id: randomUUID(), schema_version: 1, source: 'app', author: 'me', ts: new Date().toISOString(), kind: 'task_change', payload: { ref: { type: 'task', id: wifi.id }, data: { task: { op: 'update', status: 'done' } } } });
    s.add(event({ payload: { text: 'камеры у соседа' }, ts: '2026-11-11T10:05:00.000Z' }));
    for (const batch of s.triage.ready(Date.now() + QUIET + 1000)) await s.triage.run(batch);
    const later = s.add(event({ payload: { text: 'опять не работает Wi-Fi' }, ts: '2026-11-11T10:10:00.000Z' }));
    for (const batch of s.triage.ready(Date.now() + QUIET + 1000)) await s.triage.run(batch);
    const back = s.tasks().find((task) => task.id === wifi.id)!;
    assert.equal(back.status, 'todo', 'the closed case is back at work');
    assert.ok(back.messages.includes(later.id));
    const asked = s.store.triage.taskEvents().at(-1)!.payload.data!.task as { alternatives?: string[] };
    assert.equal(asked.alternatives?.length, 1, 'only known tasks, not the chosen one');
  } finally { s.cleanup(); }
});

const lastChange = (s: ReturnType<typeof setup>, title: string) => s.store.triage.taskEvents()
  .map((item) => item.payload.data!.task as Record<string, any>).find((change) => change.title === title)!;
const planned = (data: Partial<PlanOutput['tasks'][number]>): PlanOutput['tasks'][number] => ({ task_id: null, title: 'Дело', responsible: 'me', executors: [], author: null, template: null, due: null, message_ids: [], confidence: 0.9, note: null, filed: false, done: false, alternatives: [], ...data });

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

test('a filed template gets its executor from the registry; the fallback task has no executors', async () => {
  const s = setup((input) => ({ tasks: [planned({ title: 'Самочувствие', template: 'diary', filed: true, executors: [], message_ids: [input.messages[0]!.id] })] }));
  try {
    s.add(event({ payload: { text: 'выспался' } }));
    s.add(event({ payload: { text: 'ок' } }));
    for (const batch of s.triage.ready(Date.now() + QUIET + 1000)) await s.triage.run(batch);
    assert.deepEqual(lastChange(s, 'Самочувствие').roles, { author: 'me', responsible: 'me', executors: ['ai'], controller: 'me' });
    assert.deepEqual(lastChange(s, 'Разобрать').roles, { author: 'me', responsible: 'me', executors: [] });
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
    const [job] = s.tasks();
    assert.equal(job!.title, 'Клиент: настройка компьютера');
    assert.deepEqual(job!.items.map((item) => item.text), ['установить программу', 'настроить почту'], 'no duplicate, no empty item');
    // The owner names the task: the next rename is ignored.
    s.add({ ...event({ kind: 'task_change', payload: { ref: { type: 'task', id: job!.id }, data: { task: { op: 'update', title: 'Мой заголовок' } } } }), ts: new Date(Date.now() + 1000).toISOString(), source: 'app', author: 'me' } as JournalEvent);
    s.add(telegram('7002', 'и принтер ещё'));
    for (const batch of s.triage.ready(Date.now() + CHAT_QUIET + 1000)) await s.triage.run(batch);
    assert.equal(s.tasks()[0]!.title, 'Мой заголовок');
  } finally { s.cleanup(); }
});

test('triage puts tasks into projects: the planner\'s choice, the source default, options when unsure; a placed task stays', async () => {
  const P1 = '11111111-1111-4111-8111-111111111111';
  const P2 = '22222222-2222-4222-8222-222222222222';
  const base = { responsible: 'me', executors: [], author: null, template: null, due: null, confidence: 0.9, note: null, filed: false, done: false, alternatives: [], items: [], rename: null };
  let reply: (input: PlanInput) => PlanOutput = () => ({ tasks: [] });
  const s = setup((input) => reply(input));
  const project = (id: string, data: Record<string, unknown>) => s.add({ ...event({ kind: 'project_change', payload: { ref: { type: 'project', id }, data: { project: { op: 'create', ...data } } } }), source: 'app', author: 'me' } as JournalEvent);
  try {
    project(P1, { title: 'Удалёнка BY', kind: 'stream', sources: ['tg:by'] });
    project(P2, { title: 'Сайт', kind: 'goal', sections: [{ id: 'ideas', title: 'Идеи', role: 'ideas' }, { id: 'next', title: 'Следующее', role: 'next' }] });
    // A chat of the BY account: the planner leaves it empty, the source default applies.
    reply = (input) => {
      assert.deepEqual(input.projects.map((item) => item.title).sort(), ['Сайт', 'Удалёнка BY']);
      assert.equal(input.messages[0]!.default_project, P1);
      return { tasks: [{ ...base, task_id: null, title: 'Настроить принтер', message_ids: [input.messages[0]!.id], project: null, section: null, project_options: [] }] };
    };
    s.add(telegram('7101', 'не печатает принтер'));
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
    assert.deepEqual([byTitle.get('Тёмная тема')!.project, byTitle.get('Тёмная тема')!.section], [P2, 'ideas']);
    assert.equal(byTitle.get('Что-то общее')!.project, undefined);
    assert.deepEqual(byTitle.get('Что-то общее')!.project_options, [P1, P2]);
    assert.deepEqual([byTitle.get('Шаг')!.project, byTitle.get('Шаг')!.section], [P2, null]);
    // A task already in a project is not moved by a later batch.
    const printer = byTitle.get('Настроить принтер')!;
    reply = (input) => ({ tasks: [{ ...base, task_id: printer.id, title: printer.title, message_ids: [input.messages[0]!.id], project: P2, section: 'next', project_options: [] }] });
    s.add(telegram('7101', 'всё ещё не печатает'));
    for (const batch of s.triage.ready(Date.now() + CHAT_QUIET + 1000)) await s.triage.run(batch);
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
  let reply: (input: PlanInput) => PlanOutput = () => ({ tasks: [] });
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
    assert.equal((s.tasks().find((task) => task.id === bill.id) as any).counterparty, C1);
  } finally { s.cleanup(); }
});

test('the triage keeps personal talk and consultations in the conversation; items are steps still to do', async () => {
  const { PLAN_INSTRUCTIONS } = await import('../src/tasks/planner.ts');
  for (const rule of ['Остаётся в беседе', 'консультация', 'личная и семейная переписка', 'Пункт — только шаг', 'Сомневаешься — задачи нет']) {
    assert.ok(PLAN_INSTRUCTIONS.includes(rule), rule);
  }
});
