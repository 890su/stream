import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { temporaryStore, event, token } from './helpers.ts';
import { createApp } from '../src/server/http.ts';
import { LiveFeed } from '../src/server/live.ts';
import { tasksConfig } from '../src/config.ts';
import { foldTasks } from '../src/tasks/fold.ts';
import { recheck } from '../src/tasks/recheck.ts';
import { RECHECK_SCHEMA, restoreRecheck, type RecheckInput, type RecheckProposal } from '../src/tasks/recheckplan.ts';
import type { JournalEvent } from '../src/contracts/validate.ts';

// «✨ Сверить с перепиской» on a record (docs/plans/2026-11-23-conversation-records-design.md «✨ на записи»): the
// record's conversations go to a scripted rechecker instead of AI; everything it says is only proposed. Texts are made up.
interface Proposal { id: string; kind: string; task_id: string; message_ids: string[]; reason: string; change: Record<string, any>; also?: { task_id: string; change: Record<string, any> }[] }
const chat = (chatId: string, text: string, ts: string): JournalEvent => event({ source: 'telegram', author: `contact:tg:by:${chatId}`, ts,
  payload: { text, data: { telegram: { account: 'by', chat_id: chatId, chat_type: 'private', chat_title: 'Клиент', message_id: Math.floor(Math.random() * 1e6) + 1, sent_at: ts } } } });
const proposal = (data: Partial<RecheckProposal>): RecheckProposal => ({ kind: 'add', message_ids: [], value: null, target_task_id: null, reason: 'потому что', ...data });

function setup() {
  const storage = temporaryStore();
  const calls: RecheckInput[] = [];
  let script: (input: RecheckInput) => RecheckProposal[] = () => [];
  const rechecker = async (input: RecheckInput) => { calls.push(input); return { proposals: script(input), usage: { input_tokens: 1000, output_tokens: 100 } }; };
  const add = (item: JournalEvent) => storage.store.appendEvent(item).event;
  const own = (id: string, change: Record<string, unknown>, author = 'me') => add({ id: randomUUID(), schema_version: 1, source: author === 'me' ? 'app' : 'system', author,
    ts: new Date().toISOString(), kind: 'task_change', payload: { ref: { type: 'task', id }, data: { task: change } } });
  const tasks = () => foldTasks(storage.store.triage.taskEvents());
  const task = (id: string) => tasks().find((item) => item.id === id)!;
  const results = () => storage.store.triage.results().filter((result) => (result.payload.data!.triage as { recheck?: string }).recheck);
  const proposals = () => (results().at(-1)!.payload.data!.triage as { proposals?: Proposal[] }).proposals ?? [];
  const run = (taskId: string) => recheck({ store: storage.store, live: new LiveFeed(), rechecker, taskId });
  return { ...storage, calls, add, own, tasks, task, results, proposals, run, set: (next: typeof script) => { script = next; } };
}

// A record of mine about a client's router, two messages in it; the same chat goes on about it and about cameras.
function routerCase(s: ReturnType<typeof setup>) {
  const record = randomUUID();
  const a = s.add(chat('7101', 'роутер не включается', '2026-11-20T10:00:00.000Z'));
  const b = s.add(chat('7101', 'камеры бы ещё посмотреть', '2026-11-20T10:02:00.000Z'));
  const c = s.add(chat('7101', 'роутер мигает красным', '2026-11-20T10:05:00.000Z'));
  s.own(record, { op: 'create', title: 'Клиент: роутер', status: 'todo', add: [a.id, b.id] });
  return { record, a, b, c };
}

