// Scores a triage output against a golden case's expectation, and checks the synthetic case file is well-formed.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseCases, scoreCase } from '../src/tasks/goldenscore.ts';
import type { PlanOutput, PlannedTask } from '../src/tasks/planner.ts';

function planned(task_id: string | null, message_ids: string[]): PlannedTask {
  return { task_id, title: 't', responsible: 'me', executors: [], author: null, template: null, due: null, message_ids, confidence: 0.9, note: null, filed: false, done: false, alternatives: [] };
}
const output = (tasks: PlannedTask[], extra: Partial<PlanOutput> = {}): PlanOutput => ({ tasks, conversation_only: [], ...extra });

test('a perfect output scores zero everywhere', () => {
  const score = scoreCase({ create: [{ message_ids: ['a'] }], link: [{ task_id: 'T1', message_ids: ['b'] }], nothing: ['c'] },
    { ...output([planned(null, ['a']), planned('T1', ['b'])]), conversation_only: ['c'] });
  assert.deepEqual(score, { missed: 0, extra: 0, duplicates: 0, wrong_link: 0, asked: 0 });
});
test('missed: an expected create or link in no output task', () => {
  const score = scoreCase({ create: [{ message_ids: ['a'] }], link: [{ task_id: 'T1', message_ids: ['b'] }] }, output([]));
  assert.equal(score.missed, 2);
});
test('extra: a new task holding only messages expected as nothing', () => {
  const score = scoreCase({ nothing: ['c'] }, output([planned(null, ['c'])]));
  assert.equal(score.extra, 1);
  assert.equal(scoreCase({ nothing: ['c'], create: [{ message_ids: ['a'] }] }, output([planned(null, ['a', 'c'])])).extra, 0);
});
test('duplicates: a new task over messages expected as link', () => {
  const score = scoreCase({ link: [{ task_id: 'T1', message_ids: ['b'] }] }, output([planned(null, ['b'])]));
  assert.equal(score.duplicates, 1);
  assert.equal(score.missed, 0);
});
test('wrong_link: linked to another task than expected', () => {
  const score = scoreCase({ link: [{ task_id: 'T1', message_ids: ['b'] }] }, output([planned('T2', ['b'])]));
  assert.equal(score.wrong_link, 1);
  assert.equal(score.duplicates, 0);
});
test('asked: questions present, absent means zero', () => {
  assert.equal(scoreCase({ ask: true }, output([])).asked, 0);
  assert.equal(scoreCase({ ask: true }, output([], { questions: [{ text: '?' }] } as Partial<PlanOutput>)).asked, 1);
});
test('golden/conversations.jsonl parses into consistent cases', () => {
  const cases = parseCases(readFileSync(new URL('../golden/conversations.jsonl', import.meta.url), 'utf8'), 'conversations.jsonl');
  assert.ok(cases.length >= 8);
  assert.equal(new Set(cases.map((item) => item.id)).size, cases.length);
});
test('parseCases rejects an expectation naming an unknown message', () => {
  const bad = JSON.stringify({ id: 'x', records: [], context: [], messages: [], expect: { nothing: ['zz'] } });
  assert.throws(() => parseCases(bad, 'bad'), /zz/);
});
