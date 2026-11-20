import assert from 'node:assert/strict';
import { test } from 'node:test';
import { partyOf } from '../src/tasks/parties.ts';
import { quietOf, streamOf } from '../src/tasks/triage.ts';
import type { JournalEvent } from '../src/contracts/validate.ts';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { chatOf, sourceKey } from '../web/projection.js';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { conversationOf } from '../web/conversations.js';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { outboundData, replyWindowClosed, phoneAnswerable } from '../web/outbound.js';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { messengerLabel, deliveryText } from '../web/tgbubble.js';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { partyOf as webPartyOf } from '../web/parties.js';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { showsQr, qrNext } from '../web/system.js';

const event = { id: 'w1', author: 'contact:whatsapp:+48500000001', source: 'whatsapp', kind: 'text', ts: '2026-11-20T10:00:00.000Z', schema_version: 1,
  payload: { text: 'Cześć', data: { whatsapp: { account: 'pl', chat: 'Anna', jid: '48500000001@s.whatsapp.net', phone: '+48500000001', received_at: '2026-11-20T10:00:00.000Z' } } } };
const reply = { id: 'r1', author: 'me', source: 'app', kind: 'text', ts: '2026-11-20T10:05:00.000Z', schema_version: 1,
  payload: { text: 'Dzień dobry', data: { outbound: { connector: 'whatsapp_pl', chat_id: '+48500000001', chat_title: 'Anna' } } } };
const lidOnly = { ...event, author: 'contact:whatsapp:Anna',
  payload: { text: 'Cześć', data: { whatsapp: { account: 'pl', chat: 'Anna', jid: '1234@lid', received_at: '2026-11-20T10:00:00.000Z' } } } };

test('a WhatsApp chat with a phone is that number conversation', () => {
  assert.deepEqual(chatOf(event), { key: 'whatsapp_pl|+48500000001', account: 'whatsapp_pl', chat_id: '+48500000001', title: 'Anna', group: false });
  assert.equal(conversationOf(event), 'tel:+48500000001');
  assert.equal(sourceKey(event), 'whatsapp');
});

test('a reply goes to the whatsapp connector by phone', () => {
  const chat = chatOf(event);
  assert.equal(replyWindowClosed(chat, []), false);
  assert.deepEqual(outboundData(chat, undefined, {}), { connector: 'whatsapp_pl', chat_id: '+48500000001', chat_title: 'Anna' });
  assert.equal(conversationOf(reply), 'tel:+48500000001', 'my reply joins the same conversation');
  assert.deepEqual(chatOf(reply), { key: 'whatsapp_pl|+48500000001', account: 'whatsapp_pl', chat_id: '+48500000001', title: 'Anna', group: false });
  assert.equal(sourceKey(reply), 'whatsapp');
});

test('without a phone: own conversation, no reply from the feed', () => {
  assert.equal(conversationOf(lidOnly), 'wa:1234@lid');
  assert.deepEqual(chatOf(lidOnly), { key: 'whatsapp_pl|1234@lid', account: 'whatsapp_pl', chat_id: '', title: 'Anna', group: false });
  assert.equal(phoneAnswerable(chatOf(lidOnly)), false);
  assert.equal(phoneAnswerable(chatOf(event)), true);
});

test('labels say WhatsApp', () => {
  assert.equal(messengerLabel(event).head, 'WhatsApp PL · Anna · +48500000001');
  assert.equal(messengerLabel(event).incoming, true);
  assert.equal(messengerLabel({ ...event, author: 'me' }).incoming, false);
  assert.equal(messengerLabel(reply).head, '→ WhatsApp PL · Anna');
  assert.equal(deliveryText({ status: 'done', connector: 'whatsapp_pl' }), '✓ в WhatsApp');
});

test('the sender is one party with their calls; the stream is the phone', () => {
  assert.equal(partyOf('contact:whatsapp:+48500000001'), 'tel:+48500000001');
  assert.equal(partyOf('contact:whatsapp:Anna'), 'name:Anna');
  assert.equal(webPartyOf('contact:whatsapp:+48500000001'), 'tel:+48500000001');
  assert.equal(webPartyOf('contact:whatsapp:Anna'), 'name:Anna');
  assert.equal(streamOf(event as unknown as JournalEvent), 'whatsapp|+48500000001');
  assert.equal(streamOf(lidOnly as unknown as JournalEvent), 'whatsapp|1234@lid');
  assert.equal(streamOf(reply as unknown as JournalEvent), 'whatsapp|+48500000001');
  assert.equal(quietOf('whatsapp|+48500000001'), 180, 'a chat waits like Telegram and Viber before triage');
});

test('Viber still answers only by phone', () => {
  assert.equal(phoneAnswerable({ account: 'viber', chat_id: '' }), false);
  assert.equal(phoneAnswerable({ account: 'viber', chat_id: '+375290000001' }), true);
  assert.equal(phoneAnswerable({ account: 'by', chat_id: '123456' }), true, 'Telegram is not limited to phones');
});

test('the System screen shows the QR only while WhatsApp waits for linking', () => {
  assert.equal(showsQr({ source: 'whatsapp_pl', state: 'login_required', info: { qr: true } }), true);
  assert.equal(showsQr({ source: 'whatsapp_pl', state: 'silent', info: { qr: true } }), false, 'switched off after a QR');
  assert.equal(showsQr({ source: 'whatsapp_pl', state: 'ok', info: { qr: false } }), false);
  assert.equal(showsQr({ source: 'telegram_pl', state: 'login_required', info: { qr: true } }), false);
});

test('a missing QR is waited for, not reloaded at once', () => {
  assert.equal(qrNext(200, false), 'show');
  assert.equal(qrNext(404, false), 'wait', 'right after drawing: no new render (no request loop)');
  assert.equal(qrNext(404, true), 'refresh', 'on the timer: redraw the screen once');
  assert.equal(qrNext(500, true), 'wait');
});