test('recheck: the record\'s conversation goes to the AI with what is in the record; proposals are written, nothing applied', async () => {
  const s = setup();
  try {
    const { record, a, b, c } = routerCase(s);
    const before = s.task(record);
    s.set((input) => {
      assert.equal(input.record.id, record);
      assert.deepEqual(input.messages.map((message) => [message.id, message.in_record]), [[a.id, true], [b.id, true], [c.id, false]]);
      return [proposal({ kind: 'add', message_ids: [c.id], reason: 'тот же роутер' }), proposal({ kind: 'remove', message_ids: [b.id], reason: 'камеры — другое дело' }),
        proposal({ kind: 'rename', value: 'Клиент: роутер мигает' }), proposal({ kind: 'due', value: '2026-11-25' }),
        proposal({ kind: 'items', value: 'проверить блок питания' }), proposal({ kind: 'status', value: 'Заменил блок питания', message_ids: [c.id] })];
    });
    const result = await s.run(record);
    assert.deepEqual(result, { proposals: 6 });
    const written = s.proposals();
    assert.deepEqual(written.map((item) => item.kind), ['add', 'remove', 'rename', 'due', 'items', 'status']);
    assert.ok(written.every((item) => item.task_id === record && /^[0-9a-f-]{36}$/.test(item.id)));
    assert.deepEqual(written[0]!.change, { op: 'update', add: [c.id] });
    assert.deepEqual(written[1]!.change, { op: 'update', remove: [b.id] });
    assert.deepEqual(written[2]!.change, { op: 'update', title: 'Клиент: роутер мигает' });
    assert.deepEqual(written[3]!.change, { op: 'update', due: '2026-11-25' });
    assert.equal(written[4]!.change.items_add[0].text, 'проверить блок питания');
    assert.deepEqual(written[5]!.change, { op: 'update', proposed: 'done', report: { note: 'Заменил блок питания' } });
    const after = s.task(record);
    assert.deepEqual([after.title, after.messages, after.due, after.items, after.status, after.proposed], [before.title, before.messages, before.due, before.items, before.status, before.proposed], 'the server applies nothing');
    const triage = s.results().at(-1)!.payload.data!.triage as Record<string, unknown>;
    assert.equal(triage.recheck, record);
    assert.equal(triage.processor, tasksConfig.ai.recheck_processor);
    assert.equal(triage.messages, undefined, 'a recheck does not decide what is only conversation');
    assert.equal(triage.last_message, undefined, 'nor whether the conversation is over');
  } finally { s.cleanup(); }
});

test('recheck: an owner-titled record gets a rename only as a proposal', async () => {
  const s = setup();
  try {
    const { record } = routerCase(s);
    s.own(record, { op: 'update', title: 'Роутер Иванова' });
    assert.equal(s.task(record).owner_titled, true);
    s.set((input) => { assert.equal(input.record.owner_titled, true); return [proposal({ kind: 'rename', value: 'Клиент: роутер' + ' TP-Link' })]; });
    assert.deepEqual(await s.run(record), { proposals: 1 });
    assert.deepEqual(s.proposals()[0]!.change, { op: 'update', title: 'Клиент: роутер TP-Link' });
    assert.equal(s.task(record).title, 'Роутер Иванова');
  } finally { s.cleanup(); }
});

test('recheck: a merge moves the duplicate\'s messages and items and closes it — in `also`', async () => {
  const s = setup();
  try {
    const { record } = routerCase(s);
    const dup = randomUUID();
    const d = s.add(chat('7101', 'так что с роутером?', '2026-11-20T11:00:00.000Z'));
    s.own(dup, { op: 'create', title: 'Клиент: роутер снова', status: 'todo', add: [d.id], items_add: [{ id: 'i1', text: 'купить роутер' }, { id: 'i2', text: 'настроить wifi' }],
      processor: 'triage-ai-v21', unconfirmed: true }, 'system');
    s.own(dup, { op: 'update', items_set: [{ id: 'i2', done: true }] }, 'system');
    s.set((input) => {
      assert.ok(input.others.some((other) => other.id === dup), 'the duplicate is shown');
      return [proposal({ kind: 'merge', target_task_id: dup, reason: 'то же дело' })];
    });
    assert.deepEqual(await s.run(record), { proposals: 1 });
    const merge = s.proposals()[0]!;
    assert.deepEqual(merge.change.add, [d.id]);
    assert.deepEqual(merge.change.items_add.map((item: { text: string }) => item.text), ['купить роутер', 'настроить wifi']);
    assert.deepEqual(merge.change.items_set, [{ id: merge.change.items_add[1].id, done: true }], 'a done item stays done');
    assert.deepEqual(merge.also, [{ task_id: dup, change: { op: 'update', status: 'cancelled', reason: 'Склеено с «Клиент: роутер»' } }]);
    assert.equal(s.task(dup).status, 'todo', 'nothing applied');
  } finally { s.cleanup(); }
});

test('recheck: an unknown target_task_id drops the proposal; a known one hints where removed messages go', async () => {
  const s = setup();
  try {
    const { record, b } = routerCase(s);
    const cameras = randomUUID();
    s.own(cameras, { op: 'create', title: 'Клиент: камеры', status: 'todo', add: [], roles: { author: 'tg:7101', responsible: 'me', executors: ['me'] } });
    s.set(() => [proposal({ kind: 'merge', target_task_id: randomUUID() }), proposal({ kind: 'remove', message_ids: [b.id], target_task_id: randomUUID() }),
      proposal({ kind: 'merge', target_task_id: record }), proposal({ kind: 'remove', message_ids: [b.id], target_task_id: cameras })]);
    assert.deepEqual(await s.run(record), { proposals: 1 });
    const [remove] = s.proposals();
    assert.deepEqual([remove!.kind, remove!.change], ['remove', { op: 'update', remove: [b.id] }]);
    assert.deepEqual(remove!.also, [{ task_id: cameras, change: { op: 'update', add: [b.id] } }]);
  } finally { s.cleanup(); }
});

