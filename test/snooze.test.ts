import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { snoozeOptions, swipeChoices } from '../web/snooze.js';
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

// The tiles a left swipe puts in place of a queue tile (owner, 2026-11-22): 15 / 30 / 60 minutes, morning, day,
// evening, night — a part of the day already gone moves to tomorrow — and the next ten days.
test('swipe choices: minutes, parts of the day (gone ones tomorrow), ten days ahead', () => {
  const now = new Date(2026, 10, 22, 14, 30);
  const { times, days } = swipeChoices(now, { queue: { swipe: { minutes: [15, 30, 60], parts: [
    { key: 'morning', label: 'утро', icon: '🌅', hour: 9 }, { key: 'day', label: 'день', icon: '🌞', hour: 13 },
    { key: 'evening', label: 'вечер', icon: '🌆', hour: 18 }, { key: 'night', label: 'ночь', icon: '🌙', hour: 22 }], days: 10, day_hour: 9 } } });
  assert.deepEqual(times.map((item: any) => item.label), ['15 мин', '30 мин', '60 мин', 'утро', 'день', 'вечер', 'ночь']);
  assert.equal(Date.parse(times[1].until), now.getTime() + 30 * 60_000);
  assert.equal(Date.parse(times[3].until), new Date(2026, 10, 23, 9).getTime(), 'the morning is gone: tomorrow');
  assert.equal(times[3].tomorrow, true);
  assert.equal(Date.parse(times[4].until), new Date(2026, 10, 23, 13).getTime(), 'the day is gone too');
  assert.equal(Date.parse(times[5].until), new Date(2026, 10, 22, 18).getTime(), 'the evening is still ahead');
  assert.equal(times[5].tomorrow, false);
  assert.equal(days.length, 10);
  assert.equal(Date.parse(days[0].until), new Date(2026, 10, 23, 9).getTime());
  assert.equal(Date.parse(days[9].until), new Date(2026, 11, 2, 9).getTime());
  assert.match(days[0].label, /23/);
});

test('swipe choices fall back to defaults with an older registry', () => {
  const { times, days } = swipeChoices(new Date(2026, 10, 22, 7, 0), { queue: {} });
  assert.deepEqual(times.map((item: any) => item.label), ['15 мин', '30 мин', '60 мин', 'утро', 'день', 'вечер', 'ночь']);
  assert.equal(times[3].tomorrow, false, 'at 7:00 the morning is ahead');
  assert.equal(days.length, 10);
});
