import assert from 'node:assert/strict';
import { test } from 'node:test';
import { project, sourceKey, chatOf } from '../web/projection.js';
import { messengerLabel, setAccounts, deliveryText } from '../web/tgbubble.js';

// Telegram messages in the feed (CONCEPT.md §8.2). Names are made up.
const telegram = (overrides: Record<string, unknown> = {}, author = 'contact:tg:by:7') => ({
  id: crypto.randomUUID(), schema_version: 1, source: 'telegram', author, ts: '2026-11-17T08:00:00.000Z', kind: 'text',
  payload: { text: 'Привет', data: { telegram: { account: 'by', chat_id: '7', chat_type: 'private', chat_title: 'Клиент А', from_name: 'Клиент А', message_id: 1, sent_at: '2026-11-17T08:00:00.000Z', ...overrides } } },
});
const reply = (id: string) => ({
  id, schema_version: 1, source: 'app', author: 'me', ts: '2026-11-17T08:05:00.000Z', kind: 'text',
  payload: { text: 'Буду в 15:00', data: { outbound: { connector: 'telegram_by', chat_id: '7', chat_title: 'Клиент А' } } },
});
const result = (source: string, status: string, ts: string, error?: string) => ({
  id: crypto.randomUUID(), schema_version: 1, source: 'system', author: 'system', ts, kind: 'action_result',
  payload: { ref: { type: 'action', id: 'a1' }, data: { action: { status, connector: 'telegram_by', source_event: source, ...(error ? { error } : {}) } } },
});

test('sources and chats: a reply to Telegram belongs to that chat', () => {
  assert.equal(sourceKey(telegram()), 'telegram:by');
  assert.equal(sourceKey(reply('r')), 'telegram:by');
  assert.equal(sourceKey({ source: 'android_phone', kind: 'call', payload: {} }), 'phone');
  assert.equal(sourceKey({ source: 'system', kind: 'system', payload: {} }), 'system');
  assert.equal(sourceKey({ source: 'app', kind: 'text', payload: { text: 'x' } }), 'me');
  assert.equal(chatOf(telegram())!.key, 'by|7');
  assert.equal(chatOf(reply('r'))!.key, 'by|7');
  assert.equal(chatOf({ source: 'app', kind: 'text', payload: {} }), null);
});

test('delivery of a reply follows the latest action result; results are not messages', () => {
  const id = crypto.randomUUID();
  const waiting = project([reply(id)]);
  assert.deepEqual(waiting[0]!.delivery, { status: 'approved', error: null, action: null });
  const views = project([reply(id), result(id, 'failed', '2026-11-17T08:06:00.000Z', 'FLOOD'), result(id, 'done', '2026-11-17T08:07:00.000Z')]);
  assert.equal(views.length, 1);
  assert.deepEqual(views[0]!.delivery, { status: 'done', error: null, action: 'a1' });
  assert.equal(deliveryText(views[0]!.delivery), '✓ в Telegram');
});

test('labels: account, chat, group author, forward, file not downloaded', () => {
  setAccounts({ by: { title: 'Telegram BY' } });
  assert.equal(messengerLabel(telegram())!.head, 'Telegram BY · Клиент А');
  assert.equal(messengerLabel(telegram())!.incoming, true);
  const group = messengerLabel(telegram({ chat_type: 'group', chat_title: 'Офис', from_name: 'Иван', forward: { from_name: 'Клиент Б', date: '2026-11-17T07:00:00.000Z' },
    media_skipped: { reason: 'too_large', mime: 'video/mp4', size_bytes: 90 * 1024 * 1024 } }))!;
  assert.equal(group.head, 'Telegram BY · Офис · Иван');
  assert.equal(group.forward, 'Переслано от Клиент Б');
  assert.equal(group.skipped, 'Видео 90.0 МБ — слишком большой');
  assert.equal(messengerLabel(telegram({}, 'me'))!.incoming, false);
  assert.equal(messengerLabel(reply('r'))!.head, '→ Telegram BY · Клиент А');
});
