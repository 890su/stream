// Focus (task manager spec §5.4): one task of mine in work (`doing`); taking another pauses it — `todo` with a
// `resume_note`, where I stopped — and «Вернуться» takes it back. Time in work comes from the status history, no
// manual timer. Pure: no DOM — tested in node; the changes go through the usual queue (taskquick.js).

// I execute it, or nobody executes it and I answer for it.
export function isMineToDo(task) {
  const executors = task.roles?.executors ?? [];
  return executors.includes('me') || (!executors.length && task.roles?.responsible === 'me');
}

const newestFirst = (a, b) => b.updatedAt.localeCompare(a.updatedAt);

// { current, paused }: current — my newest `doing`; paused — my other `doing` and my open tasks with a resume note,
// newest first (the last paused comes back first).
export function inWork(tasks) {
  const doing = tasks.filter((task) => task.status === 'doing' && isMineToDo(task)).sort(newestFirst);
  const current = doing[0] ?? null;
  // Only a plain paused task waits for return: deferred, waiting or filed ones live in their own places.
  const noted = tasks.filter((task) => task.status === 'todo' && !task.filed && task.resumeNote && isMineToDo(task));
  const paused = [...doing.slice(1), ...noted].sort(newestFirst);
  return { current, paused };
}

// Where I stopped, in a few words: the first unticked checklist item, else «в работе».
export function resumeNoteOf(task) {
  return task.items?.find((item) => !item.done)?.text ?? 'в работе';
}

// The changes for «Пауза»: back to `todo` with where I stopped.
export function pauseWork(task) {
  return { id: task.id, change: { op: 'update', status: 'todo', resume_note: resumeNoteOf(task).slice(0, 200) } };
}

// The changes for «▶ В работу» (and «Вернуться»): the current task is paused, this one is in work, its note cleared.
export function startWork(task, current) {
  const start = { id: task.id, change: { op: 'update', status: 'doing', resume_note: '' } };
  return current && current.id !== task.id ? [pauseWork(current), start] : [start];
}

// Minutes the task spent in `doing`, from its history; an open span runs until `now`.
export function workedMinutes(task, now = new Date()) {
  let total = 0;
  let since = null;
  let status = null;
  for (const entry of task.history ?? []) {
    const next = entry.change?.status;
    if (next === undefined || next === status) continue;
    const at = Date.parse(entry.ts);
    if (status === 'doing' && since !== null) total += at - since;
    since = next === 'doing' ? at : null;
    status = next;
  }
  if (status === 'doing' && since !== null) total += now.getTime() - since;
  return Math.max(0, Math.round(total / 60_000));
}
