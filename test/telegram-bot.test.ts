import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer, type IncomingMessage } from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { fixture } from './helpers.ts';
import { nameId } from '../src/ids.ts';
import type { JournalEvent } from '../src/contracts/validate.ts';

// Account bots against a fake Bot API (CONCEPT.md §8.2). All people, numbers and texts are made up.
const OWNER = 900001;
const STRANGER = 900002;
const CLIENT = 700001;
const GROUP = -100500;
const TOKEN = '123:test';
const now = () => Math.floor(Date.now() / 1000);

async function fakeTelegram() {
  const queue: Record<string, unknown>[] = [];
  const calls: { method: string; params: Record<string, any> }[] = [];
  let nextUpdate = 1;
  let nextMessage = 500;
  const failSend: string[] = [];
  const read = async (request: IncomingMessage) => { const chunks = []; for await (const chunk of request) chunks.push(chunk); const text = Buffer.concat(chunks).toString(); return text ? JSON.parse(text) : {}; };
  const server = createServer(async (request, response) => {
    if (request.url?.startsWith(`/file/bot${TOKEN}/`)) { response.end(Buffer.from('OggS fake voice')); return; }
    const method = request.url!.split('/').at(-1)!;
    const params = await read(request);
    calls.push({ method, params });
    const ok = (result: unknown) => { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ ok: true, result })); };
    if (method === 'getMe') return ok({ id: 1, is_bot: true, username: 'stream_by_test_bot', can_connect_to_business: true });
    if (method === 'getUpdates') {
      const deadline = Date.now() + 300;
      while (!queue.some((u) => (u.update_id as number) >= (params.offset ?? 0)) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
      return ok(queue.filter((u) => (u.update_id as number) >= (params.offset ?? 0)));
    }
    if (method === 'getFile') return ok({ file_id: params.file_id, file_path: 'voice/1.ogg' });
    if (method === 'sendMessage') {
      const error = failSend.shift();
      if (error) { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ ok: false, error_code: 400, description: error })); return; }
      return ok({ message_id: nextMessage++ });
    }
    if (method === 'leaveChat') return ok(true);
    ok(true);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    apiBase: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    push(update: Record<string, unknown>) { queue.push({ update_id: nextUpdate++, ...update }); },
    calls, failSend,
    stop: () => { server.closeAllConnections(); return new Promise<void>((resolve) => server.close(() => resolve())); },
  };
}

