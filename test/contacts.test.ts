import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as server from '../src/contacts/fold.ts';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import * as client from '../web/contacts.js';

// The directory as folds of the journal (contacts design §3), the same on the server and the device. Made-up data.
let n = 0;
const at = () => `2026-11-19T10:00:${String(++n).padStart(2, '0')}.000Z`;
const person = (id: string, contact: Record<string, unknown>) => ({ id: `e${n}`, schema_version: 1, source: 'app', author: 'me', ts: at(), kind: 'contact_change', payload: { ref: { type: 'person', id }, data: { contact } } });
const firm = (id: string, counterparty: Record<string, unknown>) => ({ id: `e${n}`, schema_version: 1, source: 'app', author: 'me', ts: at(), kind: 'counterparty_change', payload: { ref: { type: 'counterparty', id }, data: { counterparty } } });

const events: any[] = [
  firm('c1', { op: 'create', kind: 'org', title: 'ООО Пример', side: 'pl' }),
  firm('c2', { op: 'create', kind: 'address', title: 'ул. Пробная 1', address: 'ул. Пробная 1, Варшава' }),
  firm('c2', { op: 'update', status: 'archived' }),
  person('p1', { op: 'create', name: 'Анна Тестова', phones: ['+48 600 300 400', '0048600300400'], telegram: ['501', '@anna_test'], roles: [{ counterparty: 'c1', title: 'бухгалтер' }] }),
  person('p2', { op: 'create', name: 'Анна Вторая', phones: ['+48600300400'] }),
  person('p3', { op: 'create', name: 'Борис Удалённый', phones: ['+375 29 111 22 33'] }),
  person('p3', { op: 'update', status: 'deleted' }),
  person('p1', { op: 'update', note: 'звонить после 10' }),
];

for (const [side, fold] of [['server', server], ['client', client]] as const) {
  test(`${side}: people with points, counterparties with status, people of a counterparty`, () => {
    const people = fold.foldPeople(events);
    const counterparties = fold.foldCounterparties(events);
    const anna = people.find((item: any) => item.id === 'p1');
    assert.deepEqual(anna.points, ['tel:+48600300400', 'tg:501'], 'one number in two forms is one point; a @username is not a party');
    assert.equal(anna.note, 'звонить после 10');
    assert.equal(fold.personOf('tel:+48600300400', people).id, 'p1', 'two people with one number: the first one made');
    assert.equal(fold.personOf('tel:+375291112233', people), null, 'a deleted person is not found');
    assert.equal(counterparties.find((item: any) => item.id === 'c2').status, 'archived', 'an archived counterparty stays in the fold');
    assert.deepEqual(fold.peopleOf('c1', people).map((item: any) => [item.person.name, item.title]), [['Анна Тестова', 'бухгалтер']]);
  });
}

test('the server and the device fold the same way', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(server.foldPeople(events))), JSON.parse(JSON.stringify(client.foldPeople(events))));
  assert.deepEqual(JSON.parse(JSON.stringify(server.foldCounterparties(events))), JSON.parse(JSON.stringify(client.foldCounterparties(events))));
});
