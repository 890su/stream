import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { askChoices, answerEvents, conversationQuestions, shortAsk } from '../web/askline.js';

// The AI's question in the head of a conversation (triage-ai-v21 `ask`, design 2026-11-23 «Очередь — всё
// распределено»): options as buttons, «Своими словами…», an answer writes `answer_question` and the chosen change.
// Names and texts are made up.
const question = {
  id: '00000000-0000-4000-8000-000000000001', text: 'Новое дело или продолжение «Принтер Neo Form»?', messageIds: ['m1', 'm2'], ts: '2026-11-24T10:00:00Z',
  processor: 'triage-ai-v21',
  options: [
    { label: 'Продолжение «Принтер Neo Form»', task_id: 't1', title: null, template: null, nothing: false },
    { label: 'Задача: отправить посылку', task_id: null, title: 'Анна: отправить посылку', template: 'callback', nothing: false },
    { label: 'Ничего', task_id: null, title: null, template: null, nothing: true },
  ],
};
const tasksById = new Map([['t1', { id: 't1', title: 'Принтер Neo Form', status: 'todo' }]]);

test('choices: labels with their option index and kind; an option naming an unknown record is dropped', () => {
  assert.deepEqual(askChoices(question, tasksById), [
    { index: 0, label: 'Продолжение «Принтер Neo Form»', kind: 'link', taskId: 't1' },
    { index: 1, label: 'Задача: отправить посылку', kind: 'create', title: 'Анна: отправить посылку', template: 'callback' },
    { index: 2, label: 'Ничего', kind: 'nothing' },
  ]);
  const choices = askChoices(question, new Map());
  assert.deepEqual(choices.map((choice: any) => choice.index), [1, 2], 'the record is gone: its option is not offered, the others keep their index');
});

test('an answer by a link: my task change adding the messages, then the answer', () => {
  const [link, answer] = answerEvents(question, askChoices(question, tasksById)[0]).map((entry: any) => entry.event);
  assert.equal(link.kind, 'task_change');
  assert.equal(link.author, 'me', 'my link — it counts as my action in the queue');
  assert.deepEqual([link.payload.ref.id, link.payload.data.task], ['t1', { op: 'update', add: ['m1', 'm2'] }]);
  assert.equal(answer.kind, 'correction');
  assert.deepEqual(answer.payload.ref, { type: 'event', id: 'm2' }, 'on the latest message of the question');
  assert.deepEqual(answer.payload.data, { op: 'answer_question', question: question.id, option: 0 });
});

test('an answer by a new record: my task of its template with the messages; nothing — only the answer', () => {
  const [made, answer] = answerEvents(question, askChoices(question, tasksById)[1], { taskId: 'new-1' }).map((entry: any) => entry.event);
  assert.equal(made.payload.ref.id, 'new-1');
  const task = made.payload.data.task;
  assert.deepEqual([task.op, task.title, task.template, task.add, task.roles.responsible, task.unconfirmed], ['create', 'Анна: отправить посылку', 'callback', ['m1', 'm2'], 'me', undefined]);
  assert.equal(answer.payload.data.option, 1);
  const only = answerEvents(question, askChoices(question, tasksById)[2]).map((entry: any) => entry.event);
  assert.equal(only.length, 1);
  assert.deepEqual(only[0].payload.data, { op: 'answer_question', question: question.id, option: 2 });
});

test('an answer in words: only the answer with the text', () => {
  const only = answerEvents(question, { text: '  это подарок, ничего не нужно ' }).map((entry: any) => entry.event);
  assert.equal(only.length, 1);
  assert.deepEqual(only[0].payload.data, { op: 'answer_question', question: question.id, text: 'это подарок, ничего не нужно' });
  assert.equal(only[0].payload.text, undefined, 'the words are the answer, not an edit of the message');
});

test('the questions of a conversation: each once, the newest first; deleted messages ask nothing', () => {
  const older = { ...question, id: 'q-old', ts: '2026-11-24T09:00:00Z', messageIds: ['m0'] };
  const waiting = new Map([['m0', older], ['m1', question], ['m2', question], ['m9', { ...question, id: 'q-elsewhere' }]]);
  const conversation = { views: [{ id: 'm0' }, { id: 'm1' }, { id: 'm2' }, { id: 'm3', deleted: true }] };
  assert.deepEqual(conversationQuestions(conversation, waiting).map((item: any) => item.id), [question.id, 'q-old']);
  assert.deepEqual(conversationQuestions({ views: [{ id: 'm0', deleted: true }] }, waiting), []);
});

test('a short question for the tile', () => {
  assert.equal(shortAsk('Задача или ничего?'), '❓ Задача или ничего?');
  const long = shortAsk('Новое дело или продолжение «Принтер Neo Form», который чинили на прошлой неделе у клиента?');
  assert.ok(long.length <= 62 && long.endsWith('…'), long);
});

test('the server accepts what an answer and «↩» write', async () => {
  const { fixture, event } = await import('./helpers.ts');
  // @ts-expect-error Browser modules are deliberately buildless JavaScript.
  const { unlinkEvent } = await import('../web/linkmark.js');
  const f = await fixture();
  const post = (body: unknown) => f.request('/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const first = event({ payload: { text: 'посылку маме отправишь?' } });
    const second = event({ payload: { text: 'до пятницы' } });
    for (const message of [first, second]) assert.equal((await post(message)).status, 201);
    const asked = { ...question, id: crypto.randomUUID(), messageIds: [first.id, second.id] };
    const record = crypto.randomUUID();
    for (const { event: written } of answerEvents(asked, askChoices(asked, tasksById)[1], { taskId: record })) assert.equal((await post(written)).status, 201, written.kind);
    for (const { event: written } of answerEvents(asked, { text: 'это подарок' })) assert.equal((await post(written)).status, 201, 'words');
    for (const { event: written } of answerEvents({ ...asked, options: [{ label: 'Продолжение', task_id: record }] }, { kind: 'link', taskId: record, index: 0 })) assert.equal((await post(written)).status, 201, 'link');
    assert.equal((await post(unlinkEvent(second.id, record).event)).status, 201, '↩');
  } finally { await f.stop(); }
});
