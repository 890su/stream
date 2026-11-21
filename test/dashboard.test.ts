import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { dashboardOrder } from '../web/dashboard.js';

// The dashboard reads top-down, the most important on top (owner, 2026-11-21). Tasks are made up.
const task = (id: string) => ({ id, title: id });

test('top-down: work first, paused under it, next under them in the order of «До конца дня»', () => {
  const rows = dashboardOrder({ work: task('W'), paused: [task('P1'), task('P2')], today: [task('N1'), task('N2'), task('N3')] });
  assert.deepEqual(rows.map((row: any) => row.task.id), ['W', 'P1', 'P2', 'N1', 'N2', 'N3']);
  assert.deepEqual(rows.map((row: any) => row.kind), ['work', 'paused', 'paused', 'next', 'next', 'next']);
});

test('no work: nothing marked work; empty blocks give no rows', () => {
  const rows = dashboardOrder({ work: null, paused: [task('P1')], today: [task('N1')] });
  assert.deepEqual(rows.map((row: any) => row.kind), ['paused', 'next']);
  assert.deepEqual(dashboardOrder({ work: null, paused: [], today: [] }), []);
});
