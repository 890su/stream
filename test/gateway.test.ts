import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { fixture, token, readUntil } from './helpers.ts';
import { nameId } from '../src/ids.ts';
import type { JournalEvent } from '../src/contracts/validate.ts';

// Telegram account gateways (CONCEPT.md §8.2). All names and numbers are made up.
const CLIENT = '700001';
const CONTRACTOR = '700002';
const GROUP = '-100500';
const ME = '900000';
const msg = (overrides: Record<string, unknown> = {}) => ({
  chat_id: CLIENT, chat_type: 'private', chat_title: 'Клиент А', message_id: 10, date: '2026-11-17T08:00:00.000Z',
  out: false, from_id: CLIENT, from_name: 'Клиент А', kind: 'text', text: 'Не работает Wi-Fi в офисе', ...overrides,
});
const tgId = (chat: string, message: number) => nameId(`tg|by|${chat}|${message}`);
type Results = { results: { message_id: number; status: string; id?: string }[] };

test('a gateway token opens only its own account', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.gatewayRequest('config')).status, 200);
    assert.equal((await f.gatewayRequest('config', undefined, 'GET', `Bearer ${token}`)).status, 200, 'owner token works too');
    assert.equal((await f.gatewayRequest('config', undefined, 'GET', 'Bearer wrong')).status, 401);
    const other = await fetch(`${f.base}/api/gateway/telegram/pl/config`, { headers: { Authorization: 'Bearer test-gateway-token-by-for-local-tests' } });
    assert.equal(other.status, 401, 'by token does not open pl');
    for (const path of ['/api/events', '/api/system', '/api/phone/ping']) {
      assert.equal((await fetch(f.base + path, { headers: { Authorization: 'Bearer test-gateway-token-by-for-local-tests' } })).status, 401, path);
    }
    const config = await (await f.gatewayRequest('config')).json() as Record<string, unknown>;
    assert.equal(config.folder, 'Stream');
    assert.equal(config.timezone, 'Europe/Minsk');
    assert.deepEqual(config.excluded, []);
  } finally { await f.stop(); }
});

test('messages become journal events once, with authors, replies and live delivery', async () => {
  const f = await fixture();
  try {
    const live = await f.request('/api/live');
    const first = await f.gatewayRequest('messages', { messages: [msg(), msg({ message_id: 11, out: true, from_id: ME, from_name: 'Я', text: 'Сейчас приеду', reply_to_message_id: 10 })] });
    assert.equal(first.status, 200);
    const { results } = await first.json() as Results;
    assert.deepEqual(results.map((item) => item.status), ['created', 'created']);
    assert.equal(results[0]!.id, tgId(CLIENT, 10));
    const incoming = f.store.getEvent(tgId(CLIENT, 10))!;
    assert.equal(incoming.source, 'telegram');
    assert.equal(incoming.author, `contact:tg:by:${CLIENT}`);
    assert.equal(incoming.ts, '2026-11-17T08:00:00.000Z');
    assert.deepEqual(incoming.payload.data, { telegram: { account: 'by', chat_id: CLIENT, chat_type: 'private', chat_title: 'Клиент А', from_id: CLIENT, from_name: 'Клиент А', message_id: 10, sent_at: '2026-11-17T08:00:00.000Z' } });
    const mine = f.store.getEvent(tgId(CLIENT, 11))!;
    assert.equal(mine.author, 'me');
    assert.equal(mine.reply_to, incoming.id, 'a Telegram reply is a journal reply');
    assert.match(await readUntil(live, (text) => text.includes(mine.id)), new RegExp(mine.id));

    const again = await (await f.gatewayRequest('messages', { messages: [msg({ chat_title: 'Клиент А (новое имя)' })] })).json() as Results;
    assert.equal(again.results[0]!.status, 'exists', 'a retry after a rename is not a conflict');
    const empty = await (await f.gatewayRequest('messages', { messages: [msg({ message_id: 12, text: '' })] })).json() as Results;
    assert.equal(empty.results[0]!.status, 'skipped');
    assert.equal((await f.gatewayRequest('messages', { messages: [msg({ chat_id: 'abc' })] })).status, 400);
  } finally { await f.stop(); }
});

