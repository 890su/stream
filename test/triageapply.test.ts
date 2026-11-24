// How one planned outcome of the triage is applied (triage-ai-v21): links at once, content changes as proposals,
// new records, repeats and done work; questions with known options only. Pure, texts are made up.
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPlanned, questionsOf, type ApplyContext } from '../src/tasks/triageapply.ts';
import type { Task } from '../src/tasks/fold.ts';
import type { PlannedTask } from '../src/tasks/planner.ts';

const M1 = '00000000-0000-4000-8000-000000000001';
const M2 = '00000000-0000-4000-8000-000000000002';
const M3 = '00000000-0000-4000-8000-000000000003';
const roles = (): Task['roles'] => ({ author: null, responsible: 'me', executors: [], controller: null, watchers: [], counterparty: null, members: [] });
const task = (id: string, over: Partial<Task> = {}): Task => ({
  id, title: id, status: 'todo', assignee: 'me', roles: roles(), filed: false, messages: [], items: [], owner_titled: false,
  created_by: 'system', created_at: '2026-11-20T10:00:00.000Z', updated_at: '2026-11-20T10:00:00.000Z', ...over });
const planned = (over: Partial<PlannedTask>): PlannedTask => ({ task_id: null, title: 'Дело', responsible: 'me', executors: [], author: null, template: null,
  due: null, message_ids: [M1], confidence: 0.9, note: null, filed: false, done: false, ...over });
const context = (records: Task[], over: Partial<ApplyContext> = {}): ApplyContext => ({
  index: 0, batchKey: 'batch', batchIds: new Set([M1, M2]), conversationOnly: new Set(),
  open: new Map(records.filter((item) => item.status !== 'done').map((item) => [item.id, item])),
  closed: new Map(records.filter((item) => item.status === 'done').map((item) => [item.id, item])),
  removed: new Map(), projects: [], counterparties: [], filedTemplates: new Set(['note', 'diary']), newTasks: 'unconfirmed',
  roles: () => ({ responsible: 'me', executors: [] }), ...over });

test('an owner-titled task gets no title change even if the AI renames', () => {
  const job = task('job', { owner_titled: true, title: 'Мой заголовок' });
  const applied = applyPlanned(planned({ task_id: 'job', rename: 'Клиент: всё сразу', items: ['настроить почту'] }), context([job]));
  assert.deepEqual(applied.map((item) => item.kind), ['link', 'proposal']);
  const proposal = applied[1] as Extract<typeof applied[number], { kind: 'proposal' }>;
  assert.equal('title' in proposal.change, false);
  assert.deepEqual((proposal.change.items_add as { text: string }[]).map((item) => item.text), ['настроить почту']);
  const named = applyPlanned(planned({ task_id: 'job', rename: 'Клиент: всё сразу' }), context([task('job')]));
  assert.equal((named[1] as { change: Record<string, unknown> }).change.title, 'Клиент: всё сразу', 'a task the owner did not name may be renamed');
});

test('a continuation without new content is only a link; messages already in the task are not linked again', () => {
  const job = task('job', { messages: [M1] });
  assert.deepEqual(applyPlanned(planned({ task_id: 'job', message_ids: [M1, M2] }), context([job])), [{ kind: 'link', task_id: 'job', add: [M2] }]);
  assert.deepEqual(applyPlanned(planned({ task_id: 'job', message_ids: [M1] }), context([job])), [], 'nothing new');
  // A link «Разобрать заново» withdraws counts as not in the task: it is linked again.
  assert.deepEqual(applyPlanned(planned({ task_id: 'job', message_ids: [M1] }), context([job], { unlinked: new Map([['job', new Set([M1])]]) })),
    [{ kind: 'link', task_id: 'job', add: [M1] }]);
});

test('a message the owner took out of a task is neither linked nor proposed into it', () => {
  const job = task('job');
  const ctx = context([job], { removed: new Map([['job', new Set([M1])]]) });
  assert.deepEqual(applyPlanned(planned({ task_id: 'job', message_ids: [M1], due: '2026-11-30' }), ctx), []);
  assert.deepEqual(applyPlanned(planned({ task_id: 'job', message_ids: [M1, M2] }), ctx), [{ kind: 'link', task_id: 'job', add: [M2] }]);
});

