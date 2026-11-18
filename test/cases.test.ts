import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { feedItems, shownViews, caseOf, withWhom, caseMembers } from '../web/cases.js';

// The feed of cases (CONCEPT.md §2.9). People and texts are made up.
const NOW = Date.parse('2026-11-18T12:00:00Z');
const H = 3_600_000;
const view = (id: string, hoursAgo: number, taskIds: string[] = [], data: Record<string, unknown> = {}) => ({
  id, taskIds, event: { id, ts: new Date(NOW - hoursAgo * H).toISOString(), kind: 'text', author: 'me', payload: { text: id, data } },
});
const task = (id: string, status: string, updatedAt: string, doneAt?: string) => ({ id, title: id, status, assignee: 'me', messages: [], updatedAt, doneAt });

test('messages group by their case; ordered by the last message; a message without a task stays as it is', () => {
  const tasks = new Map([
    ['wifi', task('wifi', 'todo', '2026-11-18T08:00:00Z')],
    ['diary', task('diary', 'done', '2026-11-18T09:00:00Z', '2026-11-18T09:00:00Z')],
    ['old', task('old', 'done', '2026-11-10T09:00:00Z', '2026-11-10T09:00:00Z')],
  ]);
  const chat = { telegram: { account: 'by', chat_id: '7', chat_type: 'private', chat_title: 'Клиент А', message_id: 1, sent_at: 'x' } };
  const visible = [
    view('w1', 30, ['wifi'], chat), view('note', 20), view('d1', 3, ['diary']), view('w2', 1, ['wifi', 'diary']), view('o1', 200, ['old']),
  ];
  const items = feedItems(visible, tasks, { now: new Date(NOW) });
  assert.deepEqual(items.map((item: any) => item.kind === 'case' ? `case:${item.task.id}` : item.view.id), ['note', 'case:diary', 'case:wifi'],
    'a long-finished case is out; the case with the newest message is last');
  const wifi = items.at(-1);
  assert.deepEqual(wifi.views.map((v: any) => v.id), ['w1', 'w2'], 'a message in an open and a finished task goes under the open one');
  assert.deepEqual(withWhom(wifi.views), ['Клиент А']);
  assert.equal(caseOf(view('x', 1, ['diary', 'old']), tasks).id, 'diary', 'among finished: the one finished last');
  assert.equal(feedItems(visible, tasks, { now: new Date(NOW), showDone: true }).length, 4, '«Завершённые» brings it back');

  const options = { now: NOW, freshH: 6, expandLast: 10 };
  assert.deepEqual(shownViews(wifi, undefined, options).map((v: any) => v.id), ['w2'], 'fresh messages under an open case');
  assert.deepEqual(shownViews(wifi, 'all', options).map((v: any) => v.id), ['w1', 'w2']);
  assert.deepEqual(shownViews(wifi, 'none', options), []);
  const diary = items[1];
  assert.equal(diary.stage, 'collapsed');
  assert.deepEqual(shownViews(diary, undefined, options), [], 'a finished case shows only its header');

  // Written into the case before the triage reached it: shown in the case at once.
  const follow = { ...view('w3', 0.5), continues: 'w2' };
  const withFollow = feedItems([...visible, follow], tasks, { now: new Date(NOW) });
  assert.deepEqual(withFollow.at(-1).views.map((v: any) => v.id), ['w1', 'w2', 'w3']);
  assert.deepEqual(caseMembers({ messages: ['w1', 'w2'] }, [follow, ...visible]).map((v: any) => v.id), ['w1', 'w2', 'w3']);
});
