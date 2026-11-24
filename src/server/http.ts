// HTTP server: auth (owner and phone tokens), routing to API modules, static files, background workers.
import { createServer } from 'node:http';
import { timingSafeEqual, createHash } from 'node:crypto';
import { join } from 'node:path';
import type { JournalStore } from '../store/store.ts';
import { captureConfig, tagConfig, telegramConfig, tasksConfig, conversationsConfig, filtersConfig, pulseConfig, whatsappConfig } from '../config.ts';
import { HttpError } from './errors.ts';
import { json, readBody } from './body.ts';
import { events } from './events.ts';
import { media } from './media.ts';
import { share } from './share.ts';
import { phone } from './phone.ts';
import { viber } from './viber.ts';
import type { SocketFactory } from '../whatsapp/types.ts';
import { whatsappQr } from './whatsapp.ts';
import { system, watchSilence } from './system.ts';
import { staticFile } from './static.ts';
import { LiveFeed } from './live.ts';
import type { GoogleOptions } from './google.ts';
import type { SecretStore } from '../secrets.ts';
import { secretsRoute } from './secrets.ts';
import { ConnectorSwitches } from '../switches.ts';
import { OwnerSettings } from '../ownersettings.ts';
import { createConnections, type TriageOptions } from './connectors.ts';
import { retriage } from '../tasks/retriage.ts';
import { recheck } from '../tasks/recheck.ts';
import { directiveAdded } from '../tasks/directive.ts';

const bearer = (value: string) => createHash('sha256').update(`Bearer ${value}`).digest();