test('recheck: messages the owner put into another record are context only — never proposed for add', async () => {
  const s = setup();
  try {
    const { record, c } = routerCase(s);
    const other = randomUUID();
    s.own(other, { op: 'create', title: 'Клиент: мигание', status: 'todo', add: [c.id] });
    s.set((input) => {
      assert.equal(input.messages.find((message) => message.id === c.id)!.owner_linked_elsewhere, true);
      return [proposal({ kind: 'add', message_ids: [c.id] })];
    });
    assert.deepEqual(await s.run(record), { proposals: 0 });
    assert.deepEqual(s.proposals(), []);
  } finally { s.cleanup(); }
});

test('recheck: the AI log keeps the pass and each proposal; a second pass withdraws what the first left waiting', async () => {
  const s = setup();
  try {
    const { record, c } = routerCase(s);
    s.set(() => [proposal({ kind: 'add', message_ids: [c.id] }), proposal({ kind: 'rename', value: 'Клиент: роутер мигает' })]);
    await s.run(record);
    const [first, second] = s.proposals();
    assert.equal(s.store.ailog.decision(first!.id)!.status, 'pending');
    assert.equal(s.store.ailog.decision(first!.id)!.kind, 'recheck');
    assert.equal(s.store.triage.spent(new Date().toISOString().slice(0, 7)) > 0, true, 'the cost is counted against the budget');
    // ✕ on the rename: a `reject_proposal` correction on a message of the record.
    s.add({ id: randomUUID(), schema_version: 1, source: 'app', author: 'me', ts: new Date().toISOString(), kind: 'correction',
      payload: { ref: { type: 'event', id: c.id }, data: { op: 'reject_proposal', proposal: second!.id } } });
    assert.equal(s.store.ailog.decision(second!.id)!.status, 'rejected');
    s.set((input) => {
      assert.deepEqual(input.rejected, [{ kind: 'rename', value: 'Клиент: роутер мигает' }], 'what I turned down is shown, not to be offered again');
      return [];
    });
    assert.deepEqual(await s.run(record), { proposals: 0 });
    const again = s.results().at(-1)!.payload.data!.triage as { withdrawn?: string[] };
    assert.deepEqual(again.withdrawn, [first!.id], 'the waiting one is withdrawn, the rejected one is not');
    assert.equal(s.store.ailog.decision(first!.id)!.status, 'replaced');
  } finally { s.cleanup(); }
});

test('recheck: a record without messages has nothing to check against; an unknown record is 404', async () => {
  const s = setup();
  try {
    const empty = randomUUID();
    s.own(empty, { op: 'create', title: 'Купить кабель', status: 'todo', add: [] });
    await assert.rejects(s.run(empty), (error: { status: number }) => error.status === 409);
    await assert.rejects(s.run(randomUUID()), (error: { status: number }) => error.status === 404);
    assert.equal(s.calls.length, 0);
  } finally { s.cleanup(); }
});

test('POST /api/tasks/:id/recheck: 200 with the count; 409 without a key or over the budget', async () => {
  const storage = temporaryStore();
  const start = async (rechecker: unknown) => {
    const server = createApp({ store: storage.store, ownerToken: token, triage: { planner: null, rechecker: rechecker as never, everyMs: 3_600_000 } });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return { post: (id: string) => fetch(`${base}/api/tasks/${id}/recheck`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }),
      stop: async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); } };
  };
  const record = randomUUID();
  const a = storage.store.appendEvent(chat('7201', 'роутер не включается', '2026-11-20T10:00:00.000Z')).event;
  storage.store.appendEvent({ id: randomUUID(), schema_version: 1, source: 'app', author: 'me', ts: new Date().toISOString(), kind: 'task_change',
    payload: { ref: { type: 'task', id: record }, data: { task: { op: 'create', title: 'Клиент: роутер', status: 'todo', add: [a.id] } } } });
  let app = await start(null);
  try {
    const none = await app.post(record);
    assert.equal(none.status, 409);
    assert.match((await none.json()).error, /ключ/i);
    await app.stop();
    app = await start(async () => ({ proposals: [proposal({ kind: 'items', value: 'проверить блок питания' })] }));
    const ok = await app.post(record);
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { proposals: 1 });
    storage.store.triage.addUsage(new Date().toISOString().slice(0, 7), 0, 0, tasksConfig.ai.monthly_budget_usd);
    const over = await app.post(record);
    assert.equal(over.status, 409);
    assert.match((await over.json()).error, /лимит/);
  } finally { await app.stop(); storage.cleanup(); }
});

const at = (base: string, minutes: number) => new Date(Date.parse(base) + minutes * 60_000).toISOString();

