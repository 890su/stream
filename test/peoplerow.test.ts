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
