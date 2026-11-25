import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { fixture, token, readUntil } from './helpers.ts';
import { phoneEventId } from '../src/server/phone.ts';

const started = '2026-11-17T09:00:00.000Z';
const callBody = { direction: 'in', number: '+48500000001', name: 'Клиент А', started_at: started, duration_s: 75 };
// The same reference value is pinned in the Android test (LogicTest.kt): both sides must derive equal ids.
const PINNED_CALL_ID = '05114e8c-8aed-5940-9d5c-12bf73695f7e';

test('phone event ids are derived from the call or SMS itself, the same way as on the phone', () => {
  assert.equal(phoneEventId('call|+48500000001|1794900000000'), PINNED_CALL_ID);
  assert.match(phoneEventId('x'), /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('the phone token opens only the phone endpoints', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.phoneRequest('/api/phone/ping')).status, 204);
    assert.equal((await f.phoneRequest('/api/phone/ping', undefined, `Bearer ${token}`)).status, 204, 'owner token works too');
    assert.equal((await f.phoneRequest('/api/phone/ping', undefined, '')).status, 401);
    for (const path of ['/api/events', '/api/live', '/api/media/abc']) assert.equal((await f.phoneRequest(path)).status, 401, path);
  } finally { await f.stop(); }
  const without = await fixture({ phone: '' });
  try {
    assert.equal((await without.phoneRequest('/api/phone/ping')).status, 401, 'no phone token configured');
    assert.equal((await without.phoneRequest('/api/phone/ping', undefined, `Bearer ${token}`)).status, 204);
  } finally { await without.stop(); }
});

test('a call is written once, with an id derived from number and start, and reaches live clients', async () => {
  const f = await fixture();
  try {
    const client = await f.request('/api/live');
    const first = await f.phoneRequest('/api/phone/calls', callBody);
    assert.equal(first.status, 201);
    const { id } = await first.json() as { id: string };
    assert.equal(id, phoneEventId(`call|+48500000001|${Date.parse(started)}`));
    const again = await f.phoneRequest('/api/phone/calls', callBody);
    assert.equal(again.status, 200, 'a retry is not a conflict');
    assert.equal((await again.json() as { id: string }).id, id);
    const stored = f.store.getEvent(id)!;
    assert.equal(stored.kind, 'call');
    assert.equal(stored.source, 'android_phone');
    assert.equal(stored.ts, started);
    assert.deepEqual(stored.payload.data, { call: { direction: 'in', number: '+48500000001', name: 'Клиент А', started_at: started, duration_s: 75 } });
    assert.match(await readUntil(client, (text) => text.includes(id)), new RegExp(id));

    const hidden = await f.phoneRequest('/api/phone/calls', { direction: 'missed', number: '', started_at: '2026-11-17T09:05:00.000Z' });
    assert.equal(hidden.status, 201, 'a hidden number is still a call');
    assert.equal((await f.phoneRequest('/api/phone/calls', { direction: 'in', started_at: 'вчера' })).status, 400);
    assert.equal((await f.phoneRequest('/api/phone/calls', { direction: 'sideways', started_at: started })).status, 400);
    assert.equal((await f.phoneRequest('/api/phone/calls', 'not an object')).status, 400);
  } finally { await f.stop(); }
});

test('a note continues its call; retries are idempotent', async () => {
  const f = await fixture();
  try {
    const { id } = await (await f.phoneRequest('/api/phone/calls', callBody)).json() as { id: string };
    const note = { note_id: randomUUID(), text: 'Договорились на пятницу', written_at: Date.parse(started) + 120000 };
    assert.equal((await f.phoneRequest(`/api/phone/calls/${id}/note`, note)).status, 201);
    const stored = f.store.getEvent(note.note_id)!;
    assert.equal(stored.kind, 'text');
    assert.equal(stored.payload.text, 'Договорились на пятницу');
    assert.equal(stored.ts, new Date(note.written_at).toISOString());
    assert.deepEqual(stored.payload.data, { continuation: { target: id, on: true } });
    assert.equal((await f.phoneRequest(`/api/phone/calls/${id}/note`, note)).status, 200, 'retry');
    assert.equal((await f.phoneRequest(`/api/phone/calls/${randomUUID()}/note`, { ...note, note_id: randomUUID() })).status, 404);
    assert.equal((await f.phoneRequest(`/api/phone/calls/${id}/note`, { ...note, note_id: randomUUID(), text: '  ' })).status, 400);
    assert.equal((await f.phoneRequest(`/api/phone/calls/${id}/note`, { ...note, note_id: 'not-a-uuid' })).status, 400);
  } finally { await f.stop(); }
});

