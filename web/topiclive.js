// Which topics are live in a conversation (topics design 2026-11-23): a topic stays in the conversation's line while
// it had a message within `topic_days` and the conversation waits or left the queue within `archive_days`; an open
// task stays while open. Removing a topic from a conversation (×) takes its messages out, so it is no longer among
// the conversation's records at all. Pure — no DOM; `lastAt(task)` gives the newest message time of a record.
import { isOpen } from './taskfold.js';
import { handledAt } from './queue.js';
import { isTopic } from './topickind.js';

const DAY = 86_400_000;
const time = (ts) => (ts ? Date.parse(ts) : -Infinity);

// The newest message time of a record among the conversation's views (when the caller has nothing better).
const lastInViews = (conversation) => (task) => (conversation.views ?? []).filter((view) => view.taskIds?.includes(task.id)).map((view) => view.event.ts).sort().at(-1) ?? null;

const newestFirst = (lastAt) => (a, b) => time(lastAt(b)) - time(lastAt(a)) || String(a.id).localeCompare(String(b.id));

// The conversation's open records that are live: tasks first, then topics, each by newest message.
export function liveTopics(conversation, { now = new Date(), topics, lastAt = lastInViews(conversation) }) {
  const open = (conversation.tasks ?? []).filter((task) => isOpen(task) && !task.filed);
  const recent = (ts) => now.getTime() - time(ts) <= topics.topic_days * DAY;
  const active = Boolean(conversation.queue?.waiting) || now.getTime() - time(handledAt(conversation)) <= topics.archive_days * DAY;
  const tasks = open.filter((task) => !isTopic(task));
  const live = active ? open.filter((task) => isTopic(task) && recent(lastAt(task))) : [];
  return [...tasks.sort(newestFirst(lastAt)), ...live.sort(newestFirst(lastAt))];
}

// The record chosen when a conversation opens: the live one of the newest message that has one (a fresh message is
// often not triaged yet), else null.
export function defaultTopic(conversation, live) {
  const ids = new Set(live.map((task) => task.id));
  const views = [...(conversation.views ?? [])].filter((view) => !view.deleted).sort((a, b) => time(b.event.ts) - time(a.event.ts));
  for (const view of views) {
    const id = view.taskIds?.find((item) => ids.has(item));
    if (id) return id;
  }
  return null;
}

// What a message may be moved to: { here — live records of this conversation, other — live topics of other
// conversations, tasks — open tasks elsewhere }. `tasks` — every folded task, so a task without messages is offered too.
export function pickable(conversations, key, { now = new Date(), topics, lastAt, tasks = null }) {
  const current = conversations.find((item) => item.key === key);
  const here = current ? liveTopics(current, { now, topics, ...(lastAt ? { lastAt } : {}) }) : [];
  const taken = new Set(here.map((task) => task.id));
  const other = [];
  for (const item of conversations) {
    if (item.key === key) continue;
    for (const task of liveTopics(item, { now, topics, ...(lastAt ? { lastAt } : {}) })) {
      if (!isTopic(task) || taken.has(task.id)) continue;
      taken.add(task.id);
      other.push(task);
    }
  }
  const all = tasks ?? conversations.flatMap((item) => item.tasks ?? []);
  const open = [];
  for (const task of all) {
    if (isTopic(task) || !isOpen(task) || task.filed || taken.has(task.id)) continue;
    taken.add(task.id);
    open.push(task);
  }
  const order = newestFirst(lastAt ?? ((task) => task.updatedAt ?? null));
  return { here, other: other.sort(order), tasks: open.sort(order) };
}
