import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { headline, nextStep, contactLinks } from '../web/taskcard.js';

// The top of the task card (task card design §4): with whom, when, the state, what next, a call and a map. Made up.
const now = new Date('2026-11-19T12:00:00');

test('the line under the title: counterparty · due · status (not for a plain «сделать»)', () => {
  assert.deepEqual(headline({ status: 'doing', due: '2026-11-19', counterpartyTitle: 'ул. Пробная 5' }, now), ['◆ ул. Пробная 5', 'сегодня', 'в работе']);
  assert.deepEqual(headline({ status: 'todo' }, now), []);
  assert.deepEqual(headline({ status: 'waiting', due: '2026-11-18' }, now), ['просрочено', 'ждёт']);
});

test('what next: where I stopped, else the first unticked item', () => {
  assert.equal(nextStep({ resumeNote: 'проверить Wi-Fi', items: [] }), 'проверить Wi-Fi');
  assert.equal(nextStep({ resumeNote: 'в работе', items: [{ text: 'кабель', done: true }, { text: 'роутер', done: false }] }), 'роутер');
  assert.equal(nextStep({ items: [] }), '');
});

test('a call and a map in one tap: the person\'s phones, then addresses of the person and the counterparty', () => {
  const links = contactLinks({ person: { phones: ['+48 600 300 400'], addresses: ['ул. Пробная 5, Варшава'] }, counterparty: { address: 'ул. Пробная 5, Варшава' } });
  assert.deepEqual(links, [
    { kind: 'tel', href: 'tel:+48600300400', text: '+48 600 300 400' },
    { kind: 'map', href: 'https://www.google.com/maps/search/?api=1&query=%D1%83%D0%BB.%20%D0%9F%D1%80%D0%BE%D0%B1%D0%BD%D0%B0%D1%8F%205%2C%20%D0%92%D0%B0%D1%80%D1%88%D0%B0%D0%B2%D0%B0', text: 'ул. Пробная 5, Варшава' },
  ], 'the same address once');
  assert.deepEqual(contactLinks({}), []);
});
