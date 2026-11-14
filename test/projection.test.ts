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

test('related messages follow reply links in both directions; versions run from the source to the current text', async () => {
  // @ts-expect-error Browser modules are deliberately buildless JavaScript.
  const { related, versions } = await import('../web/projection.js');
  const root = message('заявка'), a = message('ответ 1', { reply_to: root.id }), b = message('ответ на ответ', { reply_to: a.id });
  const other = message('другое'), gone = message('удалённый ответ', { reply_to: root.id });
  const views = project([root, a, b, other, gone, fix(gone.id, 'delete'), fix(a.id, 'edit', { text: 'ответ 1, исправлен' }), fix(a.id, 'edit', { text: 'ответ 1, финал' })]);
  for (const from of [root.id, a.id, b.id]) assert.deepEqual(related(views, from).map((view: { text: string }) => view.text), ['заявка', 'ответ 1, финал', 'ответ на ответ']);
  assert.deepEqual(related(views, other.id).map((view: { text: string }) => view.text), ['другое']);
  const edited = views.find((view: { id: string }) => view.id === a.id);
  assert.deepEqual(versions(edited).map((item: { label: string; text: string }) => [item.label, item.text]),
    [['Исходное', 'ответ 1'], ['Редакция 1', 'ответ 1, исправлен'], ['Текущая', 'ответ 1, финал']]);
  assert.equal(versions(edited)[0].at, a.ts);
  assert.deepEqual(versions(views[0]).map((item: { label: string }) => item.label), ['Без правок']);
});

test('messages in a row join one bubble; a pause, a new day or a reply starts the next', async () => {
  // @ts-expect-error Browser modules are deliberately buildless JavaScript.
  const { bursts, chains } = await import('../web/projection.js');
  const at = (time: string) => `2026-11-12T${time}:00Z`;
  const a = message('выезжаю', { ts: at('09:00') }), b = message('приехал', { ts: at('09:03') }), c = message('на машине', { ts: at('09:07') });
  const d = message('через час', { ts: at('10:30') }), e = message('ответ', { ts: at('10:31'), reply_to: d.id });
  const f = message('после полуночи', { ts: '2026-11-13T00:01:00Z' });
  const views = project([a, b, c, d, e, f]);
  assert.deepEqual(bursts(views, 5).map((group: Array<{ text: string }>) => group.map((view) => view.text)),
    [['выезжаю', 'приехал', 'на машине'], ['через час'], ['ответ'], ['после полуночи']]);
  const chain = chains(views);
  assert.deepEqual([chain.get(d.id).index, chain.get(e.id).index, chain.get(e.id).title], [0, 1, 'через час']);
  assert.equal(chain.has(a.id), false, 'a single message is not a chain');
});
