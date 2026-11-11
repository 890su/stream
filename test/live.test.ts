import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture, event, token } from './helpers.ts';

// Reads the event stream until `predicate` matches the accumulated text or the timeout passes.
async function readUntil(response: Response, predicate: (text: string) => boolean, timeoutMs = 3000): Promise<string> {
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
  let text = '';
  const deadline = Date.now() + timeoutMs;
  try {
    while (!predicate(text)) {
      const left = deadline - Date.now();
      if (left <= 0) break;
      const chunk = await Promise.race([reader.read(), new Promise<null>((resolve) => setTimeout(() => resolve(null), left))]);
      if (!chunk || chunk.done) break;
      text += chunk.value;
    }
  } finally { await reader.cancel().catch(() => {}); }
  return text;
}

const appended = (text: string) => [...text.matchAll(/event: append\ndata: (.+)\n\n/g)].map((match) => JSON.parse(match[1]!));

test('live stream requires the owner token', async () => {
  const f = await fixture();
  try {
    assert.equal((await fetch(f.base + '/api/live')).status, 401);
  } finally { await f.stop(); }
});

test('a new event reaches every open client at once; a retry does not repeat it', async () => {
  const f = await fixture();
  try {
    const phone = await f.request('/api/live');
    const desktop = await f.request('/api/live');
    assert.equal(phone.status, 200);
    assert.match(phone.headers.get('content-type')!, /^text\/event-stream/);
    assert.match(phone.headers.get('cache-control')!, /no-transform/);
    const created = event({ payload: { text: 'с телефона', tags: ['#задача'] } });
    const post = () => f.request('/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(created) });
    assert.equal((await post()).status, 201);
    assert.equal((await post()).status, 200); // idempotent retry
    const later = event();
    assert.equal((await f.request('/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(later) })).status, 201);
    for (const client of [phone, desktop]) {
      const received = appended(await readUntil(client, (text) => text.includes(later.id)));
      assert.deepEqual(received.map((item) => item.id), [created.id, later.id]);
      assert.equal(received[0].payload.text, 'с телефона');
      assert.ok(received[0].received_at, 'server time is included');
    }
  } finally { await f.stop(); }
});

test('events saved through share-target are pushed too', async () => {
  const f = await fixture();
  try {
    const client = await f.request('/api/live');
    const form = new FormData();
    form.set('text', 'из другого приложения');
    const response = await fetch(f.base + '/share-target', { method: 'POST', body: form, headers: { Authorization: `Bearer ${token}` }, redirect: 'manual' });
    assert.equal(response.status, 303);
    const [shared] = appended(await readUntil(client, (text) => text.includes('event: append')));
    assert.equal(shared.source, 'share');
    assert.equal(shared.payload.text, 'из другого приложения');
  } finally { await f.stop(); }
});

test('client parser handles split chunks, comments and multi-line data', async () => {
  // @ts-expect-error Browser modules are deliberately buildless JavaScript.
  const { parseEvents } = await import('../web/live.js');
  const seen: Array<[string, string]> = [];
  let buffer = parseEvents('retry: 3000\n: connected\n\nevent: append\ndata: {"id":', (name: string, data: string) => seen.push([name, data]));
  assert.equal(seen.length, 0); // deepEqual(seen, []) would narrow the type to never[]
  buffer = parseEvents(buffer + '"a"}\n\n: ping\n\ndata: line1\ndata: line2\n\n', (name: string, data: string) => seen.push([name, data]));
  assert.equal(buffer, '');
  assert.deepEqual(seen, [['append', '{"id":"a"}'], ['message', 'line1\nline2']]);
});