test('recheck: a record with more messages than the bound gives the AI only its newest, up to max_batch × 3', async () => {
  const s = setup();
  try {
    const cap = tasksConfig.max_batch * 3;
    const record = randomUUID();
    const own = Array.from({ length: cap + 5 }, (_, index) => s.add(chat('7301', `роутер, сообщение ${index}`, at('2026-11-20T08:00:00.000Z', index))));
    s.add(chat('7301', 'не в записи', at('2026-11-20T08:00:00.000Z', cap + 10)));
    s.own(record, { op: 'create', title: 'Клиент: роутер', status: 'todo', add: own.map((event) => event.id) });
    s.set((input) => {
      assert.equal(input.messages.length, cap);
      assert.ok(input.messages.every((message) => message.in_record), 'its own first');
      assert.equal(input.messages.at(-1)!.id, own.at(-1)!.id, 'the newest of them');
      return [];
    });
    await s.run(record);
    assert.equal(s.calls.length, 1);
  } finally { s.cleanup(); }
});

test('recheck: over the bound, each conversation keeps the session before the record — a busy chat does not crowd out another', async () => {
  const s = setup();
  try {
    const cap = tasksConfig.max_batch * 3;
    const record = randomUUID();
    const a0 = s.add(chat('7401', 'вчера про роутер', '2026-11-19T10:00:00.000Z'));
    const a1 = s.add(chat('7401', 'роутер не включается', '2026-11-20T10:00:00.000Z'));
    const busy = Array.from({ length: cap + 10 }, (_, index) => s.add(chat('7401', `болтовня ${index}`, at('2026-11-20T10:00:00.000Z', index + 1))));
    const b0 = s.add(chat('7402', 'напарник: вчера смотрел роутер', '2026-11-19T12:00:00.000Z'));
    const b1 = s.add(chat('7402', 'напарник: роутер — блок питания', '2026-11-20T09:00:00.000Z'));
    s.own(record, { op: 'create', title: 'Клиент: роутер', status: 'todo', add: [a1.id, b1.id] });
    s.set((input) => {
      const ids = new Set(input.messages.map((message) => message.id));
      assert.equal(input.messages.length, cap);
      for (const kept of [a0, a1, b0, b1]) assert.ok(ids.has(kept.id), kept.payload.text);
      assert.ok(ids.has(busy.at(-1)!.id) && !ids.has(busy[0]!.id), 'then the newest of the rest');
      return [];
    });
    await s.run(record);
    assert.equal(s.calls.length, 1);
  } finally { s.cleanup(); }
});

test('recheck: a due must be a whole date or date-time; a removed message is not hinted back where I took it out', async () => {
  const s = setup();
  try {
    const { record, b } = routerCase(s);
    const cameras = randomUUID();
    s.own(cameras, { op: 'create', title: 'Клиент: камеры', status: 'todo', add: [b.id], roles: { author: 'tg:7101', responsible: 'me', executors: ['me'] } });
    s.own(cameras, { op: 'update', remove: [b.id] });
    s.set(() => [proposal({ kind: 'due', value: '2026-11-25 вечером' }), proposal({ kind: 'due', value: '2026-02-30' }), proposal({ kind: 'due', value: '2026-11-25T14:00:00Z' }),
      proposal({ kind: 'remove', message_ids: [b.id], target_task_id: cameras })]);
    assert.deepEqual(await s.run(record), { proposals: 2 });
    const [due, remove] = s.proposals();
    assert.deepEqual(due!.change, { op: 'update', due: '2026-11-25T14:00:00Z' });
    assert.deepEqual([remove!.change, remove!.also], [{ op: 'update', remove: [b.id] }, undefined], 'no move into the record I took it out of');
  } finally { s.cleanup(); }
});

// The API refuses a schema with more than 16 union-typed parameters (type arrays or anyOf), nested ones counted.
test('the recheck schema stays well within the API limit of 16 union-typed parameters', () => {
  const unions = (node: unknown): number => {
    if (!node || typeof node !== 'object') return 0;
    const own = Array.isArray((node as any).type) || 'anyOf' in (node as object) ? 1 : 0;
    return own + Object.values(node as object).reduce((sum: number, child) => sum + unions(child), 0);
  };
  assert.ok(unions(RECHECK_SCHEMA) <= 4, `${unions(RECHECK_SCHEMA)} union-typed parameters`);
});

test('restoreRecheck: "" comes back as null for value and target_task_id', () => {
  const [item] = restoreRecheck({ proposals: [{ kind: 'rename', message_ids: [], value: '', target_task_id: '', reason: 'x' }] }).proposals;
  assert.deepEqual([item!.value, item!.target_task_id], [null, null]);
});
