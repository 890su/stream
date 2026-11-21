import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { systemGroups, cardFacts } from '../web/systemcards.js';

// The System screen by cards (owner, 2026-11-21): channels and services; what needs attention first.
const source = (id: string, state: string, extra: Record<string, unknown> = {}) => ({ source: id, title: id, state, on: state !== 'off', pulse_at: null, last_event_at: null, detail: null, failed_24h: 0, ...extra });

test('channels and services in a fixed order; a connection with a problem is lifted into «Требуют внимания»; one switched off is not a problem', () => {
  const groups = systemGroups([
    source('ai_triage', 'login_required', { detail: 'нет ключа' }), source('viber', 'ok'), source('telegram_pl', 'ok'), source('google_calendar', 'off'),
    source('telegram_by', 'error'), source('whatsapp_pl', 'ok', { failed_24h: 2 }), source('android_phone', 'silent'),
  ]);
  assert.deepEqual(groups.attention.map((item: any) => item.source), ['telegram_by', 'whatsapp_pl', 'android_phone', 'ai_triage']);
  assert.deepEqual(groups.channels.map((item: any) => item.source), ['telegram_by', 'telegram_pl', 'whatsapp_pl', 'viber', 'android_phone']);
  assert.deepEqual(groups.services.map((item: any) => item.source), ['google_calendar', 'ai_triage']);
  assert.deepEqual(systemGroups([source('viber', 'unset')]).attention, [], 'never set up is not a problem');
  assert.equal(cardFacts(source('viber', 'unset')).state, 'не подключён');
});

test('a card says its state in words and when it was last heard from', () => {
  const now = Date.parse('2026-11-21T12:00:00Z');
  const ok = cardFacts(source('telegram_by', 'ok', { last_event_at: '2026-11-21T11:55:00Z' }), now);
  assert.deepEqual([ok.state, ok.when, ok.attention], ['работает', 'сообщение 5 мин назад', false]);
  const off = cardFacts(source('viber', 'off'), now);
  assert.deepEqual([off.state, off.attention], ['выключен', false]);
  const failed = cardFacts(source('whatsapp_pl', 'ok', { failed_24h: 2, pulse_at: '2026-11-21T11:59:30Z' }), now);
  assert.deepEqual([failed.state, failed.when, failed.attention], ['работает · не отправлено: 2', 'сигнал только что', true]);
  assert.equal(cardFacts(source('android_phone', 'silent'), now).when, 'ещё ни разу');
  assert.match(cardFacts(source('telegram_by', 'ok'), now).guide!, /TELEGRAM\.md$/);
});
