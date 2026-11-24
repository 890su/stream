// The cached journal (web/db.js) is read from the device once and kept in memory: every redraw of the queue and of
// a conversation reads it, and IndexedDB getAll of the whole journal on each one made opening a conversation slow.
import assert from 'node:assert/strict';
import { test } from 'node:test';

// A tiny IndexedDB: enough for db.js (open with upgrade, one transaction per call, getAll / put on a store).
function fakeIndexedDB() {
  const stores = new Map<string, Map<string, unknown>>();
  const counts = { getAll: 0 };
  const objectStore = (name: string, transaction: { result?: unknown }) => ({
    getAll() { counts.getAll++; const request = { result: [...(stores.get(name) ?? new Map()).values()] }; return request; },
    put(value: { id?: string; key?: string; event?: { id: string } }) { stores.get(name)!.set(value.id ?? value.key ?? value.event!.id, value); return {}; },
    get(key: string) { return { result: stores.get(name)!.get(key) }; },
    delete(key: string) { stores.get(name)!.delete(key); return {}; },
    transaction,
  });
  const db = {
    createObjectStore(name: string) { stores.set(name, new Map()); },
    transaction(name: string) {
      const transaction: Record<string, unknown> = {};
      transaction.objectStore = () => objectStore(name, transaction);
      setTimeout(() => (transaction.oncomplete as () => void)?.(), 0);
      return transaction;
    },
  };
  return {
    counts,
    open() {
      const request: Record<string, unknown> = { result: db };
      setTimeout(() => { (request.onupgradeneeded as () => void)?.(); (request.onsuccess as () => void)?.(); }, 0);
      return request;
    },
  };
}

test('the journal is read from the device once; new events join the copy in memory', async () => {
  const fake = fakeIndexedDB();
  (globalThis as { indexedDB?: unknown }).indexedDB = fake;
  // @ts-expect-error Browser modules are deliberately buildless JavaScript.
  const { cachedEvents, cacheEvents } = await import('../web/db.js');
  await cacheEvents([{ id: 'a', ts: '2026-11-24T09:00:00Z' }]);
  assert.deepEqual((await cachedEvents()).map((event: { id: string }) => event.id), ['a']);
  await cacheEvents([{ id: 'b', ts: '2026-11-24T09:01:00Z' }, { id: 'a', ts: '2026-11-24T09:00:00Z', edited: true }]);
  const events = await cachedEvents();
  assert.deepEqual(events.map((event: { id: string }) => event.id).sort(), ['a', 'b']);
  assert.equal(events.find((event: { id: string }) => event.id === 'a').edited, true, 'a newer copy of an event replaces the old');
  await cachedEvents();
  assert.equal(fake.counts.getAll, 1, 'the device store is read once, not on every redraw');
});
