import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { syncEntries } from '../web/sync.js';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { makeEntry, entryFromShare } from '../web/shared.js';
import { validateEvent } from '../src/contracts/validate.ts';

test('capture and share create schema-valid entries with stable ids and bytes', async () => {
  const blob = new Blob(['audio'], { type: 'audio/webm;codecs=opus' });
  const entry = await makeEntry({ kind: 'voice', files: [blob], duration: 2 });
  validateEvent(entry.event);
  assert.equal(entry.files[0].blob, blob);
  assert.match(entry.event.payload.media[0].media_id, /^[a-f0-9]{64}$/);
  const form = new FormData();
  form.set('title', 'Заголовок'); form.set('text', 'Текст'); form.set('url', 'https://example.org');
  form.append('files', new File(['photo'], 'photo.png', { type: 'image/png' }));
  const shared = await entryFromShare(form);
  validateEvent(shared.event);
  assert.equal(shared.event.source, 'share');
  assert.equal(shared.event.payload.text, 'Заголовок\nТекст');
  assert.equal(shared.files.length, 1);
});

test('sync uploads bytes before the event and only acknowledges 200/201', async () => {
  const entry = await makeEntry({ kind: 'voice', files: [new Blob(['audio'], { type: 'audio/webm' })] });
  const calls: string[] = [];
  const removed: string[] = [];
  const repository = { list: async () => [entry], save: async () => {}, remove: async (id: string) => { removed.push(id); } };
  const request = async (url: string, init: RequestInit) => {
    calls.push(`${init.method} ${url}`);
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer token');
    return new Response(JSON.stringify(url.includes('/media/') ? { mime: 'audio/webm', size_bytes: 5 } : { ...entry.event, received_at: new Date().toISOString() }), { status: 201 });
  };
  await syncEntries(repository, 'token', request);
  assert.match(calls[0]!, /^PUT \/api\/media\//);
  assert.equal(calls[1], 'POST /api/events');
  assert.deepEqual(removed, [entry.event.id]);
});

test('lost responses retry the same id, conflicts and auth failures retain data', async () => {
  for (const status of [409, 401, 422, 500]) {
    const entry = await makeEntry({ text: 'offline' });
    const removed: string[] = [];
    const repository = { list: async () => [entry], save: async () => {}, remove: async (id: string) => { removed.push(id); } };
    await syncEntries(repository, 'token', async () => new Response(JSON.stringify({ error: 'Ошибка' }), { status }));
    assert.deepEqual(removed, []);
    assert.ok(entry.error);
    const id = entry.event.id;
    await syncEntries(repository, 'token', async () => { throw new TypeError('Offline'); });
    assert.equal(entry.event.id, id);
    assert.deepEqual(removed, []);
    await syncEntries(repository, 'token', async () => new Response(JSON.stringify({ ...entry.event, received_at: new Date().toISOString() }), { status: 200 }));
    assert.deepEqual(removed, [id]);
  }
});

test('media failures stop event submission and missing token leaves queue intact', async () => {
  const entry = await makeEntry({ files: [new Blob(['photo'], { type: 'image/png' })], kind: 'photo' });
  const methods: string[] = [];
  const repository = { list: async () => [entry], save: async () => {}, remove: async () => assert.fail('must retain') };
  const request = async (_url: string, init: RequestInit) => { methods.push(init.method!); return new Response('{}', { status: 413 }); };
  await syncEntries(repository, '', request);
  assert.deepEqual(methods, []);
  await syncEntries(repository, 'token', request);
  assert.deepEqual(methods, ['PUT']);
});

test('a stalled request times out and preserves its queue entry', async () => {
  const entry = await makeEntry({ text: 'Сохранить' });
  const repository = { list: async () => [entry], save: async () => {}, remove: async () => assert.fail('must retain') };
  let aborted = false;
  const request = (_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
    assert.ok(init.signal);
    init.signal!.addEventListener('abort', () => { aborted = true; reject(init.signal!.reason); });
  });
  await Promise.race([
    syncEntries(repository, 'token', request, async () => {}, 10),
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout handling failed')), 500)),
  ]);
  assert.equal(aborted, true);
  assert.ok(entry.error);
});

test('composer entries carry owner tags; registry quick tags satisfy the contract', async () => {
  const tagged = await makeEntry({ text: 'купить кабель', tags: ['#задача', '#закупка'] });
  validateEvent(tagged.event);
  assert.deepEqual(tagged.event.payload.tags, ['#задача', '#закупка']);
  const plain = await makeEntry({ text: 'без меток' });
  assert.equal('tags' in plain.event.payload, false);
  const { readFileSync } = await import('node:fs');
  const config = JSON.parse(readFileSync(new URL('../registry/capture.json', import.meta.url), 'utf8'));
  assert.ok(config.quick_tags.length > 0);
  validateEvent((await makeEntry({ text: 'x', tags: config.quick_tags })).event);
});

test('the queue sends oldest first, so a correction never precedes its message; entries are valid', async () => {
  // @ts-expect-error Browser modules are deliberately buildless JavaScript.
  const { makeCorrection } = await import('../web/shared.js');
  const original = await makeEntry({ text: 'исходное' });
  await new Promise((resolve) => setTimeout(resolve, 5));
  const reply = await makeEntry({ text: 'ответ', replyTo: original.event.id });
  await new Promise((resolve) => setTimeout(resolve, 5));
  const edit = makeCorrection(original.event.id, 'edit', { text: 'исправлено', tags: ['#задача'] });
  const archive = makeCorrection(original.event.id, 'archive');
  for (const entry of [original, reply, edit, archive]) validateEvent(entry.event);
  assert.equal(reply.event.reply_to, original.event.id);
  assert.equal('text' in archive.event.payload, false);
  const store = new Map([edit, archive, reply, original].map((entry) => [entry.event.id, entry]));
  const posted: string[] = [];
  await syncEntries({ list: async () => [...store.values()], save: async () => {}, remove: async (id: string) => { store.delete(id); } }, 'token',
    async (_url: string, init: RequestInit) => { posted.push(JSON.parse(String(init.body)).id); return new Response('{}', { status: 201 }); });
  assert.equal(posted[0], original.event.id);
  assert.ok(posted.indexOf(edit.event.id) > posted.indexOf(original.event.id));
});
