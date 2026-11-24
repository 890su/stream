import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JournalStore } from '../src/store/store.ts';
import { LiveFeed } from '../src/server/live.ts';
import { migrateTopics } from '../src/tasks/topicsgone.ts';
import { foldTasks } from '../src/tasks/fold.ts';
import { nameId } from '../src/ids.ts';

// One-time migration of the dropped topics (2026-11-24). Texts are made up.
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const AT = '2026-11-24T10:00:00.000Z';
let counter = 100;
const change = (task: string, minute: number, data: Record<string, unknown>, author = 'system') => ({
  id: uuid(++counter), schema_version: 1 as const, source: author === 'me' ? 'app' : 'system', author, ts: `2026-11-23T10:${String(minute).padStart(2, '0')}:00.000Z`,
  kind: 'task_change', payload: { ref: { type: 'task', id: task }, data: { task: data } } });
const fresh = () => { const dir = mkdtempSync(join(tmpdir(), 'topicsgone-')); return { store: new JournalStore(dir), done: () => rmSync(dir, { recursive: true, force: true }) }; };
const run = (store: JournalStore) => migrateTopics({ store, live: new LiveFeed(), at: AT });
const seed = (store: JournalStore) => {
  // t1: AI topic with an offer; t2: AI topic without one, the owner wrote into it; t3: made by the owner; t4: a plain task.
  store.appendEvent(change(uuid(1), 0, { op: 'create', title: 'Принтер', kind: 'topic', offer: true }));
  store.appendEvent(change(uuid(2), 1, { op: 'create', title: 'Погода', kind: 'topic' }));
  store.appendEvent(change(uuid(2), 2, { op: 'update', add: [uuid(90)] }, 'me'));
  store.appendEvent(change(uuid(3), 3, { op: 'create', title: 'Моя тема', kind: 'topic' }, 'me'));
  store.appendEvent(change(uuid(4), 4, { op: 'create', title: 'Обычная', status: 'todo' }));
};
const byId = (store: JournalStore) => new Map(foldTasks(store.triage.taskEvents()).map((task) => [task.id, task]));

test('migrateTopics: AI topic with offer → unconfirmed task', () => {
  const { store, done } = fresh();
  try {
    seed(store);
    const result = run(store);
    assert.equal(result.tasks, 1);
    const written = store.getEvent(nameId(`topics-gone|${uuid(1)}`))!;
    assert.deepEqual((written.payload.data as any).task, { op: 'update', kind: 'task', unconfirmed: true });
    assert.equal(byId(store).get(uuid(1))!.unconfirmed, true);
    assert.notEqual(byId(store).get(uuid(1))!.status, 'cancelled');
  } finally { store.close(); done(); }
});

test('migrateTopics: other AI topics → cancelled «Темы убраны», even if the owner replied into them', () => {
  const { store, done } = fresh();
  try {
    seed(store);
    assert.equal(run(store).cancelled, 1);
    assert.equal(byId(store).get(uuid(2))!.status, 'cancelled');
    assert.equal((store.getEvent(nameId(`topics-gone|${uuid(2)}`))!.payload.data as any).task.reason, 'Темы убраны');
  } finally { store.close(); done(); }
});

test('migrateTopics: a topic the owner created stays an open task', () => {
  const { store, done } = fresh();
  try {
    seed(store);
    run(store);
    assert.equal(store.getEvent(nameId(`topics-gone|${uuid(3)}`)), undefined);
    assert.equal(store.getEvent(nameId(`topics-gone|${uuid(4)}`)), undefined);
    assert.equal(byId(store).get(uuid(3))!.status, 'todo');
  } finally { store.close(); done(); }
});

test('migrateTopics twice writes nothing new', () => {
  const { store, done } = fresh();
  try {
    seed(store);
    run(store);
    const before = store.triage.taskEvents().length;
    assert.deepEqual(run(store), { tasks: 0, cancelled: 0, unconfirmed: 0 });
    assert.equal(store.triage.taskEvents().length, before);
  } finally { store.close(); done(); }
});

test('pending AI log decisions topic/topic_link/propose_task → replaced', () => {
  const { store, done } = fresh();
  try {
    store.ailog.run({ id: 'r1', at: AT, processor: 'triage-ai-v20', model: 'm', stream: 's', messages: 1, input_tokens: 1, output_tokens: 1, cost_usd: 0, input: null, output: null });
    const make = (id: string, kind: string, status: string) => ({ id, run_id: 'r1', at: AT, kind: kind as any, task_id: null, message_ids: [], confidence: null, reason: null, status: status as any });
    store.ailog.decide([make('a', 'topic', 'pending'), make('b', 'topic_link', 'pending'), make('c', 'propose_task', 'pending'),
      make('d', 'link', 'pending'), make('e', 'topic', 'accepted')]);
    assert.equal(store.ailog.replaceKinds(['topic', 'topic_link', 'propose_task'], AT), 3);
    assert.deepEqual(['a', 'b', 'c', 'd', 'e'].map((id) => store.ailog.decision(id)!.status), ['replaced', 'replaced', 'replaced', 'pending', 'accepted']);
    assert.equal(store.ailog.replaceKinds(['topic'], AT), 0);
  } finally { store.close(); done(); }
});
