import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { calendarToggles, googleNotice } from '../web/googlebox.js';

// Google on the System screen (docs/plans/2026-11-20-google-calendar-design.md, stage 1). Names are made up.
test('calendar switches: by account, the account\'s own calendar first, then by title; on = shown in «План»', () => {
  const toggles = calendarToggles([
    { id: 'family@group', title: 'Семья', account: 'anna@example.com', hidden: false },
    { id: 'anna@example.com', title: 'anna@example.com', account: 'anna@example.com', hidden: false },
    { id: 'holiday', title: 'Праздники', account: 'anna@example.com', hidden: true },
    { id: 'boris@example.com', title: 'boris@example.com', account: 'boris@example.com', hidden: false },
  ]);
  assert.deepEqual(toggles.map((item: any) => [item.id, item.on]), [['anna@example.com', true], ['holiday', false], ['family@group', true], ['boris@example.com', true]]);
});

test('the notice after Google sends the owner back', () => {
  assert.equal(googleNotice('?google=ok'), 'Google подключён: календари появятся в «Плане» через минуту');
  assert.equal(googleNotice('?google=error'), 'Не удалось подключить Google — попробуйте ещё раз на экране «Система»');
  assert.equal(googleNotice('?mode=tasks'), null);
});