test('a proposal carries only content: items, due, «done» with a report draft', () => {
  const job = task('job', { due: '2026-11-25' });
  const applied = applyPlanned(planned({ task_id: 'job', due: '2026-11-28', done: true, report: { note: 'Сделал', duration_min: 30, cost: null, expenses: null, currency: null } }), context([job]));
  const proposal = applied.find((item) => item.kind === 'proposal') as Extract<typeof applied[number], { kind: 'proposal' }>;
  assert.deepEqual(proposal, { kind: 'proposal', task_id: 'job', message_ids: [M1], change: { due: '2026-11-28', proposed: 'done', report: { note: 'Сделал', duration_min: 30 } } });
  const same = applyPlanned(planned({ task_id: 'job', due: '2026-11-25' }), context([job]));
  assert.deepEqual(same.map((item) => item.kind), ['link'], 'the same due is no change');
});

test('a closed record: a thank-you only links, a new request is a new record with repeat_of', () => {
  const closed = task('old', { status: 'done', title: 'Клиент: Wi-Fi' });
  assert.deepEqual(applyPlanned(planned({ task_id: 'old' }), context([closed])), [{ kind: 'link', task_id: 'old', add: [M1] }], 'not reopened');
  for (const again of [planned({ task_id: 'old', repeat_of: 'old', title: 'Клиент: Wi-Fi снова' }), planned({ task_id: null, repeat_of: 'old', title: 'Клиент: Wi-Fi снова' }), planned({ task_id: 'old', items: ['проверить роутер'] })]) {
    const [created] = applyPlanned(again, context([closed]));
    assert.equal(created!.kind, 'create');
    const change = (created as { change: Record<string, unknown> }).change;
    assert.deepEqual([change.op, change.repeat_of, change.status, change.unconfirmed], ['create', 'old', 'todo', true]);
    assert.notEqual(created!.task_id, 'old');
  }
  assert.equal('repeat_of' in (applyPlanned(planned({ repeat_of: 'unknown' }), context([closed]))[0] as { change: Record<string, unknown> }).change, false, 'an unknown repeat_of is dropped');
});

test('a closed filed note: a filed message is linked, a request about it is a record of its own', () => {
  const note = task('note', { status: 'done', template: 'note', filed: true });
  assert.deepEqual(applyPlanned(planned({ task_id: 'note', filed: true, template: 'note' }), context([note])), [{ kind: 'link', task_id: 'note', add: [M1] }]);
  const [created] = applyPlanned(planned({ task_id: 'note', title: 'Клиент: принтер' }), context([note]));
  assert.equal(created!.kind, 'create');
  assert.equal('repeat_of' in (created as { change: Record<string, unknown> }).change, false);
});

test('work done in the conversation is a done record with its report draft', () => {
  const [created] = applyPlanned(planned({ title: 'Клиент: удалёнка', template: 'lead', done: true, report: { note: 'Настроил почту', duration_min: 40, cost: 100, expenses: null, currency: 'PLN' } }), context([]));
  const change = (created as { change: Record<string, unknown> }).change;
  assert.deepEqual([change.status, change.template, change.report, change.proposed], ['done', 'lead', { note: 'Настроил почту', duration_min: 40, cost: 100, currency: 'PLN' }, undefined]);
});

test('an unknown task_id becomes a new task; unknown options are dropped', () => {
  const [created] = applyPlanned(planned({ task_id: 'made-up', title: 'Новое дело' }), context([]));
  assert.equal(created!.kind, 'create');
  assert.equal((created as { change: Record<string, unknown> }).change.title, 'Новое дело');
  const job = task('job');
  const option = (over: Partial<{ label: string; task_id: string | null; title: string | null; template: string | null; nothing: boolean }>) =>
    ({ label: 'Вариант', task_id: null, title: null, template: null, nothing: false, ...over });
  const questions = questionsOf([
    { message_ids: [M1, M3], text: 'О каком деле речь?', options: [option({ task_id: 'job', label: 'job' }), option({ task_id: 'made-up' }), option({ title: 'Новое: роутер', template: 'todo' }), option({ nothing: true, label: 'Ничего' })] },
    { message_ids: [M2], text: 'Куда?', options: [option({ task_id: 'made-up' }), option({ nothing: true })] },
    { message_ids: [M3], text: 'Чужое', options: [option({ task_id: 'job' }), option({ nothing: true })] },
  ], { batchKey: 'batch', batchIds: new Set([M1, M2]), known: new Set([job.id]) });
  assert.equal(questions.length, 1, 'a question left with one option, or about no message of the batch, is dropped');
  assert.deepEqual(questions[0]!.message_ids, [M1]);
  assert.deepEqual(questions[0]!.options.map((item) => item.label), ['job', 'Вариант', 'Ничего']);
  assert.match(questions[0]!.id, /^[0-9a-f-]{36}$/);
});
