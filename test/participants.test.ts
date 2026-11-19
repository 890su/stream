import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { participants, toggleRole, removeParticipant, toggleMuted, roleLabel, ROLE_TITLES } from '../web/participants.js';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { whenChoices } from '../web/taskbar.js';

// Participants of a task and their roles (CONCEPT.md §2.8 roles). Parties are made up.
const roles = { author: 'tg:501', responsible: 'me', executors: ['me', 'tg:7'], controller: null, watchers: ['tg:501'], counterparty: null };

test('participants: each party once with its roles, plain members too, me first; switched off ones marked', () => {
  assert.deepEqual(participants({ roles: { ...roles, members: ['tg:8', 'tg:7'] }, muted: ['tg:7'] }), [
    { party: 'me', roles: ['executors', 'responsible'], muted: false },
    { party: 'tg:501', roles: ['author', 'watchers'], muted: false },
    { party: 'tg:7', roles: ['executors'], muted: true },
    { party: 'tg:8', roles: [], muted: false },
  ]);
  assert.equal(ROLE_TITLES.executors, 'Исполнитель');
  assert.equal(ROLE_TITLES.counterparty, 'Контрагент');
  assert.equal(roleLabel([]), '', '«Участник» is not shown on the tile');
  assert.equal(roleLabel(['author', 'executors']), 'Постановщик, Исполнитель');
});

test('a single role moves to the new party, the former holder stays as a participant; a list role is added or taken away', () => {
  assert.deepEqual(toggleRole(roles, 'tg:7', 'responsible'), { responsible: 'tg:7', members: ['tg:7', 'me'] });
  assert.deepEqual(toggleRole(roles, 'me', 'responsible'), { responsible: null, members: ['me'] });
  assert.deepEqual(toggleRole(roles, 'tg:9', 'executors'), { executors: ['me', 'tg:7', 'tg:9'], members: ['tg:9'] });
  assert.deepEqual(toggleRole(roles, 'tg:7', 'executors'), { executors: ['me'], members: ['tg:7'] });
  assert.deepEqual(toggleRole(roles, 'tg:5', 'counterparty'), { counterparty: 'tg:5', members: ['tg:5'] });
});

test('«Участник»: every role of the party off, the party kept', () => {
  assert.deepEqual(toggleRole(roles, 'tg:501', 'members'), { author: null, watchers: [], members: ['tg:501'] });
});

test('removing a participant takes every role and the membership away; a tap on the name switches them off and on', () => {
  assert.deepEqual(removeParticipant(roles, 'tg:501'), { author: null, watchers: [] });
  assert.deepEqual(removeParticipant({ ...roles, members: ['tg:8'] }, 'tg:8'), { members: [] });
  assert.deepEqual(removeParticipant(roles, 'tg:999'), {});
  assert.deepEqual(toggleMuted({ muted: ['tg:7'] }, 'tg:7'), []);
  assert.deepEqual(toggleMuted({}, 'tg:7'), ['tg:7']);
});

test('an answer from the task skips the personal chat of a switched-off participant, not a group', async () => {
  // @ts-expect-error Browser modules are deliberately buildless JavaScript.
  const { answerable } = await import('../web/tasksheet.js');
  assert.equal(answerable({ reply: { chat_id: '7', group: false } }, ['tg:7']), false);
  assert.equal(answerable({ reply: { chat_id: '7', group: false } }, []), true);
  assert.equal(answerable({ reply: { chat_id: '-100', group: true } }, ['tg:7']), true);
  assert.equal(answerable({ reply: null }, []), false);
});

test('«Когда?» as icons: today, tomorrow, this week, each with its words for the screen reader', () => {
  const choices = whenChoices(new Date('2026-11-19T12:00:00'));
  assert.deepEqual(choices.map((item: any) => [item.icon, item.label, item.due]), [
    ['☀', 'сегодня', '2026-11-19'], ['🌙', 'завтра', '2026-11-20'], ['🗓', 'на неделе', '2026-11-20'],
  ]);
});
