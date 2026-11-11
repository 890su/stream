import type { IncomingMessage, ServerResponse } from 'node:http';
import type { JournalStore } from '../store/store.ts';
import { validateEvent, isDateTime } from '../contracts/validate.ts';
import { captureConfig } from '../config.ts';
import { HttpError } from './errors.ts';
import { json, readBody } from './body.ts';
import type { LiveFeed } from './live.ts';

export async function events(request: IncomingMessage, response: ServerResponse, url: URL, store: JournalStore, live: LiveFeed): Promise<void> {
  if (request.method === 'POST') {
    let input: unknown;
    try { input = JSON.parse((await readBody(request, captureConfig.max_event_bytes)).toString('utf8')); }
    catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, 'Некорректный JSON'); }
    validateEvent(input);
    const result = store.appendEvent(input);
    if (result.created) live.publish(result.event);
    json(response, result.created ? 201 : 200, result.event);
    return;
  }
  if (request.method !== 'GET') throw new HttpError(405, 'Метод не поддерживается');
  const limitText = url.searchParams.get('limit') ?? String(captureConfig.default_page_size);
  const limit = Number(limitText);
  if (!/^\d+$/.test(limitText) || limit < 1 || limit > captureConfig.max_page_size) throw new HttpError(400, 'Некорректный limit');
  const before = url.searchParams.get('before') ?? undefined;
  if (before !== undefined && !isDateTime(before)) throw new HttpError(400, 'Некорректный before');
  json(response, 200, store.listEvents({ before: before === undefined ? undefined : new Date(before).toISOString(), limit }));
}
