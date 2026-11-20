import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { partyConversation, cardOrder, talkItems, foldLabel } from '../web/cardtalk.js';

// The conversation in the task card (design 2026-11-20, stage 2). Names are made up.
const conversations = [{ key: 'tg:501' }, { key: 'tg:-900' }, { key: 'tel:+48600100200' }];

test('a participant\'s conversation: a Telegram user, a group, a number; others have none', () => {
  assert.equal(partyConversation('tg:501', conversations).key, 'tg:501');
  assert.equal(partyConversation('group:tg:-900', conversations).key, 'tg:-900');
  assert.equal(partyConversation('tel:+48600100200', conversations).key, 'tel:+48600100200');
  assert.equal(partyConversation('name:Стас', conversations), null);
  assert.equal(partyConversation('tg:777', conversations), null);
});

test('tile order: the chosen one leftmost, recent next; at first whoever wrote last, else «Я»', () => {
  const parties = ['me', 'tg:501', 'tel:+48600100200'];
  assert.deepEqual(cardOrder(parties, { lastAuthor: 'tg:501' }), ['tg:501', 'me', 'tel:+48600100200']);
  assert.deepEqual(cardOrder(parties, {}), ['me', 'tg:501', 'tel:+48600100200']);
  assert.deepEqual(cardOrder(parties, { stored: ['tel:+48600100200', 'tg:999', 'me'], lastAuthor: 'tg:501' }), ['tel:+48600100200', 'me', 'tg:501'], 'a party no longer in the task is skipped');
});

test('other tasks\' messages: dimmed one by one, or folded in runs', () => {
  const v = (id: string, tasks: string[]) => ({ id, taskIds: tasks });
  const views = [v('a', ['t1']), v('b', ['t2']), v('c', []), v('d', ['t1', 't2']), v('e', ['t2'])];
  assert.deepEqual(talkItems(views, 't1', 'dim').map((item: any) => [item.view.id, item.other]), [['a', false], ['b', true], ['c', true], ['d', false], ['e', true]]);
  assert.deepEqual(talkItems(views, 't1', 'fold').map((item: any) => (item.kind === 'fold' ? item.views.map((x: any) => x.id).join('') : item.view.id)), ['a', 'bc', 'd', 'e']);
  assert.deepEqual([foldLabel(1), foldLabel(3), foldLabel(5)], ['· 1 сообщение по другим делам ·', '· 3 сообщения по другим делам ·', '· 5 сообщений по другим делам ·']);
});
