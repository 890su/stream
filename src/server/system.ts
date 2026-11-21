import type { IncomingMessage, ServerResponse } from 'node:http';
import type { JournalStore } from '../store/store.ts';
import type { SourceState } from '../store/status.ts';
import type { Action } from '../store/actions.ts';
import { telegramConfig, whatsappConfig } from '../config.ts';
import { CONNECTORS } from '../switches.ts';
import { nameId } from '../ids.ts';
import { HttpError } from './errors.ts';
import { json } from './body.ts';
import type { LiveFeed } from './live.ts';
import type { TelegramBot } from '../telegram/bot.ts';
import { readBody } from './body.ts';

// The System screen (CONCEPT.md §5): what works without the owner, its state and its actions.
// State transitions become `system` events in the feed; the pulse itself stays out of the journal.

const STATE_TEXT: Record<SourceState, string> = { ok: 'работает', silent: 'молчит', login_required: 'нужен вход', error: 'ошибка' };

export function sourceTitle(source: string): string {
  const account = Object.values(telegramConfig.accounts).find((item) => item.connector === source)
    ?? Object.values(whatsappConfig.accounts).find((item) => item.connector === source);
  if (account) return account.title;
  return source === 'android_phone' ? 'Телефон (звонки и SMS)' : source === 'ai_triage' ? 'Разбор задач (ИИ)' : source === 'viber' ? 'Viber' : source === 'google_calendar' ? 'Google Календарь' : source;
}

export function stateChanged(store: JournalStore, live: LiveFeed, source: string, state: SourceState, previous: SourceState | 'unknown', detail: string | null): void {
  if (state === previous || (previous === 'unknown' && state === 'ok')) return;
  const at = new Date().toISOString();
  const words = previous !== 'unknown' && previous !== 'ok' && state === 'ok' ? 'снова работает' : STATE_TEXT[state];
  const result = store.appendEvent({
    id: nameId(`system|${source}|${state}|${at}`), schema_version: 1, source: 'system', author: 'system', ts: at, kind: 'system',
    payload: { text: `${sourceTitle(source)}: ${words}${detail && state !== 'ok' ? ` — ${detail}` : ''}`, data: { system: { source, state, previous } } },
  });
  if (result.created) live.publish(result.event);
}

// Every change of an action is also an action_result event: the reply bubble shows «✓ в Telegram» from it.
export function actionChanged(store: JournalStore, live: LiveFeed, action: Action): void {
  const data: Record<string, string> = { status: action.status, connector: action.connector };
  if (action.source_event) data.source_event = action.source_event;
  if (action.external_id) data.external_id = action.external_id;
  if (action.error) data.error = action.error;
  const result = store.appendEvent({
    id: nameId(`action_result|${action.id}|${action.status}|${action.updated_at}`), schema_version: 1, source: 'system', author: 'system',
    ts: action.updated_at, kind: 'action_result', payload: { ref: { type: 'action', id: action.id }, data: { action: data } },
  });
  if (result.created) live.publish(result.event);
}

// `off()` — connections switched off on the System screen: not marked silent (they are quiet on purpose).
export function watchSilence(store: JournalStore, live: LiveFeed, off: () => string[] = () => []): () => void {
  const timer = setInterval(() => {
    try {
      const before = new Date(Date.now() - telegramConfig.silent_after_s * 1000).toISOString();
      for (const { source, previous } of store.status.markSilent(before, off())) stateChanged(store, live, source, 'silent', previous, null);
    } catch (error) { console.error('Silence check failed', error instanceof Error ? error.message : error); }
  }, 30_000);
  timer.unref();
  return () => clearInterval(timer);
}

// The System screen's data: every connection (CONNECTORS) with its state — 'off' when switched off there — and `on`.
export async function system(request: IncomingMessage, response: ServerResponse, path: string, store: JournalStore, live: LiveFeed,
  { bots = [], isOn = () => true }: { bots?: TelegramBot[]; isOn?: (id: string) => boolean } = {}): Promise<void> {
  if (path === 'system' && request.method === 'GET') {
    const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
    const known = new Map(store.status.all().map((item) => [item.source, item]));
    for (const account of Object.values(telegramConfig.accounts)) if (!known.has(account.connector)) {
      known.set(account.connector, { source: account.connector, state: 'unset' as never, detail: 'нет токена бота — откройте карточку и введите токен из @BotFather', pulse_at: null, last_event_at: null, info: null });
    }
    // A connection never heard from is not set up yet ('unset'), not silent: nothing to worry about, just to do.
    for (const id of CONNECTORS) if (!known.has(id)) known.set(id, { source: id, state: 'unset' as never, detail: null, pulse_at: null, last_event_at: null, info: null });
    const sources = [...known.values()].map((item) => ({ ...item, state: isOn(item.source) ? item.state : 'off', on: isOn(item.source),
      title: sourceTitle(item.source), failed_24h: store.actions.failedSince(item.source, dayAgo) }));
    const telegram = {
      bots: Object.fromEntries(bots.map((bot) => [bot.account, bot.username])),
      connections: store.connections.list(), groups: store.connections.groups(),
    };
    json(response, 200, { sources, actions: store.actions.recent(30), exclusions: store.telegram.exclusions(), telegram });
    return;
  }
  // The owner's decision on an account connected to a bot: trusted — its chats are read and answered.
  if (path === 'telegram/trust' && request.method === 'POST') {
    let body: { account?: unknown; user_id?: unknown; trusted?: unknown };
    try { body = JSON.parse((await readBody(request, 4096)).toString('utf8')); } catch { throw new HttpError(400, 'Некорректный JSON'); }
    if (typeof body.account !== 'string' || !telegramConfig.accounts[body.account] || typeof body.user_id !== 'string' || typeof body.trusted !== 'boolean') {
      throw new HttpError(400, 'Нужны account, user_id и trusted');
    }
    store.connections.decide(body.account, body.user_id, body.trusted);
    response.writeHead(204, { 'Cache-Control': 'no-store' }).end();
    return;
  }
  const retry = /^actions\/([0-9a-f-]{36})\/retry$/.exec(path);
  if (retry && request.method === 'POST') {
    const action = store.actions.retry(retry[1]!);
    actionChanged(store, live, action);
    json(response, 200, action);
    return;
  }
  throw new HttpError(404, 'Маршрут не найден');
}