test('an SMS is written once with its text', async () => {
  const f = await fixture();
  try {
    const body = { direction: 'in', number: '+48500000002', sent_at: started, text: 'Буду в 10' };
    const created = await f.phoneRequest('/api/phone/sms', body);
    assert.equal(created.status, 201);
    const { id } = await created.json() as { id: string };
    assert.equal(id, phoneEventId(`sms|in|+48500000002|${Date.parse(started)}|Буду в 10`));
    assert.equal((await f.phoneRequest('/api/phone/sms', body)).status, 200);
    const stored = f.store.getEvent(id)!;
    assert.equal(stored.kind, 'sms');
    assert.equal(stored.payload.text, 'Буду в 10');
    assert.equal((await f.phoneRequest('/api/phone/sms', { ...body, text: '' })).status, 400);
  } finally { await f.stop(); }
});

const post = (f: Awaited<ReturnType<typeof fixture>>, event: unknown) =>
  f.request('/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(event) });

test('a reply by SMS waits for the phone: it takes it, sends it and reports; never to a name', async () => {
  const f = await fixture();
  try {
    const reply = { id: randomUUID(), schema_version: 1, source: 'app', author: 'me', ts: '2026-11-25T09:00:00.000Z', kind: 'text',
      payload: { text: 'Буду в 10', data: { outbound: { connector: 'sms', chat_id: '+48500000002', chat_title: 'Клиент Б' } } } };
    assert.equal((await post(f, reply)).status, 201);
    const byName = { ...reply, id: randomUUID(), payload: { ...reply.payload, data: { outbound: { connector: 'sms', chat_id: 'InPost' } } } };
    assert.equal((await post(f, byName)).status, 400, 'only to a number');

    const next = await f.phoneRequest('/api/phone/actions/next?wait=0');
    assert.equal(next.status, 200);
    const action = await next.json() as { id: string; number: string; text: string };
    assert.deepEqual({ number: action.number, text: action.text }, { number: '+48500000002', text: 'Буду в 10' });
    assert.equal(f.store.actions.get(action.id)?.status, 'running');
    assert.equal(f.store.status.get('android_phone')?.state, 'ok', 'the request is the phone pulse');
    assert.equal((await f.phoneRequest('/api/phone/actions/next?wait=0')).status, 204);
    assert.equal((await f.phoneRequest(`/api/phone/actions/${action.id}`, { status: 'done' })).status, 204);
    assert.equal(f.store.actions.get(action.id)?.status, 'done');
    assert.equal((await f.phoneRequest(`/api/phone/actions/${action.id}`, { status: 'sent' })).status, 400);

    const failed = { ...reply, id: randomUUID(), payload: { ...reply.payload, text: 'Ещё' } };
    await post(f, failed);
    const taken = await (await f.phoneRequest('/api/phone/actions/next?wait=0')).json() as { id: string };
    assert.equal((await f.phoneRequest(`/api/phone/actions/${taken.id}`, { status: 'failed', error: 'Нет сети' })).status, 204);
    assert.equal(f.store.actions.get(taken.id)?.error, 'Нет сети');
  } finally { await f.stop(); }
});

test('the phone waits for an SMS to send: one written meanwhile comes at once', async () => {
  const f = await fixture();
  try {
    const waiting = f.phoneRequest('/api/phone/actions/next?wait=5');
    await new Promise((resolve) => setTimeout(resolve, 300));
    const reply = { id: randomUUID(), schema_version: 1, source: 'app', author: 'me', ts: '2026-11-25T09:00:00.000Z', kind: 'text',
      payload: { text: 'Перезвоню', data: { outbound: { connector: 'sms', chat_id: '+48500000003' } } } };
    const at = Date.now();
    await post(f, reply);
    const response = await waiting;
    assert.equal(response.status, 200);
    assert.equal((await response.json() as { text: string }).text, 'Перезвоню');
    assert.ok(Date.now() - at < 2500, 'within the poll step');
  } finally { await f.stop(); }
});

test('a send the phone took long ago and never confirmed fails, and is not handed out again', async () => {
  const f = await fixture();
  try {
    await post(f, { id: randomUUID(), schema_version: 1, source: 'app', author: 'me', ts: '2026-11-25T09:00:00.000Z', kind: 'text',
      payload: { text: 'Тест', data: { outbound: { connector: 'sms', chat_id: '+48500000004' } } } });
    const { id } = await (await f.phoneRequest('/api/phone/actions/next?wait=0')).json() as { id: string };
    assert.deepEqual(f.store.actions.failRunning('sms', 'x', new Date(Date.now() - 60_000).toISOString()), [], 'a fresh one stays');
    const [stale] = f.store.actions.failRunning('sms', 'Телефон не подтвердил', new Date(Date.now() + 60_000).toISOString());
    assert.equal(stale?.id, id);
    assert.equal(f.store.actions.get(id)?.status, 'failed');
    assert.equal((await f.phoneRequest('/api/phone/actions/next?wait=0')).status, 204);
  } finally { await f.stop(); }
});
