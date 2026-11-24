import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JournalStore } from '../src/store/store.ts';
import type { AiDecision } from '../src/store/ailog.ts';

// The AI log (docs/plans/2026-11-21-ai-proposals-design.md): every triage run and decision, with its reason and what
// the owner made of it. Data is made up.
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const fresh = () => { const dir = mkdtempSync(join(tmpdir(), 'ailog-')); return { store: new JournalStore(dir), done: () => rmSync(dir, { recursive: true, force: true }) }; };
const run = (id: string, at = '2026-11-21T10:00:00.000Z') => ({ id, at, processor: 'triage-ai-v15', model: 'm', stream: 'tg:by:501', messages: 2,
  input_tokens: 100, output_tokens: 20, cost_usd: 0.001, input: { messages: ['привет'] }, output: { tasks: [] } });
const decision = (id: string, kind: AiDecision['kind'], task: string | null, messages: string[], status: AiDecision['status'] = kind === 'link' ? 'pending' : 'auto'): AiDecision =>
  ({ id, run_id: 'r1', at: '2026-11-21T10:00:00.000Z', kind, task_id: task, message_ids: messages, confidence: 0.6, reason: 'тот же сайт', status });
const change = (task: string, data: Record<string, unknown>, n: number) => ({ id: uuid(900 + n), schema_version: 1 as const, source: 'app', author: 'me',
  ts: `2026-11-21T11:0${n}:00.000Z`, kind: 'task_change', payload: { ref: { type: 'task', id: task }, data: { task: data } } });
const message = (n: number) => ({ id: uuid(n), schema_version: 1 as const, source: 'app', author: 'me', ts: '2026-11-21T09:00:00.000Z', kind: 'text', payload: { text: `сообщение ${n}` } });

test('a run and its decisions are kept; the run\'s input and output come back as they were', () => {
  const { store, done } = fresh();
  try {
    store.ailog.run(run('r1'));
    store.ailog.run(run('r1')); // a repeated run writes nothing twice
    store.ailog.decide([decision('d1', 'link', uuid(50), [uuid(1)]), decision('d2', 'create', uuid(51), [uuid(2)])]);
    store.ailog.decide([decision('d1', 'link', uuid(50), [uuid(1)])]);
    assert.deepEqual(store.ailog.runInput('r1'), { input: { messages: ['привет'] }, output: { tasks: [] } });
    assert.deepEqual([store.ailog.decision('d1')?.status, store.ailog.decision('d1')?.reason, store.ailog.decision('d2')?.status], ['pending', 'тот же сайт', 'auto']);
  } finally { store.close(); done(); }
});

test('the owner\'s answers settle proposals: accepted, moved elsewhere, rejected; a hand link counts too', () => {
  const { store, done } = fresh();
  try {
    for (const n of [1, 2, 3, 4]) store.appendEvent(message(n));
    store.ailog.decide([decision('a1', 'link', uuid(50), [uuid(1)]), decision('a2', 'link', uuid(50), [uuid(2)]),
      decision('a3', 'link', uuid(50), [uuid(3)]), decision('a4', 'link', uuid(50), [uuid(4)])]);
    store.appendEvent(change(uuid(50), { op: 'update', add: [uuid(1)], proposal: uuid(701) }, 1));
    assert.equal(store.ailog.decision('a1')?.status, 'pending', 'an answer to another proposal changes nothing');
    store.ailog.decide([decision(uuid(702), 'link', uuid(50), [uuid(5)]), decision(uuid(703), 'link', uuid(50), [uuid(6)]), decision(uuid(704), 'link', uuid(50), [uuid(7)])]);
    store.appendEvent(change(uuid(50), { op: 'update', add: [uuid(1)], proposal: uuid(702) }, 2));
    store.appendEvent(change(uuid(60), { op: 'update', add: [uuid(1)], proposal: uuid(703) }, 3));
    store.appendEvent({ id: uuid(910), schema_version: 1, source: 'app', author: 'me', ts: '2026-11-21T11:05:00.000Z', kind: 'correction',
      payload: { ref: { type: 'event', id: uuid(1) }, data: { op: 'reject_proposal', proposal: uuid(704) } } });
    assert.deepEqual([uuid(702), uuid(703), uuid(704)].map((id) => store.ailog.decision(id)?.status), ['accepted', 'redirected', 'rejected']);
    assert.equal(store.ailog.decision(uuid(703))?.resolved_task_id, uuid(60));
    // Without the buttons: the owner puts a waiting message into a task by hand.
    store.appendEvent(change(uuid(61), { op: 'update', add: [uuid(2)] }, 6));
    store.appendEvent(change(uuid(50), { op: 'update', add: [uuid(3)] }, 7));
    assert.deepEqual(['a2', 'a3', 'a4'].map((id) => store.ailog.decision(id)?.status), ['redirected', 'accepted', 'pending']);
  } finally { store.close(); done(); }
});

