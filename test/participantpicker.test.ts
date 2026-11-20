// Checks participant suggestion ranking, search and task-change validity.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateEvent } from '../src/contracts/validate.ts';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { participantOptions, filterParticipants } from '../web/participantpicker.js';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { makeTaskChange } from '../web/shared.js';

const records = {
  recipients: [
    { title: 'Пробный чат', chat_id: '501', account: 'by', pinned: true, count: 1 },
    { title: 'Команда стенда', chat_id: '-77', account: 'pl', group: true, count: 5 },
  ],
  conversations: [
    { key: 'tg:501', title: 'Имя в мессенджере', views: [{}, {}], channels: ['by'] },
    { key: 'tel:+48500000002', title: 'Пример телефона', views: Array(4).fill({}), channels: ['phone'] },
    { key: 'wa:42@lid', title: 'Пример WhatsApp', views: [{}], channels: ['whatsapp'] },
    { key: 'me', title: 'Свои заметки', views: [{}] },
  ],
  people: [
    { name: 'Анна Пример', points: ['tg:501'] },
    { name: 'Борис Пример', points: ['tel:+48500000003'] },
    { name: 'Удалённый контакт', points: ['tg:99'], status: 'deleted' },
  ],
};
const parties = (options: { party: string }[]) => options.map((item) => item.party);

test('the empty search shows pins first and respects the suggestion limit', () => {
  const options = participantOptions({ ...records, exclude: ['tg:999'] });
  assert.deepEqual(parties(filterParticipants(options, '', 3)), ['tg:501', 'group:tg:-77', 'tel:+48500000002']);
  assert.equal(options[0].title, 'Анна Пример');
  assert.equal(options[0].count, 2, 'the chat and recipient counts are not added together');
});

test('a query replaces suggestions with all eligible matching contacts and chats', () => {
  const options = participantOptions({ ...records, exclude: ['group:tg:-77'] });
  assert.deepEqual(parties(filterParticipants(options, 'Команда', 1)), []);
  assert.deepEqual(parties(filterParticipants(options, 'БОРИС', 1)), ['tel:+48500000003']);
  assert.deepEqual(parties(filterParticipants(options, 'имя в мессенджере', 1)), ['tg:501']);
  assert.deepEqual(parties(filterParticipants(options, '+48 (500)', 1)).sort(), ['tel:+48500000002', 'tel:+48500000003']);
  assert.deepEqual(parties(filterParticipants(options, 'WhatsApp', 1)), ['name:Пример WhatsApp']);
});

test('all selected party types can be stored in a task change', () => {
  const options = participantOptions(records);
  const event = makeTaskChange(crypto.randomUUID(), { op: 'update', roles: { members: parties(options) } }).event;
  assert.doesNotThrow(() => validateEvent(event));
});
