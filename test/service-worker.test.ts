import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
// @ts-expect-error Shared code runs directly in both browser contexts.
import { entryFromShare } from '../web/shared.js';
import { validateEvent } from '../src/contracts/validate.ts';

function worker(saveEntry: (entry: unknown) => Promise<void>) {
  const handlers = new Map<string, (event: unknown) => void>();
  const source = readFileSync(new URL('../web/sw.js', import.meta.url), 'utf8').replace(/^import .*;$/gm, '');
  runInNewContext(source, {
    self: { location: { origin: 'https://stream.example' }, addEventListener: (name: string, callback: (event: unknown) => void) => handlers.set(name, callback) },
    saveEntry, entryFromShare, URL, Response,
  });
  return handlers;
}

test('offline share persists original file bytes before redirecting to the shell', async () => {
  let saved: any;
  const handlers = worker(async (entry) => { saved = entry; });
  const form = new FormData(); form.set('text', 'Без сети');
  form.append('files', new File(['source bytes'], 'photo.png', { type: 'image/png' }));
  let result: Promise<Response> | undefined;
  handlers.get('fetch')!({ request: new Request('https://stream.example/share-target', { method: 'POST', body: form }), respondWith: (promise: Promise<Response>) => { result = promise; } });
  const response = await result!;
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), 'https://stream.example/?shared=1');
  validateEvent(saved.event);
  assert.equal(saved.event.source, 'share');
  assert.equal(await saved.files[0].blob.text(), 'source bytes');
});

test('share persistence failure is visible and private requests bypass shell cache', async () => {
  const handlers = worker(async () => { throw new Error('QuotaExceededError'); });
  const form = new FormData(); form.set('text', 'Не потерять');
  let result: Promise<Response> | undefined;
  handlers.get('fetch')!({ request: new Request('https://stream.example/share-target', { method: 'POST', body: form }), respondWith: (promise: Promise<Response>) => { result = promise; } });
  const response = await result!;
  assert.equal(response.status, 507);
  assert.match(await response.text(), /повторите/);
  for (const path of ['/api/events', '/api/media/hash', '/healthz']) {
    handlers.get('fetch')!({ request: new Request(`https://stream.example${path}`), respondWith: () => assert.fail('Private data must bypass shell cache') });
  }
});
