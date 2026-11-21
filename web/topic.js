// A conversation's topic and the cuts of its messages (docs/plans/2026-11-21-workspace-redesign-design.md). Every
// conversation is a topic: its task is empty, unconfirmed (the AI's offer) or real. In the card the messages run in
// segments: open ones, and «cuts» — a run of messages of one task folded into a centred line with its title. In a
// conversation the task runs fold and loose messages stay open; in a task (`focus`) its own messages stay open and the
// rest fold. Filed notes and unconfirmed tasks are no topic of their own here. Pure — no DOM.
import { isOpen } from './taskfold.js';
import { byUrgency } from './convlist.js';

// { state: 'empty' | 'unconfirmed' | 'task', tasks } — open tasks of the conversation, real ones first by urgency.
export function topicOf(conversation, now = new Date()) {
  const open = (conversation.tasks ?? []).filter((task) => isOpen(task) && !task.filed);
  const real = open.filter((task) => !task.unconfirmed).sort(byUrgency(now));
  const offered = open.filter((task) => task.unconfirmed).sort(byUrgency(now));
  return { state: real.length ? 'task' : offered.length ? 'unconfirmed' : 'empty', tasks: [...real, ...offered] };
}

const NO_TASK = 'Без задачи';

// [{ kind: 'open', views } | { kind: 'cut', taskId, title, views, key, open }]. `open` — keys of unfolded cuts
// (`taskId|first view id`), `all` — everything unfolded.
export function cutSegments(views, { focus = null, tasksById = new Map(), open = new Set(), all = false } = {}) {
  const topicId = (view) => {
    if (focus && view.taskIds?.includes(focus)) return focus;
    return (view.taskIds ?? []).find((id) => {
      const task = tasksById.get(id);
      return task && !task.filed && !task.unconfirmed && task.status !== 'cancelled';
    }) ?? null;
  };
  const segments = [];
  for (const view of views) {
    const topic = topicId(view);
    const shown = focus ? topic === focus : topic === null;
    const last = segments.at(-1);
    if (shown) {
      if (last?.kind === 'open') last.views.push(view); else segments.push({ kind: 'open', views: [view] });
      continue;
    }
    if (last?.kind === 'cut' && last.taskId === topic) { last.views.push(view); continue; }
    const key = `${topic ?? 'none'}|${view.id}`;
    segments.push({ kind: 'cut', taskId: topic, title: topic ? tasksById.get(topic)?.title ?? 'Задача' : NO_TASK, views: [view], key, open: all || open.has(key) });
  }
  return segments;
}
