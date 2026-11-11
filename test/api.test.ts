import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { event, fixture } from './helpers.ts';
import { validateEvent } from '../src/contracts/validate.ts';

test('events API accepts, retries, conflicts and validates', async () => {
  const f = await fixture();
  try {
    const input = event();
    const post = (value: unknown) => f.request('/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
    const first = await post(input);
    assert.equal(first.status, 201);
    const saved = await first.json();
    validateEvent(saved);
    assert.equal((await post(input)).status, 200);
    assert.equal((await post({ ...input, payload: { text: 'changed' } })).status, 409);
    const { ts, ...missingTs } = input;
    for (const value of [{ ...input, kind: 'other' }, missingTs, { ...input, extra: 1 }]) {
      const response = await post(value);
      assert.equal(response.status, 400);
      assert.ok((await response.json()).error);
    }
    const response = await f.request('/api/events');
    assert.equal(response.status, 200);
    const page = await response.json();
    assert.deepEqual(page.events, [saved]);
    page.events.forEach(validateEvent);
    assert.equal(page.next_before, null);
    assert.equal((await f.request('/api/events', { method: 'POST', body: '{' })).status, 400);
    assert.equal((await f.request('/api/events', { method: 'DELETE' })).status, 405);
  } finally { await f.stop(); }
});

test('media API verifies, serves protected bytes, ranges and missing references', async () => {
  const f = await fixture();
  try {
    const bytes = Buffer.from('fake webm audio');
    const id = createHash('sha256').update(bytes).digest('hex');
    const upload = (hash: string) => f.request(`/api/media/${hash}`, { method: 'PUT', headers: { 'Content-Type': 'audio/webm;codecs=opus' }, body: bytes });
    assert.equal((await upload('0'.repeat(64))).status, 400);
    assert.equal((await upload(id)).status, 201);
    assert.equal((await upload(id)).status, 200);
    const response = await f.request(`/api/media/${id}`);
    assert.equal(response.status, 200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
    assert.match(response.headers.get('content-type')!, /audio\/webm/);
    const range = await f.request(`/api/media/${id}`, { headers: { Range: 'bytes=2-5' } });
    assert.equal(range.status, 206);
    assert.deepEqual(Buffer.from(await range.arrayBuffer()), bytes.subarray(2, 6));
    assert.equal((await f.request(`/api/media/${id}`, { headers: { Range: 'bytes=99-' } })).status, 416);
    assert.equal((await f.request('/api/media/invalid')).status, 400);
    assert.equal((await f.request(`/api/media/${'f'.repeat(64)}`)).status, 404);
    const post = (mediaId: string) => f.request('/api/events', { method: 'POST', body: JSON.stringify(event({ kind: 'voice', payload: { media: [{ media_id: mediaId, mime: 'audio/webm;codecs=opus' }] } })) });
    assert.equal((await post('f'.repeat(64))).status, 422);
    assert.equal((await post(id)).status, 201);
  } finally { await f.stop(); }
});

test('API pagination traverses equal-clock entries without loss', async () => {
  const f = await fixture();
  try {
    const ids: string[] = [];
    for (let i = 0; i < 9; i++) ids.unshift(f.store.appendEvent(event()).event.id);
    const found: string[] = [];
    let before: string | null = null;
    do {
      const response = await f.request(`/api/events?limit=2${before ? `&before=${encodeURIComponent(before)}` : ''}`);
      assert.equal(response.status, 200);
      const page = await response.json();
      found.push(...page.events.map((item: { id: string }) => item.id));
      before = page.next_before;
    } while (before);
    assert.deepEqual(found, ids);
    for (const query of ['limit=0', 'limit=101', 'limit=abc', 'limit=1.5', 'before=bad']) {
      assert.equal((await f.request(`/api/events?${query}`)).status, 400);
    }
  } finally { await f.stop(); }
});

test('all private routes require Bearer auth, public shell and health stay available', async () => {
  const f = await fixture();
  try {
    for (const [method, path] of [['GET', '/api/events'], ['POST', '/api/events'], ['PUT', `/api/media/${'f'.repeat(64)}`], ['GET', `/api/media/${'f'.repeat(64)}`], ['POST', '/share-target']]) {
      const response = await fetch(f.base + path, { method });
      assert.equal(response.status, 401);
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }
    assert.equal((await fetch(f.base + '/api/events', { headers: { Authorization: 'Bearer wrong' } })).status, 401);
    assert.equal((await fetch(f.base + '/healthz')).status, 200);
    assert.equal((await fetch(f.base + '/')).status, 200);
    assert.equal((await fetch(f.base + '/manifest.json')).status, 200);
    assert.equal((await fetch(f.base + '/.env')).status, 404);
    assert.equal((await fetch(f.base + '/src/main.ts')).status, 404);
  } finally { await f.stop(); }
});

test('authenticated share fallback appends media and a share event then redirects', async () => {
  const f = await fixture();
  try {
    const form = new FormData();
    form.set('title', 'Ссылка'); form.set('text', 'Текст'); form.set('url', 'https://example.org/');
    form.append('files', new File(['image'], 'image.png', { type: 'image/png' }));
    const response = await f.request('/share-target', { method: 'POST', body: form });
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), '/');
    const saved = f.store.listEvents({ limit: 50 }).events[0]!;
    validateEvent(saved);
    assert.equal(saved.source, 'share');
    assert.equal(saved.payload.url, 'https://example.org/');
    assert.match(saved.payload.text!, /Текст/);
    assert.ok(f.store.getMedia(saved.payload.media![0]!.media_id));
    assert.equal((await f.request('/share-target', { method: 'POST', body: 'malformed' })).status, 400);
  } finally { await f.stop(); }
});
