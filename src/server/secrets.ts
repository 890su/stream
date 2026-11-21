import type { IncomingMessage, ServerResponse } from 'node:http';
import { SecretStore } from '../secrets.ts';
import { HttpError } from './errors.ts';
import { json, readBody } from './body.ts';

// /api/secrets — the keys on the System screen (src/secrets.ts): GET lists what is set (never a value), PUT
// /api/secrets/<name> { value } sets one, DELETE removes the app's value (the .env one, if any, works again).
export async function secretsRoute(request: IncomingMessage, response: ServerResponse, url: URL, secrets: SecretStore): Promise<void> {
  if (url.pathname === '/api/secrets' && request.method === 'GET') { json(response, 200, { secrets: secrets.describe() }); return; }
  const name = decodeURIComponent(url.pathname.slice('/api/secrets/'.length));
  if (!SecretStore.known(name)) throw new HttpError(404, 'Неизвестный ключ');
  if (request.method === 'PUT') {
    let body: { value?: unknown };
    try { body = JSON.parse((await readBody(request, 4096)).toString('utf8') || '{}'); } catch { throw new HttpError(400, 'Некорректный JSON'); }
    try { secrets.set(name, String(body.value ?? '')); } catch (error) { throw new HttpError(400, (error as Error).message); }
    console.log(`Secrets: ${name} set on the System screen`);
    json(response, 200, { ok: true });
    return;
  }
  if (request.method === 'DELETE') {
    secrets.remove(name);
    console.log(`Secrets: ${name} removed on the System screen`);
    json(response, 200, { ok: true });
    return;
  }
  throw new HttpError(405, 'Метод не поддерживается');
}
