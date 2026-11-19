// Conversations (P14): messages grouped by chat or phone number, with a state (urgent / mine / theirs / quiet / done)
// and an order, all from the registry. Pure — no DOM. Views must already carry `taskIds`.
import { chatOf } from './projection.js';
import { isOpen, involvesMe, dueState } from './taskfold.js';
import { phoneLabel } from './phonebubble.js';
import { phoneNumber } from './parties.js';

// The conversation a message belongs to: one Telegram chat across both accounts, one phone number, own notes.
export function conversationOf(event) {
  const data = event?.payload?.data ?? {};
  if (event?.kind === 'system' || event?.kind === 'correction' || event?.kind === 'task_change') return null;
  const chat = data.telegram?.chat_id ?? data.outbound?.chat_id;
  if (chat !== undefined && chat !== null) return `tg:${chat}`;
  if (event?.kind === 'call' || event?.kind === 'sms') {
    const number = phoneNumber(event.kind === 'call' ? data.call?.number : data.sms?.number);
    return number ? `tel:${number}` : null;
  }
  if (event?.author === 'me' && (event.source === 'app' || event.source === 'share')) return 'me';
  return null;
}

const channelOf = (event, key) => {
  if (key === 'me') return 'me';
  if (key.startsWith('tel:')) return 'phone';
  return chatOf(event)?.account ?? null;
};

const titleOf = (view, key) => {
  if (key === 'me') return 'Заметки';
  const event = view.event;
  if (key.startsWith('tel:')) {
    const data = event.kind === 'call' ? event.payload?.data?.call : event.payload?.data?.sms;
    return (data?.name ?? '').trim() || key.slice(4);
  }
  return chatOf(event)?.title ?? 'Чат';
};

// Who spoke last: 'out' (me), 'in' (them), 'unknown'. Phone events are all stored as `me`; their direction decides.
export function directionOf(event) {
  if (event.kind === 'call' || event.kind === 'sms') {
    const direction = (event.kind === 'call' ? event.payload?.data?.call : event.payload?.data?.sms)?.direction;
    if (direction === 'out') return 'out';
    return ['in', 'missed', 'rejected'].includes(direction) ? 'in' : 'unknown';
  }
  return event.author === 'me' ? 'out' : 'in';
}
const isMine = (view) => directionOf(view.event) === 'out';
const isIncoming = (view) => directionOf(view.event) === 'in';
const incomingChat = (view) => isIncoming(view) && view.event.payload?.data?.telegram;

// 'urgent' | 'mine' | 'theirs' | 'quiet' | 'done' — `conversation` needs views, tasks, last, key, group.
export function conversationState(conversation, { now = new Date(), config }) {
  const views = conversation.views.filter((view) => !view.deleted);
  const byId = new Map(views.map((view) => [view.id, view]));
  const taskOf = new Map(conversation.tasks.map((task) => [task.id, task]));
  const open = conversation.tasks.filter((task) => isOpen(task) && !task.filed);
  const mineOpen = open.filter(involvesMe);
  // An urgent tag counts while its message is untriaged or in an open task: done with, it no longer burns.
  const live = (view) => !view.taskIds?.length || view.taskIds.some((id) => { const task = taskOf.get(id); return task && isOpen(task); });
  if (mineOpen.some((task) => ['today', 'overdue'].includes(dueState(task, now)))
    || views.some((view) => view.tags?.some((tag) => config.urgent_tags.includes(tag)) && live(view))) return 'urgent';

  // A message is meaningful unless it belongs only to filed tasks; untriaged is meaningful.
  const meaningful = (view) => {
    const tasks = (view.taskIds ?? []).map((id) => taskOf.get(id)).filter(Boolean);
    return !tasks.length || tasks.some((task) => !task.filed);
  };
  // In a group, someone else's message matters to me only when it answers mine or is in a task where I have a role.
  const matters = (view) => {
    if (directionOf(view.event) !== 'in' || !conversation.group) return true;
    const parent = view.event.reply_to && byId.get(view.event.reply_to);
    if (parent && isMine(parent)) return true;
    return (view.taskIds ?? []).some((id) => { const task = taskOf.get(id); return task && involvesMe(task); });
  };
  // An own note pulled into a chat or a number (a call description, a reply not sent) is not an answer.
  const note = (view) => conversation.key !== 'me' && conversationOf(view.event) === 'me';
  // «Отвечено» (CONCEPT.md §2.5): messages up to the marked one, and tasks with no message after it, wait for nobody.
  const mark = views.filter((view) => view.answered).reduce((a, b) => (!a || b.event.ts >= a.event.ts ? b : a), null);
  const after = (view) => !mark || view.event.ts > mark.event.ts;
  const fresh = (task) => !mark || views.some((view) => after(view) && task.messages?.includes(view.id));
  const candidates = views.filter((view) => after(view) && directionOf(view.event) !== 'unknown' && !note(view) && meaningful(view) && matters(view));
  const last = candidates.reduce((a, b) => (!a || b.event.ts >= a.event.ts ? b : a), null);

  if (conversation.key !== 'me') {
    if ((last && isIncoming(last)) || mineOpen.some((task) => fresh(task) && (task.status === 'inbox' || task.status === 'review'))) return 'mine';
    if ((last && isMine(last)) || open.some((task) => fresh(task) && task.status === 'waiting')
      || open.some((task) => fresh(task) && task.roles.controller === 'me' && task.roles.executors.length && !task.roles.executors.includes('me'))) return 'theirs';
  }
  const age = (now.getTime() - Date.parse(conversation.last)) / 86_400_000;
  return open.length || age < config.quiet_days ? 'quiet' : 'done';
}

