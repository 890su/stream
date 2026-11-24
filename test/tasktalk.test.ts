// The task card «По задаче» (CONCEPT.md §5, 2026-11-24): the task's messages from every conversation with folded
// context, the recipient's line and the long-press list. Names, chats and texts are made up.
import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { taskThread, recipientOptions, recipientHint } from '../web/tasktalk.js';

const tg = (id: string, chat: string, ts: string, author = `contact:tg:by:${chat}`) => ({ id, deleted: false, event: { id, ts: `2026-11-24T${ts}:00Z`, author, kind: 'text',
  payload: { text: id, data: { telegram: { account: 'by', chat_id: chat, chat_type: 'private', chat_title: chat === '501' ? 'Анна' : 'Борис', from_name: 'x', message_id: 1, sent_at: '' } } } } });
const anna = [tg('a1', '501', '09:00'), tg('a2', '501', '09:01'), tg('a3', '501', '09:02'), tg('a4', '501', '09:03'), tg('a5', '501', '09:04')];
const boris = [tg('b1', '502', '09:10'), tg('b2', '502', '09:11')];
const conversations = [{ key: 'tg:501', title: 'Анна', views: anna }, { key: 'tg:502', title: 'Борис', views: boris }];

test('«По задаче»: the task messages of all conversations by time, each with its folded context', () => {
  const note = { id: 'n1', deleted: false, event: { id: 'n1', ts: '2026-11-24T09:05:00Z', author: 'me', kind: 'text', payload: { text: 'моя заметка' } } };
  const items = taskThread([anna[1], anna[4], boris[1], note], conversations);
  assert.deepEqual(items.map((item: any) => item.view.id), ['a2', 'a5', 'b2'], 'a comment of the task is not part of the thread');
  assert.deepEqual(items[0].before.map((view: any) => view.id), ['a1']);
  assert.deepEqual(items[0].after.map((view: any) => view.id), ['a3']);
  assert.deepEqual(items[1].before.map((view: any) => view.id), ['a4'], 'a context message is shown once');
  assert.deepEqual(items[2].before.map((view: any) => view.id), ['b1']);
  assert.deepEqual(items[2].after, []);
});

test('context stops at another message of the task and skips deleted ones', () => {
  const gone = { ...anna[1], deleted: true };
  const items = taskThread([anna[0], anna[2]], [{ key: 'tg:501', views: [anna[0], gone, anna[2], anna[3]] }]);
  assert.deepEqual(items[0].after, [], 'between two task messages there is no context left after the deleted one');
  assert.deepEqual(items[1].after.map((view: any) => view.id), ['a4']);
});

test('the long-press list: each person with each of their chats, the comment last', () => {
  const options = recipientOptions(['tg:501', 'tg:502'], conversations, (party: string) => ({ 'tg:501': 'Анна', 'tg:502': 'Борис' }[party] ?? party));
  assert.deepEqual(options.map((item: any) => item.label), ['Анна · Telegram BY', 'Борис · Telegram BY', 'Комментарий к задаче']);
  assert.equal(options[0].party, 'tg:501');
  assert.equal(options[0].chat.chat_id, '501');
  assert.equal(options.at(-1).party, null);
});

test('the input names the recipient, or says the comment', () => {
  assert.equal(recipientHint('tg:501', conversations[0], 'Анна'), '→ Анна · TG BY');
  assert.equal(recipientHint(null, null, ''), 'Комментарий к задаче');
  assert.equal(recipientHint('tel:+48600000001', { key: 'tel:+48600000001', views: [] }, 'Петр'), '→ Петр (нет чата: заметка в задаче)');
});
