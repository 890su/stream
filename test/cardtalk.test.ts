import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { partyConversation, cardOrder, talkItems, foldLabel, taskActivity } from '../web/cardtalk.js';

// The conversation in the task card (design 2026-11-20, stage 2). Names are made up.
const conversations = [{ key: 'tg:501' }, { key: 'tg:-900' }, { key: 'tel:+48600100200' }];

test('a participant\'s conversation: a Telegram user, a group, a number; others have none', () => {
  assert.equal(partyConversation('tg:501', conversations).key, 'tg:501');
  assert.equal(partyConversation('group:tg:-900', conversations).key, 'tg:-900');
  assert.equal(partyConversation('tel:+48600100200', conversations).key, 'tel:+48600100200');
  assert.equal(partyConversation('name:Стас', conversations), null);
  assert.equal(partyConversation('tg:777', conversations), null);
});

test('name-only messenger chats are matched only when the name is unambiguous', () => {
  const chat = { key: 'wa:123@lid', title: 'Собеседник' };
  assert.equal(partyConversation('name:Собеседник', [chat]), chat);
  assert.equal(partyConversation('name:Собеседник', [chat, { key: 'viber:Собеседник', title: 'Собеседник' }]), null);
  assert.equal(partyConversation('name:Собеседник', [{ key: 'tel:+48500000002', title: 'Собеседник' }]), null);
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
  assert.deepEqual(talkItems(views, 't1', 'dim', new Set(['c'])).filter((item: any) => !item.other).map((item: any) => item.view.id), ['a', 'c', 'd'], 'continuations in the task are highlighted too');
});

test('the activity log separates owner, AI and system entries', () => {
  const history = [
    { ts: '2026-11-20T09:00:00Z', author: 'system', change: { processor: 'triage-test', op: 'create' } },
    { ts: '2026-11-20T10:00:00Z', author: 'me', change: { status: 'done' } },
    { ts: '2026-11-20T11:00:00Z', author: 'system', change: { status: 'todo' } },
  ];
  assert.deepEqual(taskActivity({ history }).map((item: { party: string }) => item.party), ['ai', 'me', 'system']);
});

test('the first tile: who wrote last — a group as the group, a muted participant skipped — else «Я»', async () => {
  // @ts-expect-error Browser modules are deliberately buildless JavaScript.
  const { lastSpeaker } = await import('../web/cardtalk.js');
  const tg = (author: string, chat: string, type = 'private') => ({ event: { author, kind: 'text', payload: { data: { telegram: { account: 'by', chat_id: chat, chat_type: type } } } } });
  const views = [tg('contact:tg:by:501', '501'), tg('contact:tg:by:7', '-900', 'group')];
  assert.equal(lastSpeaker(views, ['me', 'tg:501', 'group:tg:-900'], []), 'group:tg:-900');
  assert.equal(lastSpeaker(views, ['me', 'tg:501', 'group:tg:-900'], ['group:tg:-900']), 'tg:501', 'muted is skipped');
  assert.equal(lastSpeaker(views, ['me'], []), null);
});

test('the task\'s own feed: its messages and its changes as grey lines, by time', async () => {
  // @ts-expect-error Browser modules are deliberately buildless JavaScript.
  const { withLog } = await import('../web/cardtalk.js');
  const views = [{ id: 'm1', event: { ts: '2026-11-20T09:00:00Z' } }, { id: 'm2', event: { ts: '2026-11-20T11:00:00Z' } }];
  const log = [{ ts: '2026-11-20T10:00:00Z', text: 'срок пт' }, { ts: '2026-11-20T12:00:00Z', text: 'готово' }];
  assert.deepEqual(withLog(views, log).map((item: any) => item.kind === 'log' ? item.text : item.view.id), ['m1', 'срок пт', 'm2', 'готово']);
});

test('paging keeps its order when another participant moves to the front of the strip', async () => {
  // @ts-expect-error Browser modules are deliberately buildless JavaScript.
  const { pagerOrder } = await import('../web/cardtalk.js');
  const original = ['me', 'tg:501', 'tg:502'];
  assert.deepEqual(pagerOrder(['tg:501', 'me', 'tg:502'], original), original);
  assert.deepEqual(pagerOrder(['tg:502', 'me', 'tg:503'], original), ['me', 'tg:502', 'tg:503']);
});
