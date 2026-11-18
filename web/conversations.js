// Conversations (P14): messages grouped by chat or phone number, with a state (urgent / mine / theirs / quiet / done)
// and an order, all from the registry. Pure — no DOM. Views must already carry `taskIds`.
import { chatOf } from './projection.js';
import { isOpen, involvesMe, dueState } from './taskfold.js';

// The conversation a message belongs to: one Telegram chat across both accounts, one phone number, own notes.
export function conversationOf(event) {
  const data = event?.payload?.data ?? {};
  if (event?.kind === 'system' || event?.kind === 'correction' || event?.kind === 'task_change') return null;
  const chat = data.telegram?.chat_id ?? data.outbound?.chat_id;
  if (chat !== undefined && chat !== null) return `tg:${chat}`;
  if (event?.kind === 'call' || event?.kind === 'sms') {
    const number = String((event.kind === 'call' ? data.call?.number : data.sms?.number) ?? '').replace(/[^+\d]/g, '');
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

const isMine = (view) => view.event.author === 'me';
const incomingChat = (view) => !isMine(view) && view.event.payload?.data?.telegram;

// 'urgent' | 'mine' | 'theirs' | 'quiet' | 'done' — `conversation` needs views, tasks, last, key, group.
export function conversationState(conversation, { now = new Date(), config }) {
  const views = conversation.views.filter((view) => !view.deleted);
  const byId = new Map(views.map((view) => [view.id, view]));
  const taskOf = new Map(conversation.tasks.map((task) => [task.id, task]));
  const open = conversation.tasks.filter((task) => isOpen(task) && !task.filed);
  const mineOpen = open.filter(involvesMe);
  if (mineOpen.some((task) => ['today', 'overdue'].includes(dueState(task, now)))
    || views.some((view) => view.tags?.some((tag) => config.urgent_tags.includes(tag)))) return 'urgent';

  // A message is meaningful unless it belongs only to filed tasks; untriaged is meaningful.
  const meaningful = (view) => {
    const tasks = (view.taskIds ?? []).map((id) => taskOf.get(id)).filter(Boolean);
    return !tasks.length || tasks.some((task) => !task.filed);
  };
  // In a group, someone else's message matters to me only when it answers mine or is in a task where I have a role.
  const matters = (view) => {
    if (isMine(view) || !conversation.group) return true;
    const parent = view.event.reply_to && byId.get(view.event.reply_to);
    if (parent && isMine(parent)) return true;
    return (view.taskIds ?? []).some((id) => { const task = taskOf.get(id); return task && involvesMe(task); });
  };
  const candidates = views.filter((view) => meaningful(view) && matters(view));
  const last = candidates.reduce((a, b) => (!a || b.event.ts >= a.event.ts ? b : a), null);

  if (conversation.key !== 'me') {
    if ((last && !isMine(last)) || mineOpen.some((task) => task.status === 'inbox' || task.status === 'review')) return 'mine';
    if ((last && isMine(last)) || open.some((task) => task.status === 'waiting')
      || open.some((task) => task.roles.controller === 'me' && task.roles.executors.length && !task.roles.executors.includes('me'))) return 'theirs';
  }
  const age = (now.getTime() - Date.parse(conversation.last)) / 86_400_000;
  return open.length || age < config.quiet_days ? 'quiet' : 'done';
}

// All conversations, ordered by `config.states`, newest first inside a state.
export function conversations(views, tasks, { now = new Date(), config }) {
  const groups = new Map();
  for (const view of views) {
    if (view.deleted) continue;
    const key = conversationOf(view.event);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(view);
  }
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const list = [];
  for (const [key, group] of groups) {
    const sorted = [...group].sort((a, b) => a.event.ts.localeCompare(b.event.ts));
    const latest = sorted.at(-1);
    const ids = new Set(sorted.flatMap((view) => view.taskIds ?? []));
    const incoming = sorted.filter(incomingChat).at(-1);
    const conversation = {
      key, title: titleOf(latest, key), group: sorted.some((view) => chatOf(view.event)?.group),
      channels: [...new Set(sorted.map((view) => channelOf(view.event, key)).filter(Boolean))],
      views: sorted, last: latest.event.ts, tasks: [...ids].map((id) => taskById.get(id)).filter(Boolean),
      reply: incoming ? chatOf(incoming.event) : null,
    };
    list.push({ ...conversation, state: conversationState(conversation, { now, config }) });
  }
  const rank = (state) => config.states.indexOf(state);
  return list.sort((a, b) => rank(a.state) - rank(b.state) || b.last.localeCompare(a.last));
}
