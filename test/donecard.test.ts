import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { buildReport, parseMinutes, reportKeys } from '../web/donecard.js';

// The closing report typed into «Задача выполнена?» (CONCEPT.md §2.9). Values are made up.
const fields = {
  started: { title: 'Когда начал', type: 'datetime' }, duration_min: { title: 'Сколько заняло, мин', type: 'minutes' },
  cost: { title: 'Стоимость', type: 'money' }, expenses: { title: 'Затраты', type: 'money' }, tags: { title: 'Метки', type: 'tags' }, note: { title: 'Итог', type: 'text' },
};

test('the report: durations in several forms, sums, tags; empty fields are missing', () => {
  assert.deepEqual([parseMinutes('90'), parseMinutes('1:30'), parseMinutes('1,5 ч'), parseMinutes('2 ч'), parseMinutes('45 мин'), parseMinutes('долго')], [90, 90, 90, 120, 45, null]);
  const keys = ['started', 'duration_min', 'cost', 'expenses', 'tags', 'note'];
  const { report } = buildReport(keys, { duration_min: '1:30', cost: '250,50', tags: 'выезд #Камеры', note: ' роутер заменён ' }, fields, 'PLN');
  assert.deepEqual(report, { duration_min: 90, cost: 250.5, tags: ['#выезд', '#камеры'], note: 'роутер заменён', currency: 'PLN', missing: ['started', 'expenses'] });
  assert.match(buildReport(keys, { cost: 'много' }, fields, 'PLN').error, /сумма/);
  assert.deepEqual(buildReport(['note'], {}, fields, 'PLN').report, { missing: ['note'] }, 'skipped: no currency, all missing');
  const tasks = { reports: { lead: ['cost'] }, report_default: ['note'] };
  assert.deepEqual([reportKeys({ template: 'lead' }, tasks), reportKeys({}, tasks)], [['cost'], ['note']]);
});
