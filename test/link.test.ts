import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture, event } from './helpers.ts';

test('a continuation is stored with the message, chosen or declined, and must point to an accepted message', async () => {
  const f = await fixture();
  const post = (body: unknown) => f.request('/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const first = event({ payload: { text: 'выезжаю' } });
    assert.equal((await post(first)).status, 201);
    const yes = event({ payload: { text: 'приехал', data: { continuation: { target: first.id, on: true } } } });
    const no = event({ payload: { text: 'другое дело', data: { continuation: { target: first.id, on: false } } } });
    assert.equal((await post(yes)).status, 201);
    assert.equal((await post(no)).status, 201, 'a declined suggestion is kept as training data');
    assert.equal((await post(event({ payload: { text: 'x', data: { continuation: { target: crypto.randomUUID(), on: true } } } }))).status, 422, 'unknown target');
    assert.equal((await post(event({ payload: { text: 'x', data: { continuation: { target: first.id } } } }))).status, 400, 'on is required');
    assert.equal((await post(event({ payload: { text: 'x', data: { continuation: { target: 'bad', on: true } } } }))).status, 400, 'target is a uuid');
  } finally { await f.stop(); }
});

test('link and unlink correct a connection later; a message cannot be linked to itself or to a correction', async () => {
  const f = await fixture();
  const post = (body: unknown) => f.request('/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const fix = (ref: string, data: Record<string, unknown>) => event({ kind: 'correction', payload: { ref: { type: 'event', id: ref }, data } });
  try {
    const a = event({ payload: { text: 'a' } }), b = event({ payload: { text: 'b' } });
    assert.equal((await post(a)).status, 201);
    assert.equal((await post(b)).status, 201);
    const link = fix(b.id, { op: 'link', target: a.id });
    assert.equal((await post(link)).status, 201);
    assert.equal((await post(fix(b.id, { op: 'unlink' }))).status, 201);
    assert.equal((await post(fix(b.id, { op: 'link' }))).status, 400, 'link needs a target');
    assert.equal((await post(fix(b.id, { op: 'link', target: b.id }))).status, 400, 'not to itself');
    assert.equal((await post(fix(b.id, { op: 'link', target: crypto.randomUUID() }))).status, 422, 'unknown target');
    assert.equal((await post(fix(b.id, { op: 'link', target: link.id }))).status, 400, 'not to a correction');
  } finally { await f.stop(); }
});

test('a topic is named by hand with a correction on its first message', async () => {
  const f = await fixture();
  const post = (body: unknown) => f.request('/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const fix = (ref: string, data: Record<string, unknown>) => event({ kind: 'correction', payload: { ref: { type: 'event', id: ref }, data } });
  try {
    const a = event({ payload: { text: 'выезжаю' } });
    assert.equal((await post(a)).status, 201);
    assert.equal((await post(fix(a.id, { op: 'topic', title: 'Клиент А — сеть в офисе' }))).status, 201);
    for (const title of [undefined, '   ', 'x'.repeat(81)]) assert.equal((await post(fix(a.id, { op: 'topic', title }))).status, 400, String(title));
  } finally { await f.stop(); }
});
