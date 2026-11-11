import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { project, snippet } from '../web/projection.js';

let clock = Date.parse('2026-11-11T10:00:00Z');
const at = () => new Date(clock += 1000).toISOString();
const message = (text: string, extra: Record<string, unknown> = {}) => ({ id: crypto.randomUUID(), kind: 'text', ts: at(), payload: { text }, ...extra });
const fix = (target: string, op: string, payload: Record<string, unknown> = {}) =>
  ({ id: crypto.randomUUID(), kind: 'correction', ts: at(), payload: { ref: { type: 'event', id: target }, data: { op }, ...payload } });

test('the latest edit wins and earlier versions stay in history', () => {
  const original = message('купить кабель');
  const first = fix(original.id, 'edit', { text: 'купить кабель UTP' });
  const second = fix(original.id, 'edit', { text: 'купить кабель UTP 305 м', tags: ['#закупка'] });
  const [view] = project([second, original, first]); // arrival order does not matter
  assert.equal(view.text, 'купить кабель UTP 305 м');
  assert.deepEqual(view.tags, ['#закупка']);
  assert.equal(view.edited, true);
  assert.deepEqual(view.history.map((item: { text: string }) => item.text), ['купить кабель', 'купить кабель UTP']);
  assert.equal(view.event.payload.text, 'купить кабель', 'the source event is untouched');
});

test('archive, delete and their undo are plain state, corrections are never messages', () => {
  const a = message('a'), b = message('b');
  const views = project([a, b, fix(a.id, 'archive'), fix(b.id, 'delete'), fix(b.id, 'restore'), fix(a.id, 'unarchive'), fix(a.id, 'archive')]);
  assert.equal(views.length, 2);
  assert.deepEqual(views.map((view: { archived: boolean; deleted: boolean }) => [view.archived, view.deleted]), [[true, false], [false, false]]);
  const deleted = project([a, fix(a.id, 'delete')]);
  assert.equal(deleted[0].deleted, true);
});

test('a correction for a message not loaded yet is ignored until the message arrives', () => {
  const later = message('позже');
  const early = fix(later.id, 'edit', { text: 'исправлено' });
  assert.equal(project([early]).length, 0);
  assert.equal(project([early, later])[0].text, 'исправлено');
});

test('replies quote the current text of their parent, or say it is gone', () => {
  const parent = message('звонил Марек');
  const reply = message('перезвонить в четверг', { reply_to: parent.id });
  let views = project([parent, reply, fix(parent.id, 'edit', { text: 'звонил Марек с Урсынова' })]);
  assert.equal(snippet(views[1].replyTo), 'звонил Марек с Урсынова');
  views = project([parent, reply, fix(parent.id, 'delete')]);
  assert.equal(snippet(views[1].replyTo), 'Удалённое сообщение');
  assert.equal(snippet(project([reply])[0].replyTo), 'Сообщение');
});

test('pending corrections mark their message as waiting for the queue', () => {
  const original = message('x');
  const edit = fix(original.id, 'edit', { text: 'y' });
  assert.equal(project([original, edit], new Set([edit.id]))[0].pending, true);
  assert.equal(project([original, edit])[0].pending, false);
});
