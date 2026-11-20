// Checks task filtering, shortcuts and saved views.
import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { applyView, countsFor, viewTitle, isDefaultView, dueGroups, DEFAULT_VIEW, WHEN, WHOSE } from '../web/viewstate.js';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { taskShortcuts } from '../web/viewpanel.js';

// One view for the task panel (when · whose · where), whatever layout picks it. Tasks are made up.
const now = new Date('2026-11-19T12:00:00');
const mine = { responsible: 'me', executors: ['me'] };
const t = (id: string, data: Record<string, unknown>) => ({ id, title: id, status: 'todo', roles: mine, items: [], updatedAt: '2026-11-19T09:00:00Z', ...data });
const tasks = [
  t('сегодня', { due: '2026-11-19' }),
  t('просрочено', { due: '2026-11-17', project: 'p1' }),
  t('через неделю', { due: '2026-11-25', project: 'p1', counterparty: 'c1' }),
  t('без срока', {}),
  t('новое', { status: 'inbox' }),
  t('отложено', { status: 'deferred', remindAt: '2026-11-30T09:00:00Z' }),
  t('жду', { status: 'waiting', roles: { ...mine, author: 'tg:501' } }),
  t('поручено', { roles: { responsible: 'me', executors: ['tg:7'], controller: 'me' } }),
  t('проверить', { status: 'review', roles: { responsible: 'tg:7', executors: ['tg:7'], controller: 'me' } }),
  t('команда', { roles: { responsible: 'tg:8', executors: ['tg:9'] } }),
  t('готово', { status: 'done' }),
  t('записано', { status: 'done', filed: true }),
];
const ids = (view: object, extra: object = {}) => applyView(tasks, { ...DEFAULT_VIEW, ...view }, { now, projects: [], people: [], ...extra }).map((task: any) => task.id).sort();

test('when: today, inbox, upcoming, deferred, all open, done (filed never)', () => {
  assert.deepEqual(ids({ when: 'today' }), ['просрочено', 'сегодня'].sort());
  assert.deepEqual(ids({ when: 'inbox' }), ['новое']);
  assert.deepEqual(ids({ when: 'upcoming' }), ['через неделю']);
  assert.deepEqual(ids({ when: 'deferred' }), ['отложено']);
  assert.deepEqual(ids({ when: 'done' }), ['готово']);
  assert.equal(ids({ when: 'all' }).includes('команда'), false, '«Всё» is what involves me');
});

test('whose: mine, watch, review, team', () => {
  assert.deepEqual(ids({ when: 'all', whose: 'watch' }), ['жду', 'поручено'].sort());
  assert.deepEqual(ids({ when: 'all', whose: 'review' }), ['проверить']);
  assert.deepEqual(ids({ when: 'all', whose: 'team' }), ['команда']);
  assert.equal(ids({ when: 'all', whose: 'mine' }).includes('поручено'), false);
});

test('where: a project with its children, a counterparty, a person by their points', () => {
  const projects = [{ id: 'p1', parent: null }, { id: 'p2', parent: 'p1' }];
  assert.deepEqual(ids({ when: 'all', where: { project: 'p1' } }, { projects }), ['просрочено', 'через неделю'].sort());
  assert.deepEqual(ids({ when: 'all', where: { counterparty: 'c1' } }), ['через неделю']);
  const people = [{ id: 'h1', points: ['tg:501'], status: 'active' }];
  assert.deepEqual(ids({ when: 'all', where: { person: 'h1' } }, { people }), ['жду']);
});

test('counts per option keep the other axes; the title names the view; default is the pulse', () => {
  const counts = countsFor(tasks, { ...DEFAULT_VIEW, whose: 'watch' }, 'when', { now, projects: [], people: [] });
  assert.equal(counts.get('all'), 2);
  assert.equal(counts.get('done'), 0);
  assert.equal(viewTitle({ when: 'all', whose: 'watch', where: { counterparty: 'c1' } }, { counterparties: [{ id: 'c1', title: 'ООО Пример' }] }), 'Все открытые · Слежу · ◆ ООО Пример');
  assert.equal(isDefaultView(DEFAULT_VIEW), true);
  assert.equal(isDefaultView({ ...DEFAULT_VIEW, whose: 'mine' }), false);
  assert.ok(WHEN.length >= 7 && WHOSE.length === 5);
});

test('a list by dates: overdue, today, tomorrow, this week, later, no date', () => {
  const groups = dueGroups(applyView(tasks, { ...DEFAULT_VIEW, when: 'all' }, { now, projects: [], people: [] }), now);
  assert.deepEqual(groups.map((group: any) => [group.title, group.tasks.length]), [['Просрочено', 1], ['Сегодня', 1], ['Позже', 1], ['Без срока', 6]]);
});

test('the panel has one dashboard and shortcuts with counts for inbox, review and open tasks', () => {
  const entries = taskShortcuts(tasks, { now, projects: [], people: [] });
  assert.deepEqual(entries.map(({ title, count }: { title: string; count: number | null }) => [title, count]),
    [['Пульт', null], ['Входящие', 1], ['На проверке', 1], ['Все открытые', 9]]);
  assert.deepEqual(entries[0].view, DEFAULT_VIEW);
  assert.deepEqual(entries[2].view, { when: 'all', whose: 'review', where: {} });
});

test('the view store keeps filters and saved views from devices with an old layout preference', async () => {
  // @ts-expect-error Browser modules are deliberately buildless JavaScript.
  const { createViewStore } = await import('../web/viewstore.js');
  const data = new Map([['stream.taskPanel.layout', '"tree"']]);
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
  const store = createViewStore(storage);
  assert.deepEqual(store.get(), DEFAULT_VIEW);
  store.set({ whose: 'watch' });
  store.set({ where: { project: 'p1' } });
  store.set({ where: { counterparty: 'c1' } });
  assert.deepEqual(store.get(), { when: 'pulse', whose: 'watch', where: { project: 'p1', counterparty: 'c1' } });
  store.set({ where: { project: null } });
  assert.deepEqual(store.get().where, { counterparty: 'c1' });
  const saved = store.save('Выезды');
  assert.deepEqual(store.saved().map((item: any) => item.title), ['Выезды']);
  store.reset();
  assert.deepEqual(store.get(), DEFAULT_VIEW);
  store.open(saved.id);
  assert.equal(store.get().whose, 'watch');
  store.remove(saved.id);
  assert.equal(store.saved().length, 0);
  assert.equal(store.layout, undefined);
  assert.equal(data.get('stream.taskPanel.layout'), '"tree"', 'the legacy choice is ignored');
});

test('«Не учтено»: closed tasks whose report has gaps', () => {
  const list = [t('с пробелами', { status: 'done', report: { missing: ['duration_min'] } }), t('полный', { status: 'done', report: { note: 'ок' } })];
  assert.deepEqual(applyView(list, { ...DEFAULT_VIEW, when: 'unreported' }, { now }).map((task: any) => task.id), ['с пробелами']);
});
