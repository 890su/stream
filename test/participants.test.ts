import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { participants, toggleRole, removeParticipant, ROLE_TITLES } from '../web/participants.js';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { whenChoices } from '../web/taskbar.js';

// Participants of a task and their roles (CONCEPT.md §2.8 roles). Parties are made up.
const roles = { author: 'tg:501', responsible: 'me', executors: ['me', 'tg:7'], controller: null, watchers: ['tg:501'], counterparty: null };

test('participants: each party once with its roles, me first', () => {
  assert.deepEqual(participants({ roles }), [
    { party: 'me', roles: ['responsible', 'executors'] },
    { party: 'tg:501', roles: ['author', 'watchers'] },
    { party: 'tg:7', roles: ['executors'] },
  ]);
  assert.equal(ROLE_TITLES.executors, 'Исполнитель');
});

test('a single role moves to the new party; a list role is added or taken away', () => {
  assert.deepEqual(toggleRole(roles, 'tg:7', 'responsible'), { responsible: 'tg:7' });
  assert.deepEqual(toggleRole(roles, 'me', 'responsible'), { responsible: null });
  assert.deepEqual(toggleRole(roles, 'tg:9', 'executors'), { executors: ['me', 'tg:7', 'tg:9'] });
  assert.deepEqual(toggleRole(roles, 'tg:7', 'executors'), { executors: ['me'] });
});

test('removing a participant takes every role away from them', () => {
  assert.deepEqual(removeParticipant(roles, 'tg:501'), { author: null, watchers: [] });
  assert.deepEqual(removeParticipant(roles, 'tg:999'), {});
});

test('«Когда?» as icons: today, tomorrow, this week, each with its words for the screen reader', () => {
  const choices = whenChoices(new Date('2026-11-19T12:00:00'));
  assert.deepEqual(choices.map((item: any) => [item.icon, item.label, item.due]), [
    ['☀', 'сегодня', '2026-11-19'], ['🌙', 'завтра', '2026-11-20'], ['🗓', 'на неделе', '2026-11-20'],
  ]);
});
