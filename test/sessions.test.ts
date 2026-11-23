import assert from 'node:assert/strict';
import { test } from 'node:test';
import { event } from './helpers.ts';
import { conversationOf, sessionsOf, contextSessions } from '../src/tasks/sessions.ts';
import type { JournalEvent } from '../src/contracts/validate.ts';

// Conversations and sessions for the triage (CONCEPT.md §2.8, triage-ai-v19). Numbers and texts are made up.
const HOUR = 3_600_000;
const at = (iso: string, text = 'сообщение', extra: Partial<JournalEvent> = {}): JournalEvent => event({ ts: iso, received_at: iso, payload: { text }, ...extra });
const call = (number: string, ts = '2026-11-20T10:00:00.000Z') => event({ source: 'android_phone', kind: 'call', ts, payload: { data: { call: { direction: 'in', number } } } });

test('a conversation is the queue one: a chat, one number across calls, SMS and messengers, my notes', () => {
  assert.equal(conversationOf(call('+48 600 100 200')), 'tel:+48600100200');
  assert.equal(conversationOf(event({ source: 'android_phone', kind: 'sms', payload: { data: { sms: { direction: 'in', number: '+48600100200' } } } })), 'tel:+48600100200');
  assert.notEqual(conversationOf(call('+48600100200')), conversationOf(call('+48600100300')), 'calls of two people are two conversations');
  assert.equal(conversationOf(event({ source: 'viber', author: 'contact:viber:+48600100200', payload: { text: 'x', data: { viber: { chat: 'Анна', phone: '+48600100200' } } } })), 'tel:+48600100200');
  assert.equal(conversationOf(event({ source: 'whatsapp', author: 'contact:whatsapp:+48600100200', payload: { text: 'x', data: { whatsapp: { jid: '1@s.whatsapp.net', phone: '+48600100200' } } } })), 'tel:+48600100200');
  assert.equal(conversationOf(event({ source: 'telegram', author: 'contact:tg:by:7001', payload: { text: 'x', data: { telegram: { account: 'by', chat_id: '7001' } } } })), 'tg:7001');
  assert.equal(conversationOf(event({ payload: { text: 'купить кабель' } })), 'me');
  assert.equal(conversationOf(call('')), 'phone', 'a hidden number keeps the old phone stream');
});

test('sessions split where the pause is longer than the gap, in message time', () => {
  const a = at('2026-11-20T09:00:00.000Z'); const b = at('2026-11-20T11:00:00.000Z');
  const c = at('2026-11-20T18:00:00.000Z'); const d = at('2026-11-20T18:30:00.000Z');
  assert.deepEqual(sessionsOf([c, a, d, b], 4 * HOUR).map((session) => session.map((item) => item.id)), [[a.id, b.id], [c.id, d.id]]);
});

test('context is the last session; each step back adds the one before it; `more` says if there is one', () => {
  const old = at('2026-11-18T10:00:00.000Z'); const yesterday = [at('2026-11-19T20:00:00.000Z'), at('2026-11-19T20:10:00.000Z')];
  const today = at('2026-11-20T10:00:00.000Z');
  const history = [old, ...yesterday, today];
  const last = contextSessions(history, { gapMs: 4 * HOUR, steps: 0, limit: 60 });
  assert.deepEqual(last.events.map((item) => item.id), [today.id]);
  assert.equal(last.more, true);
  const back = contextSessions(history, { gapMs: 4 * HOUR, steps: 1, limit: 60 });
  assert.deepEqual(back.events.map((item) => item.id), [...yesterday.map((item) => item.id), today.id]);
  const all = contextSessions(history, { gapMs: 4 * HOUR, steps: 2, limit: 60 });
  assert.equal(all.events.length, 4);
  assert.equal(all.more, false, 'nothing earlier');
  assert.deepEqual(contextSessions([], { gapMs: HOUR, steps: 0, limit: 60 }), { events: [], more: false });
});

test('a long session keeps its newest messages up to the limit', () => {
  const long = Array.from({ length: 5 }, (_, index) => at(`2026-11-20T10:0${index}:00.000Z`));
  assert.deepEqual(contextSessions(long, { gapMs: HOUR, steps: 0, limit: 3 }).events.map((item) => item.id), long.slice(2).map((item) => item.id));
});
