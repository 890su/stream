// Conversations (P14): messages grouped by chat or phone number, each with its place in the queue (queue.js,
// CONCEPT.md §2.5). Pure — no DOM. Views must already carry `taskIds`.
import { chatOf } from './projection.js';
import { phoneLabel } from './phonebubble.js';
import { phoneNumber } from './parties.js';
import { ownerLinked, queueOf } from './queue.js';
import { fromV21 } from './questions.js';

// The conversation a message belongs to: one Telegram chat across both accounts, one phone number, own notes.
// A Viber chat with a phone is that number's conversation (with its calls and SMS); without one — `viber:<name>`.
// WhatsApp the same; without a phone (an anonymous LID address) — `wa:<address>`.
export function conversationOf(event) {
  const data = event?.payload?.data ?? {};
  if (event?.kind === 'system' || event?.kind === 'correction' || event?.kind === 'triage_result' || event?.kind === 'task_change' || event?.kind === 'project_change'
    || event?.kind === 'contact_change' || event?.kind === 'counterparty_change') return null;
  if (data.viber) return data.viber.phone ? `tel:${data.viber.phone}` : `viber:${data.viber.chat}`;
  if (data.outbound?.connector === 'viber') return `tel:${data.outbound.chat_id}`;
  if (data.whatsapp) return data.whatsapp.phone ? `tel:${data.whatsapp.phone}` : `wa:${data.whatsapp.jid}`;
  if (data.outbound?.connector?.startsWith('whatsapp_')) return `tel:${data.outbound.chat_id}`;
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
  if (key === 'me' || key.startsWith('task:')) return 'me';
  if (key.startsWith('split:')) return channelOf(event, conversationOf(event) ?? 'me');
  if (event?.payload?.data?.viber || event?.payload?.data?.outbound?.connector === 'viber') return 'viber';
  if (event?.payload?.data?.whatsapp || event?.payload?.data?.outbound?.connector?.startsWith('whatsapp_')) return 'whatsapp';
  if (key.startsWith('tel:')) return 'phone';
  return chatOf(event)?.account ?? null;
};

// A task that names a conversation: the first one of the message that is not filed away. A record the v21 triage (or
// later) made and I have not confirmed does not take my note out of «Я»: the note waits there for ✓ or ✕ (queue.js);
// an older unconfirmed record keeps its note, as before.
const workOf = (view, taskById, { confirmed = false } = {}) => (view?.taskIds ?? []).map((id) => taskById.get(id))
  .find((task) => task && !task.filed && !(confirmed && task.unconfirmed && fromV21(task.processor))) ?? null;
const snippetOf = (view) => (view?.text ?? view?.event?.payload?.text ?? '').trim().split(/\r?\n/)[0].slice(0, 60) || 'Сообщение';

// The name a call, an SMS or a messenger message by number gives its person (or the number itself).
const NUMBER_LIKE = /^\+?[\d\s()-]*$/;
const phoneName = (event) => {
  const data = event.kind === 'call' ? event.payload?.data?.call : event.kind === 'sms' ? event.payload?.data?.sms : null;
  const outbound = event.payload?.data?.outbound;
  const byPhone = outbound && (outbound.connector === 'viber' || outbound.connector.startsWith('whatsapp_'));
  const messenger = event.payload?.data?.viber?.chat ?? event.payload?.data?.whatsapp?.chat ?? (byPhone ? outbound.chat_title : null);
  return (data?.name ?? '').trim() || (messenger ?? '').trim();
};

