import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { temporaryStore, event } from './helpers.ts';
import { LiveFeed } from '../src/server/live.ts';
import { Triage } from '../src/tasks/triage.ts';
import { foldTasks } from '../src/tasks/fold.ts';
import type { NameInput } from '../src/tasks/namer.ts';
import type { JournalEvent } from '../src/contracts/validate.ts';

// A task the owner made by hand gets its title from AI: «Контрагент: суть» (task manager spec). Texts are made up.
const ownTask = (title: string, messageId: string, ts: string): JournalEvent => ({
  id: randomUUID(), schema_version: 1, source: 'app', author: 'me', ts, kind: 'task_change',
  payload: { ref: { type: 'task', id: randomUUID() }, data: { task: { op: 'create', title, status: 'todo', roles: { responsible: 'me', executors: ['me'] }, add: [messageId] } } },
});

test('a task made by hand is named by AI once; a task the owner named stays', async () => {
  const storage = temporaryStore();
  const asked: NameInput[] = [];
  const triage = new Triage({ store: storage.store, live: new LiveFeed(), planner: async () => ({ tasks: [], conversation_only: [] }),
    namer: async (input) => { asked.push(input); return { title: 'Dzika 11: проверить кабель', usage: { input_tokens: 100, output_tokens: 10 } }; } });
  try {
    const earlier = new Date(Date.now() - 60_000).toISOString();
    const message = storage.store.appendEvent(event({ payload: { text: 'это заказ на ул. Dzika 11, проверить кабель' }, ts: earlier })).event;
    const made = storage.store.appendEvent(ownTask('это заказ на ул. Dzika 11, проверить кабель', message.id, earlier)).event;
    const named = storage.store.appendEvent(ownTask('Моё название', message.id, earlier)).event;
    storage.store.appendEvent({ ...ownTask('', message.id, earlier), payload: { ref: named.payload.ref, data: { task: { op: 'update', title: 'Моё название' } } } });
    await triage.tick();
    await triage.tick();
    const tasks = foldTasks(storage.store.triage.taskEvents());
    const byId = (id: string) => tasks.find((task) => task.id === id)!;
    assert.equal(byId(made.payload.ref!.id).title, 'Dzika 11: проверить кабель');
    assert.equal(byId(named.payload.ref!.id).title, 'Моё название');
    assert.equal(asked.length, 1, 'named once, the owner-titled task is not asked about');
    assert.equal(asked[0]!.messages[0]!.text, 'это заказ на ул. Dzika 11, проверить кабель');
  } finally { storage.cleanup(); }
});
