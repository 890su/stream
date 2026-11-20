import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { snoozeOptions } from '../web/snooze.js';
import { conversationsConfig } from '../src/config.ts';

// «⏱ Отложить» (CONCEPT.md §5, design 2026-11-20): the choices depend on the time of day.
const config = conversationsConfig;
const local = (iso: string) => { const d = new Date(iso); return `${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; };

test('in the morning: minutes, noon, evening, tomorrow morning', () => {
  const options = snoozeOptions(new Date(2026, 10, 20, 9, 30), config);
  assert.deepEqual(options.map((item: any) => item.key), ['15m', '1h', '3h', 'noon', 'evening', 'morning']);
  assert.deepEqual(options.map((item: any) => item.label), ['15 мин', '1 ч', '3 ч', 'в полдень', 'вечером', 'утром']);
  assert.deepEqual(options.map((item: any) => local(item.until)), ['20 9:45', '20 10:30', '20 12:30', '20 12:00', '20 18:00', '21 9:00']);
  assert.ok(options.every((item: any) => typeof item.icon === 'string' && item.icon && !Number.isNaN(Date.parse(item.until))));
});

test('after 11 there is no noon; from 17 «завтра днём» replaces the evening', () => {
  assert.deepEqual(snoozeOptions(new Date(2026, 10, 20, 12, 30), config).map((item: any) => item.key), ['15m', '1h', '3h', 'evening', 'morning']);
  const late = snoozeOptions(new Date(2026, 10, 20, 17, 30), config);
  assert.deepEqual(late.map((item: any) => item.key), ['15m', '1h', '3h', 'tomorrow_day', 'morning']);
  assert.equal(late.find((item: any) => item.key === 'tomorrow_day').label, 'завтра днём');
  assert.equal(local(late.find((item: any) => item.key === 'tomorrow_day').until), '21 13:00');
});

test('after midnight «утром» is this morning while it is still ahead', () => {
  const night = snoozeOptions(new Date(2026, 10, 21, 2, 0), config);
  assert.equal(local(night.find((item: any) => item.key === 'morning').until), '21 9:00');
});
