import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateEvent } from '../src/contracts/validate.ts';
import { event } from './helpers.ts';

test('valid event input and output satisfy the versioned schema', () => {
  validateEvent(event());
  validateEvent(event({ kind: 'voice', payload: { media: [{ media_id: 'a'.repeat(64), mime: 'audio/webm', duration_s: 1, size_bytes: 20 }] } }));
  validateEvent(event({ received_at: new Date().toISOString(), reply_to: null, topic_hint: null }));
});

test('schema rejects invalid fields, formats and nested payloads', () => {
  const { ts, ...missingTs } = event();
  for (const invalid of [
    { ...event(), kind: 'unknown' }, missingTs, { ...event(), extra: 1 },
    { ...event(), id: 'bad' }, { ...event(), ts: '2026-02-30T10:00:00Z' },
    { ...event(), ts: 'today' }, { ...event(), source: 'UPPER' }, { ...event(), author: 'other' },
    { ...event(), payload: { extra: true } }, { ...event(), schema_version: 2 },
    { ...event(), payload: { media: [{ mime: 'image/png' }] } },
    { ...event(), payload: { media: [{ media_id: 'abc', mime: 'audio/webm', duration_s: -1 }] } },
    { ...event(), payload: { media: [{ media_id: 'abc', mime: 'audio/webm', size_bytes: 1.5 }] } },
    { ...event(), payload: { ref: { type: 'wrong', id: '123' } } }, null, [],
  ]) assert.throws(() => validateEvent(invalid), /400/);
});

test('owner tags are optional, validated per item and accept Cyrillic', () => {
  validateEvent(event({ payload: { text: 'x', tags: ['#расход', '#naserwis', '#a_b-1'] } }));
  for (const tags of [['расход'], ['#'], ['#два слова'], '#расход', [1]] as unknown as string[][]) {
    assert.throws(() => validateEvent(event({ payload: { text: 'x', tags } })), /400/);
  }
});
