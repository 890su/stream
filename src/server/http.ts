import { createServer } from 'node:http';
import { timingSafeEqual, createHash } from 'node:crypto';
import type { JournalStore } from '../store/store.ts';
import { captureConfig, tagConfig, telegramConfig } from '../config.ts';
import { HttpError } from './errors.ts';
import { json } from './body.ts';
import { events } from './events.ts';
import { media } from './media.ts';
import { share } from './share.ts';
import { phone } from './phone.ts';
import { gateway } from './gateway.ts';
import { system, watchSilence } from './system.ts';
import { staticFile } from './static.ts';
import { LiveFeed } from './live.ts';

const bearer = (value: string) => createHash('sha256').update(`Bearer ${value}`).digest();

// phoneToken (optional) opens only /api/phone/*: the Android companion never holds the owner token.
// gatewayTokens (optional) — one per Telegram account; each opens only /api/gateway/telegram/<account>/*.
export function createApp({ store, ownerToken, phoneToken, gatewayTokens = {} }: { store: JournalStore; ownerToken: string; phoneToken?: string; gatewayTokens?: Record<string, string> }) {
  if (!ownerToken || ownerToken.length < captureConfig.min_owner_token_length) throw new Error(`STREAM_OWNER_TOKEN должен содержать минимум ${captureConfig.min_owner_token_length} символа`);
  if (phoneToken !== undefined && phoneToken.length < captureConfig.min_owner_token_length) throw new Error(`STREAM_PHONE_TOKEN должен содержать минимум ${captureConfig.min_owner_token_length} символа`);
  const expected = bearer(ownerToken);
  const expectedPhone = phoneToken === undefined ? undefined : bearer(phoneToken);
  for (const [account, value] of Object.entries(gatewayTokens)) {
    if (value.length < captureConfig.min_owner_token_length) throw new Error(`Токен шлюза ${account} должен содержать минимум ${captureConfig.min_owner_token_length} символа`);
  }
  const expectedGateway = new Map(Object.entries(gatewayTokens).map(([account, value]) => [account, bearer(value)]));
  const live = new LiveFeed();
  const server = createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    try {
      const url = new URL(request.url ?? '/', 'http://localhost');
      if (url.pathname.startsWith('/api/') || (url.pathname === '/share-target' && request.method === 'POST')) {
        const actual = createHash('sha256').update(request.headers.authorization ?? '').digest();
        const isPhonePath = url.pathname.startsWith('/api/phone/');
        const owner = timingSafeEqual(expected, actual);
        const phoneAllowed = isPhonePath && expectedPhone !== undefined && timingSafeEqual(expectedPhone, actual);
        const gatewayPath = /^\/api\/gateway\/telegram\/([a-z]{2,8})\/(.+)$/.exec(url.pathname);
        const gatewayToken = gatewayPath && expectedGateway.get(gatewayPath[1]!);
        const gatewayAllowed = Boolean(gatewayToken && timingSafeEqual(gatewayToken, actual));
        if (!owner && !phoneAllowed && !gatewayAllowed) { response.setHeader('WWW-Authenticate', 'Bearer'); throw new HttpError(401, isPhonePath ? 'Проверьте токен телефона' : gatewayPath ? 'Проверьте токен шлюза' : 'Введите токен владельца в настройках'); }
        if (isPhonePath) return await phone(request, response, url.pathname.slice('/api/phone/'.length), store, live);
        if (gatewayPath) return await gateway(request, response, gatewayPath[1]!, gatewayPath[2]!, store, live);
        if (url.pathname === '/api/system' || url.pathname.startsWith('/api/actions/')) return await system(request, response, url.pathname.slice('/api/'.length), store, live);
        if (url.pathname === '/api/live' && request.method === 'GET') return live.subscribe(request, response);
        if (url.pathname === '/api/events') return await events(request, response, url, store, live);
        if (url.pathname.startsWith('/api/media/')) return await media(request, response, url.pathname.slice('/api/media/'.length), store);
        if (url.pathname === '/share-target') return await share(request, response, store, live);
        throw new HttpError(404, 'Маршрут не найден');
      }
      if (request.method !== 'GET') throw new HttpError(405, 'Метод не поддерживается');
      if (url.pathname === '/healthz') { json(response, 200, { ok: true }); return; }
      if (url.pathname === '/capture-config.json') {
        const telegram = { accounts: Object.fromEntries(Object.entries(telegramConfig.accounts).map(([key, account]) => [key, { title: account.title, connector: account.connector }])) };
        json(response, 200, { ...captureConfig, tagging: tagConfig, telegram }); return;
      }
      const file = await staticFile(url.pathname);
      if (!file) throw new HttpError(404, 'Страница не найдена');
      response.writeHead(200, file.headers); response.end(file.body);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      if (status === 500) console.error('Request failed', error instanceof Error ? error.message : 'Unknown error');
      json(response, status, { error: status === 500 ? 'Ошибка сервера. Запись останется в очереди' : (error as Error).message });
    }
  });
  const stopWatching = watchSilence(store, live);
  server.on('close', stopWatching);
  return server;
}
