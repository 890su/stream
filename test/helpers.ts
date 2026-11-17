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
export const phoneToken = 'test-phone-token-for-local-tests-only';
export const gatewayToken = 'test-gateway-token-by-for-local-tests';
export const event = (overrides: Partial<JournalEvent> = {}): JournalEvent => ({
  id: randomUUID(), schema_version: 1, source: 'app', author: 'me',
  ts: '2026-11-11T10:00:00.000Z', kind: 'text', payload: { text: 'Проверка' }, ...overrides,
});

export function temporaryStore() {
  const directory = mkdtempSync(join(tmpdir(), 'stream-test-'));
  const store = new JournalStore(directory);
  return { store, directory, cleanup() { store.close(); rmSync(directory, { recursive: true, force: true }); } };
}

// `phone: ''` starts a server without a phone token.
export async function fixture({ phone = phoneToken }: { phone?: string } = {}) {
  const storage = temporaryStore();
  const server = createApp({ store: storage.store, ownerToken: token, phoneToken: phone || undefined, gatewayTokens: { by: gatewayToken } });
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
    // A request as the phone companion makes it: the phone token and a JSON body (GET without one).
    phoneRequest(path: string, body?: unknown, authorization = `Bearer ${phoneToken}`) {
      const headers = new Headers({ Authorization: authorization });
      if (body !== undefined) headers.set('Content-Type', 'application/json');
      return fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
    },
    // A request as the Telegram gateway of account `by` makes it.
    gatewayRequest(path: string, body?: unknown, method?: string, authorization = `Bearer ${gatewayToken}`) {
      const headers = new Headers({ Authorization: authorization });
      if (body !== undefined) headers.set('Content-Type', 'application/json');
      return fetch(`${base}/api/gateway/telegram/by/${path}`, { method: method ?? (body === undefined ? 'GET' : 'POST'), headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
    },
    async stop() { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); storage.cleanup(); },
  };
}

// Reads an event stream until `predicate` matches the accumulated text or the timeout passes.
export async function readUntil(response: Response, predicate: (text: string) => boolean, timeoutMs = 3000): Promise<string> {
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
