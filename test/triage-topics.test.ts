import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { temporaryStore, event } from './helpers.ts';
import { tasksConfig } from '../src/config.ts';
import { LiveFeed } from '../src/server/live.ts';
import { Triage } from '../src/tasks/triage.ts';
import { retriage } from '../src/tasks/retriage.ts';
import { foldTasks } from '../src/tasks/fold.ts';
import type { PlanInput, PlanOutput } from '../src/tasks/planner.ts';
import type { JournalEvent } from '../src/contracts/validate.ts';
import type { TriageNewTasks } from '../src/ownersettings.ts';

// Triage v20 (topics design 2026-11-23): messages go into topics, a task is only offered. A scripted planner; texts
// are made up.
const CHAT_QUIET = 180_000;
const telegram = (chat: string, text: string): JournalEvent => event({
  source: 'telegram', author: `contact:tg:by:${chat}`, payload: { text, data: { telegram: { account: 'by', chat_id: chat, chat_type: 'private', chat_title: 'Клиент', message_id: Math.floor(Math.random() * 1e6) + 1, sent_at: '2026-11-23T10:00:00.000Z' } } },
});
type Planned = PlanOutput['tasks'][number];
const planned = (data: Partial<Planned>): Planned => ({ task_id: null, title: 'Дело', responsible: 'me', executors: [], author: null, template: null, due: null, message_ids: [], confidence: 0.9, note: null, filed: false, done: false, alternatives: [], work: false, ...data });

function setup(plan: (input: PlanInput) => Planned[], mode: TriageNewTasks = 'unconfirmed') {
  const storage = temporaryStore();
  const calls: PlanInput[] = [];
  const triage = new Triage({ store: storage.store, live: new LiveFeed(), newTasks: () => mode,
    planner: async (input) => { calls.push(input); return { conversation_only: [], tasks: plan(input), unfinished: null, need_earlier: false }; } });
  const add = (item: JournalEvent) => storage.store.appendEvent(item).event;
  const tasks = () => foldTasks(storage.store.triage.taskEvents());
  const run = async (at = Date.now() + CHAT_QUIET + 1000) => { for (const batch of triage.ready(at)) await triage.run(batch); };
  const proposals = () => storage.store.triage.results().flatMap((result) => (result.payload.data?.triage as { proposals?: { task_id: string }[] }).proposals ?? []);
  const owner = (task: string, change: Record<string, unknown>) => storage.store.appendEvent({ id: randomUUID(), schema_version: 1, source: 'app', author: 'me', ts: new Date().toISOString(),
    kind: 'task_change', payload: { ref: { type: 'task', id: task }, data: { task: change } } });
  return { ...storage, triage, calls, add, tasks, run, proposals, owner };
}

test('a new subject without work becomes a topic, no offer', async () => {
  const s = setup((input) => [planned({ title: 'Клиент: какой роутер выбрать', message_ids: input.messages.map((m) => m.id), work: false })]);
  try {
    s.add(telegram('8101', 'какой роутер лучше взять?'));
    await s.run();
    const [topic] = s.tasks();
    assert.equal(topic!.kind, 'topic');
    assert.equal(topic!.offer, false);
  } finally { s.cleanup(); }
});

test('a new subject with work becomes a topic with an offer (mode unconfirmed)', async () => {
  const s = setup((input) => [planned({ title: 'Клиент: выезд', message_ids: input.messages.map((m) => m.id), work: true, reason: 'договорились о выезде' })]);
  try {
    s.add(telegram('8102', 'приезжайте в субботу'));
    await s.run();
    const [topic] = s.tasks();
    assert.deepEqual([topic!.kind, topic!.offer], ['topic', true]);
    assert.deepEqual(Object.values(s.store.ailog.stats('2000-01-01')).length > 0, true);
    assert.deepEqual(s.store.ailog.stats('2000-01-01').propose_task, { pending: 1 });
  } finally { s.cleanup(); }
});

test('confirmed mode makes a task at once', async () => {
  const s = setup((input) => [planned({ title: 'Клиент: выезд', message_ids: input.messages.map((m) => m.id), work: true })], 'confirmed');
  try {
    s.add(telegram('8103', 'приезжайте в субботу'));
    await s.run();
    assert.deepEqual([s.tasks()[0]!.kind, s.tasks()[0]!.offer], ['task', false]);
  } finally { s.cleanup(); }
});

