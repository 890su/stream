import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { partyConversation, cardOrder, taskActivity, frontOrder, pickParty, commentViews, messageParties } from '../web/cardtalk.js';

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

test('a task\'s conversation: its own messages open, the rest under cuts by task; its continuations count as its own', async () => {
  // @ts-expect-error Browser modules are deliberately buildless JavaScript.
  const { cutSegments } = await import('../web/topic.js');
  const v = (id: string, tasks: string[]) => ({ id, taskIds: tasks });
  const tasksById = new Map([['t1', { id: 't1', title: 'Роутер', status: 'todo' }], ['t2', { id: 't2', title: 'Счёт', status: 'todo' }]]);
  const views = [v('a', ['t1']), v('b', ['t2']), v('c', []), v('d', ['t1', 't2']), v('e', ['t2'])];
  const shape = (keep: Set<string>) => cutSegments(views, { focus: 't1', tasksById, keep }).map((item: any) => (item.kind === 'open' ? item.views.map((x: any) => x.id).join('') : `[${item.title}:${item.views.map((x: any) => x.id).join('')}]`));
  assert.deepEqual(shape(new Set()), ['a', '[Счёт:b]', '[Без задачи:c]', 'd', '[Счёт:e]']);
  assert.deepEqual(shape(new Set(['c'])), ['a', '[Счёт:b]', 'cd', '[Счёт:e]'], 'a continuation in the task is open');
});

test('the swiped-to tile moves leftmost only once typing starts', () => {
  const order = ['tg:1', 'tg:2', 'tel:+48600100200'];
  assert.deepEqual(frontOrder(order, 'tg:2', false), order, 'a swipe alone keeps the row');
  assert.deepEqual(frontOrder(order, 'tg:2', true), ['tg:2', 'tg:1', 'tel:+48600100200']);
  assert.deepEqual(frontOrder(order, 'tg:9', true), order, 'a party not in the row changes nothing');
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

// The task card reads like a conversation (owner, 2026-11-22): the chosen interlocutor's conversation, or the task's
// comments when the chosen one is switched off.
test('the card talks with the chosen one; switched off — the comments; not chosen yet — the last speaker', () => {
  const parties = ['tg:1', 'tel:+48600100200'];
  assert.equal(pickParty('tel:+48600100200', parties, ['tg:1', 'tel:+48600100200']), 'tel:+48600100200');
  assert.equal(pickParty(null, parties, ['tg:1']), null, 'switched off');
  assert.equal(pickParty(undefined, parties, ['tg:1', 'tel:+48600100200']), 'tg:1', 'the most recent');
  assert.equal(pickParty(undefined, parties, ['tg:1', 'tel:+48600100200'], ['tg:1']), 'tel:+48600100200', 'a muted one is skipped');
  assert.equal(pickParty(undefined, [], []), null, 'nobody to talk to: the comments');
  assert.equal(pickParty('tg:9', parties, ['tg:1']), 'tg:1', 'one no longer in the task');
});

test('the comments of a task: notes of mine, the AI and the system; no chat messages, replies or calls', () => {
  const view = (id: string, event: Record<string, unknown>) => ({ id, event: { kind: 'text', payload: {}, ...event } });
  const views = [
    view('note', { author: 'me', source: 'app' }),
    view('ai', { author: 'ai', source: 'system' }),
    view('reply', { author: 'me', source: 'app', payload: { data: { outbound: { connector: 'telegram_by', chat_id: '1' } } } }),
    view('incoming', { author: 'contact:tg:by:1', source: 'telegram' }),
    view('call', { author: 'me', kind: 'call', source: 'android_phone', payload: { data: { call: { direction: 'out', number: '+48600100200' } } } }),
  ];
  assert.deepEqual(commentViews(views).map((item: any) => item.id), ['note', 'ai']);
});

test('a task made from a conversation talks with its people even when they have no role', () => {
  const conversations = [
    { key: 'tg:7003', title: 'Анна Тестова', views: [{ id: 'm1' }, { id: 'm2' }] },
    { key: 'tel:+48600100200', title: 'Пётр', views: [{ id: 'm3' }] },
    { key: 'me', title: 'Заметки', views: [{ id: 'm4' }] },
  ];
  assert.deepEqual(messageParties({ messages: ['m2', 'm4'] }, conversations), ['tg:7003']);
  assert.deepEqual(messageParties({ messages: ['m3', 'm1'] }, conversations), ['tg:7003', 'tel:+48600100200']);
});
