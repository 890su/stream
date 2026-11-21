import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { dashboardOrder } from '../web/dashboard.js';

// The dashboard reads bottom-up like the conversation queue (design 2026-11-21). Tasks are made up.
const task = (id: string) => ({ id, title: id });

test('bottom-up: work last, paused above it, next above them, the nearest next lowest', () => {
  const rows = dashboardOrder({ work: task('W'), paused: [task('P1'), task('P2')], today: [task('N1'), task('N2'), task('N3')] });
  assert.deepEqual(rows.map((row: any) => row.task.id), ['N3', 'N2', 'N1', 'P2', 'P1', 'W']);
  assert.deepEqual(rows.map((row: any) => row.kind), ['next', 'next', 'next', 'paused', 'paused', 'work']);
});

test('no work: nothing marked work; empty blocks give no rows', () => {
  const rows = dashboardOrder({ work: null, paused: [task('P1')], today: [task('N1')] });
  assert.deepEqual(rows.map((row: any) => row.kind), ['next', 'paused']);
  assert.deepEqual(dashboardOrder({ work: null, paused: [], today: [] }), []);
});