async function until<T>(check: () => T | undefined | false, what: string, ms = 3000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timeout: ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

const person = (id: number, first_name: string) => ({ id, is_bot: false, first_name });
const connection = (user: number, name: string, id = `conn-${user}`) => ({ business_connection: { id, user: person(user, name), user_chat_id: user, date: now(), rights: { can_reply: true }, is_enabled: true } });
const businessMessage = (fields: Record<string, unknown>, conn = `conn-${OWNER}`) => ({
  business_message: { business_connection_id: conn, message_id: 10, date: now(), chat: { id: CLIENT, type: 'private', first_name: 'Клиент', last_name: 'А' }, from: person(CLIENT, 'Клиент'), text: 'Не работает Wi-Fi', ...fields },
});
const tgId = (chat: number, message: number) => nameId(`tg|by|${chat}|${message}`);

async function setup() {
  const telegram = await fakeTelegram();
  const f = await fixture({ telegram: { tokens: { by: TOKEN }, apiBase: telegram.apiBase } });
  const trust = (user: number, trusted = true) => f.request('/api/telegram/trust', { method: 'POST', body: JSON.stringify({ account: 'by', user_id: String(user), trusted }) });
  const post = (body: unknown) => f.request('/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const systemTexts = () => (f.store.listEvents({ limit: 100 }).events).filter((e) => e.kind === 'system').map((e) => e.payload.text);
  return { telegram, f, trust, post, systemTexts, stop: async () => { await f.stop(); await telegram.stop(); } };
}

test('a connection works only after the owner trusts it; then chats are written with authors and files', async () => {
  const { telegram, f, trust, systemTexts, stop } = await setup();
  try {
    await until(() => systemTexts().some((t) => t?.includes('подключите @stream_by_test_bot')), 'not connected note');
    telegram.push(connection(STRANGER, 'Чужой'));
    telegram.push(businessMessage({ text: 'от чужого аккаунта' }, `conn-${STRANGER}`));
    await until(() => systemTexts().some((t) => t?.includes('подключён аккаунт «Чужой»')), 'pending note');
    assert.equal(f.store.getEvent(tgId(CLIENT, 10)), undefined, 'an untrusted connection is not read');

    telegram.push(connection(OWNER, 'Владелец'));
    await until(() => f.store.connections.get(`conn-${OWNER}`), 'owner connection');
    assert.equal((await trust(OWNER)).status, 204);
    telegram.push(businessMessage({ message_id: 11 }));
    telegram.push(businessMessage({ message_id: 12, from: person(OWNER, 'Владелец'), text: 'Приеду в 15:00', reply_to_message: { message_id: 11 } }));
    telegram.push(businessMessage({ message_id: 13, text: undefined, voice: { file_id: 'v1', file_unique_id: 'u1', duration: 4, mime_type: 'audio/ogg', file_size: 15 } }));
    const voice = await until(() => f.store.getEvent(tgId(CLIENT, 13)), 'voice');
    const incoming = f.store.getEvent(tgId(CLIENT, 11))!;
    assert.equal(incoming.author, `contact:tg:by:${CLIENT}`);
    assert.equal((incoming.payload.data!.telegram as { chat_title: string }).chat_title, 'Клиент А');
    const mine = f.store.getEvent(tgId(CLIENT, 12))!;
    assert.equal(mine.author, 'me');
    assert.equal(mine.reply_to, incoming.id);
    assert.equal(voice.kind, 'voice');
    assert.equal(voice.payload.media![0]!.mime, 'audio/ogg');
    assert.ok(f.store.getMedia(voice.payload.media![0]!.media_id), 'the file is stored');
    await until(() => f.store.status.get('telegram_by')?.state === 'ok', 'state ok');
  } finally { await stop(); }
});

test('edits and deletions in Telegram are corrections on top of the original', async () => {
  const { telegram, f, trust, stop } = await setup();
  try {
    telegram.push(connection(OWNER, 'Владелец'));
    await until(() => f.store.connections.get(`conn-${OWNER}`), 'connection');
    await trust(OWNER);
    telegram.push(businessMessage({ message_id: 20 }));
    await until(() => f.store.getEvent(tgId(CLIENT, 20)), 'message');
    telegram.push({ edited_business_message: { ...businessMessage({ message_id: 20, text: 'Не работает Wi-Fi на складе', edit_date: now() }).business_message } });
    telegram.push({ deleted_business_messages: { business_connection_id: `conn-${OWNER}`, chat: { id: CLIENT, type: 'private' }, message_ids: [20] } });
    const deleted = await until(() => f.store.getEvent(nameId(`tg-delete|by|${CLIENT}|20`)), 'delete mark');
    assert.deepEqual(deleted.payload.data, { op: 'remote_delete', origin: 'telegram' });
    const corrections = f.store.listEvents({ limit: 50 }).events.filter((e) => e.kind === 'correction');
    assert.ok(corrections.some((e) => e.payload.data?.op === 'edit' && e.payload.text === 'Не работает Wi-Fi на складе'));
    assert.equal(f.store.getEvent(tgId(CLIENT, 20))!.payload.text, 'Не работает Wi-Fi', 'the original stays');
  } finally { await stop(); }
});

test('groups: read when the owner added the bot, also before confirming the connection; a stranger\'s group is not read', async () => {
  const { telegram, f, trust, systemTexts, stop } = await setup();
  try {
    telegram.push(connection(OWNER, 'Владелец'));
    await until(() => f.store.connections.get(`conn-${OWNER}`), 'connection');
    const added = (chat: number, by: number, title: string) => ({ my_chat_member: { chat: { id: chat, type: 'supergroup', title }, from: person(by, 'x'), date: now(), old_chat_member: { status: 'left' }, new_chat_member: { status: 'member' } } });
    telegram.push(added(GROUP, OWNER, 'Офис'));
    await until(() => systemTexts().some((t) => t?.includes('когда вы подтвердите подключение')), 'group waits for trust');
    await trust(OWNER);
    telegram.push({ message: { message_id: 30, date: now(), chat: { id: GROUP, type: 'supergroup', title: 'Офис' }, from: person(700003, 'Иван'), text: 'Есть заявка на 4 камеры' } });
    const groupMessage = await until(() => f.store.getEvent(tgId(GROUP, 30)), 'group message');
    assert.equal((groupMessage.payload.data!.telegram as { chat_type: string }).chat_type, 'group');
    telegram.push(added(-100600, STRANGER, 'Чужая'));
    telegram.push({ message: { message_id: 31, date: now(), chat: { id: -100600, type: 'supergroup', title: 'Чужая' }, from: person(STRANGER, 'x'), text: 'спам' } });
    await until(() => systemTexts().some((t) => t?.includes('добавили в группу «Чужая» не вы')), 'stranger note');
    telegram.push(connection(STRANGER, 'Чужой', 'conn-y'));
    await until(() => f.store.connections.get('conn-y'), 'later update handled');
    assert.equal(f.store.getEvent(tgId(-100600, 31)), undefined);
  } finally { await stop(); }
});

test('a reply from the feed goes through the business connection once; groups and the 24-hour window are refused', async () => {
  const { telegram, f, trust, post, stop } = await setup();
  try {
    telegram.push(connection(OWNER, 'Владелец'));
    await until(() => f.store.connections.get(`conn-${OWNER}`), 'connection');
    await trust(OWNER);
    telegram.push(businessMessage({ message_id: 40 }));
    await until(() => f.store.getEvent(tgId(CLIENT, 40)), 'incoming');
    const reply = (chat: number, text: string, replyTo?: number): JournalEvent => ({ id: randomUUID(), schema_version: 1, source: 'app', author: 'me', ts: new Date().toISOString(), kind: 'text',
      payload: { text, data: { outbound: { connector: 'telegram_by', chat_id: String(chat), chat_title: 'Клиент А', ...(replyTo ? { reply_to_message_id: replyTo } : {}) } } } });
    const first = reply(CLIENT, 'Буду в 15:00', 40);
    assert.equal((await post(first)).status, 201);
    const done = await until(() => f.store.actions.recent(10).find((a) => a.source_event === first.id && a.status === 'done'), 'sent');
    const sends = telegram.calls.filter((c) => c.method === 'sendMessage');
    assert.equal(sends.length, 1);
    assert.deepEqual(sends[0]!.params, { business_connection_id: `conn-${OWNER}`, chat_id: CLIENT, text: 'Буду в 15:00', reply_parameters: { message_id: 40, allow_sending_without_reply: true } });
    assert.equal(done.external_id, `${CLIENT}:500`);
    // The sent message comes back as a business message from the bot: not written twice.
    telegram.push(businessMessage({ message_id: 500, from: person(OWNER, 'Владелец'), text: 'Буду в 15:00', sender_business_bot: { id: 1, is_bot: true, first_name: 'Stream BY' } }));
    telegram.push(businessMessage({ message_id: 41, text: 'ok' }));
    await until(() => f.store.getEvent(tgId(CLIENT, 41)), 'next message');
    assert.equal(f.store.getEvent(tgId(CLIENT, 500)), undefined);

    const group = reply(GROUP, 'в группу');
    await post(group);
    const refused = await until(() => f.store.actions.recent(10).find((a) => a.source_event === group.id && a.status === 'failed'), 'group refused');
    assert.match(refused.error!, /В группе/);

    telegram.failSend.push('Bad Request: BUSINESS_PEER_USAGE_MISSING');
    const late = reply(CLIENT, 'поздно');
    await post(late);
    const closed = await until(() => f.store.actions.recent(10).find((a) => a.source_event === late.id && a.status === 'failed'), 'window closed');
    assert.match(closed.error!, /24 часа/);
    assert.equal(telegram.calls.filter((c) => c.method === 'sendMessage').length, 2, 'group reply never reached Telegram');
  } finally { await stop(); }
});

test('the System screen lists connections; untrusting stops reading', async () => {
  const { telegram, f, trust, stop } = await setup();
  try {
    telegram.push(connection(OWNER, 'Владелец'));
    await until(() => f.store.connections.get(`conn-${OWNER}`), 'connection');
    const before = await (await f.request('/api/system')).json() as { telegram: { connections: { user_name: string; trusted: boolean | null }[]; bots: Record<string, string> } };
    assert.equal(before.telegram.connections[0]!.trusted, null);
    assert.equal(before.telegram.bots.by, 'stream_by_test_bot');
    await trust(OWNER);
    await trust(OWNER, false);
    telegram.push(businessMessage({ message_id: 50 }));
    telegram.push(connection(STRANGER, 'Чужой', 'conn-x'));
    await until(() => f.store.connections.get('conn-x'), 'next update handled');
    assert.equal(f.store.getEvent(tgId(CLIENT, 50)), undefined);
    assert.equal((await f.request('/api/telegram/trust', { method: 'POST', body: '{"account":"zz","user_id":"1","trusted":true}' })).status, 400);
  } finally { await stop(); }
});

test('«Не отслеживать» stops writing a chat until it is tracked again', async () => {
  const { telegram, f, trust, post, stop } = await setup();
  try {
    telegram.push(connection(OWNER, 'Владелец'));
    await until(() => f.store.connections.get(`conn-${OWNER}`), 'connection');
    await trust(OWNER);
    telegram.push(businessMessage({ message_id: 60 }));
    await until(() => f.store.getEvent(tgId(CLIENT, 60)), 'message');
    const correction = (op: string, ts: string): JournalEvent => ({ id: randomUUID(), schema_version: 1, source: 'app', author: 'me', ts, kind: 'correction', payload: { ref: { type: 'event', id: tgId(CLIENT, 60) }, data: { op } } });
    assert.equal((await post(correction('untrack', '2026-11-17T09:00:00.000Z'))).status, 201);
    const system = await (await f.request('/api/system')).json() as { exclusions: { chat_id: string; chat_title: string }[] };
    assert.deepEqual(system.exclusions.map((item) => [item.chat_id, item.chat_title]), [[String(CLIENT), 'Клиент А']]);
    telegram.push(businessMessage({ message_id: 61 }));
    telegram.push(connection(OWNER, 'Владелец'));
    await until(() => telegram.calls.filter((c) => c.method === 'getUpdates').length > 6, 'more polls');
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(f.store.getEvent(tgId(CLIENT, 61)), undefined, 'an untracked chat is not written');
    await post(correction('track', '2026-11-17T09:05:00.000Z'));
    telegram.push(businessMessage({ message_id: 62 }));
    await until(() => f.store.getEvent(tgId(CLIENT, 62)), 'tracked again');
  } finally { await stop(); }
});
