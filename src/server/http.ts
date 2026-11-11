import { createServer } from 'node:http';
import { timingSafeEqual, createHash } from 'node:crypto';
import type { JournalStore } from '../store/store.ts';
import { captureConfig } from '../config.ts';
import { HttpError } from './errors.ts';
import { json } from './body.ts';
import { events } from './events.ts';
import { media } from './media.ts';
import { share } from './share.ts';
import { staticFile } from './static.ts';
import { LiveFeed } from './live.ts';

export function createApp({ store, ownerToken }: { store: JournalStore; ownerToken: string }) {
  if (!ownerToken || ownerToken.length < captureConfig.min_owner_token_length) throw new Error(`STREAM_OWNER_TOKEN должен содержать минимум ${captureConfig.min_owner_token_length} символа`);
  const expected = createHash('sha256').update(`Bearer ${ownerToken}`).digest();
  const live = new LiveFeed();
  return createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    try {
      const url = new URL(request.url ?? '/', 'http://localhost');
      if (url.pathname.startsWith('/api/') || (url.pathname === '/share-target' && request.method === 'POST')) {
        const actual = createHash('sha256').update(request.headers.authorization ?? '').digest();
        if (!timingSafeEqual(expected, actual)) { response.setHeader('WWW-Authenticate', 'Bearer'); throw new HttpError(401, 'Введите токен владельца в настройках'); }
        if (url.pathname === '/api/live' && request.method === 'GET') return live.subscribe(request, response);
        if (url.pathname === '/api/events') return await events(request, response, url, store, live);
        if (url.pathname.startsWith('/api/media/')) return await media(request, response, url.pathname.slice('/api/media/'.length), store);
        if (url.pathname === '/share-target') return await share(request, response, store, live);
        throw new HttpError(404, 'Маршрут не найден');
      }
      if (request.method !== 'GET') throw new HttpError(405, 'Метод не поддерживается');
      if (url.pathname === '/healthz') { json(response, 200, { ok: true }); return; }
      if (url.pathname === '/capture-config.json') { json(response, 200, captureConfig); return; }
      const file = await staticFile(url.pathname);
      if (!file) throw new HttpError(404, 'Страница не найдена');
      response.writeHead(200, file.headers); response.end(file.body);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      if (status === 500) console.error('Request failed', error instanceof Error ? error.message : 'Unknown error');
      json(response, status, { error: status === 500 ? 'Ошибка сервера. Запись останется в очереди' : (error as Error).message });
    }
  });
}
