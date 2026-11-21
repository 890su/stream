import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { JournalStore } from '../src/store/store.ts';
import { createApp } from '../src/server/http.ts';
import type { JournalEvent } from '../src/contracts/validate.ts';
import type { SocketFactory } from '../src/whatsapp/types.ts';
import { SecretStore } from '../src/secrets.ts';
import { ConnectorSwitches } from '../src/switches.ts';

export const token = 'test-owner-token-for-local-tests-only';
export const phoneToken = 'test-phone-token-for-local-tests-only';
export const viberToken = 'test-viber-token-for-local-tests-only';
export const event = (overrides: Partial<JournalEvent> = {}): JournalEvent => ({
  id: randomUUID(), schema_version: 1, source: 'app', author: 'me',
  ts: '2026-11-11T10:00:00.000Z', kind: 'text', payload: { text: 'Проверка' }, ...overrides,
});

export function temporaryStore() {
  const directory = mkdtempSync(join(tmpdir(), 'stream-test-'));
  const store = new JournalStore(directory);
  return { store, directory, cleanup() { store.close(); rmSync(directory, { recursive: true, force: true }); } };
}

// `phone: ''` starts a server without a phone token; `telegram` runs account bots against a fake Bot API;
// `whatsapp` runs linked-device clients on a fake socket (test/fakewa.ts), reconnecting after 10 ms.
// `google` runs the calendar connector against a fake Google (`fetch`); `secrets` — keys entered on the System screen.
export async function fixture({ phone = phoneToken, telegram, whatsapp, google, secrets }: {
  phone?: string; telegram?: { tokens: Record<string, string>; apiBase: string }; whatsapp?: { accounts: string[]; factory: SocketFactory };
  google?: { fetch: (url: string | URL | Request, init?: RequestInit) => Promise<Response> }; secrets?: boolean;
} = {}) {
  const storage = temporaryStore();
  const server = createApp({ store: storage.store, ownerToken: token, phoneToken: phone || undefined, viberToken, telegram,
    whatsapp: whatsapp && { ...whatsapp, authRoot: join(storage.directory, 'whatsapp'), retryMs: 10 },
    google: google ? { clientId: 'test-client', clientSecret: 'test-secret', publicUrl: 'https://stream.example', dir: join(storage.directory, 'google'), fetch: google.fetch }
      : secrets ? { publicUrl: 'https://stream.example', dir: join(storage.directory, 'google') } : undefined,
    secrets: secrets ? new SecretStore(join(storage.directory, 'secrets.json'), {}) : undefined,
    switches: secrets ? new ConnectorSwitches(join(storage.directory, 'switches.json')) : undefined });
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