// phoneToken (optional) opens only /api/phone/*: the Android companion never holds the owner token.
// viberToken (optional) opens only /api/viber/*: the Viber bridge on the agent desktop (deploy/DESKTOP.md).
// telegram.tokens (optional) — one bot token per Telegram account (CONCEPT.md §8.2); the bots run in this process.
// triage (optional) — the task triage (CONCEPT.md §2.8); planner null keeps it off and says why on the System screen.
// whatsapp (optional) — WhatsApp accounts as linked devices in this process (deploy/WHATSAPP.md); session keys in
// <authRoot>/<account>; `factory` replaces Baileys in tests.
// google — the Google Calendar connector (deploy/GOOGLE.md): the owner's Google client, tokens in `dir`; `fetch` in tests.
// secrets (optional) — keys entered on the System screen (src/secrets.ts): the Google client, the bot tokens, the AI
// key, used over .env and applied at once. switches (optional) — connections switched off there (src/switches.ts).
// The connections themselves run in src/server/connectors.ts.
export function createApp({ store, ownerToken, phoneToken, viberToken, telegram, triage, whatsapp, google, secrets, switches, settings, live: liveFeed }: {
  store: JournalStore; ownerToken: string; phoneToken?: string; viberToken?: string; telegram?: { tokens: Record<string, string>; apiBase?: string };
  triage?: TriageOptions;
  whatsapp?: { accounts: string[]; authRoot: string; factory?: SocketFactory; retryMs?: number };
  google?: GoogleOptions;
  secrets?: SecretStore;
  switches?: ConnectorSwitches;
  live?: LiveFeed; // shared with the start-up migration (src/tasks/topicsgone.ts); one is made when absent
  settings?: OwnerSettings; // the owner's settings from the System screen (src/ownersettings.ts)
}) {
  if (!ownerToken || ownerToken.length < captureConfig.min_owner_token_length) throw new Error(`STREAM_OWNER_TOKEN должен содержать минимум ${captureConfig.min_owner_token_length} символа`);
  if (phoneToken !== undefined && phoneToken.length < captureConfig.min_owner_token_length) throw new Error(`STREAM_PHONE_TOKEN должен содержать минимум ${captureConfig.min_owner_token_length} символа`);
  const expected = bearer(ownerToken);
  if (viberToken !== undefined && viberToken.length < captureConfig.min_owner_token_length) throw new Error(`STREAM_VIBER_TOKEN должен содержать минимум ${captureConfig.min_owner_token_length} символа`);
  const expectedPhone = phoneToken === undefined ? undefined : bearer(phoneToken);
  const expectedViber = viberToken === undefined ? undefined : bearer(viberToken);
  const live = liveFeed ?? new LiveFeed();
  const connections = createConnections({ store, live, ownerToken, telegram, whatsapp, triage, google, secrets, switches });
  const { bots, whatsappClients, google: googleConnector } = connections;
  // A channel that sends from a device (the phone, the Viber bridge) switched off answers 503: the device keeps its
  // queue and sends it once the channel is on again (both retry on 5xx).
  const deviceOff = (id: string) => { if (!connections.isOn(id)) throw new HttpError(503, `${id === 'viber' ? 'Viber' : 'Телефон'}: канал выключен на «Системе» — сообщения подождут на устройстве`); };
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
        if (isPhonePath) { deviceOff('android_phone'); return await phone(request, response, url.pathname.slice('/api/phone/'.length), store, live); }
        if (isViberPath) { deviceOff('viber'); return await viber(request, response, url.pathname.slice('/api/viber/'.length), store, live); }
        if (url.pathname === '/api/system' || url.pathname.startsWith('/api/actions/') || url.pathname.startsWith('/api/telegram/')) {
          return await system(request, response, url.pathname.slice('/api/'.length), store, live, { bots, isOn: connections.isOn });
        }
        const toggle = /^\/api\/connectors\/([a-z_]+)$/.exec(url.pathname);
        if (toggle && request.method === 'POST') {
          if (!switches || !ConnectorSwitches.known(toggle[1]!)) throw new HttpError(404, 'Неизвестное подключение');
          let body: { on?: unknown };
          try { body = JSON.parse((await readBody(request, 1024)).toString('utf8') || '{}'); } catch { throw new HttpError(400, 'Некорректный JSON'); }
          if (typeof body.on !== 'boolean') throw new HttpError(400, 'Нужно on: true или false');
          switches.set(toggle[1]!, body.on);
          json(response, 200, { ok: true });
          return;
        }
        // How the AI makes new tasks (design 2026-11-21): «ИИ предлагает — я подтверждаю» or «ИИ создаёт сразу».
        if (url.pathname === '/api/settings/triage-new-tasks' && request.method === 'POST') {
          if (!settings) throw new HttpError(404, 'Настройки недоступны');
          let body: { value?: unknown };
          try { body = JSON.parse((await readBody(request, 1024)).toString('utf8') || '{}'); } catch { throw new HttpError(400, 'Некорректный JSON'); }
          if (!OwnerSettings.isMode(body.value)) throw new HttpError(400, 'Нужно value: unconfirmed или confirmed');
          settings.setTriageNewTasks(body.value);
          json(response, 200, { ok: true });
          return;
        }
        // «✨ Разобрать заново» (src/tasks/retriage.ts): the open conversation's last session goes to the AI again.
        if (url.pathname === '/api/triage/again' && request.method === 'POST') {
          if (!connections.triage || !connections.isOn('ai_triage')) throw new HttpError(409, 'Разбор задач выключен на «Системе»');
          if (!connections.triage.canRun) throw new HttpError(409, 'Нет ключа ИИ — введите его на «Системе» (Разбор задач)');
          let body: { ids?: unknown };
          try { body = JSON.parse((await readBody(request, 64 * 1024)).toString('utf8') || '{}'); } catch { throw new HttpError(400, 'Некорректный JSON'); }
          const ids = Array.isArray(body.ids) ? body.ids.filter((id): id is string => typeof id === 'string').slice(0, 2000) : [];
          if (!ids.length) throw new HttpError(400, 'Нужны ids — сообщения беседы');
          json(response, 200, await retriage({ store, live, triage: connections.triage, ids }));
          return;
        }
        // «✨ Сверить с перепиской» (src/tasks/recheck.ts): the record's conversations to the AI; only proposals come back.
        const recheckOf = /^\/api\/tasks\/([0-9a-f-]{36})\/recheck$/i.exec(url.pathname);
        if (recheckOf && request.method === 'POST') {
          if (!connections.triage || !connections.isOn('ai_triage')) throw new HttpError(409, 'Разбор задач выключен на «Системе»');
          const rechecker = connections.rechecker();
          if (!rechecker) throw new HttpError(409, 'Нет ключа ИИ — введите его на «Системе» (Разбор задач)');
          json(response, 200, await recheck({ store, live, rechecker, taskId: recheckOf[1]!.toLowerCase() }));
          return;
        }
        if (url.pathname === '/api/live' && request.method === 'GET') return live.subscribe(request, response);
        if (url.pathname === '/api/secrets' || url.pathname.startsWith('/api/secrets/')) {
          if (!secrets) throw new HttpError(404, 'Ключи на этом сервере задаются только в .env');
          return await secretsRoute(request, response, url, secrets);
        }
        if (url.pathname === '/api/calendar' || url.pathname.startsWith('/api/google/')) {
          if (googleConnector && await googleConnector.route(request, response, url)) return;
          if (url.pathname === '/api/calendar') { json(response, 200, { configured: false, accounts: [], calendars: [], events: [] }); return; }
          if (url.pathname === '/api/google/connect') throw new HttpError(409, 'Google не настроен: нет STREAM_GOOGLE_CLIENT_ID и STREAM_GOOGLE_CLIENT_SECRET в /srv/stream/.env (deploy/GOOGLE.md)');
        }
        if (url.pathname === '/api/recipients' && request.method === 'GET') { json(response, 200, { recipients: store.recipients.list() }); return; }
        if (url.pathname === '/api/events') return await events(request, response, url, store, live, (event) => {
          // A directive tag on a message already triaged: its session goes to the AI again, without the quiet window.
          const message = connections.triage?.canRun && connections.isOn('ai_triage') ? directiveAdded(store, event) : null;
          if (message) connections.triage!.rerun(message, event.id).catch((error) => console.error('Triage rerun failed', error instanceof Error ? error.message : error));
        });
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
  const stopWatching = watchSilence(store, live, () => switches?.off() ?? []);
  server.on('listening', () => connections.start());
  server.on('close', () => { stopWatching(); connections.stop(); });
  return server;
}
