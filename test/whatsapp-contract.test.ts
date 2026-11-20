import assert from 'node:assert/strict';
import { test } from 'node:test';
import { event, temporaryStore } from './helpers.ts';
import { checkWhatsapp, whatsappAccountOf } from '../src/contracts/whatsapp.ts';
import { checkTelegram } from '../src/contracts/telegram.ts';

const wa = { account: 'pl', chat: 'Anna', jid: '48500000001@s.whatsapp.net', phone: '+48500000001', received_at: '2026-11-20T10:00:00.000Z' };
const msg = event({ source: 'whatsapp', author: 'contact:whatsapp:+48500000001', kind: 'text', payload: { text: 'Cześć', data: { whatsapp: wa } } });
const reply = (chat_id: string) => event({ source: 'app', author: 'me', kind: 'text',
  payload: { text: 'Dzień dobry', data: { outbound: { connector: 'whatsapp_pl', chat_id, chat_title: 'Anna' } } } });

test('a WhatsApp message with data.whatsapp is written', () => {
  const storage = temporaryStore();
  try {
    assert.equal(storage.store.appendEvent(msg).created, true);
  } finally { storage.cleanup(); }
});

test('data.whatsapp only with source whatsapp', () => {
  assert.throws(() => checkWhatsapp({ ...msg, source: 'app' }), /source: whatsapp/);
});

test('a whatsapp message needs data.whatsapp', () => {
  assert.throws(() => checkWhatsapp({ ...msg, payload: { text: 'Cześć', data: {} } }), /data\.whatsapp/);
});

test('a WhatsApp message is text, voice, photo or file', () => {
  assert.throws(() => checkWhatsapp({ ...msg, kind: 'call' }), /text, voice, photo или file/);
  assert.doesNotThrow(() => checkWhatsapp({ ...msg, kind: 'voice' }));
});

test('an unknown WhatsApp account is refused', () => {
  assert.throws(() => checkWhatsapp({ ...msg, payload: { text: 'Cześć', data: { whatsapp: { ...wa, account: 'xx' } } } }), /аккаунт/);
});

test('a LID address without a phone is valid', () => {
  const { phone: _phone, ...noPhone } = wa;
  const lid = { ...msg, author: 'contact:whatsapp:Anna', payload: { text: 'Cześć', data: { whatsapp: { ...noPhone, jid: '123456789012345@lid' } } } };
  assert.doesNotThrow(() => checkWhatsapp(lid));
  const storage = temporaryStore();
  try {
    assert.equal(storage.store.appendEvent(lid).created, true);
  } finally { storage.cleanup(); }
});

test('a reply to WhatsApp goes only to a phone', () => {
  assert.doesNotThrow(() => checkTelegram(reply('+48500000001')));
  assert.doesNotThrow(() => checkWhatsapp(reply('+48500000001')));
  assert.throws(() => checkWhatsapp(reply('12345')), /номер/);
});

test('whatsappAccountOf maps connectors', () => {
  assert.equal(whatsappAccountOf('whatsapp_pl'), 'pl');
  assert.equal(whatsappAccountOf('telegram_pl'), undefined);
});
