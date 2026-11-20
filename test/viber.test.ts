import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID, createHash } from 'node:crypto';
import { fixture, token, viberToken } from './helpers.ts';
import { partyOf } from '../src/tasks/parties.ts';
import { streamOf } from '../src/tasks/triage.ts';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { chatOf, sourceKey } from '../web/projection.js';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { conversationOf, directionOf } from '../web/conversations.js';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { outboundData, replyWindowClosed, phoneAnswerable } from '../web/outbound.js';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { messengerLabel, deliveryText } from '../web/tgbubble.js';

const message = { key: 'n1', chat: 'Пётр', phone: '+375290000001', text: 'Привет, что по ценам?', received_at: '2026-11-20T08:55:45+01:00' };

async function bridge(f: { base: string }, path: string, body?: unknown, authorization = `Bearer ${viberToken}`) {
  return fetch(f.base + path, { method: 'POST', headers: { Authorization: authorization, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
}

test('the bridge token opens only /api/viber/*', async () => {
  const f = await fixture();
  try {
    assert.equal((await bridge(f, '/api/viber/hello')).status, 204);
    assert.equal((await bridge(f, '/api/viber/hello', undefined, `Bearer ${token}`)).status, 204, 'the owner token works too');
    assert.equal((await bridge(f, '/api/viber/hello', undefined, 'Bearer wrong')).status, 401);
    assert.equal((await fetch(f.base + '/api/events', { headers: { Authorization: `Bearer ${viberToken}` } })).status, 401);
  } finally { await f.stop(); }
});

test('an incoming Viber message is written once; the phone makes its author the same person as their calls', async () => {
  const f = await fixture();
  try {
    const first = await bridge(f, '/api/viber/messages', message);
    assert.equal(first.status, 201);
    const { id } = await first.json() as { id: string };
    assert.equal((await bridge(f, '/api/viber/messages', message)).status, 200, 'a retry writes nothing new');
    const stored = f.store.getEvent(id)!;
    assert.equal(stored.source, 'viber');
    assert.equal(stored.author, 'contact:viber:+375290000001');
    assert.equal(stored.ts, '2026-11-20T07:55:45.000Z');
    assert.deepEqual(stored.payload.data, { viber: { chat: 'Пётр', phone: '+375290000001', received_at: '2026-11-20T07:55:45.000Z' } });
    assert.equal(partyOf(stored.author), 'tel:+375290000001');
    assert.equal(streamOf(stored), 'viber|+375290000001');
    assert.equal(f.store.status.get('viber')?.state, 'ok');

    const unknown = await bridge(f, '/api/viber/messages', { key: 'n2', chat: 'Неизвестно', text: 'Здравствуйте', received_at: '2026-11-20T09:03:38+01:00' });
    assert.equal(unknown.status, 201, 'without a phone: a conversation by the name');
    const hidden = f.store.getEvent((await unknown.json() as { id: string }).id)!;
    assert.equal(partyOf(hidden.author), 'name:Неизвестно');

    assert.equal((await bridge(f, '/api/viber/messages', { ...message, key: 'n3', phone: '8029' })).status, 400);
    assert.equal((await bridge(f, '/api/viber/messages', { ...message, key: 'n4', text: ' ' })).status, 400);
    assert.equal((await bridge(f, '/api/viber/messages', { ...message, key: '' })).status, 400);
  } finally { await f.stop(); }
});

test('a photo from Viber: the bridge uploads the file, the message is a photo without the placeholder text', async () => {
  const f = await fixture();
  try {
    const bytes = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4fd0000000049454e44ae426082', 'hex');
    const sha = createHash('sha256').update(bytes).digest('hex');
    const put = await fetch(`${f.base}/api/viber/media/${sha}`, { method: 'PUT', headers: { Authorization: `Bearer ${viberToken}`, 'Content-Type': 'image/png' }, body: bytes });
    assert.ok([200, 201].includes(put.status), String(put.status));
    const sent = await bridge(f, '/api/viber/messages', { key: 'p1', chat: 'Пётр', phone: '+375290000001', text: '', received_at: '2026-11-20T09:13:59+01:00',
      media: [{ media_id: sha, mime: 'image/png', size_bytes: bytes.length }] });
    assert.equal(sent.status, 201);
    const stored = f.store.getEvent((await sent.json() as { id: string }).id)!;
    assert.equal(stored.kind, 'photo');
    assert.equal(stored.payload.text, undefined);
    assert.equal(stored.payload.media?.[0]?.media_id, sha);
    const missing = await bridge(f, '/api/viber/messages', { key: 'p2', chat: 'Пётр', text: '', received_at: '2026-11-20T09:14:00+01:00',
      media: [{ media_id: 'a'.repeat(64), mime: 'image/png' }] });
    assert.ok(missing.status >= 400, 'a file that was not uploaded is refused');
  } finally { await f.stop(); }
});

test('the owner own Viber message read back from the window: author me, same conversation, idempotent', async () => {
  const f = await fixture();
  try {
    const own = { key: 'out|+375290000001|09:58|abc123', chat: 'Пётр', phone: '+375290000001', mine: true,
      text: 'Да, договорились', received_at: '2026-11-20T09:58:00+01:00' };
    const first = await bridge(f, '/api/viber/messages', own);
    assert.equal(first.status, 201);
    const stored = f.store.getEvent((await first.json() as { id: string }).id)!;
    assert.equal(stored.author, 'me', 'the owner own message is mine, not the contact');
    assert.equal(stored.source, 'viber');
    assert.equal(conversationOf(stored), 'tel:+375290000001', 'it joins the number conversation');
    assert.equal(directionOf(stored), 'out', 'it renders as my (outgoing) bubble');
    assert.equal((await bridge(f, '/api/viber/messages', own)).status, 200, 'a re-read writes nothing new');

    // A name-only chat (Viber hides the number): still my message, in the conversation by the name.
    const noPhone = { key: 'out|Аня|10:01|def456', chat: 'Аня', mine: true, text: 'Ок', received_at: '2026-11-20T10:01:00+01:00' };
    const kept = f.store.getEvent((await (await bridge(f, '/api/viber/messages', noPhone)).json() as { id: string }).id)!;
    assert.equal(kept.author, 'me');
    assert.equal(conversationOf(kept), 'viber:Аня');
  } finally { await f.stop(); }
});

test('the channel state is a pulse; a change becomes a system event in the feed', async () => {
  const f = await fixture();
  try {
    assert.equal((await bridge(f, '/api/viber/pulse', { state: 'ok' })).status, 204);
    assert.equal((await bridge(f, '/api/viber/pulse', { state: 'logged_out', detail: 'Viber ждёт входа по QR-коду' })).status, 204);
    assert.equal(f.store.status.get('viber')?.state, 'login_required');
    assert.equal((await bridge(f, '/api/viber/pulse', { state: 'unverified', detail: 'Самопроверка кликов не пройдена' })).status, 204);
    assert.equal(f.store.status.get('viber')?.state, 'error');
    const page = await (await f.request('/api/events?limit=50')).json() as { events: { kind: string; payload: { text?: string } }[] };
    const notes = page.events.filter((item) => item.kind === 'system').map((item) => item.payload.text);
    assert.ok(notes.includes('Viber: нужен вход — Viber ждёт входа по QR-коду'), JSON.stringify(notes));
    assert.ok(notes.includes('Viber: ошибка — Самопроверка кликов не пройдена'), JSON.stringify(notes));
  } finally { await f.stop(); }
});

test('a reply to Viber goes by phone: an action the bridge takes, sends and reports', async () => {
  const f = await fixture();
  try {
    const reply = { id: randomUUID(), schema_version: 1, source: 'app', author: 'me', ts: '2026-11-20T09:00:00.000Z', kind: 'text',
      payload: { text: 'Добрый день, цены прежние', data: { outbound: { connector: 'viber', chat_id: '+375290000001', chat_title: 'Пётр' } } } };
    assert.equal((await f.request('/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(reply) })).status, 201);
    const byName = { ...reply, id: randomUUID(), payload: { ...reply.payload, data: { outbound: { connector: 'viber', chat_id: 'Неизвестно' } } } };
    assert.equal((await f.request('/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(byName) })).status, 400, 'never by a name');

    const next = await bridge(f, '/api/viber/actions/next');
    assert.equal(next.status, 200);
    const action = await next.json() as { id: string; phone: string; text: string };
    assert.equal(action.phone, '+375290000001');
    assert.equal(action.text, 'Добрый день, цены прежние');
    assert.equal(f.store.actions.get(action.id)?.status, 'running');
    assert.equal((await bridge(f, '/api/viber/actions/next')).status, 204, 'one at a time');
    assert.equal((await bridge(f, `/api/viber/actions/${action.id}`, { status: 'done' })).status, 204);
    assert.equal(f.store.actions.get(action.id)?.status, 'done');

    // A send left running when the bridge restarts is not sent again.
    const second = { ...reply, id: randomUUID(), payload: { ...reply.payload, text: 'Ещё' } };
    await f.request('/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(second) });
    const taken = await (await bridge(f, '/api/viber/actions/next')).json() as { id: string };
    assert.equal((await bridge(f, '/api/viber/hello')).status, 204);
    assert.equal(f.store.actions.get(taken.id)?.status, 'failed');
    assert.match(f.store.actions.get(taken.id)?.error ?? '', /проверьте в Viber/);
    assert.equal((await bridge(f, `/api/viber/actions/${taken.id}`, { status: 'sideways' })).status, 400);
  } finally { await f.stop(); }
});

test('the client: a Viber chat with a phone is that number conversation and is answered by phone', () => {
  const event = { id: 'e1', author: 'contact:viber:+375290000001', source: 'viber', kind: 'text', ts: '2026-11-20T07:55:45.000Z',
    payload: { text: 'Привет', data: { viber: { chat: 'Пётр', phone: '+375290000001', received_at: '2026-11-20T07:55:45.000Z' } } } };
  const chat = chatOf(event);
  assert.deepEqual(chat, { key: 'viber|+375290000001', account: 'viber', chat_id: '+375290000001', title: 'Пётр', group: false });
  assert.equal(conversationOf(event), 'tel:+375290000001');
  assert.equal(sourceKey(event), 'viber');
  assert.equal(replyWindowClosed(chat, []), false, 'no 24 h window');
  assert.deepEqual(outboundData(chat, undefined, {}), { connector: 'viber', chat_id: '+375290000001', chat_title: 'Пётр' });
  assert.equal(messengerLabel(event).head, 'Viber · Пётр · +375290000001');
  assert.equal(deliveryText({ status: 'done', connector: 'viber' }), '✓ в Viber');
  assert.equal(deliveryText({ status: 'done', connector: 'telegram_by' }), '✓ в Telegram');

  const hidden = { ...event, author: 'contact:viber:Неизвестно', payload: { text: 'Здравствуйте', data: { viber: { chat: 'Неизвестно', received_at: event.ts } } } };
  assert.equal(conversationOf(hidden), 'viber:Неизвестно');
  assert.equal(phoneAnswerable(chatOf(hidden)), false, 'no phone — no reply from the feed');
  const reply = { ...event, author: 'me', source: 'app', payload: { text: 'Ок', data: { outbound: { connector: 'viber', chat_id: '+375290000001', chat_title: 'Пётр' } } } };
  assert.equal(conversationOf(reply), 'tel:+375290000001', 'my reply joins the same conversation');
});
