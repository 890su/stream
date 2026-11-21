import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { proposalsByMessage, proposalOptions } from '../web/proposals.js';

// The AI's proposals under the messages (docs/plans/2026-11-21-ai-proposals-design.md). Data is made up.
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T1 = id(501); const T2 = id(502); const T3 = id(503);
const result = (n: number, proposals: unknown[], ts = '2026-11-21T10:00:00.000Z') => ({ id: id(n), kind: 'triage_result', author: 'system', ts,
  payload: { data: { triage: { processor: 'triage-ai-v15', conversation_only: [], proposals } } } });
const proposal = (n: number, task: string, messages: string[], extra: Record<string, unknown> = {}) => ({ id: id(n), task_id: task, message_ids: messages, reason: 'тот же сайт',
  confidence: 0.6, alternatives: [], change: { op: 'update', add: messages }, ...extra });
const owner = (n: number, task: string, data: Record<string, unknown>) => ({ id: id(n), kind: 'task_change', author: 'me', ts: '2026-11-21T11:00:00.000Z',
  payload: { ref: { type: 'task', id: task }, data: { task: { op: 'update', ...data } } } });

test('a waiting proposal shows on each of its messages; the owner\'s answer, a refusal or a hand link takes it away', () => {
  const m = [id(1), id(2), id(3), id(4)];
  const events = [result(90, [proposal(201, T1, [m[0]!, m[1]!]), proposal(202, T1, [m[2]!]), proposal(203, T1, [m[3]!])])];
  const waiting = proposalsByMessage(events);
  assert.deepEqual([...waiting.keys()], m);
  assert.deepEqual([waiting.get(m[1])!.id, waiting.get(m[1])!.task, waiting.get(m[1])!.reason, waiting.get(m[1])!.messageIds], [id(201), T1, 'тот же сайт', [m[0], m[1]]]);
  const answered = proposalsByMessage([...events,
    owner(91, T2, { add: [m[0]!, m[1]!], proposal: id(201) }),
    { id: id(92), kind: 'correction', author: 'me', ts: '2026-11-21T11:01:00.000Z', payload: { ref: { type: 'event', id: m[2] }, data: { op: 'reject_proposal', proposal: id(202) } } },
    owner(93, T3, { add: [m[3]!] }),
  ]);
  assert.equal(answered.size, 0);
});

test('the options: the proposed task first, then known alternatives; the reason comes along', () => {
  const tasks = new Map([[T1, { id: T1, title: 'Экология финансов', status: 'todo' }], [T2, { id: T2, title: 'Юрий: сайт', status: 'done' }]]);
  const p = { id: id(201), task: T1, alternatives: [T2, id(999)], reason: 'тот же сайт', messageIds: [id(1)], change: { op: 'update', add: [id(1)] } };
  const options = proposalOptions({ id: id(1), taskIds: [] }, p, tasks);
  assert.equal(options.proposal, id(201));
  assert.equal(options.chosen, T1);
  assert.equal(options.reason, 'тот же сайт');
  assert.deepEqual(options.options.map((item: any) => [item.title, item.open]), [['Экология финансов', true], ['Юрий: сайт', false]]);
  assert.deepEqual(proposalOptions({ id: id(1), taskIds: [] }, { ...p, task: id(998), alternatives: [] }, tasks).options, [], 'a task that is gone: only «new» and «✕» remain');
  assert.equal(proposalOptions({ id: id(1), taskIds: [] }, undefined, tasks), null);
});
