import assert from 'node:assert/strict';
import { test } from 'node:test';
import { temporaryStore } from './helpers.ts';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { recheckProposals, recheckLabel, rejectEvent, recheckToast } from '../web/recheck.js';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { proposalsByMessage, acceptEvents } from '../web/proposals.js';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { foldTasks } from '../web/taskfold.js';

// «✨ Сверить с перепиской» in the card (docs/plans/2026-11-23-conversation-records-design.md «✨ на записи»): the
// recheck's proposals listed with ✓ ✕; ✓ writes the change and every `also`, once. Data is made up.
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const REC = id(501); const DUP = id(502);
const M = [id(1), id(2), id(3)];
const change = (n: number, task: string, data: Record<string, unknown>, author = 'me', ts = '2026-11-24T09:00:00.000Z') => ({ id: id(n), schema_version: 1,
  source: author === 'me' ? 'app' : 'system', author, ts, kind: 'task_change', payload: { ref: { type: 'task', id: task }, data: { task: data } } });
const result = (n: number, triage: Record<string, unknown>, ts = '2026-11-24T10:00:00.000Z') => ({ id: id(n), schema_version: 1, source: 'system', author: 'system', ts,
  kind: 'triage_result', payload: { data: { triage: { processor: 'recheck-ai-v1', conversation_only: [], ...triage } } } });
const merge = { id: id(301), kind: 'merge', task_id: REC, message_ids: [M[2]], reason: 'то же дело', confidence: 1, alternatives: [],
  change: { op: 'update', add: [M[2]], items_add: [{ id: 'item-1', text: 'купить роутер' }] },
  also: [{ task_id: DUP, change: { op: 'update', status: 'cancelled', reason: 'Склеено с «Клиент: роутер»' } }] };
const rename = { id: id(302), kind: 'rename', task_id: REC, message_ids: [], reason: 'точнее', confidence: 1, alternatives: [], change: { op: 'update', title: 'Клиент: роутер TP-Link' } };
const base = [
  change(101, REC, { op: 'create', title: 'Клиент: роутер', status: 'todo', add: [M[0], M[1]] }),
  change(102, DUP, { op: 'create', title: 'Клиент: роутер снова', status: 'todo', add: [M[2]], unconfirmed: true }, 'system'),
  result(201, { recheck: REC, proposals: [merge, rename] }),
];

test('the recheck\'s waiting proposals by record; they are not shown under messages and do not hold the queue', () => {
  const waiting = recheckProposals(base);
  assert.deepEqual(waiting.get(REC).map((item: { id: string }) => item.id), [merge.id, rename.id]);
  assert.deepEqual([waiting.get(REC)[0].kind, waiting.get(REC)[0].also], ['merge', merge.also]);
  assert.equal(proposalsByMessage(base).size, 0, 'only in the card');
  const reject = { id: id(401), schema_version: 1, source: 'app', author: 'me', ts: '2026-11-24T11:00:00.000Z', kind: 'correction',
    payload: { ref: { type: 'event', id: M[0] }, data: { op: 'reject_proposal', proposal: rename.id } } };
  assert.deepEqual(recheckProposals([...base, reject]).get(REC).map((item: { id: string }) => item.id), [merge.id], '✕ settles it');
  const again = result(202, { recheck: REC, withdrawn: [merge.id, rename.id] }, '2026-11-24T12:00:00.000Z');
  assert.equal(recheckProposals([...base, again]).get(REC), undefined, 'a later recheck withdraws them');
});

