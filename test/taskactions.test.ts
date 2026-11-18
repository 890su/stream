import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { actionsFor, changeFor, dueChips, partyName, delegateOptions } from '../web/taskactions.js';

// One-tap task actions by status and roles (P14). Names and numbers are made up.
const roles = (executors: string[] = []) => ({ author: 'me', responsible: 'me', executors, controller: null, watchers: [], counterparty: null });
const task = (status: string, executors: string[] = []) => ({ id: 't1', title: 'Проверить Wi-Fi', status, roles: roles(executors) });
const NOW = new Date('2026-11-18T09:00:00Z'); // Wednesday

test('a new task of mine: accept, delegate, defer; a delegated one is done into review', () => {
  const fresh = actionsFor(task('inbox'));
  for (const action of ['accept', 'delegate', 'defer']) assert.ok(fresh.includes(action), action);
  assert.ok(!fresh.includes('reopen'));
  const delegated = task('todo', ['tg:42']);
  assert.ok(actionsFor(delegated).includes('done'));
  assert.deepEqual(changeFor('done', delegated), { status: 'review', proposed: null });
  assert.equal(changeFor('done', task('todo', ['me'])), 'report');
  assert.equal(changeFor('done', task('todo')), 'report');
});

test('review is verified with a report; closed tasks reopen', () => {
  const review = actionsFor(task('review', ['tg:42']));
  assert.ok(review.includes('verify') && review.includes('reopen') && !review.includes('done'));
  assert.equal(changeFor('verify', task('review', ['tg:42'])), 'report');
  assert.deepEqual(actionsFor(task('done')), ['reopen']);
  assert.deepEqual(changeFor('reopen', task('cancelled')), { status: 'todo' });
  assert.deepEqual(changeFor('cancel', task('todo')), { status: 'cancelled' });
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
