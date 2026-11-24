import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { pendingDraft, draftSent } from '../web/taskdraft.js';

// The draft of a #поручить task waits in the input of the conversation with the executor until sent or cleared.
// Data is made up.
const view = (author: string, text: string, ts: string) => ({ deleted: false, text, event: { author, ts, kind: 'text', payload: { text } } });
const conversation = (extra: unknown[] = []) => ({ key: 'by|7410', views: [view('contact:tg:by:7410', 'привет', '2026-11-24T09:00:00Z'), ...extra] });
const task = (over: Record<string, unknown> = {}) => ({ id: 't1', title: 'Привезти роутер', status: 'todo', draft: 'Алекс, привези роутер завтра', roles: { executors: ['tg:7410'] },
  createdAt: '2026-11-24T10:00:00Z', updatedAt: '2026-11-24T10:00:00Z', ...over });

test('the draft of an open task for the interlocutor is pending', () => {
  assert.deepEqual(pendingDraft(conversation(), [task()]), { task: task(), text: 'Алекс, привези роутер завтра' });
});

test('no draft for another person, a closed task, a cleared draft, my notes or a task conversation', () => {
  assert.equal(pendingDraft(conversation(), [task({ roles: { executors: ['tg:9'] } })]), null);
  assert.equal(pendingDraft(conversation(), [task({ status: 'done' })]), null);
  assert.equal(pendingDraft(conversation(), [task({ draft: '' })]), null, 'cleared with ✕');
  assert.equal(pendingDraft({ ...conversation(), key: 'me' }, [task({ roles: { executors: ['me'] } })]), null);
  assert.equal(pendingDraft({ ...conversation(), key: 'task:t1' }, [task()]), null);
});

test('any message of mine after the task handles the draft: sent, edited or other', () => {
  const sent = (text: string, ts = '2026-11-24T10:05:00Z') => conversation([view('me', text, ts)]);
  assert.equal(pendingDraft(sent('Алекс, привези роутер завтра'), [task()]), null);
  assert.equal(pendingDraft(sent('Алекс, роутер нужен к 10'), [task()]), null, 'edited');
  assert.equal(draftSent(task(), sent('другое сообщение')), true);
  assert.notEqual(pendingDraft(sent('привет', '2026-11-24T09:30:00Z'), [task()]), null, 'before the task: not it');
});

test('a group never gets the draft, nor a conversation with someone else too', () => {
  const group = { key: 'by|-100', views: [{ deleted: false, text: 'привет', event: { author: 'contact:tg:by:7410', ts: '2026-11-24T09:00:00Z', kind: 'text',
    payload: { text: 'привет', data: { telegram: { account: 'by', chat_id: '-100', chat_type: 'group', chat_title: 'Бригада' } } } } }] };
  assert.equal(pendingDraft(group, [task()]), null);
  assert.equal(pendingDraft(conversation([view('contact:tg:by:9', 'я тоже', '2026-11-24T09:10:00Z')]), [task()]), null);
});

test('the executor is found through the points of the same person', () => {
  const people = [{ id: 'p1', status: 'active', createdAt: '2026-11-01T00:00:00Z', points: ['tel:+48500100200', 'tg:7410'] }];
  const phone = { key: 'tel:+48500100200', views: [view('contact:viber:+48500100200', 'привет', '2026-11-24T09:00:00Z')] };
  assert.equal(pendingDraft(phone, [task()]), null, 'no directory: another string');
  assert.notEqual(pendingDraft(phone, [task()], people), null);
  assert.equal(pendingDraft(phone, [task()], [{ ...people[0]!, points: ['tel:+48500100200'] }]), null, 'tg: is not the same person');
});