test('what the AI made by itself is undone when the owner cancels the task or takes its messages out', () => {
  const { store, done } = fresh();
  try {
    store.appendEvent(message(1));
    store.ailog.decide([decision('c1', 'create', uuid(50), [uuid(1)]), decision('c2', 'create', uuid(51), [uuid(2)]), decision('c3', 'create', uuid(52), [uuid(3)])]);
    store.appendEvent(change(uuid(50), { op: 'update', status: 'cancelled' }, 1));
    store.appendEvent(change(uuid(51), { op: 'update', remove: [uuid(2)] }, 2));
    store.appendEvent(change(uuid(52), { op: 'update', status: 'done' }, 3));
    assert.deepEqual(['c1', 'c2', 'c3'].map((id) => store.ailog.decision(id)?.status), ['undone', 'undone', 'auto']);
  } finally { store.close(); done(); }
});

test('numbers for the System screen; old inputs are wiped, the decisions stay', () => {
  const { store, done } = fresh();
  try {
    store.ailog.run(run('old', '2026-01-01T00:00:00.000Z'));
    store.ailog.run(run('new'));
    store.ailog.decide([decision('l1', 'link', uuid(50), [uuid(1)]), decision('l2', 'link', uuid(50), [uuid(2)], 'rejected'), decision('k1', 'create', uuid(51), [uuid(3)])]);
    assert.deepEqual(store.ailog.stats('2026-11-20T00:00:00.000Z'), { link: { pending: 1, rejected: 1 }, create: { auto: 1 } });
    assert.equal(store.ailog.prune('2026-06-01T00:00:00.000Z'), 1);
    assert.equal(store.ailog.runInput('old'), null);
    assert.ok(store.ailog.runInput('new'));
  } finally { store.close(); done(); }
});

test('the owner confirming an AI task settles its create as accepted', () => {
  const { store, done } = fresh();
  try {
    store.appendEvent(message(1));
    store.ailog.decide([decision('c1', 'create', uuid(50), [uuid(1)]), decision('c2', 'create', uuid(51), [uuid(2)])]);
    store.appendEvent(change(uuid(50), { op: 'update', unconfirmed: false }, 1));
    store.appendEvent(change(uuid(51), { op: 'update', unconfirmed: true }, 2));
    assert.deepEqual(['c1', 'c2'].map((id) => store.ailog.decision(id)?.status), ['accepted', 'auto']);
  } finally { store.close(); done(); }
});

test('the owner\'s answer to an AI question settles it: an option — accepted, words — redirected', () => {
  const { store, done } = fresh();
  try {
    store.appendEvent(message(1));
    store.ailog.decide([decision(uuid(801), 'question', null, [uuid(1)], 'pending'), decision(uuid(802), 'question', null, [uuid(1)], 'pending')]);
    const answer = (n: number, data: Record<string, unknown>) => store.appendEvent({ id: uuid(920 + n), schema_version: 1, source: 'app', author: 'me',
      ts: `2026-11-21T11:1${n}:00.000Z`, kind: 'correction', payload: { ref: { type: 'event', id: uuid(1) }, data: { op: 'answer_question', ...data } } });
    answer(1, { question: uuid(801), option: 1 });
    answer(2, { question: uuid(802), text: 'это подарок' });
    assert.deepEqual([uuid(801), uuid(802)].map((id) => store.ailog.decision(id)?.status), ['accepted', 'redirected']);
  } finally { store.close(); done(); }
});
