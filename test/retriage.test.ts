import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { temporaryStore, event } from './helpers.ts';
import { LiveFeed } from '../src/server/live.ts';
import { Triage } from '../src/tasks/triage.ts';
import { retriage } from '../src/tasks/retriage.ts';
import { foldTasks } from '../src/tasks/fold.ts';
import type { PlanInput, PlanOutput, PlannedTask } from '../src/tasks/planner.ts';
import type { JournalEvent } from '../src/contracts/validate.ts';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { proposalsByMessage } from '../web/proposals.js';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { project } from '../web/projection.js';

// «✨ Разобрать заново» (owner, 2026-11-23): the conversation's last session goes to the triage again and replaces
// what the AI decided about it that the owner has not answered. Texts are made up.
const chat = (text: string, ts: string): JournalEvent => event({ source: 'telegram', author: 'contact:tg:by:7001', ts,
  payload: { text, data: { telegram: { account: 'by', chat_id: '7001', chat_type: 'private', chat_title: 'Клиент', message_id: Math.floor(Math.random() * 1e6) + 1, sent_at: ts } } } });
const planned = (data: Partial<PlannedTask>): PlannedTask => ({ task_id: null, title: 'Дело', responsible: 'me', executors: [], author: null, template: null, due: null,
  message_ids: [], confidence: 0.9, note: null, filed: false, done: false, alternatives: [], ...data });

function setup() {
  const storage = temporaryStore();
  let plan: (input: PlanInput) => Omit<PlanOutput, 'usage'> = () => ({ tasks: [], conversation_only: [] });
  const calls: PlanInput[] = [];
  const triage = new Triage({ store: storage.store, live: new LiveFeed(), newTasks: () => 'unconfirmed', planner: async (input) => { calls.push(input); return plan(input); } });
  const add = (item: JournalEvent) => storage.store.appendEvent(item).event;
  const tasks = () => foldTasks(storage.store.triage.taskEvents());
  const own = (id: string, change: Record<string, unknown>) => add({ id: randomUUID(), schema_version: 1, source: 'app', author: 'me', ts: new Date().toISOString(), kind: 'task_change', payload: { ref: { type: 'task', id }, data: { task: change } } });
  const events = () => storage.store.listEvents({ limit: 10_000 }).events.reverse();
  return { ...storage, triage, calls, add, tasks, own, events, set: (next: typeof plan) => { plan = next; } };
}

test('again: unconfirmed AI tasks and waiting proposals of the session are withdrawn; the new result replaces them', async () => {
  const s = setup();
  try {
    // A task of mine from before, and a conversation the AI got wrong.
    const mine = randomUUID();
    s.own(mine, { op: 'create', title: 'Роутер у клиента', status: 'todo', add: [] });
    const a = s.add(chat('по роутеру: не включается', '2026-11-20T10:00:00.000Z'));
    const b = s.add(chat('и ещё камеры посмотри', '2026-11-20T10:05:00.000Z'));
    s.set((input) => ({ tasks: [planned({ title: 'Камеры', message_ids: [b.id] }), planned({ task_id: mine, title: 'Роутер у клиента', message_ids: [a.id] })], conversation_only: [] }));
    for (const batch of s.triage.ready(Date.now() + 200_000)) await s.triage.run(batch);
    const wrong = s.tasks().find((task) => task.title === 'Камеры')!;
    assert.equal(wrong.unconfirmed, true);
    assert.equal(proposalsByMessage(s.events()).get(a.id)?.task, mine, 'a waiting proposal before');

    s.set((input) => {
      assert.ok(input.messages.some((message) => message.id === a.id) && input.messages.some((message) => message.id === b.id), 'the whole session again');
      return { tasks: [planned({ title: 'Клиент: роутер и камеры', message_ids: [a.id, b.id] })], conversation_only: [] };
    });
    const result = await retriage({ store: s.store, live: new LiveFeed(), triage: s.triage, ids: [a.id, b.id] });
    assert.deepEqual({ messages: result.messages, tasks: result.tasks, proposals: result.proposals }, { messages: 2, tasks: 1, proposals: 1 });
    const after = s.tasks();
    assert.equal(after.find((task) => task.id === wrong.id)!.status, 'cancelled', 'the old AI task is withdrawn');
    assert.equal(after.find((task) => task.id === mine)!.status, 'todo', 'my task stays');
    assert.ok(after.some((task) => task.title === 'Клиент: роутер и камеры' && task.unconfirmed));
    assert.equal(proposalsByMessage(s.events()).get(a.id), undefined, 'the old proposal is withdrawn');
    const stats = s.store.ailog.stats(new Date(0).toISOString());
    assert.equal(stats.create?.replaced, 1, 'the AI log keeps what was replaced');
    assert.equal(stats.link?.replaced, 1);
  } finally { s.cleanup(); }
});

test('again: a confirmed AI task stays; messages already in a task are not proposed into it again', async () => {
  const s = setup();
  try {
    const a = s.add(chat('нужна настройка принтера', '2026-11-20T10:00:00.000Z'));
    s.set((input) => ({ tasks: [planned({ title: 'Принтер', message_ids: input.messages.map((message) => message.id) })], conversation_only: [] }));
    for (const batch of s.triage.ready(Date.now() + 200_000)) await s.triage.run(batch);
    const printer = s.tasks()[0]!;
    s.own(printer.id, { op: 'update', unconfirmed: false });
    s.set(() => ({ tasks: [planned({ task_id: printer.id, title: 'Принтер', message_ids: [a.id] })], conversation_only: [] }));
    const result = await retriage({ store: s.store, live: new LiveFeed(), triage: s.triage, ids: [a.id] });
    assert.equal(result.tasks, 0);
    assert.equal(s.tasks()[0]!.status, 'todo');
    assert.equal(proposalsByMessage(s.events()).size, 0, 'nothing to propose');
  } finally { s.cleanup(); }
});

test('again: only the last session goes; earlier ones are context', async () => {
  const s = setup();
  try {
    const old = s.add(chat('вчера: про камеры', '2026-11-19T10:00:00.000Z'));
    const fresh = s.add(chat('сегодня: про роутер', '2026-11-20T10:00:00.000Z'));
    await retriage({ store: s.store, live: new LiveFeed(), triage: s.triage, ids: [old.id, fresh.id] });
    assert.deepEqual(s.calls.at(-1)!.messages.map((message) => message.id), [fresh.id]);
    assert.deepEqual(s.calls.at(-1)!.context.map((message) => message.id), [old.id]);
  } finally { s.cleanup(); }
});

test('the newest triage result decides whether a message stays only in the conversation', () => {
  const message = event({ payload: { text: 'привет' } });
  const result = (ts: string, triage: Record<string, unknown>) => event({ source: 'system', author: 'system', kind: 'triage_result', ts, payload: { data: { triage } } });
  const only = (list: JournalEvent[]) => Boolean(project([message, ...list]).find((view: { id: string }) => view.id === message.id).conversationOnly);
  const first = result('2026-11-20T10:00:00.000Z', { conversation_only: [message.id], messages: [message.id] });
  const again = result('2026-11-20T11:00:00.000Z', { conversation_only: [], messages: [message.id], again: true });
  assert.equal(only([first]), true);
  assert.equal(only([first, again]), false);
});
