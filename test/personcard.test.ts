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

test('review fixes: no person from a group chat or a short service number; names fit the contract', async () => {
  assert.equal(personFromConversation({ key: 'tg:-1001234', title: 'Напарники', group: true }), null);
  assert.equal(personFromConversation({ key: 'tel:900', title: '900' }), null, 'a number too short to be a point');
  assert.equal(personFromConversation({ key: 'tg:501', title: 'А'.repeat(130) })!.name.length, 120);
  // @ts-expect-error Browser modules are deliberately buildless JavaScript.
  const { newCounterparty } = await import('../web/counterpartyline.js');
  assert.equal(newCounterparty({ kind: 'address', title: 'у'.repeat(150), side: null }).title.length, 120);
});

test('review fixes: other people with the same number or Telegram', async () => {
  // @ts-expect-error Browser modules are deliberately buildless JavaScript.
  const { samePoints } = await import('../web/personcard.js');
  const anna = { id: 'p1', status: 'active', points: ['tel:+48600300400', 'tg:501'] };
  const people = [anna, { id: 'p2', status: 'active', points: ['tel:+48600300400'] }, { id: 'p3', status: 'deleted', points: ['tg:501'] }, { id: 'p4', status: 'active', points: ['tg:9'] }];
  assert.deepEqual(samePoints(anna, people).map((item: any) => item.id), ['p2']);
});