const titleOf = (view, key, taskById = new Map(), views = []) => {
  if (key === 'me') return 'Заметки';
  if (key.startsWith('task:')) return taskById.get(key.slice(5))?.title ?? 'Заметка';
  if (key.startsWith('split:')) {
    const anchor = views.find((item) => item.id === key.slice(6)) ?? view;
    return workOf(anchor, taskById)?.title ?? snippetOf(anchor);
  }
  const event = view.event;
  if (key.startsWith('tel:')) {
    // The latest real name of either side: my own WhatsApp message from the phone carries only the number.
    for (const item of [view, ...[...views].reverse()]) {
      const name = phoneName(item.event);
      if (name && !NUMBER_LIKE.test(name)) return name;
    }
    return key.slice(4);
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
const isIncoming = (view) => directionOf(view.event) === 'in';
const incomingChat = (view) => isIncoming(view) && (view.event.payload?.data?.telegram || view.event.payload?.data?.viber || view.event.payload?.data?.whatsapp);

// The latest message with the archive mark (`answered`, CONCEPT.md §2.5), or null.
const archiveMark = (views) => views.filter((view) => view.answered).reduce((a, b) => (!a || b.event.ts >= a.event.ts ? b : a), null);

// In the archive: marked, and nothing came after the mark (a new message, theirs or mine, brings it back).
export function isArchived(conversation) {
  const views = conversation.views.filter((view) => !view.deleted);
  const mark = archiveMark(views);
  return Boolean(mark) && !views.some((view) => view.event.ts > mark.event.ts);
}

// message id -> conversation key. An own note that continues or answers a message joins that message's
// conversation (a call description, a reply written without a recipient), through chains of such notes.
// A message split off its chat (and what continues or answers it) is its own conversation `split:<id>`; an own
// note in a task that is not filed away is the conversation of that task `task:<id>` (task manager spec, 2026-11-19).
// `tasksById` — folded tasks by id; without it notes stay in «Заметки».
export function conversationKeys(views, { tasksById = new Map() } = {}) {
  const byId = new Map(views.map((view) => [view.id, view]));
  const keys = new Map();
  const splitOf = (view) => {
    const seen = new Set();
    for (let current = view; current && !seen.has(current.id); current = byId.get(current.continues ?? current.event.reply_to)) {
      if (current.split) return `split:${current.id}`;
      seen.add(current.id);
    }
    return null;
  };
  const resolve = (view) => {
    if (keys.has(view.id)) return keys.get(view.id);
    const split = splitOf(view);
    if (split) { keys.set(view.id, split); return split; }
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
    if (key === 'me') {
      const work = workOf(view, tasksById, { confirmed: true }) ?? workOf(current, tasksById, { confirmed: true });
      if (work) key = `task:${work.id}`;
    }
    keys.set(view.id, key);
    return key;
  };
  for (const view of views) resolve(view);
  return keys;
}

// All conversations, the latest message first, each with `queue` (queue.js; the list's order is queueList's job).
// `keys` — conversationKeys of a wider
// set of views (the feed passes all live ones, so a note keeps its conversation when its parent is archived);
// `questions` / `proposals` — the AI's waiting questions and proposals by message (questions.js, proposals.js).
export function conversations(views, tasks, { now = new Date(), config, questions = new Map(), proposals = new Map(),
  keys = conversationKeys(views, { tasksById: new Map(tasks.map((task) => [task.id, task])) }) }) {
  const groups = new Map();
  for (const view of views) {
    if (view.deleted) continue;
    const key = keys.get(view.id);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(view);
  }
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const owner = ownerLinked(tasks);
  const list = [];
  for (const [key, group] of groups) {
    const sorted = [...group].sort((a, b) => a.event.ts.localeCompare(b.event.ts));
    const latest = sorted.at(-1);
    const own = sorted.filter((view) => conversationOf(view.event) === key).at(-1) ?? latest; // carries the channel's data
    const ids = new Set(sorted.flatMap((view) => view.taskIds ?? []));
    const incoming = sorted.filter(incomingChat).at(-1);
    const conversation = {
      key, title: titleOf(own, key, taskById, sorted), group: sorted.some((view) => chatOf(view.event)?.group),
      channels: [...new Set(sorted.map((view) => channelOf(view.event, key)).filter(Boolean))],
      views: sorted, last: latest.event.ts, tasks: [...ids].map((id) => taskById.get(id)).filter(Boolean),
      reply: incoming ? chatOf(incoming.event) : null,
    };
    list.push({ ...conversation, queue: queueOf(conversation, { now, config, owner, questions, proposals }), archived: isArchived(conversation) });
  }
  return list.sort((a, b) => Date.parse(b.last) - Date.parse(a.last));
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
