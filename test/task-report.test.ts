import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { fixture } from './helpers.ts';

// Closing a task with a report (CONCEPT.md §2.9): only fields from registry/tasks.json, each of its type.
const change = (data: Record<string, unknown>) => ({
  id: randomUUID(), schema_version: 1, source: 'app', author: 'me', ts: new Date().toISOString(), kind: 'task_change',
  payload: { ref: { type: 'task', id: '7c1f6a52-3c55-4a0b-9e0a-6a1f2b3c4d5e' }, data: { task: data } },
});

test('a task closes with a report of known fields; unknown fields, wrong types and proposals are checked', async () => {
  const f = await fixture();
  const post = (body: unknown) => f.request('/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    assert.equal((await post(change({ op: 'create', title: 'Настроить Wi-Fi', proposed: 'done' }))).status, 201);
    const report = { started: '2026-11-18T09:00:00.000Z', duration_min: 90, cost: 250, expenses: 40, currency: 'PLN', tags: ['#выезд'], note: 'роутер заменён', missing: [] };
    assert.equal((await post(change({ op: 'update', status: 'done', proposed: null, report }))).status, 201);
    assert.equal((await post(change({ op: 'update', report: { mood: 5 } }))).status, 400, 'unknown field');
    assert.equal((await post(change({ op: 'update', report: { duration_min: '1 час' } }))).status, 400, 'minutes are a number');
    assert.equal((await post(change({ op: 'update', report: { currency: 'RUB' } }))).status, 400, 'currency from the registry');
    assert.equal((await post(change({ op: 'update', report: { missing: ['cost', 'mood'] } }))).status, 400, 'missing names report fields');
    assert.equal((await post(change({ op: 'update', proposed: 'maybe' }))).status, 400, 'only «done» is proposed');
  } finally { await f.stop(); }
});
