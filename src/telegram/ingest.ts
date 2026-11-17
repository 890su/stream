import type { JournalStore } from '../store/store.ts';
import type { JournalEvent, MediaRef } from '../contracts/validate.ts';
import { telegramConfig } from '../config.ts';
import { nameId } from '../ids.ts';
import { HttpError } from '../server/errors.ts';
import type { LiveFeed } from '../server/live.ts';

// Telegram messages into the journal (CONCEPT.md §8.2). The bot (bot.ts) turns Bot API updates into plain
// items; here all journal decisions are made — ids, authors, replies, forwards, echoes, edits, deletions.

export type Item = Record<string, unknown>;
type Body = Item;
const KINDS = ['text', 'voice', 'photo', 'file'];
const ID = /^-?[0-9]{1,20}$/;

export const messageEventId = (account: string, chatId: string, messageId: number) => nameId(`tg|${account}|${chatId}|${messageId}`);
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

export type Outcome = { message_id: number; status: 'created' | 'exists' | 'skipped' | 'echo'; id?: string };

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
    // A reply sent from the feed coming back from Telegram: it is already in the feed as the owner's message.
    const sent = store.actions.byExternal(connector, `${chatId}:${messageId}`);
    if (sent) return { message_id: messageId, status: 'echo', id: sent.source_event ?? undefined };
    if (body.via_bot === true) return { message_id: messageId, status: 'echo' };
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
  // An album arrives as several messages: each part continues the first one already written.
  else if (telegram.album_id) {
    const first = store.telegram.albumFirst(account, chatId, telegram.album_id);
    if (first && first !== messageEventId(account, chatId, messageId)) data.continuation = { target: first, on: true };
  }
  const replyTarget = telegram.reply_to_message_id && store.getEvent(messageEventId(account, chatId, telegram.reply_to_message_id));
  return {
    id: messageEventId(account, chatId, messageId), schema_version: 1, source: 'telegram', author: author(account, body, chatId), ts: sentAt, kind,
    payload: compact({ text: text || undefined, media: media.length ? media : undefined, data }),
    reply_to: replyTarget ? replyTarget.id : null,
  };
}

// Items in Telegram order. Chats switched off with «Не отслеживать» are skipped (CONCEPT.md §8.2).
export function ingest(account: string, items: Item[], store: JournalStore, live: LiveFeed): Outcome[] {
  const excluded = new Set(store.telegram.exclusions(account).map((item) => item.chat_id));
  const outcomes: Outcome[] = [];
  for (const item of items) {
    if (excluded.has(String(item.chat_id))) { outcomes.push({ message_id: item.message_id as number, status: 'skipped' }); continue; }
    const built = message(account, item, store);
    if (!('schema_version' in built)) { outcomes.push(built); continue; }
    try {
      const result = store.appendEvent(built);
      if (result.created) live.publish(result.event);
      outcomes.push({ message_id: item.message_id as number, status: result.created ? 'created' : 'exists', id: built.id });
    } catch (error) {
      // The same message again with a renamed chat: it is in the journal already.
      if (error instanceof HttpError && error.status === 409) { outcomes.push({ message_id: item.message_id as number, status: 'exists', id: built.id }); continue; }
      throw error;
    }
  }
  if (outcomes.some((item) => item.status === 'created')) store.status.seen(telegramConfig.accounts[account]!.connector, new Date().toISOString());
  return outcomes;
}

// Deleted in Telegram: a mark on the message; the message itself stays (CONCEPT.md §8.2).
export function markDeleted(account: string, chatId: string, messageIds: number[], at: string, store: JournalStore, live: LiveFeed): number {
  let marked = 0;
  for (const messageId of messageIds) {
    const target = store.getEvent(messageEventId(account, chatId, messageId));
    if (!target) continue;
    const result = store.appendEvent({
      id: nameId(`tg-delete|${account}|${chatId}|${messageId}`), schema_version: 1, source: 'telegram', author: target.author, ts: at,
      kind: 'correction', payload: { ref: { type: 'event', id: target.id }, data: { op: 'remote_delete', origin: 'telegram' } },
    });
    if (result.created) { live.publish(result.event); marked += 1; }
  }
  return marked;
}
