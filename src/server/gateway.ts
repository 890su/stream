import type { IncomingMessage, ServerResponse } from 'node:http';
import type { JournalStore } from '../store/store.ts';
import type { JournalEvent, MediaRef } from '../contracts/validate.ts';
import { captureConfig, telegramConfig } from '../config.ts';
import { nameId } from '../ids.ts';
import { HttpError } from './errors.ts';
import { json, readBody } from './body.ts';
import type { LiveFeed } from './live.ts';
import { actionChanged, stateChanged } from './system.ts';

// Telegram account gateways (CONCEPT.md §8.2, docs/plans/2026-11-17-p11-telegram.md). A gateway is blind
// (rule 6): it posts what Telegram gives, picks up approved replies and reports results. All journal
// decisions — ids, authors, replies, forwards, echoes — are made here.

type Body = Record<string, unknown>;
const KINDS = ['text', 'voice', 'photo', 'file'];
const ID = /^-?[0-9]{1,20}$/;

async function readJson(request: IncomingMessage, limit = captureConfig.max_event_bytes): Promise<Body> {
  let value: unknown;
  try { value = JSON.parse((await readBody(request, limit)).toString('utf8')); }
  catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, 'Некорректный JSON'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'Ожидается объект JSON');
  return value as Body;
}

const messageEventId = (account: string, chatId: string, messageId: number) => nameId(`tg|${account}|${chatId}|${messageId}`);
const iso = (value: unknown, field: string) => {
  const ms = typeof value === 'string' ? Date.parse(value) : NaN;
  if (!Number.isFinite(ms)) throw new HttpError(400, `${field} — некорректное время`);
  return new Date(ms).toISOString();
};
const id = (value: unknown, field: string) => {
  if (typeof value !== 'string' || !ID.test(value)) throw new HttpError(400, `${field} — некорректный id Telegram`);
  return value;
};
const str = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : undefined;
const positive = (value: unknown) => Number.isSafeInteger(value) && (value as number) > 0 ? value as number : undefined;
const compact = <T extends Record<string, unknown>>(object: T) => Object.fromEntries(Object.entries(object).filter(([, v]) => v !== undefined)) as T;

type Outcome = { message_id: number; status: 'created' | 'exists' | 'skipped' | 'echo'; id?: string };

function author(account: string, message: Body, chatId: string): string {
  return message.out === true ? 'me' : `contact:tg:${account}:${str(message.from_id) ?? chatId}`;
}

function edit(account: string, message: Body, chatId: string, messageId: number, store: JournalStore): JournalEvent | Outcome {
  const target = store.getEvent(messageEventId(account, chatId, messageId));
  const text = typeof message.text === 'string' ? message.text : '';
  // Only messages already in the journal are corrected; an unchanged text is not an edit worth recording.
  if (!target || !text.trim() || text === target.payload.text) return { message_id: messageId, status: 'skipped' };
  const at = iso(message.edit_date, 'edit_date');
  return {
    id: nameId(`tg-edit|${account}|${chatId}|${messageId}|${at}`), schema_version: 1, source: 'telegram', author: target.author, ts: at,
    kind: 'correction', payload: { ref: { type: 'event', id: target.id }, text, ...(target.payload.tags ? { tags: target.payload.tags } : {}), data: { op: 'edit', origin: 'telegram' } },
  };
}

