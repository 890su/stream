// HTTP server: auth (owner and phone tokens), routing to API modules, static files, background workers.
import { createServer } from 'node:http';
import { timingSafeEqual, createHash } from 'node:crypto';
import { join } from 'node:path';
import type { JournalStore } from '../store/store.ts';
import { captureConfig, tagConfig, telegramConfig, tasksConfig, conversationsConfig, filtersConfig, pulseConfig, whatsappConfig } from '../config.ts';
import { HttpError } from './errors.ts';
import { json } from './body.ts';
import { events } from './events.ts';
import { media } from './media.ts';
import { share } from './share.ts';
import { phone } from './phone.ts';
import { viber } from './viber.ts';
import { TelegramBot } from '../telegram/bot.ts';
import { WhatsAppClient } from '../whatsapp/client.ts';
import type { SocketFactory } from '../whatsapp/types.ts';
import { whatsappQr } from './whatsapp.ts';
import { Triage } from '../tasks/triage.ts';
import type { Namer } from '../tasks/namer.ts';
import type { Planner } from '../tasks/planner.ts';
import { system, watchSilence } from './system.ts';
import { staticFile } from './static.ts';
import { LiveFeed } from './live.ts';
import { createGoogle, type GoogleOptions } from './google.ts';

const bearer = (value: string) => createHash('sha256').update(`Bearer ${value}`).digest();

