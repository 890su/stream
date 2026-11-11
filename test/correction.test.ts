import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture, event } from './helpers.ts';
import type { JournalEvent } from '../src/contracts/validate.ts';

const correction = (target: string, data: Record<string, unknown>, payload: Partial<JournalEvent['payload']> = {}) =>
  event({ kind: 'correction', payload: { ref: { type: 'event', id: target }, data, ...payload } });

test('owner corrections reference an accepted message and carry a known operation', async () => {
  const f = await fixture();
  const post = (body: unknown) => f.request('/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const original = event({ payload: { text: 'купить кабель' } });
    assert.equal((await post(original)).status, 201);
    const photo = event({ kind: 'photo', payload: { text: 'подпись' } });
    assert.equal((await post(photo)).status, 201);

    for (const op of ['archive', 'unarchive', 'delete', 'restore']) assert.equal((await post(correction(original.id, { op }))).status, 201, op);
    const edit = correction(original.id, { op: 'edit' }, { text: 'купить кабель UTP', tags: ['#закупка'] });
    assert.equal((await post(edit)).status, 201);
    assert.equal((await post(edit)).status, 200, 'retry is idempotent');

    assert.equal((await post(correction(crypto.randomUUID(), { op: 'archive' }))).status, 422, 'unknown target');
    assert.equal((await post(correction(edit.id, { op: 'archive' }))).status, 400, 'a correction cannot be corrected');
    assert.equal((await post(correction(original.id, { op: 'erase' }))).status, 400, 'unknown operation');
    assert.equal((await post(correction(original.id, { op: 'edit' }))).status, 400, 'edit needs text');
    assert.equal((await post(correction(original.id, { op: 'edit' }, { text: '  ' }))).status, 400, 'text message cannot become empty');
    assert.equal((await post(event({ kind: 'correction', payload: { data: { op: 'archive' } } }))).status, 400, 'ref is required');
    assert.equal((await post(event({ kind: 'correction', payload: { ref: { type: 'task', id: original.id }, data: { op: 'archive' } } }))).status, 400, 'only events');
    assert.equal((await post(correction(photo.id, { op: 'edit' }, { text: '' }))).status, 201, 'a caption can be removed');
  } finally { await f.stop(); }
});
