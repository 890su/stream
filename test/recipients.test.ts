import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { fixture } from './helpers.ts';
import type { JournalEvent } from '../src/contracts/validate.ts';

// The address book of the «кому» row (CONCEPT.md §2.9). All people, numbers and texts are made up.
const DAY = 86_400_000;
const at = (ms: number) => new Date(Date.now() - ms).toISOString();
let nextMessage = 1;

const incoming = (chat: string, ago: number, title: string, chatType = 'private'): JournalEvent => ({
  id: randomUUID(), schema_version: 1, source: 'telegram', author: `contact:tg:${chat}`, ts: at(ago), kind: 'text',
  payload: { text: 'привет', data: { telegram: { account: 'by', chat_id: chat, chat_type: chatType, chat_title: title, message_id: nextMessage++, sent_at: at(ago) } } },
});
const reply = (chat: string, title: string): JournalEvent => ({
  id: randomUUID(), schema_version: 1, source: 'app', author: 'me', ts: at(1000), kind: 'text',
  payload: { text: 'ответ', data: { outbound: { connector: 'telegram_by', chat_id: chat, chat_title: title } } },
});
const correction = (target: string, op: string): JournalEvent => ({
  id: randomUUID(), schema_version: 1, source: 'app', author: 'me', ts: new Date().toISOString(), kind: 'correction', payload: { ref: { type: 'event', id: target }, data: { op } },
});

test('recipients: chats and the bot\'s groups, pinned first, then by frequency; window, untracked and strangers\' groups', async () => {
  const f = await fixture();
  try {
    for (const ago of [3 * 3_600_000, 2 * 3_600_000, 3_600_000]) f.store.appendEvent(incoming('700001', ago, 'Клиент А'));
    f.store.appendEvent(reply('700001', 'Клиент А'));
    const old = incoming('700002', 40 * DAY, 'Поставщик');
    f.store.appendEvent(old);
    const quiet = incoming('700003', 2 * DAY, 'Сосед');
    f.store.appendEvent(quiet);
    f.store.appendEvent(incoming('700003', DAY + 3_600_000, 'Сосед'));
    const gone = incoming('700004', 3_600_000, 'Отключённый');
    f.store.appendEvent(gone);
    f.store.appendEvent(correction(gone.id, 'untrack'));
    f.store.connections.decide('by', '900001', true);
    f.store.connections.setGroup('by', '-100500', 'Напарники', '900001', true);
    f.store.connections.setGroup('by', '-100600', 'Чужая', '900002', true);

    assert.equal((await f.request('/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(correction(old.id, 'pin')) })).status, 201);
    const response = await f.request('/api/recipients');
    assert.equal(response.status, 200);
    const { recipients } = await response.json() as { recipients: { key: string; title: string; group: boolean; count: number; pinned: boolean; window_open: boolean; anchor: string | null }[] };
    assert.deepEqual(recipients.map((item) => item.key), ['by|700002', 'by|700001', 'by|700003', 'by|-100500']);
    const [pinned, client, neighbour, group] = recipients;
    assert.deepEqual([pinned!.pinned, pinned!.count, pinned!.window_open, pinned!.anchor], [true, 0, false, old.id], 'pinned although old; window closed');
    assert.deepEqual([client!.title, client!.count, client!.window_open], ['Клиент А', 4, true], 'replies sent from the feed count too');
    assert.equal(neighbour!.window_open, false, 'last incoming more than 24 hours ago');
    assert.deepEqual([group!.title, group!.group, group!.window_open, group!.count], ['Напарники', true, true, 0], 'a group with the bot, before anyone writes');

    assert.equal((await f.request('/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(correction(old.id, 'unpin')) })).status, 201);
    assert.equal(f.store.recipients.list()[0]!.key, 'by|700001', 'unpinned: back to frequency');
    const note: JournalEvent = { id: randomUUID(), schema_version: 1, source: 'app', author: 'me', ts: new Date().toISOString(), kind: 'text', payload: { text: 'заметка' } };
    f.store.appendEvent(note);
    assert.equal((await f.request('/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(correction(note.id, 'pin')) })).status, 400, 'only a chat can be pinned');
  } finally { await f.stop(); }
});