// phoneToken (optional) opens only /api/phone/*: the Android companion never holds the owner token.
// viberToken (optional) opens only /api/viber/*: the Viber bridge on the agent desktop (deploy/DESKTOP.md).
// telegram.tokens (optional) — one bot token per Telegram account (CONCEPT.md §8.2); the bots run in this process.
// triage (optional) — the task triage (CONCEPT.md §2.8); planner null keeps it off and says why on the System screen.
// whatsapp (optional) — WhatsApp accounts as linked devices in this process (deploy/WHATSAPP.md); session keys in
// <authRoot>/<account>; `factory` replaces Baileys in tests.
// google — the Google Calendar connector (deploy/GOOGLE.md): the owner's Google client, tokens in `dir`; `fetch` in tests.
export function createApp({ store, ownerToken, phoneToken, viberToken, telegram, triage, whatsapp, google }: {
  store: JournalStore; ownerToken: string; phoneToken?: string; viberToken?: string; telegram?: { tokens: Record<string, string>; apiBase?: string };
  triage?: { planner: Planner | null; namer?: Namer | null; reason?: string; everyMs?: number };
  whatsapp?: { accounts: string[]; authRoot: string; factory?: SocketFactory; retryMs?: number };
  google?: GoogleOptions;
}) {
  if (!ownerToken || ownerToken.length < captureConfig.min_owner_token_length) throw new Error(`STREAM_OWNER_TOKEN должен содержать минимум ${captureConfig.min_owner_token_length} символа`);
  if (phoneToken !== undefined && phoneToken.length < captureConfig.min_owner_token_length) throw new Error(`STREAM_PHONE_TOKEN должен содержать минимум ${captureConfig.min_owner_token_length} символа`);
  const expected = bearer(ownerToken);
  if (viberToken !== undefined && viberToken.length < captureConfig.min_owner_token_length) throw new Error(`STREAM_VIBER_TOKEN должен содержать минимум ${captureConfig.min_owner_token_length} символа`);
  const expectedPhone = phoneToken === undefined ? undefined : bearer(phoneToken);
  const expectedViber = viberToken === undefined ? undefined : bearer(viberToken);
  const live = new LiveFeed();
  const googleConnector = google ? createGoogle({ store, live, ownerToken, options: google }) : null;
  const server = createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    try {
      const url = new URL(request.url ?? '/', 'http://localhost');
      // Google's redirect back after the sign-in carries no owner token: a signed state instead (src/server/google.ts).
      if (url.pathname === '/api/google/callback' && request.method === 'GET') {
        if (!googleConnector) throw new HttpError(409, 'Google не настроен');
        return await googleConnector.callback(response, url);
      }
      if (url.pathname.startsWith('/api/') || (url.pathname === '/share-target' && request.method === 'POST')) {
        const actual = createHash('sha256').update(request.headers.authorization ?? '').digest();
        const isPhonePath = url.pathname.startsWith('/api/phone/');
        const owner = timingSafeEqual(expected, actual);
        const isViberPath = url.pathname.startsWith('/api/viber/');
        const phoneAllowed = isPhonePath && expectedPhone !== undefined && timingSafeEqual(expectedPhone, actual);
        const viberAllowed = isViberPath && expectedViber !== undefined && timingSafeEqual(expectedViber, actual);
        if (!owner && !phoneAllowed && !viberAllowed) {
          response.setHeader('WWW-Authenticate', 'Bearer');
          throw new HttpError(401, isPhonePath ? 'Проверьте токен телефона' : isViberPath ? 'Проверьте токен моста Viber' : 'Введите токен владельца в настройках');
        }
        if (isPhonePath) return await phone(request, response, url.pathname.slice('/api/phone/'.length), store, live);
        if (isViberPath) return await viber(request, response, url.pathname.slice('/api/viber/'.length), store, live);
        if (url.pathname === '/api/system' || url.pathname.startsWith('/api/actions/') || url.pathname.startsWith('/api/telegram/')) {
          return await system(request, response, url.pathname.slice('/api/'.length), store, live, bots);
        }
        if (url.pathname === '/api/live' && request.method === 'GET') return live.subscribe(request, response);
        if (url.pathname === '/api/calendar' || url.pathname.startsWith('/api/google/')) {
          if (googleConnector && await googleConnector.route(request, response, url)) return;
          if (url.pathname === '/api/calendar') { json(response, 200, { configured: false, accounts: [], calendars: [], events: [] }); return; }
          if (url.pathname === '/api/google/connect') throw new HttpError(409, 'Google не настроен: нет STREAM_GOOGLE_CLIENT_ID и STREAM_GOOGLE_CLIENT_SECRET в /srv/stream/.env (deploy/GOOGLE.md)');
        }
        if (url.pathname === '/api/recipients' && request.method === 'GET') { json(response, 200, { recipients: store.recipients.list() }); return; }
        if (url.pathname === '/api/events') return await events(request, response, url, store, live);
        // Long-lived records whole — people, counterparties, projects, task changes and triage results: a new device needs all of them,
        // not just the latest feed page (messages stay paged).
        if (url.pathname === '/api/directory' && request.method === 'GET') {
          json(response, 200, { events: [...store.triage.contactEvents(), ...store.triage.projectEvents(), ...store.triage.taskEvents(), ...store.triage.results()] }); return;
        }
        if (url.pathname.startsWith('/api/media/')) return await media(request, response, url.pathname.slice('/api/media/'.length), store);
        const qr = /^\/api\/whatsapp\/([a-z]{2,8})\/qr$/.exec(url.pathname);
        if (qr && request.method === 'GET') return await whatsappQr(response, whatsappClients.find((client) => client.account === qr[1]));
        if (url.pathname === '/share-target') return await share(request, response, store, live);
        throw new HttpError(404, 'Маршрут не найден');
      }
      if (request.method !== 'GET') throw new HttpError(405, 'Метод не поддерживается');
      if (url.pathname === '/healthz') { json(response, 200, { ok: true }); return; }
      if (url.pathname === '/capture-config.json') {
        const telegram = { accounts: Object.fromEntries(Object.entries(telegramConfig.accounts).map(([key, account]) => [key, { title: account.title, connector: account.connector }])), address_book: telegramConfig.address_book };
        json(response, 200, { ...captureConfig, tagging: tagConfig, conversations: conversationsConfig, filters: filtersConfig.filters, pulse: pulseConfig, telegram, tasks: { filed_templates: tasksConfig.templates.filter((template) => template.filed).map((template) => template.name),
          card: tasksConfig.card, report_fields: tasksConfig.report_fields, report_default: tasksConfig.report_default, currencies: tasksConfig.currencies,
          reports: Object.fromEntries(tasksConfig.templates.filter((template) => template.report).map((template) => [template.name, template.report])) } }); return;
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
  // Baileys is loaded only when a WhatsApp account is on (and never in tests, which pass a fake socket).
  const socketFactory: SocketFactory = whatsapp?.factory ?? (async (dir) => (await import('../whatsapp/socket.ts')).createSocket(dir));
  const whatsappClients = (whatsapp?.accounts ?? []).filter((account) => whatsappConfig.accounts[account])
    .map((account) => new WhatsAppClient({ account, store, live, authDir: join(whatsapp!.authRoot, account), factory: socketFactory, retryMs: whatsapp?.retryMs }));
  const triageWorker = triage ? new Triage({ store, live, planner: triage.planner, namer: triage.namer ?? null, reason: triage.reason }) : null;
  server.on('listening', () => {
    for (const bot of bots) void bot.start();
    for (const client of whatsappClients) client.start().catch((error) => console.error(`WhatsApp ${client.account}: start failed`, error instanceof Error ? error.message : error));
    triageWorker?.start(triage?.everyMs);
    googleConnector?.start();
  });
  server.on('close', () => { stopWatching(); for (const bot of bots) bot.stop(); for (const client of whatsappClients) client.stop(); triageWorker?.stop(); googleConnector?.stop(); });
  return server;
}
