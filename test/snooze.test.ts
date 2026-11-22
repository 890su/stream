import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { snoozeOptions, swipeChoices, composeUntil } from '../web/snooze.js';
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

// The dials a left swipe puts in place of a queue tile (owner, 2026-11-22): minutes 5 / 15 / 25 / 55, a part of the
// day, a date; nothing dialled — the archive with no date.
const swipe = { queue: { swipe: { minutes: [5, 15, 25, 55], parts: [
  { key: 'morning', label: 'утро', icon: '🌅', hour: 9 }, { key: 'day', label: 'день', icon: '🌞', hour: 13 },
  { key: 'evening', label: 'вечер', icon: '🌆', hour: 18 }, { key: 'night', label: 'ночь', icon: '🌙', hour: 22 }], days: 10, day_hour: 9 } } };

test('swipe dials: minutes, parts of the day, today and the next ten days', () => {
  const now = new Date(2026, 10, 22, 14, 30);
  const { minutes, parts, days } = swipeChoices(now, swipe);
  assert.deepEqual(minutes, [5, 15, 25, 55]);
  assert.deepEqual(parts.map((item: any) => item.label), ['утро', 'день', 'вечер', 'ночь']);
  assert.equal(days.length, 11);
  assert.deepEqual(days.slice(0, 2).map((item: any) => item.label), ['сегодня', 'завтра']);
  assert.match(days[2].label, /24/);
  assert.deepEqual(swipeChoices(now, { queue: {} }).minutes, [5, 15, 25, 55], 'defaults for an older registry');
});

test('the time the dials make: minutes from now; a part of the day today or, gone, tomorrow; a date at its part or the morning; nothing — null', () => {
  const now = new Date(2026, 10, 22, 14, 30);
  const choices = swipeChoices(now, swipe);
  const at = (pick: Record<string, unknown>) => { const until = composeUntil(now, pick, choices); return until && new Date(until).getTime(); };
  assert.equal(at({}), null, 'nothing dialled: the archive');
  assert.equal(at({ minutes: 25 }), now.getTime() + 25 * 60_000);
  assert.equal(at({ part: 'evening' }), new Date(2026, 10, 22, 18).getTime());
  assert.equal(at({ part: 'morning' }), new Date(2026, 10, 23, 9).getTime(), 'the morning is gone: tomorrow');
  assert.equal(at({ day: 3 }), new Date(2026, 10, 25, 9).getTime(), 'a date alone: its morning');
  assert.equal(at({ day: 3, part: 'night' }), new Date(2026, 10, 25, 22).getTime());
  assert.equal(at({ day: 0, part: 'day' }), new Date(2026, 10, 23, 13).getTime(), 'the day of today is gone: tomorrow');
});
