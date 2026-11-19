import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { foldTasks } from '../web/taskfold.js';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { undoOf } from '../web/taskactions.js';
// @ts-expect-error Browser modules are deliberately buildless JavaScript.
import { isMineToDo, inWork, resumeNoteOf, startWork, pauseWork, workedMinutes } from '../web/focus.js';

// One task in work, pause and return (task manager spec §5.4). Names and tasks are made up.
const change = (task: string, ts: string, data: Record<string, unknown>, author = 'me') => ({
  id: crypto.randomUUID(), schema_version: 1, source: 'app', author, ts, kind: 'task_change', payload: { ref: { type: 'task', id: task }, data: { task: data } },
});
const mine = { responsible: 'me', executors: ['me'] };
const fold = (...events: unknown[]) => foldTasks(events);
const byId = (tasks: any[], id: string) => tasks.find((task) => task.id === id);

test('mine to do: I execute, or nobody executes and I answer for it', () => {
  const tasks = fold(
    change('a', '2026-11-19T09:00:00Z', { op: 'create', title: 'сам', roles: mine }),
    change('b', '2026-11-19T09:00:00Z', { op: 'create', title: 'без исполнителя', roles: { responsible: 'me' } }),
    change('c', '2026-11-19T09:00:00Z', { op: 'create', title: 'напарник', roles: { responsible: 'me', executors: ['tg:1'] } }),
  );
  assert.deepEqual(tasks.map(isMineToDo), [true, true, false]);
});

test('start pauses the current task with where it stopped', () => {
  const tasks = fold(
    change('cur', '2026-11-19T09:00:00Z', { op: 'create', title: 'Сеть у клиента', status: 'doing', roles: mine,
      items_add: [{ id: 'i1', text: 'кабель' }, { id: 'i2', text: 'проверить Wi-Fi' }] }),
    change('cur', '2026-11-19T09:10:00Z', { op: 'update', items_set: [{ id: 'i1', done: true }] }),
    change('new', '2026-11-19T09:20:00Z', { op: 'create', title: 'Принтер', status: 'todo', roles: mine }),
  );
  const parts = startWork(byId(tasks, 'new'), byId(tasks, 'cur'));
  assert.deepEqual(parts, [
    { id: 'cur', change: { op: 'update', status: 'todo', resume_note: 'проверить Wi-Fi' } },
    { id: 'new', change: { op: 'update', status: 'doing', resume_note: '' } },
  ]);
  assert.deepEqual(startWork(byId(tasks, 'new'), null), [parts[1]]);
});

test('resume note: the first unticked item, else «в работе»', () => {
  const [plain] = fold(change('p', '2026-11-19T09:00:00Z', { op: 'create', title: 'Звонок', roles: mine }));
  assert.equal(resumeNoteOf(plain), 'в работе');
  assert.deepEqual(pauseWork(plain), { id: 'p', change: { op: 'update', status: 'todo', resume_note: 'в работе' } });
});

test('a partner\'s doing is not mine in work', () => {
  const tasks = fold(change('x', '2026-11-19T09:00:00Z', { op: 'create', title: 'Камеры', status: 'doing', roles: { responsible: 'me', executors: ['tg:1'], controller: 'me' } }));
  assert.deepEqual(inWork(tasks), { current: null, paused: [] });
});

test('two doing: the newest is current, the other is paused; paused with a note newest first', () => {
  const tasks = fold(
    change('old', '2026-11-19T08:00:00Z', { op: 'create', title: 'старое', status: 'doing', roles: mine }),
    change('new', '2026-11-19T09:00:00Z', { op: 'create', title: 'новое', status: 'doing', roles: mine }),
    change('p1', '2026-11-19T07:00:00Z', { op: 'create', title: 'пауза 1', status: 'todo', roles: mine, resume_note: 'дальше 1' }),
    change('p2', '2026-11-19T07:30:00Z', { op: 'create', title: 'пауза 2', status: 'todo', roles: mine, resume_note: 'дальше 2' }),
    change('done', '2026-11-19T07:40:00Z', { op: 'create', title: 'закрыто', status: 'done', roles: mine, resume_note: 'было' }),
  );
  const { current, paused } = inWork(tasks);
  assert.equal(current.id, 'new');
  assert.deepEqual(paused.map((task: any) => task.id), ['old', 'p2', 'p1']);
});

test('undo of start restores both tasks', () => {
  const tasks = fold(
    change('cur', '2026-11-19T09:00:00Z', { op: 'create', title: 'Сеть', status: 'doing', roles: mine }),
    change('new', '2026-11-19T09:20:00Z', { op: 'create', title: 'Принтер', status: 'todo', roles: mine, resume_note: 'было начато' }),
  );
  const [pause, start] = startWork(byId(tasks, 'new'), byId(tasks, 'cur'));
  assert.deepEqual(undoOf(byId(tasks, 'cur'), pause.change), { status: 'doing', resume_note: '' });
  assert.deepEqual(undoOf(byId(tasks, 'new'), start.change), { status: 'todo', resume_note: 'было начато' });
});

test('worked minutes sum the spans in doing', () => {
  const [task] = fold(
    change('w', '2026-11-19T10:00:00Z', { op: 'create', title: 'Роутер', status: 'doing', roles: mine }),
    change('w', '2026-11-19T10:30:00Z', { op: 'update', status: 'todo', resume_note: 'дальше' }),
    change('w', '2026-11-19T11:00:00Z', { op: 'update', status: 'doing', resume_note: '' }),
  );
  assert.equal(workedMinutes(task, new Date('2026-11-19T11:15:00Z')), 45);
});

test('«▶ В работу» saves both changes and «Вернуть» undoes both', async () => {
  // @ts-expect-error Browser modules are deliberately buildless JavaScript.
  const { createTaskQuick } = await import('../web/taskquick.js');
  const queued: any[] = [];
  let toast: any = null;
  const quick = createTaskQuick({ queue: async (entry: any) => { queued.push(entry.event.payload); }, notify: (text: string, action: any) => { toast = { text, action }; }, config: {} });
  const tasks = fold(
    change('cur', '2026-11-19T09:00:00Z', { op: 'create', title: 'Сеть', status: 'doing', roles: mine }),
    change('new', '2026-11-19T09:20:00Z', { op: 'create', title: 'Принтер', status: 'todo', roles: mine }),
  );
  await quick.start(byId(tasks, 'new'), byId(tasks, 'cur'));
  assert.deepEqual(queued.map((p) => [p.ref.id, p.data.task.status]), [['cur', 'todo'], ['new', 'doing']]);
  assert.equal(toast.text, 'В работе: «Принтер»');
  await toast.action.run();
  assert.deepEqual(queued.slice(2).map((p) => [p.ref.id, p.data.task.status, p.data.task.resume_note]), [['new', 'todo', ''], ['cur', 'doing', '']], 'undone in reverse: never two tasks in work at once');
});