// message id -> conversation key. An own note that continues or answers a message joins that message's
// conversation (a call description, a reply written without a recipient), through chains of such notes.
export function conversationKeys(views) {
  const byId = new Map(views.map((view) => [view.id, view]));
  const keys = new Map();
  const resolve = (view) => {
    if (keys.has(view.id)) return keys.get(view.id);
    const seen = new Set();
    let current = view;
    let key = conversationOf(current.event);
    while (key === 'me' && !seen.has(current.id)) {
      seen.add(current.id);
      const parent = byId.get(current.continues ?? current.event.reply_to);
      if (!parent) break;
      const parentKey = keys.get(parent.id) ?? conversationOf(parent.event);
      if (parentKey && parentKey !== 'me') { key = parentKey; break; }
      current = parent;
    }
    keys.set(view.id, key);
    return key;
  };
  for (const view of views) resolve(view);
  return keys;
}

// All conversations, ordered by `config.states`, newest first inside a state. `keys` — conversationKeys of a wider
// set of views (the feed passes all live ones, so a note keeps its conversation when its parent is archived).
export function conversations(views, tasks, { now = new Date(), config, keys = conversationKeys(views) }) {
  const groups = new Map();
  for (const view of views) {
    if (view.deleted) continue;
    const key = keys.get(view.id);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(view);
  }
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const list = [];
  for (const [key, group] of groups) {
    const sorted = [...group].sort((a, b) => a.event.ts.localeCompare(b.event.ts));
    const latest = sorted.at(-1);
    const own = sorted.filter((view) => conversationOf(view.event) === key).at(-1) ?? latest; // carries the channel's data
    const ids = new Set(sorted.flatMap((view) => view.taskIds ?? []));
    const incoming = sorted.filter(incomingChat).at(-1);
    const conversation = {
      key, title: titleOf(own, key), group: sorted.some((view) => chatOf(view.event)?.group),
      channels: [...new Set(sorted.map((view) => channelOf(view.event, key)).filter(Boolean))],
      views: sorted, last: latest.event.ts, tasks: [...ids].map((id) => taskById.get(id)).filter(Boolean),
      reply: incoming ? chatOf(incoming.event) : null,
    };
    list.push({ ...conversation, state: conversationState(conversation, { now, config }) });
  }
  const rank = (state) => config.states.indexOf(state);
  return list.sort((a, b) => rank(a.state) - rank(b.state) || b.last.localeCompare(a.last));
}

// With whom: chat titles and phone contacts of the messages, in order of appearance (task rows).
export function withWhom(views) {
  const names = [];
  for (const view of views) {
    const event = view.event;
    const name = chatOf(event)?.title ?? (event.kind === 'call' || event.kind === 'sms' ? phoneLabel(event).who : null);
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}