test('a message continuing a topic is added to it directly; one continuing a task is only proposed', async () => {
  let round = 0;
  let topicId = '';
  let taskId = '';
  const s = setup((input) => {
    round += 1;
    const ids = input.messages.map((m) => m.id);
    if (round === 1) return [planned({ title: 'Клиент: принтер', message_ids: ids })];
    if (round === 2) return [planned({ task_id: topicId, title: 'Клиент: принтер', message_ids: ids })];
    return [planned({ task_id: taskId, title: 'Клиент: счёт', message_ids: ids })];
  });
  try {
    s.add(telegram('8104', 'принтер не печатает'));
    await s.run();
    topicId = s.tasks()[0]!.id;
    const next = s.add(telegram('8104', 'и бумага застревает'));
    await s.run(Date.now() + 2 * CHAT_QUIET + 1000);
    assert.ok(s.tasks().find((task) => task.id === topicId)!.messages.includes(next.id), 'into the topic at once');
    assert.equal(s.proposals().length, 0);
    assert.equal(s.store.ailog.stats('2000-01-01').topic_link?.auto, 1);
    taskId = randomUUID();
    s.owner(taskId, { op: 'create', title: 'Клиент: счёт', status: 'todo' });
    s.add(telegram('8104', 'и счёт пришлите'));
    await s.run(Date.now() + 3 * CHAT_QUIET + 1000);
    assert.deepEqual(s.proposals().map((item) => item.task_id), [taskId], 'a task — still a proposal');
  } finally { s.cleanup(); }
});

test('the AI sees topics with their kind; a topic silent past topic_days is not offered as a target', async () => {
  const s = setup(() => []);
  try {
    const old = event({ ts: new Date(Date.now() - 40 * 86_400_000).toISOString(), payload: { text: 'давняя тема' } });
    s.add(old);
    s.owner(randomUUID(), { op: 'create', title: 'Давняя тема', kind: 'topic', add: [old.id] });
    s.owner(randomUUID(), { op: 'create', title: 'Свежая тема', kind: 'topic' });
    s.owner(randomUUID(), { op: 'create', title: 'Дело', status: 'todo' });
    s.add(telegram('8105', 'привет'));
    await s.run();
    const open = s.calls[0]!.open_tasks;
    assert.deepEqual(open.map((task) => [task.title, task.kind]).sort(), [['Дело', 'task'], ['Свежая тема', 'topic']]);
  } finally { s.cleanup(); }
});

test('owner «Сделать задачей» accepts the offer; ✕ rejects it', async () => {
  const s = setup((input) => [planned({ title: `Клиент: ${input.messages[0]!.text}`, message_ids: input.messages.map((m) => m.id), work: true })]);
  try {
    s.add(telegram('8106', 'выезд'));
    await s.run();
    s.add(telegram('8107', 'заказ'));
    await s.run(Date.now() + 2 * CHAT_QUIET + 1000);
    const [first, second] = s.tasks();
    s.owner(first!.id, { op: 'update', kind: 'task', offer: false });
    s.owner(second!.id, { op: 'update', offer: false });
    assert.deepEqual(s.store.ailog.stats('2000-01-01').propose_task, { accepted: 1, rejected: 1 });
  } finally { s.cleanup(); }
});

test('retriage withdraws the AI topics the owner never touched and keeps touched ones', async () => {
  let round = 0;
  const s = setup((input) => { round += 1; return [planned({ title: `Тема ${round}`, message_ids: input.messages.map((m) => m.id) })]; });
  try {
    const first = s.add(telegram('8108', 'вопрос про камеры'));
    await s.run();
    const untouched = s.tasks()[0]!;
    const message = s.add(telegram('8108', 'и про роутер'));
    await s.run(Date.now() + 2 * CHAT_QUIET + 1000);
    const touched = s.tasks().find((task) => task.id !== untouched.id)!;
    s.owner(touched.id, { op: 'update', title: 'Клиент: роутер' });
    const result = await retriage({ store: s.store, live: new LiveFeed(), triage: s.triage, ids: [first.id, message.id] });
    const after = new Map(s.tasks().map((task) => [task.id, task]));
    assert.equal(after.get(untouched.id)!.status, 'cancelled');
    assert.equal(after.get(touched.id)!.status, 'todo');
    assert.equal(result.tasks, 1);
  } finally { s.cleanup(); }
});

test('v20: processor, schema requires work, instructions speak of topics', async () => {
  const { PLAN_INSTRUCTIONS, PLAN_SCHEMA } = await import('../src/tasks/planner.ts');
  assert.equal(tasksConfig.ai.processor, 'triage-ai-v20');
  const item = (PLAN_SCHEMA.properties.tasks as { items: { required: readonly string[] } }).items;
  assert.ok(item.required.includes('work'));
  for (const rule of ['тема', 'work', 'kind']) assert.ok(PLAN_INSTRUCTIONS.includes(rule), rule);
});
