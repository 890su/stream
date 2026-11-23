// A conversation's topic and the cuts of its messages (docs/plans/2026-11-21-workspace-redesign-design.md, topics
// design 2026-11-23). `topicOf` — its open records, tasks first (magic.js). In the card the messages run in segments:
// open ones, and «cuts» — a run of messages of one topic or task folded into a centred line with its title. With a
// topic chosen (or in a task) its messages stay open and the rest fold; «≡» unfolds the rest, paler. Filed notes are no
// topic of their own here. Pure — no DOM.
import { isOpen } from './taskfold.js';
import { byUrgency } from './convlist.js';
import { isTopic } from './topickind.js';

// { state: 'empty' | 'unconfirmed' | 'task', tasks } — open tasks of the conversation, real ones first by urgency.
export function topicOf(conversation, now = new Date()) {
  const open = (conversation.tasks ?? []).filter((task) => isOpen(task) && !task.filed);
  const real = open.filter((task) => !isTopic(task)).sort(byUrgency(now));
  const offered = open.filter((task) => isTopic(task)).sort(byUrgency(now));
  return { state: real.length ? 'task' : offered.length ? 'unconfirmed' : 'empty', tasks: [...real, ...offered] };
}

const NO_TOPIC = 'Без темы';

// A record messages can belong to here: not filed away, not cancelled (topics and tasks alike, topics design 2026-11-23).
const counts = (task) => Boolean(task) && !task.filed && task.status !== 'cancelled';

// [{ kind: 'open', views } | { kind: 'cut', taskId, title, views, key, open, dim }]. `focus` — the chosen topic or the
// open task: its messages stay open and the rest fold; without it the runs of topics and tasks fold and loose messages
// stay open. `open` — keys of unfolded cuts (`taskId|first view id`), `all` — everything unfolded (with a focus the
// unfolded rest is `dim`); `keep` — ids of messages that never fold (waiting for the owner's answer).
export function cutSegments(views, { focus = null, tasksById = new Map(), open = new Set(), all = false, keep = new Set() } = {}) {
  const topicId = (view) => {
    if (focus && view.taskIds?.includes(focus)) return focus;
    return (view.taskIds ?? []).find((id) => counts(tasksById.get(id))) ?? null;
  };
  const segments = [];
  for (const view of views) {
    const topic = topicId(view);
    const shown = keep.has(view.id) || (focus ? topic === focus : topic === null);
    const last = segments.at(-1);
    if (shown) {
      if (last?.kind === 'open') last.views.push(view); else segments.push({ kind: 'open', views: [view] });
      continue;
    }
    if (last?.kind === 'cut' && last.taskId === topic) { last.views.push(view); continue; }
    const key = `${topic ?? 'none'}|${view.id}`;
    segments.push({ kind: 'cut', taskId: topic, title: topic ? tasksById.get(topic)?.title ?? 'Тема' : NO_TOPIC, views: [view], key,
      open: all || open.has(key), dim: Boolean(all && focus) });
  }
  return segments;
}

// The record a message is shown under when everything is open: the title of its first counted record other than
// the focus, or null.
export function topicCaption(view, tasksById, focus) {
  const id = (view.taskIds ?? []).find((item) => item !== focus && counts(tasksById.get(item)));
  return id ? tasksById.get(id).title ?? null : null;
}