function message(account: string, body: Body, store: JournalStore): JournalEvent | Outcome {
  const chatId = id(body.chat_id, 'chat_id');
  const messageId = positive(body.message_id);
  if (!messageId) throw new HttpError(400, 'message_id — положительное целое');
  if (body.edit_date !== undefined) return edit(account, body, chatId, messageId, store);
  const connector = telegramConfig.accounts[account]!.connector;
  if (body.out === true) {
    // The gateway's own reply coming back from Telegram: it is already in the feed as the owner's message.
    const sent = store.actions.byExternal(connector, `${chatId}:${messageId}`);
    if (sent) return { message_id: messageId, status: 'echo', id: sent.source_event ?? undefined };
  }
  const kind = typeof body.kind === 'string' && KINDS.includes(body.kind) ? body.kind : 'text';
  const text = typeof body.text === 'string' ? body.text : '';
  const media = Array.isArray(body.media) ? body.media as MediaRef[] : [];
  const skipped = body.media_skipped && typeof body.media_skipped === 'object' ? body.media_skipped as Record<string, unknown> : undefined;
  if (!text.trim() && !media.length && !skipped) return { message_id: messageId, status: 'skipped' };
  const sentAt = iso(body.date, 'date');
  const chatType = body.chat_type === 'group' ? 'group' : 'private';
  const forward = body.forward && typeof body.forward === 'object' ? body.forward as Body : undefined;
  const telegram = compact({
    account, chat_id: chatId, chat_type: chatType, chat_title: str(body.chat_title), from_id: body.from_id === undefined ? undefined : id(body.from_id, 'from_id'),
    from_name: str(body.from_name), message_id: messageId, sent_at: sentAt, reply_to_message_id: positive(body.reply_to_message_id),
    album_id: body.album_id === undefined ? undefined : id(body.album_id, 'album_id'),
    forward: forward && compact({ from_id: forward.from_id === undefined ? undefined : id(forward.from_id, 'forward.from_id'), from_name: str(forward.from_name), date: iso(forward.date, 'forward.date') }),
    media_skipped: skipped && compact({ reason: skipped.reason, mime: str(skipped.mime), size_bytes: skipped.size_bytes, name: str(skipped.name) }),
  });
  const data: Record<string, unknown> = { telegram };
  // A forward of a message already in the journal continues it: a request passed on to a contractor
  // stays in the request's topic. Telegram gives the original author and time, not its message id.
  const origin = forward?.from_id && store.telegram.forwardOrigin(forward.from_id as string, telegram.forward!.date, chatId);
  if (origin) data.continuation = { target: origin, on: true };
  // An album arrives as several messages: each part continues the first one.
  else if (telegram.album_id && body.album_first !== undefined) {
    const first = positive(body.album_first);
    if (first && first !== messageId && store.getEvent(messageEventId(account, chatId, first))) data.continuation = { target: messageEventId(account, chatId, first), on: true };
  }
  const replyTarget = telegram.reply_to_message_id && store.getEvent(messageEventId(account, chatId, telegram.reply_to_message_id));
  return {
    id: messageEventId(account, chatId, messageId), schema_version: 1, source: 'telegram', author: author(account, body, chatId), ts: sentAt, kind,
    payload: compact({ text: text || undefined, media: media.length ? media : undefined, data }),
    reply_to: replyTarget ? replyTarget.id : null,
  };
}

function messages(account: string, body: Body, store: JournalStore, live: LiveFeed): Outcome[] {
  if (!Array.isArray(body.messages)) throw new HttpError(400, 'Ожидается messages: []');
  const outcomes: Outcome[] = [];
  for (const item of body.messages as Body[]) {
    if (!item || typeof item !== 'object') throw new HttpError(400, 'Сообщение — объект');
    const built = message(account, item, store);
    if (!('schema_version' in built)) { outcomes.push(built); continue; }
    try {
      const result = store.appendEvent(built);
      if (result.created) live.publish(result.event);
      outcomes.push({ message_id: item.message_id as number, status: result.created ? 'created' : 'exists', id: built.id });
    } catch (error) {
      // A retry after a chat rename differs in chat_title: the message is in the journal already.
      if (error instanceof HttpError && error.status === 409) { outcomes.push({ message_id: item.message_id as number, status: 'exists', id: built.id }); continue; }
      throw error;
    }
  }
  if (outcomes.some((item) => item.status === 'created')) store.status.seen(telegramConfig.accounts[account]!.connector, new Date().toISOString());
  return outcomes;
}

