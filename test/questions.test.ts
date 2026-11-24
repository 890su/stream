import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { aiQuestionsByMessage } from '../web/questions.js';

// The AI's questions (triage-ai-v21 `ask`, design 2026-11-23 «Очередь — всё распределено»). Texts are made up.
const result = (ts: string, triage: Record<string, unknown>) => ({
  id: `r-${ts}`, schema_version: 1, source: 'system', author: 'system', ts, kind: 'triage_result',
  payload: { data: { triage: { processor: 'triage-ai-v21', conversation_only: [], ...triage } } },
});
const options = [
  { label: 'Задача: отправить посылку', task_id: null, title: 'Отправить посылку', template: null, nothing: false },
  { label: 'Ничего', task_id: null, title: null, template: null, nothing: true },
];
const answer = (question: string, ts: string, extra: Record<string, unknown>, author = 'me') => ({
  id: `a-${ts}`, schema_version: 1, source: 'app', author, ts, kind: 'correction',
  payload: { ref: { type: 'event', id: 'm1' }, data: { op: 'answer_question', question, ...extra } },
});

test('a question waits under each of its messages until the owner answers it', () => {
  const asked = result('2026-11-24T10:00:00Z', { questions: [{ id: 'q1', message_ids: ['m1', 'm2'], text: 'Задача или ничего?', options }] });
  const waiting = aiQuestionsByMessage([asked]);
  assert.deepEqual([...waiting.keys()], ['m1', 'm2']);
  assert.deepEqual(waiting.get('m1'), { id: 'q1', text: 'Задача или ничего?', options, messageIds: ['m1', 'm2'], ts: '2026-11-24T10:00:00Z', processor: 'triage-ai-v21' });
  assert.equal(aiQuestionsByMessage([asked, answer('q1', '2026-11-24T10:05:00Z', { option: 1 })]).size, 0, 'answered by an option');
  assert.equal(aiQuestionsByMessage([asked, answer('q1', '2026-11-24T10:05:00Z', { text: 'это подарок' })]).size, 0, 'answered in words');
  assert.equal(aiQuestionsByMessage([asked, answer('q1', '2026-11-24T10:05:00Z', { option: 0 }, 'system')]).size, 2, 'only the owner answers');
  assert.equal(aiQuestionsByMessage([asked, answer('q9', '2026-11-24T10:05:00Z', { option: 0 })]).size, 2, 'another question changes nothing');
});

test('a later result withdraws a question; the latest question about a message is the one shown', () => {
  const first = result('2026-11-24T10:00:00Z', { questions: [{ id: 'q1', message_ids: ['m1'], text: 'Первый?', options }] });
  const again = result('2026-11-24T11:00:00Z', { again: true, withdrawn: ['q1'] });
  assert.equal(aiQuestionsByMessage([first, again]).size, 0);
  const second = result('2026-11-24T12:00:00Z', { questions: [{ id: 'q2', message_ids: ['m1'], text: 'Второй?', options }] });
  assert.equal(aiQuestionsByMessage([second, first]).get('m1').id, 'q2', 'the newest result wins whatever the order of events');
});