test('an edit in Telegram corrects the message; the original stays', async () => {
  const f = await fixture();
  try {
    await f.gatewayRequest('messages', { messages: [msg()] });
    const edit = await (await f.gatewayRequest('messages', { messages: [msg({ text: 'Не работает Wi-Fi на складе', edit_date: '2026-11-17T08:05:00.000Z' })] })).json() as Results;
    assert.equal(edit.results[0]!.status, 'created');
    const correction = f.store.getEvent(edit.results[0]!.id!)!;
    assert.equal(correction.kind, 'correction');
    assert.deepEqual(correction.payload.ref, { type: 'event', id: tgId(CLIENT, 10) });
    assert.deepEqual(correction.payload.data, { op: 'edit', origin: 'telegram' });
    assert.equal(f.store.getEvent(tgId(CLIENT, 10))!.payload.text, 'Не работает Wi-Fi в офисе');
    const unknown = await (await f.gatewayRequest('messages', { messages: [msg({ message_id: 99, edit_date: '2026-11-17T08:05:00.000Z' })] })).json() as Results;
    assert.equal(unknown.results[0]!.status, 'skipped', 'edits of messages outside the journal are ignored');
  } finally { await f.stop(); }
});

test('a forward to a contractor continues the original request; album parts continue the first', async () => {
  const f = await fixture();
  try {
    await f.gatewayRequest('messages', { messages: [msg()] });
    const forward = msg({ chat_id: CONTRACTOR, chat_title: 'Подрядчик Б', message_id: 20, out: true, from_id: ME, date: '2026-11-17T08:10:00.000Z',
      forward: { from_id: CLIENT, from_name: 'Клиент А', date: '2026-11-17T08:00:00.000Z' } });
    await f.gatewayRequest('messages', { messages: [forward] });
    assert.deepEqual(f.store.getEvent(tgId(CONTRACTOR, 20))!.payload.data!.continuation, { target: tgId(CLIENT, 10), on: true });

    const photo = (message: number) => msg({ chat_id: GROUP, chat_type: 'group', chat_title: 'Офис', message_id: message, kind: 'file', text: '',
      album_id: '555', album_first: 30, media_skipped: { reason: 'too_large', mime: 'video/mp4', size_bytes: 90_000_000 } });
    await f.gatewayRequest('messages', { messages: [photo(30), photo(31)] });
    assert.equal(f.store.getEvent(tgId(GROUP, 30))!.payload.data!.continuation, undefined);
    assert.deepEqual(f.store.getEvent(tgId(GROUP, 31))!.payload.data!.continuation, { target: tgId(GROUP, 30), on: true });
  } finally { await f.stop(); }
});