async function waitForActions(request: IncomingMessage, store: JournalStore, connector: string, seconds: number) {
  const deadline = Date.now() + Math.min(Math.max(seconds, 0), telegramConfig.actions_wait_s) * 1000;
  let closed = false;
  request.once('close', () => { closed = true; });
  while (!closed && Date.now() < deadline && !store.actions.hasWork(connector)) await new Promise((resolve) => setTimeout(resolve, 500));
  return store.actions.claim(connector).map(({ id, operation, params }) => ({ id, operation, params }));
}

export async function gateway(request: IncomingMessage, response: ServerResponse, account: string, path: string, store: JournalStore, live: LiveFeed): Promise<void> {
  const settings = telegramConfig.accounts[account];
  if (!settings) throw new HttpError(404, 'Неизвестный аккаунт');
  const connector = settings.connector;
  if (path === 'config' && request.method === 'GET') {
    json(response, 200, {
      account, title: settings.title, timezone: settings.timezone, folder: telegramConfig.folder,
      excluded: store.telegram.exclusions(account).map((item) => item.chat_id),
      media_max_bytes: Math.min(telegramConfig.media_max_bytes, captureConfig.max_media_bytes), mime_types: captureConfig.mime_types,
      backfill_max_per_chat: telegramConfig.backfill_max_per_chat, pulse_every_s: telegramConfig.pulse_every_s,
      actions_wait_s: telegramConfig.actions_wait_s, config_poll_s: telegramConfig.config_poll_s,
    });
    return;
  }
  if (path === 'messages' && request.method === 'POST') { json(response, 200, { results: messages(account, await readJson(request), store, live) }); return; }
  const mediaMatch = /^media\/([a-f0-9]{64})$/.exec(path);
  if (mediaMatch && request.method === 'PUT') {
    const result = store.putMedia(mediaMatch[1]!, request.headers['content-type'] ?? 'application/octet-stream', await readBody(request, captureConfig.max_media_bytes));
    const { path: _path, ...metadata } = result.media;
    json(response, result.created ? 201 : 200, metadata);
    return;
  }
  if (path === 'actions' && request.method === 'GET') {
    const wait = Number(new URL(request.url ?? '', 'http://localhost').searchParams.get('wait') ?? 0);
    json(response, 200, { actions: await waitForActions(request, store, connector, Number.isFinite(wait) ? wait : 0) });
    return;
  }
  const resultMatch = /^actions\/([0-9a-f-]{36})\/result$/.exec(path);
  if (resultMatch && request.method === 'POST') {
    const body = await readJson(request);
    if (body.status !== 'done' && body.status !== 'failed') throw new HttpError(400, 'status — done или failed');
    const action = store.actions.get(resultMatch[1]!);
    const chatId = action?.params.chat_id;
    const messageId = positive(body.message_id);
    const external = body.status === 'done' && messageId && typeof chatId === 'string' ? `${chatId}:${messageId}` : null;
    const error = body.status === 'failed' ? (str(body.error) ?? 'Не отправлено').slice(0, 300) : null;
    const { action: finished, changed } = store.actions.finish(resultMatch[1]!, connector, body.status, external, error);
    if (changed) actionChanged(store, live, finished);
    json(response, 200, { id: finished.id, status: finished.status });
    return;
  }
  if (path === 'pulse' && request.method === 'POST') {
    const body = await readJson(request);
    const state = (['ok', 'login_required', 'error'] as const).find((value) => value === body.state);
    if (!state) throw new HttpError(400, 'state — ok, login_required или error');
    const detail = str(body.detail)?.slice(0, 300) ?? null;
    const info = body.info && typeof body.info === 'object' && !Array.isArray(body.info) ? body.info as Record<string, unknown> : null;
    const previous = store.status.pulse(connector, state, detail, info, new Date().toISOString());
    stateChanged(store, live, connector, state, previous, detail);
    response.writeHead(204, { 'Cache-Control': 'no-store' }).end();
    return;
  }
  throw new HttpError(404, 'Маршрут не найден');
}