test('✓ on a merge writes the change on the record and every `also`, each naming the proposal; a double tap is the same events', () => {
  const [item] = recheckProposals(base).get(REC);
  const entries = acceptEvents(item, { ts: '2026-11-24T11:00:00.000Z' });
  assert.deepEqual(entries.map((entry: any) => [entry.event.payload.ref.id, entry.event.payload.data.task.proposal]), [[REC, merge.id], [DUP, merge.id]]);
  assert.deepEqual(acceptEvents(item, { ts: '2026-11-24T11:05:00.000Z' }).map((entry: any) => entry.event.id), entries.map((entry: any) => entry.event.id), 'stable ids');
  const tasks = new Map<string, any>(foldTasks([...base, ...entries.map((entry: any) => entry.event)]).map((task: any) => [task.id, task]));
  assert.deepEqual(tasks.get(REC).messages, [M[0], M[1], M[2]]);
  assert.deepEqual(tasks.get(REC).items.map((entry: { text: string }) => entry.text), ['купить роутер']);
  assert.equal(tasks.get(DUP).status, 'cancelled');
  assert.equal(recheckProposals([...base, ...entries.map((entry: any) => entry.event)]).get(REC).length, 1, 'only the rename waits');
  // The journal takes them as they are (the contract), and the second time it drops them.
  const storage = temporaryStore();
  try {
    for (const event of [...base.slice(0, 2), ...entries.map((entry: any) => entry.event)]) assert.equal(storage.store.appendEvent(event as never).created, true);
    for (const entry of entries) assert.equal(storage.store.appendEvent(entry.event as never).created, false);
  } finally { storage.cleanup(); }
});

test('an accepted AI rename does not make the title the owner\'s; ✕ is a reject_proposal on a message of the record', () => {
  const [, item] = recheckProposals(base).get(REC);
  const [entry] = acceptEvents(item, { ts: '2026-11-24T11:00:00.000Z' });
  const task = foldTasks([...base, entry.event]).find((found: { id: string }) => found.id === REC);
  assert.deepEqual([task.title, task.ownerTitled], ['Клиент: роутер TP-Link', false]);
  const reject = rejectEvent(item, M[0]);
  assert.deepEqual([reject.event.kind, reject.event.payload.ref.id, reject.event.payload.data], ['correction', M[0], { op: 'reject_proposal', proposal: rename.id }]);
  assert.equal(rejectEvent(item, M[0]).event.id, reject.event.id, 'stable id');
  assert.equal(rejectEvent({ ...merge, messageIds: [M[2]] }, M[0]).event.payload.ref.id, M[2], 'its own message first');
});

test('labels say what each proposal does, in Russian', () => {
  const tasks = new Map([[DUP, { id: DUP, title: 'Клиент: роутер снова' }]]);
  const label = (item: Record<string, unknown>) => recheckLabel({ messageIds: [], also: [], ...item }, tasks);
  assert.equal(label({ kind: 'merge', also: merge.also, change: merge.change }), 'Склеить с «Клиент: роутер снова»');
  assert.equal(label({ kind: 'rename', change: rename.change }), 'Название: «Клиент: роутер TP-Link»');
  assert.equal(label({ kind: 'add', messageIds: [M[0], M[1]], change: { add: [M[0], M[1]] } }), 'Подтянуть сообщения: 2');
  assert.equal(label({ kind: 'remove', messageIds: [M[0]], change: { remove: [M[0]] }, also: [{ task_id: DUP, change: { add: [M[0]] } }] }), 'Убрать сообщения: 1 → «Клиент: роутер снова»');
  assert.equal(label({ kind: 'remove', messageIds: [M[0]], change: { remove: [M[0]] } }), 'Убрать сообщения: 1 (другое дело)');
  assert.equal(label({ kind: 'due', change: { due: '2026-11-25' } }), 'Срок: 25.11.2026');
  assert.equal(label({ kind: 'due', change: { due: null } }), 'Срок: убрать');
  assert.equal(label({ kind: 'items', change: { items_add: [{ id: 'x', text: 'проверить блок' }] } }), 'Пункт: проверить блок');
  assert.equal(label({ kind: 'status', change: { proposed: 'done', report: { note: 'заменил блок' } } }), 'Похоже, сделано: заменил блок');
});

test('the toast after «✨ Сверить с перепиской»', () => {
  assert.equal(recheckToast(200, { proposals: 3 }), 'Предложений: 3');
  assert.equal(recheckToast(200, { proposals: 0 }), 'Расхождений нет');
  assert.equal(recheckToast(409, { error: 'Нет ключа ИИ' }), 'Нет ключа ИИ');
  assert.equal(recheckToast(409, { error: '409 Исчерпан лимит трат на ИИ за месяц (10 $)' }), 'Исчерпан лимит трат на ИИ за месяц (10 $)');
  assert.equal(recheckToast(500, {}), 'Не удалось сверить (500)');
});
