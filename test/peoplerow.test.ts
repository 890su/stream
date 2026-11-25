import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { conversationTask, chatParties, replyChats, rowOrder } from '../web/peoplerow.js';

// A conversation and its task have one set of participants (owner's design, 2026-11-19). Data is made up.
const task = (id: string, data: Record<string, unknown> = {}) => ({ id, status: 'todo', filed: false, updatedAt: '2026-11-19T10:00:00Z', ...data });

test('the task of a conversation: the one it is named after, else the latest changed open one', () => {
  assert.equal(conversationTask({ key: 'task:b', tasks: [task('a'), task('b', { status: 'done' })] }).id, 'b');
  const tasks = [task('old'), task('new', { updatedAt: '2026-11-19T12:00:00Z' }), task('closed', { status: 'done', updatedAt: '2026-11-19T13:00:00Z' }), task('note', { filed: true, updatedAt: '2026-11-19T14:00:00Z' })];
  assert.equal(conversationTask({ key: 'by|501', tasks }).id, 'new');
  assert.equal(conversationTask({ key: 'by|501', tasks: [task('x', { status: 'cancelled' })] }), null, 'no open task — none');
  assert.equal(conversationTask(null), null);
});

test('without a task the line shows me and every other author once', () => {
  const view = (author: string, deleted = false) => ({ deleted, event: { author, kind: 'text', payload: { text: 'привет' } } });
  assert.deepEqual(chatParties({ views: [view('contact:tg:by:501'), view('me'), view('contact:tg:pl:501'), view('contact:tg:by:7', true)] }), ['me', 'tg:501']);
});

// The line over the input shows only who I talk with (owner, 2026-11-21): one tile per chat I can answer, no roles,
// no «Я», no «Система»; the chosen one stands leftmost and gets the reply.
test('interlocutors: one tile per chat that can be answered, the latest first; deleted and unanswerable ones stay out', () => {
  const tg = (account: string, chat: string, ts: string, extra: Record<string, unknown> = {}) => ({ deleted: false, event: { author: `contact:tg:${account}:${chat}`, ts, kind: 'text',
    payload: { text: 'привет', data: { telegram: { account, chat_id: chat, chat_type: 'private', chat_title: 'Анна Тестова' } } } }, ...extra });
  const out = { deleted: false, event: { author: 'me', ts: '2026-11-21T10:30:00Z', kind: 'text', payload: { text: 'ок', data: { outbound: { connector: 'viber', chat_id: '+48600100200', chat_title: 'Анна Тестова' } } } } };
  const anonymous = { deleted: false, event: { author: 'contact:wa:x', ts: '2026-11-21T11:00:00Z', kind: 'text', payload: { text: 'hi', data: { whatsapp: { account: 'pl', jid: '123@lid', chat: 'Аноним' } } } } };
  const chats = replyChats({ views: [tg('by', '501', '2026-11-21T09:00:00Z'), tg('pl', '501', '2026-11-21T10:00:00Z'), out, anonymous, tg('by', '777', '2026-11-21T12:00:00Z', { deleted: true })] });
  assert.deepEqual(chats.map((chat: any) => chat.key), ['viber|+48600100200', 'pl|501', 'by|501']);
  assert.deepEqual(rowOrder(chats, 'by|501').map((chat: any) => chat.key), ['by|501', 'viber|+48600100200', 'pl|501'], 'the chosen one leftmost');
  assert.deepEqual(rowOrder(chats, null).map((chat: any) => chat.key), ['viber|+48600100200', 'pl|501', 'by|501'], 'none chosen — the latest first');
});

// SMS out (CONCEPT.md §8.1, 2026-11-25): a number that sent SMS gets an «SMS» tile; the reply goes to the phone.
test('an SMS conversation has an SMS tile by its number; a sender without a number has none', async () => {
  // @ts-expect-error Browser modules are deliberately buildless JavaScript.
  const { outboundData, phoneAnswerable, replyWindowClosed } = await import('../web/outbound.js');
  // @ts-expect-error Browser modules are deliberately buildless JavaScript.
  const { deliveryText, accountTitle } = await import('../web/tgbubble.js');
  const sms = (number: string, ts: string, name?: string) => ({ deleted: false, event: { author: 'me', source: 'android_phone', ts, kind: 'sms',
    payload: { text: 'Буду в 10', data: { sms: { direction: 'in', number, sent_at: ts, ...(name ? { name } : {}) } } } } });
  const chats = replyChats({ views: [sms('+48 600 100 200', '2026-11-25T09:00:00Z', 'Анна Тестова'), sms('InPost', '2026-11-25T10:00:00Z')] });
  assert.deepEqual(chats.map((chat: any) => [chat.key, chat.account, chat.chat_id, chat.title]), [['sms|+48600100200', 'sms', '+48600100200', 'Анна Тестова']]);
  assert.equal(accountTitle('sms'), 'SMS');
  assert.equal(replyChats({ views: [sms('48500000002', '2026-11-25T09:00:00Z')] })[0]?.chat_id, '48500000002', 'a number without + is still a number');
  assert.ok(phoneAnswerable(chats[0]));
  assert.equal(replyWindowClosed(chats[0], [], Date.parse('2026-12-25T00:00:00Z')), false, 'no 24-hour window');
  assert.deepEqual(outboundData(chats[0], null, {}), { connector: 'sms', chat_id: '+48600100200', chat_title: 'Анна Тестова' });
  assert.equal(deliveryText({ connector: 'sms', status: 'approved' }), 'ждёт телефон');
  assert.equal(deliveryText({ connector: 'sms', status: 'done' }), '✓ отправлено SMS');
  assert.equal(deliveryText({ connector: 'sms', status: 'failed' }), 'не отправлено');
});

test('my SMS reply belongs to the number conversation, with its calls and SMS', async () => {
  // @ts-expect-error Browser modules are deliberately buildless JavaScript.
  const { conversationOf } = await import('../web/conversations.js');
  const reply = { author: 'me', source: 'app', ts: '2026-11-25T09:00:00Z', kind: 'text', payload: { text: 'ок', data: { outbound: { connector: 'sms', chat_id: '+48600100200' } } } };
  const incoming = { author: 'me', source: 'android_phone', ts: '2026-11-25T08:00:00Z', kind: 'sms', payload: { text: 'Буду', data: { sms: { direction: 'in', number: '+48600100200' } } } };
  assert.equal(conversationOf(reply), 'tel:+48600100200');
  assert.equal(conversationOf(incoming), 'tel:+48600100200');
});