test('«Не отслеживать» excludes the chat until it is tracked again', async () => {
  const f = await fixture();
  try {
    await f.gatewayRequest('messages', { messages: [msg()] });
    const correction = (op: string, ts: string): JournalEvent => ({ id: randomUUID(), schema_version: 1, source: 'app', author: 'me', ts, kind: 'correction', payload: { ref: { type: 'event', id: tgId(CLIENT, 10) }, data: { op } } });
    const post = (body: JournalEvent) => f.request('/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await post(correction('untrack', '2026-11-17T09:00:00.000Z'))).status, 201);
    assert.deepEqual((await (await f.gatewayRequest('config')).json() as { excluded: string[] }).excluded, [CLIENT]);
    const system = await (await f.request('/api/system')).json() as { exclusions: { chat_id: string; chat_title: string }[] };
    assert.equal(system.exclusions[0]!.chat_title, 'Клиент А');
    assert.equal((await post(correction('track', '2026-11-17T09:05:00.000Z'))).status, 201);
    assert.deepEqual((await (await f.gatewayRequest('config')).json() as { excluded: string[] }).excluded, []);

    const own = await post({ id: randomUUID(), schema_version: 1, source: 'app', author: 'me', ts: '2026-11-17T09:00:00.000Z', kind: 'text', payload: { text: 'заметка' } });
    const ownId = (await own.json() as { id: string }).id;
    assert.equal((await post({ ...correction('untrack', '2026-11-17T09:10:00.000Z'), payload: { ref: { type: 'event', id: ownId }, data: { op: 'untrack' } } })).status, 400, 'only messenger chats');
  } finally { await f.stop(); }
});

test('a reply from the feed becomes an approved action; the gateway sends it, reports, and its echo is not doubled', async () => {
  const f = await fixture();
  try {
    await f.gatewayRequest('messages', { messages: [msg()] });
    const reply: JournalEvent = { id: randomUUID(), schema_version: 1, source: 'app', author: 'me', ts: '2026-11-17T08:20:00.000Z', kind: 'text',
      payload: { text: 'Буду в 15:00', data: { outbound: { connector: 'telegram_by', chat_id: CLIENT, chat_title: 'Клиент А', reply_to_message_id: 10 } } }, reply_to: tgId(CLIENT, 10) };
    const post = (body: unknown) => f.request('/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await post(reply)).status, 201);
    assert.equal((await post(reply)).status, 200, 'a retry from the outbox makes no second action');
    assert.equal((await post({ ...reply, id: randomUUID(), payload: { text: 'x', data: { outbound: { connector: 'whatsapp', chat_id: CLIENT } } } })).status, 400);

    const { actions } = await (await f.gatewayRequest('actions?wait=0')).json() as { actions: { id: string; operation: string; params: Record<string, unknown> }[] };
    assert.equal(actions.length, 1);
    assert.equal(actions[0]!.operation, 'send_message');
    assert.deepEqual(actions[0]!.params, { chat_id: CLIENT, text: 'Буду в 15:00', reply_to_message_id: 10 });
    const again = await (await f.gatewayRequest('actions?wait=0')).json() as { actions: unknown[] };
    assert.equal(again.actions.length, 1, 'a running action is handed out again after a gateway restart');

    const done = await f.gatewayRequest(`actions/${actions[0]!.id}/result`, { status: 'done', message_id: 41 });
    assert.equal(done.status, 200);
    assert.equal((await (await f.gatewayRequest('actions?wait=0')).json() as { actions: unknown[] }).actions.length, 0);
    const echo = await (await f.gatewayRequest('messages', { messages: [msg({ message_id: 41, out: true, from_id: ME, text: 'Буду в 15:00' })] })).json() as Results;
    assert.deepEqual(echo.results[0], { message_id: 41, status: 'echo', id: reply.id });
    assert.equal(f.store.getEvent(tgId(CLIENT, 41)), undefined);

    const events = (await (await f.request('/api/events?limit=50')).json() as { events: JournalEvent[] }).events;
    const result = events.find((item) => item.kind === 'action_result')!;
    assert.deepEqual(result.payload.data!.action, { status: 'done', connector: 'telegram_by', source_event: reply.id, external_id: `${CLIENT}:41` });

    const failing = { ...reply, id: randomUUID(), payload: { text: 'Второй ответ', data: { outbound: { connector: 'telegram_by', chat_id: CLIENT } } } };
    await post(failing);
    const [second] = (await (await f.gatewayRequest('actions?wait=0')).json() as { actions: { id: string }[] }).actions;
    await f.gatewayRequest(`actions/${second!.id}/result`, { status: 'failed', error: 'PEER_ID_INVALID' });
    const retried = await f.request(`/api/actions/${second!.id}/retry`, { method: 'POST' });
    assert.equal(retried.status, 200);
    assert.equal((await (await f.gatewayRequest('actions?wait=0')).json() as { actions: unknown[] }).actions.length, 1);
  } finally { await f.stop(); }
});

test('a pulse updates the System screen; state changes go to the feed', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.gatewayRequest('pulse', { state: 'ok', info: { chats: 12 } })).status, 204);
    assert.equal((await f.gatewayRequest('pulse', { state: 'ok' })).status, 204);
    assert.equal((await f.gatewayRequest('pulse', { state: 'login_required', detail: 'сессия отозвана' })).status, 204);
    assert.equal((await f.gatewayRequest('pulse', { state: 'ok' })).status, 204);
    assert.equal((await f.gatewayRequest('pulse', { state: 'asleep' })).status, 400);
    const events = (await (await f.request('/api/events?limit=50')).json() as { events: JournalEvent[] }).events.filter((item) => item.kind === 'system');
    assert.deepEqual(events.map((item) => item.payload.text).reverse(), ['Telegram BY: нужен вход — сессия отозвана', 'Telegram BY: снова работает']);
    const system = await (await f.request('/api/system')).json() as { sources: { source: string; state: string; title: string }[] };
    const by = system.sources.find((item) => item.source === 'telegram_by')!;
    assert.equal(by.state, 'ok');
    assert.equal(system.sources.find((item) => item.source === 'telegram_pl')!.state, 'silent', 'a gateway never connected shows as silent');
  } finally { await f.stop(); }
});
