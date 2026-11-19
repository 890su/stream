import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { actionsFor, changeFor, closeChange, undoOf, dueChips, delegateOptions } from '../web/taskactions.js';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { partyName } from '../web/parties.js';

// One-tap task actions by status and roles (P14). Names and numbers are made up.
const roles = (executors: string[] = []) => ({ author: 'me', responsible: 'me', executors, controller: null, watchers: [], counterparty: null });
const task = (status: string, executors: string[] = []) => ({ id: 't1', title: 'Проверить Wi-Fi', status, roles: roles(executors) });
const NOW = new Date('2026-11-18T09:00:00Z'); // Wednesday

test('«Готово» in every open status, a new task too; it closes at once, the report waits', () => {
  for (const status of ['inbox', 'todo', 'doing', 'waiting', 'deferred']) assert.ok(actionsFor(task(status)).includes('done'), status);
  assert.equal(actionsFor(task('inbox'))[0], 'done', 'the first, primary action');
  assert.deepEqual(changeFor('done', task('todo')), { status: 'done', proposed: null });
  assert.deepEqual(changeFor('done', task('todo', ['tg:42']), undefined, NOW, ['minutes', 'cost']),
    { status: 'done', proposed: null, report: { missing: ['minutes', 'cost'] } }, 'the owner closes a delegated task too');
  assert.deepEqual(closeChange([]), { status: 'done', proposed: null });
});

test('closing again keeps a report filled before; «Вернуть» puts the old report back', () => {
  const reopened = { ...task('todo'), report: { minutes: 30, missing: ['cost'] } };
  const change = changeFor('done', reopened, undefined, NOW, ['minutes', 'cost']);
  assert.deepEqual(change, { status: 'done', proposed: null, report: { minutes: 30, missing: ['cost'] } });
  assert.deepEqual(undoOf(reopened, change), { status: 'todo', proposed: null, report: { minutes: 30, missing: ['cost'] } });
  assert.deepEqual(undoOf(task('todo'), closeChange(['cost'])), { status: 'todo', proposed: null }, 'no report before — none put back');
});

test('review is verified the same way; closed tasks reopen', () => {
  const review = actionsFor(task('review', ['tg:42']));
  assert.ok(review.includes('verify') && review.includes('reopen') && !review.includes('done'));
  assert.deepEqual(changeFor('verify', task('review', ['tg:42']), undefined, NOW, ['summary']), { status: 'done', proposed: null, report: { missing: ['summary'] } });
  assert.deepEqual(actionsFor(task('done')), ['reopen']);
  assert.deepEqual(changeFor('reopen', task('cancelled')), { status: 'todo' });
  assert.deepEqual(changeFor('cancel', task('todo')), { status: 'cancelled' });
});

test('«Вернуть» puts back exactly what a change replaced', () => {
  const proposed = { ...task('todo'), proposed: 'done', due: '2026-11-20' };
  assert.deepEqual(undoOf(proposed, closeChange(['summary'])), { status: 'todo', proposed: 'done' });
  assert.deepEqual(undoOf(task('inbox'), changeFor('accept', task('inbox'))), { status: 'inbox', roles: { executors: [] } });
  assert.deepEqual(undoOf(task('todo', ['me']), changeFor('delegate', task('todo'), 'tg:42')), { roles: { executors: ['me'], controller: null } });
  assert.deepEqual(undoOf(task('todo'), { due: '2026-11-21' }), { due: null });
  assert.deepEqual(undoOf({ ...task('deferred'), remindAt: '2026-11-19T08:00:00.000Z' }, { status: 'deferred', remind_at: '2026-11-25T08:00:00.000Z' }),
    { status: 'deferred', remind_at: '2026-11-19T08:00:00.000Z' });
  assert.deepEqual(undoOf(task('todo'), changeFor('wait', task('todo'), 'tg:42', NOW)), { status: 'todo', waiting_for: null });
});

test('accept, delegate, defer and wait changes', () => {
  assert.deepEqual(changeFor('accept', task('inbox')), { status: 'todo', roles: { executors: ['me'] } });
  assert.deepEqual(changeFor('delegate', task('todo'), 'tel:+48500100200'), { roles: { executors: ['tel:+48500100200'], controller: 'me' } });
  assert.deepEqual(changeFor('defer', task('todo'), '2026-11-20T09:00:00.000Z'), { status: 'deferred', remind_at: '2026-11-20T09:00:00.000Z' });
  const wait = changeFor('wait', task('todo'), 'tg:42', NOW);
  assert.deepEqual(wait, { status: 'waiting', waiting_for: { party: 'tg:42', since: NOW.toISOString() } });
});

test('due chips: today, tomorrow, the nearest Friday', () => {
  assert.deepEqual(dueChips(NOW).map((chip: { label: string }) => chip.label), ['сегодня', 'завтра', 'на неделе']);
  assert.equal(dueChips(new Date(2026, 10, 19, 12)).at(-1).due, '2026-11-20', 'Thursday -> this Friday');
  assert.equal(dueChips(new Date(2026, 10, 21, 12)).at(-1).due, '2026-11-27', 'Saturday -> next Friday');
  assert.equal(dueChips(new Date(2026, 10, 20, 12)).at(-1).due, '2026-11-27', 'Friday -> next Friday');
});

test('party names come from the conversations; delegate options are the authors', () => {
  const view = (author: string, data: Record<string, unknown>) => ({ event: { author, payload: { data } } });
  const views = [
    view('contact:tg:by:42', { telegram: { from_name: 'Анна Ковальская', chat_title: 'Анна Ковальская' } }),
    view('contact:tg:by:7', { telegram: { chat_type: 'group', chat_title: 'Монтажники', from_name: 'Марек' } }),
    view('me', { sms: { number: '+48500100200', name: 'Ян' } }),
    view('me', {}),
  ];
  assert.equal(partyName('tg:42', views), 'Анна Ковальская');
  assert.equal(partyName('tg:7', views), 'Марек');
  assert.equal(partyName('tel:+48500100200', []), '+48500100200');
  assert.equal(partyName('tel:+48500100200', views), 'Ян');
  assert.equal(partyName('name:Ян', []), 'Ян');
  assert.equal(partyName('ai', []), 'ИИ');
  assert.equal(partyName('tg:99', []), 'tg:99');
  assert.deepEqual(delegateOptions(views).map((option: { party: string }) => option.party), ['tg:42', 'tg:7']);
});
