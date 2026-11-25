import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture, event } from './helpers.ts';
import type { JournalEvent } from '../src/contracts/validate.ts';

const correction = (target: string, data: Record<string, unknown>, payload: Partial<JournalEvent['payload']> = {}) =>
  event({ kind: 'correction', payload: { ref: { type: 'event', id: target }, data, ...payload } });

test('owner corrections reference an accepted message and carry a known operation', async () => {
  const f = await fixture();
  const post = (body: unknown) => f.request('/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const original = event({ payload: { text: 'купить кабель' } });
    assert.equal((await post(original)).status, 201);
    const photo = event({ kind: 'photo', payload: { text: 'подпись' } });
    assert.equal((await post(photo)).status, 201);

    for (const op of ['archive', 'unarchive', 'delete', 'restore', 'answered', 'unanswered', 'split', 'unsplit']) assert.equal((await post(correction(original.id, { op }))).status, 201, op);
    const edit = correction(original.id, { op: 'edit' }, { text: 'купить кабель UTP', tags: ['#закупка'] });
    assert.equal((await post(edit)).status, 201);
    assert.equal((await post(edit)).status, 200, 'retry is idempotent');

    assert.equal((await post(correction(crypto.randomUUID(), { op: 'archive' }))).status, 422, 'unknown target');
    assert.equal((await post(correction(edit.id, { op: 'archive' }))).status, 400, 'a correction cannot be corrected');
    assert.equal((await post(correction(original.id, { op: 'erase' }))).status, 400, 'unknown operation');
    assert.equal((await post(correction(original.id, { op: 'edit' }))).status, 400, 'edit needs text');
    assert.equal((await post(correction(original.id, { op: 'edit' }, { text: '  ' }))).status, 400, 'text message cannot become empty');
    assert.equal((await post(event({ kind: 'correction', payload: { data: { op: 'archive' } } }))).status, 400, 'ref is required');
    assert.equal((await post(event({ kind: 'correction', payload: { ref: { type: 'task', id: original.id }, data: { op: 'archive' } } }))).status, 400, 'only events');
    assert.equal((await post(correction(photo.id, { op: 'edit' }, { text: '' }))).status, 201, 'a caption can be removed');
  } finally { await f.stop(); }
});

test('queue marks: snooze needs a date and time, requeue and the undos need nothing', async () => {
  const f = await fixture();
  const post = (body: unknown) => f.request('/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const original = event({ payload: { text: 'когда приедете?' } });
    assert.equal((await post(original)).status, 201);
    for (const data of [{ op: 'snooze' }, { op: 'snooze', until: 'завтра' }]) {
      const response = await post(correction(original.id, data));
      assert.equal(response.status, 400, JSON.stringify(data));
      assert.match((await response.json()).error, /Отложить можно только до даты и времени \(until\)/);
    }
    assert.equal((await post(correction(original.id, { op: 'snooze', until: '2026-11-21T09:00:00.000Z' }))).status, 201);
    for (const op of ['unsnooze', 'requeue', 'unrequeue']) assert.equal((await post(correction(original.id, { op }))).status, 201, op);
  } finally {
    await f.stop();
  }
});

test('«✕» on an AI proposal names the proposal it rejects', async () => {
  const f = await fixture();
  const post = (body: unknown) => f.request('/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const original = event({ payload: { text: 'ecolofin сделал' } });
    assert.equal((await post(original)).status, 201);
    for (const data of [{ op: 'reject_proposal' }, { op: 'reject_proposal', proposal: 'не id' }]) {
      const response = await post(correction(original.id, data));
      assert.equal(response.status, 400, JSON.stringify(data));
      assert.match((await response.json()).error, /Отказ от предложения ИИ должен указывать proposal/);
    }
    assert.equal((await post(correction(original.id, { op: 'reject_proposal', proposal: '00000000-0000-4000-8000-000000000777' }))).status, 201);
  } finally {
    await f.stop();
  }
});

test('answer_question validates option index or text', async () => {
  const f = await fixture();
  const post = (body: unknown) => f.request('/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const original = event({ payload: { text: 'отправь посылку' } });
    assert.equal((await post(original)).status, 201);
    const question = '00000000-0000-4000-8000-000000000888';
    for (const data of [{}, { question: 'не id', option: 0 }, { question }, { question, option: 0, text: 'и то и другое' }, { question, option: -1 },
      { question, option: 1.5 }, { question, option: 3 }, { question, option: '0' }, { question, text: '  ' }, { question, text: 'я'.repeat(501) }]) {
      const response = await post(correction(original.id, { op: 'answer_question', ...data }));
      assert.equal(response.status, 400, JSON.stringify(data));
      assert.match((await response.json()).error, /Ответ на вопрос ИИ|data\.(question|option)/, 'the schema or the shape check names the field');
    }
    assert.equal((await post(correction(original.id, { op: 'answer_question', question, option: 2 }))).status, 201);
    assert.equal((await post(correction(original.id, { op: 'answer_question', question, text: 'это подарок, ничего не нужно' }))).status, 201);
  } finally {
    await f.stop();
  }
});

test('a read mark needs only the message it points at', async () => {
  const f = await fixture();
  const post = (body: unknown) => f.request('/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const original = event({ payload: { text: 'когда приедете?' } });
    assert.equal((await post(original)).status, 201);
    assert.equal((await post(correction(original.id, { op: 'read' }))).status, 201);
    assert.equal((await post(correction(original.id, { op: 'erase' }))).status, 400, 'unknown operation');
  } finally {
    await f.stop();
  }
});
