import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { counterpartyChoices, newCounterparty } from '../web/counterpartyline.js';

// «Кто контрагент?» in task details (contacts design §6). Names are made up.
const counterparties = [
  { id: 'c1', kind: 'org', title: 'ООО Пример', status: 'active' },
  { id: 'c2', kind: 'address', title: 'ул. Пробная 1', status: 'archived' },
  { id: 'c3', kind: 'org', title: 'ООО Другое', status: 'active' },
];

test('the triage\'s options without archived ones, and its hint', () => {
  const choices = counterpartyChoices({ counterparty_options: ['c2', 'c1', 'xx'], counterparty_hint: 'ООО Новое' }, counterparties);
  assert.deepEqual(choices.options.map((item: any) => item.id), ['c1']);
  assert.equal(choices.hint, 'ООО Новое');
  assert.deepEqual(counterpartyChoices({}, counterparties), { options: [], hint: null });
  assert.equal(counterpartyChoices({ counterparty_hint: 'ООО Пример' }, counterparties).hint, null, 'a hint naming a known one is not «new»');
});

test('a new counterparty needs a name; an address is its own title', () => {
  assert.equal(newCounterparty({ kind: 'org', title: '   ', side: 'pl' }), null);
  assert.equal(newCounterparty({ kind: 'org', title: '', side: null }), null);
  assert.deepEqual(newCounterparty({ kind: 'org', title: ' ООО Новое ', side: 'pl' }), { op: 'create', kind: 'org', title: 'ООО Новое', side: 'pl' });
  assert.deepEqual(newCounterparty({ kind: 'address', title: 'ул. Пробная 2, Варшава', side: null }),
    { op: 'create', kind: 'address', title: 'ул. Пробная 2, Варшава', address: 'ул. Пробная 2, Варшава', side: null });
});

test('a task row names its counterparty instead of the project; «кто?» while the triage hesitates', async () => {
  // @ts-expect-error Browser modules are deliberately buildless JavaScript.
  const { rowParts } = await import('../web/tasklist.js');
  // @ts-expect-error Browser modules are deliberately buildless JavaScript.
  const { markCounterparties } = await import('../web/contacts.js');
  const tasks = [
    { id: 't1', status: 'todo', counterparty: 'c1', projectTitle: 'Удалёнка', roles: {} },
    { id: 't2', status: 'todo', counterparty_options: ['c1'], projectTitle: 'Удалёнка', roles: {} },
  ];
  markCounterparties(tasks, counterparties);
  assert.deepEqual(rowParts(tasks[0], []), ['◆ ООО Пример']);
  assert.deepEqual(rowParts(tasks[1], []), ['▸ Удалёнка', 'кто?']);
});
