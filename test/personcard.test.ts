import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { personFromConversation, splitList, personTasks } from '../web/personcard.js';

// Person cards (contacts design §6). Names and numbers are made up.
test('a person from a conversation: a Telegram chat or a phone number', () => {
  assert.deepEqual(personFromConversation({ key: 'tg:501', title: 'Анна Тестова' }), { name: 'Анна Тестова', phones: [], telegram: ['501'] });
  assert.deepEqual(personFromConversation({ key: 'tel:+48600300400', title: '+48600300400' }), { name: '+48600300400', phones: ['+48600300400'], telegram: [] });
  assert.equal(personFromConversation({ key: 'me', title: 'Заметки' }), null, 'own notes are not a person');
  assert.equal(personFromConversation({ key: 'split:abc', title: 'Счёт' }), null);
});

test('a list typed in one field: commas, semicolons and new lines; no blanks or repeats', () => {
  assert.deepEqual(splitList('+48 600 300 400, 0048600300401;\n +48 600 300 400 ,'), ['+48 600 300 400', '0048600300401']);
  assert.deepEqual(splitList('   '), []);
});

test('a person\'s open tasks: by author or a role through their points', () => {
  const person = { points: ['tg:501', 'tel:+48600300400'] };
  const tasks = [
    { id: 't1', status: 'todo', roles: { author: 'tg:501', executors: [] } },
    { id: 't2', status: 'done', roles: { author: 'tg:501', executors: [] } },
    { id: 't3', status: 'todo', roles: { author: 'me', executors: ['tel:+48600300400'] } },
    { id: 't4', status: 'todo', roles: { author: 'me', executors: ['me'] } },
  ];
  assert.deepEqual(personTasks(person, tasks).map((task: any) => task.id), ['t1', 't3']);
});
