// Checks date, duration and repeat labels in the task card.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tasksConfig } from '../src/config.ts';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { chipFacts, durationLabel } from '../web/taskchips.js';

// The chips under the task's title (owner, 2026-11-20, after the task managers' review): when I do it, the due date,
// the repeat — each a tap to change. Dates are local time.
const now = new Date(2026, 10, 20, 9, 0);

test('«Когда»: the planned start and its length; «Срок»: the due date; without them — a question', () => {
  const planned = chipFacts({ plan: { start: new Date(2026, 10, 20, 16, 0).toISOString(), duration_min: 90 }, due: '2026-11-21' }, now);
  assert.equal(planned.when, 'сегодня 16:00 · 1 ч 30 мин');
  assert.equal(planned.due, 'срок завтра');
  const bare = chipFacts({}, now);
  assert.deepEqual([bare.when, bare.due, bare.repeat], ['Когда?', 'Срок?', 'Без повтора']);
  assert.equal(chipFacts({ due: '2026-11-25T10:00' }, now).due, 'срок ср 25 нояб. 10:00');
  assert.equal(chipFacts({ due: '2026-11-18' }, now).late, true, 'overdue is marked');
  assert.equal(chipFacts({ due: '2026-11-20T08:00' }, now).late, true, 'a timed due can be overdue today');
  assert.equal(chipFacts({ due: 'старый срок' }, now).due, 'Срок?');
});

test('the repeat in words; durations', () => {
  const repeats = tasksConfig.card.repeats;
  assert.equal(chipFacts({ repeat: { every: 'week', n: 1 } }, now, repeats).repeat, 'каждую неделю');
  assert.equal(chipFacts({ repeat: { every: 'month', n: 2 } }, now).repeat, 'каждые 2 мес.');
  assert.deepEqual(repeats.map((item) => item.every), [null, 'day', 'week', 'month', 'year']);
  assert.deepEqual([durationLabel(15), durationLabel(60), durationLabel(240)], ['15 мин', '1 ч', '4 ч']);
});

test('the card head shows only what is set: nothing at all for a bare task (owner, 2026-11-24)', async () => {
  // @ts-expect-error Browser modules are deliberately buildless JavaScript.
  const { filledFacts } = await import('../web/taskchips.js');
  const now = new Date(2026, 10, 24, 10, 0);
  assert.deepEqual(filledFacts({}, { now }), []);
  const set = filledFacts({ plan: { start: new Date(2026, 10, 25, 9, 0).toISOString() }, due: '2026-11-23', repeat: { every: 'week', n: 2 } },
    { now, projectTitle: 'naserwis.pl', counterpartyTitle: 'Анна Пример' });
  assert.deepEqual(set.map((item: { text: string }) => item.text), ['📅 завтра 09:00', '⏰ срок вчера', '▸ naserwis.pl', '◆ Анна Пример', '🔁 каждые 2 нед.']);
  assert.equal(set[1].late, true);
  assert.deepEqual(filledFacts({ project_options: ['p1'] }, { now }).map((item: { text: string }) => item.text), ['▸ В какой проект?']);
});
