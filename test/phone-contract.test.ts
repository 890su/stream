import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture, event } from './helpers.ts';

const call = (data: Record<string, unknown>, payload: Record<string, unknown> = {}) =>
  event({ source: 'android_phone', kind: 'call', payload: { ...payload, data: { call: data } } });
const sms = (data: Record<string, unknown>, text?: string) =>
  event({ source: 'android_phone', kind: 'sms', payload: { ...(text === undefined ? {} : { text }), data: { sms: data } } });

test('call and sms events follow the contract', async () => {
  const f = await fixture();
  const post = (body: unknown) => f.request('/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const started = '2026-11-17T09:00:00.000Z';
  try {
    assert.equal((await post(call({ direction: 'in', number: '+48500000001', started_at: started, duration_s: 61 }))).status, 201);
    assert.equal((await post(call({ direction: 'missed', number: '', started_at: started }))).status, 201, 'hidden number');
    assert.equal((await post(call({ direction: 'sideways', started_at: started }))).status, 400);
    assert.equal((await post(call({ direction: 'in', started_at: started, duration_s: -1 }))).status, 400);
    assert.equal((await post(call({ direction: 'in' }))).status, 400, 'started_at is required');
    assert.equal((await post(event({ source: 'android_phone', kind: 'call', payload: {} }))).status, 400, 'call needs data.call');
    assert.equal((await post(call({ direction: 'in', started_at: started }, { text: 'x' }))).status, 400, 'a call has no text');

    assert.equal((await post(sms({ direction: 'in', number: '+48500000002', sent_at: started }, 'Будем в 10'))).status, 201);
    assert.equal((await post(sms({ direction: 'out', number: '+48500000002', sent_at: started }, 'Хорошо'))).status, 201);
    assert.equal((await post(sms({ direction: 'missed', number: '+48500000002', sent_at: started }, 'x'))).status, 400);
    assert.equal((await post(sms({ direction: 'in', number: '+48500000002', sent_at: started }))).status, 400, 'sms needs text');
    assert.equal((await post(sms({ direction: 'in', number: '+48500000002', sent_at: started }, '  '))).status, 400, 'blank text');

    assert.equal((await post(event({ payload: { text: 'x', data: { call: { direction: 'in', started_at: started } } } }))).status, 400, 'data.call only on a call');
    assert.equal((await post(event({ payload: { text: 'x', data: { sms: { direction: 'in', number: '1', sent_at: started } } } }))).status, 400, 'data.sms only on an sms');
  } finally { await f.stop(); }
});
