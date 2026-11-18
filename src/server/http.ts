// HTTP server: auth (owner and phone tokens), routing to API modules, static files, background workers.
import { createServer } from 'node:http';
import { timingSafeEqual, createHash } from 'node:crypto';
import type { JournalStore } from '../store/store.ts';
import { captureConfig, tagConfig, telegramConfig, tasksConfig } from '../config.ts';
import { HttpError } from './errors.ts';
import { json } from './body.ts';
import { events } from './events.ts';
import { media } from './media.ts';
import { share } from './share.ts';
import { phone } from './phone.ts';
import { TelegramBot } from '../telegram/bot.ts';
import { Triage } from '../tasks/triage.ts';
import type { Planner } from '../tasks/planner.ts';
import { system, watchSilence } from './system.ts';
import { staticFile } from './static.ts';
import { LiveFeed } from './live.ts';

const bearer = (value: string) => createHash('sha256').update(`Bearer ${value}`).digest();

// phoneToken (optional) opens only /api/phone/*: the Android companion never holds the owner token.
// telegram.tokens (optional) — one bot token per Telegram account (CONCEPT.md §8.2); the bots run in this process.
// triage (optional) — the task triage (CONCEPT.md §2.8); planner null keeps it off and says why on the System screen.
export function createApp({ store, ownerToken, phoneToken, telegram, triage }: {
  store: JournalStore; ownerToken: string; phoneToken?: string; telegram?: { tokens: Record<string, string>; apiBase?: string };
  triage?: { planner: Planner | null; reason?: string; everyMs?: number };
}) {
  if (!ownerToken || ownerToken.length < captureConfig.min_owner_token_length) throw new Error(`STREAM_OWNER_TOKEN должен содержать минимум ${captureConfig.min_owner_token_length} символа`);
  if (phoneToken !== undefined && phoneToken.length < captureConfig.min_owner_token_length) throw new Error(`STREAM_PHONE_TOKEN должен содержать минимум ${captureConfig.min_owner_token_length} символа`);
  const expected = bearer(ownerToken);
  const expectedPhone = phoneToken === undefined ? undefined : bearer(phoneToken);
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
        if (!owner && !phoneAllowed) { response.setHeader('WWW-Authenticate', 'Bearer'); throw new HttpError(401, isPhonePath ? 'Проверьте токен телефона' : 'Введите токен владельца в настройках'); }
        if (isPhonePath) return await phone(request, response, url.pathname.slice('/api/phone/'.length), store, live);
        if (url.pathname === '/api/system' || url.pathname.startsWith('/api/actions/') || url.pathname.startsWith('/api/telegram/')) {
          return await system(request, response, url.pathname.slice('/api/'.length), store, live, bots);
        }
        if (url.pathname === '/api/live' && request.method === 'GET') return live.subscribe(request, response);
        if (url.pathname === '/api/recipients' && request.method === 'GET') { json(response, 200, { recipients: store.recipients.list() }); return; }
        if (url.pathname === '/api/events') return await events(request, response, url, store, live);
        if (url.pathname.startsWith('/api/media/')) return await media(request, response, url.pathname.slice('/api/media/'.length), store);
        if (url.pathname === '/share-target') return await share(request, response, store, live);
        throw new HttpError(404, 'Маршрут не найден');
      }
      if (request.method !== 'GET') throw new HttpError(405, 'Метод не поддерживается');
      if (url.pathname === '/healthz') { json(response, 200, { ok: true }); return; }
      if (url.pathname === '/capture-config.json') {
        const telegram = { accounts: Object.fromEntries(Object.entries(telegramConfig.accounts).map(([key, account]) => [key, { title: account.title, connector: account.connector }])), address_book: telegramConfig.address_book };
        json(response, 200, { ...captureConfig, tagging: tagConfig, telegram, tasks: { done_fade_days: tasksConfig.done_fade_days, fresh_h: tasksConfig.fresh_h, expand_last: tasksConfig.expand_last } }); return;
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
  const bots = Object.entries(telegram?.tokens ?? {}).filter(([account, token]) => token && telegramConfig.accounts[account])
    .map(([account, token]) => new TelegramBot({ account, token, store, live, apiBase: telegram?.apiBase }));
  const triageWorker = triage ? new Triage({ store, live, planner: triage.planner, reason: triage.reason }) : null;
  server.on('listening', () => { for (const bot of bots) void bot.start(); triageWorker?.start(triage?.everyMs); });
  server.on('close', () => { stopWatching(); for (const bot of bots) bot.stop(); triageWorker?.stop(); });
  return server;
}
