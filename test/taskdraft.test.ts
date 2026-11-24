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

test('my message equal to the draft or starting with it, after the task was made, means sent', () => {
  const sent = (text: string, ts = '2026-11-24T10:05:00Z') => conversation([view('me', text, ts)]);
  assert.equal(pendingDraft(sent('Алекс, привези роутер завтра'), [task()]), null);
  assert.equal(pendingDraft(sent('  алекс,  привези роутер завтра, к 10 '), [task()]), null);
  assert.equal(draftSent(task(), sent('Алекс, привези роутер завтра')), true);
  assert.notEqual(pendingDraft(sent('Алекс, привези роутер завтра', '2026-11-24T09:30:00Z'), [task()]), null, 'before the task: not it');
  assert.notEqual(pendingDraft(sent('другое сообщение'), [task()]), null);
});
