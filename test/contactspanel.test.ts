import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { contactList } from '../web/contactspanel.js';

// The address book of the left panel (design 2026-11-21). People, numbers and chats are made up.
const person = (id: string, name: string, points: string[], status = 'active') => ({ id, name, points, status });
const people = [
  person('p1', 'Яна', ['tel:+48500000001']),
  person('p2', 'Анна', ['tg:501', 'tel:+48500000002']),
  person('p3', 'Борис', ['tg:502'], 'deleted'),
];
const conversations = [
  { key: 'tg:501', title: 'Анна', last: '2026-11-20T10:00:00Z' },
  { key: 'tel:+48500000002', title: '+48500000002', last: '2026-11-21T09:00:00Z' },
  { key: 'tg:777', title: 'Кто-то', last: '2026-11-21T11:00:00Z' },
];

test('alphabetical, deleted left out, the latest conversation of any point', () => {
  const list = contactList(people, conversations);
  assert.deepEqual(list.map((item: any) => item.name), ['Анна', 'Яна']);
  assert.equal(list[0].key, 'tel:+48500000002');
  assert.equal(list[0].last, '2026-11-21T09:00:00Z');
  assert.equal(list[0].phone, '+48500000002');
  assert.equal(list[1].key, null, 'no conversation yet');
});

test('search by a part of the name or by digits', () => {
  const names = (query: string) => contactList(people, conversations, query).map((item: any) => item.name);
  assert.deepEqual(names('ан'), ['Анна']);
  assert.deepEqual(names('0001'), ['Яна']);
  assert.deepEqual(names('+48 500'), ['Анна', 'Яна']);
  assert.deepEqual(names('зzz'), []);
});
