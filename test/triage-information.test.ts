// Exercises conversation-only outcomes without creating or reopening tasks.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { conversationsConfig, tasksConfig } from '../src/config.ts';
import { validateEvent, type JournalEvent } from '../src/contracts/validate.ts';
import { LiveFeed } from '../src/server/live.ts';
import { foldTasks } from '../src/tasks/fold.ts';
import type { PlannedTask } from '../src/tasks/planner.ts';
import { Triage } from '../src/tasks/triage.ts';
// @ts-expect-error The browser projection is buildless JavaScript.
import { project } from '../web/projection.js';
// @ts-expect-error The browser queue is buildless JavaScript.
import { queueOf } from '../web/queue.js';
import { event, fixture, temporaryStore } from './helpers.ts';

interface Example {
  id: string; direction: 'incoming' | 'outgoing' | 'note'; source: 'sms' | 'telegram' | 'share';
  forwarded?: true; text: string; expected: 'task' | 'conversation_only'; title?: string;
}

const examples = readFileSync(new URL('../golden/triage-information.jsonl', import.meta.url), 'utf8')
  .trim().split(/\r?\n/).map((line) => JSON.parse(line) as Example);
const task = (id: string, title: string, taskId: string | null = null): PlannedTask => ({
  task_id: taskId, title, responsible: 'me', executors: [], author: null, template: null, due: null,
  message_ids: [id], confidence: 0.9, note: null, filed: false, done: false, alternatives: [],
});

function capture(example: Example, index: number): JournalEvent {
  const ts = '2026-11-20T10:00:00.000Z';
  if (example.source === 'sms') {
    const direction = example.direction === 'outgoing' ? 'out' : 'in';
    return event({ ts, source: 'android_phone', kind: 'sms', payload: { text: example.text,
      data: { sms: { direction, number: `+4850000000${index + 1}`, sent_at: ts } } } });
  }
  if (example.source === 'telegram') return event({ ts, source: 'telegram', payload: { text: example.text,
    data: { telegram: { account: 'by', chat_id: String(500 + index), chat_type: 'private', message_id: index + 1,
      sent_at: ts, ...(example.forwarded ? { forward: { date: ts } } : {}) } } } });
  return event({ ts, source: 'share', payload: { text: example.text } });
}

test('the fictional golden examples give tasks for actions and separate outcomes for conversational context', async () => {
  const { store, cleanup } = temporaryStore();
  try {
    const events = examples.map((example, index) => store.appendEvent(capture(example, index)).event);
    const fixtures = new Map(events.map((item, index) => [item.id, examples[index]!]));
    const triage = new Triage({ store, live: new LiveFeed(), planner: async ({ messages }) => {
      const tasks: PlannedTask[] = [];
      const conversation_only: string[] = [];
      for (const message of messages) {
        const example = fixtures.get(message.id)!;
        assert.equal(message.direction, example.direction);
        assert.equal(message.forwarded, example.forwarded);
        if (example.expected === 'task') tasks.push(task(message.id, example.title ?? example.id));
        else conversation_only.push(message.id);
      }
      return { tasks, conversation_only };
    } });
    for (const batch of triage.ready(Date.now() + 6 * 60_000)) await triage.run(batch);
    const tasks = foldTasks(store.triage.taskEvents());
    const titleByMessage = new Map(tasks.flatMap((item) => item.messages.map((message) => [message, item.title])));
    assert.equal(tasks.length, 3);
    assert.deepEqual(events.map((item) => titleByMessage.get(item.id)), ['invitation', undefined, undefined, 'Забрать запасной кабель', 'capture', undefined]);
    const results = store.triage.results();
    for (const result of results) validateEvent(result);
    const views = project([...results, ...events]);
    assert.equal(views.length, events.length, 'results are annotations, not message bubbles');
    assert.deepEqual(views.filter((view: { conversationOnly?: boolean }) => view.conversationOnly)
      .map((view: { id: string }) => fixtures.get(view.id)!.id).sort(), ['forward', 'retelling', 'status']);
    assert.equal(triage.ready(Date.now() + 6 * 60_000).length, 0, 'all outcomes are marked handled');
  } finally { cleanup(); }
});

test('a context outcome excludes a conflicting reopen proposal and survives a replay', async () => {
  const { store, cleanup } = temporaryStore();
  try {
    const source = store.appendEvent(capture(examples[0]!, 0)).event;
    const taskId = crypto.randomUUID();
    store.appendEvent(event({ ts: new Date().toISOString(), kind: 'task_change', payload: {
      ref: { type: 'task', id: taskId }, data: { task: { op: 'create', title: 'Дело уже выполнено', status: 'done', add: [source.id] } },
    } }));
    const context = store.appendEvent(capture(examples[2]!, 2)).event;
    let replay = false;
    const triage = new Triage({ store, live: new LiveFeed(), planner: async () => ({
      tasks: [task(context.id, 'Повтор дела', taskId)], conversation_only: replay ? [] : [context.id],
    }) });
    assert.equal(await triage.run([context]), 0);
    replay = true;
    assert.equal(await triage.run([context]), 0);
    assert.equal(store.triage.results().length, 1);
    assert.equal(foldTasks(store.triage.taskEvents())[0]!.status, 'done');
  } finally { cleanup(); }
});

test('a new device receives context results and keeps an informational SMS out of the queue', async () => {
  const f = await fixture();
  try {
    const message = f.store.appendEvent(capture(examples[5]!, 5)).event;
    const annotation = event({ source: 'system', author: 'system', kind: 'triage_result', payload: { data: {
      triage: { processor: tasksConfig.ai.processor, conversation_only: [message.id] },
    } } });
    assert.throws(() => validateEvent({ ...annotation, kind: 'text' }));
    assert.throws(() => validateEvent({ ...annotation, author: 'me' }));
    f.store.appendEvent(annotation);
    const response = await f.request('/api/directory');
    assert.equal(response.status, 200);
    const { events } = await response.json() as { events: JournalEvent[] };
    assert.ok(events.some((item) => item.id === annotation.id));
    const key = 'tel:+48500000006';
    const options = { now: new Date('2026-11-20T11:00:00Z'), config: conversationsConfig };
    assert.equal(queueOf({ key, views: project([message]), tasks: [] }, options).waiting, true);
    assert.equal(queueOf({ key, views: project([...events, message]), tasks: [] }, options).waiting, false);
  } finally { await f.stop(); }
});
