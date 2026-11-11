import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { JournalStore } from '../src/store/store.ts';
import { createApp } from '../src/server/http.ts';
import type { JournalEvent } from '../src/contracts/validate.ts';

export const token = 'test-owner-token-for-local-tests-only';
export const event = (overrides: Partial<JournalEvent> = {}): JournalEvent => ({
  id: randomUUID(), schema_version: 1, source: 'app', author: 'me',
  ts: '2026-11-11T10:00:00.000Z', kind: 'text', payload: { text: 'Проверка' }, ...overrides,
});

export function temporaryStore() {
  const directory = mkdtempSync(join(tmpdir(), 'stream-test-'));
  const store = new JournalStore(directory);
  return { store, directory, cleanup() { store.close(); rmSync(directory, { recursive: true, force: true }); } };
}

export async function fixture() {
  const storage = temporaryStore();
  const server = createApp({ store: storage.store, ownerToken: token });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    ...storage, base,
    request(path: string, init: RequestInit = {}) {
      const headers = new Headers(init.headers);
      headers.set('Authorization', `Bearer ${token}`);
      return fetch(base + path, { ...init, headers, redirect: 'manual' });
    },
    async stop() { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); storage.cleanup(); },
  };
}
