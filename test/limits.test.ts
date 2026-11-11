import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { captureConfig } from '../src/config.ts';
import { fixture, event } from './helpers.ts';

test('oversized JSON and unsupported media fail with recoverable responses', async () => {
  const f = await fixture();
  try {
    const response = await f.request('/api/events', { method: 'POST', body: JSON.stringify(event({ payload: { text: 'x'.repeat(captureConfig.max_event_bytes) } })) });
    assert.equal(response.status, 413);
    assert.ok((await response.json()).error);
    const bytes = Buffer.from('console.log("unsupported")');
    const id = createHash('sha256').update(bytes).digest('hex');
    assert.equal((await f.request(`/api/media/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/javascript' }, body: bytes })).status, 415);
  } finally { await f.stop(); }
});

test('share media accepts image and audio families advertised by the manifest', async () => {
  const f = await fixture();
  try {
    for (const mime of ['image/avif', 'audio/aac', 'image/svg+xml']) {
      const bytes = Buffer.from(mime);
      const id = createHash('sha256').update(bytes).digest('hex');
      assert.equal((await f.request(`/api/media/${id}`, { method: 'PUT', headers: { 'Content-Type': mime }, body: bytes })).status, 201);
    }
  } finally { await f.stop(); }
});
