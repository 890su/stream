// One-tap actions of a task card (P14): which actions a task offers by status and roles, the task change each
// one makes, due-date chips, and the parties a task can be handed to. Pure: no DOM — tested in node.
import { partyOf, PARTY_LABELS } from './parties.js';

const ACTION_LABELS = { accept: 'Принять', delegate: 'Поручить…', defer: 'Отложить…', wait: 'Жду…', done: 'Готово', verify: 'Проверил', reopen: 'Вернуть в работу', cancel: 'Отменить' };
export const actionLabel = (action) => ACTION_LABELS[action] ?? action;

// Someone other than me does the task.
const delegated = (task) => task.roles.executors.length > 0 && !task.roles.executors.includes('me');

export function actionsFor(task) {
  switch (task.status) {
    case 'inbox': return ['accept', 'delegate', 'defer', 'cancel'];
    case 'todo': case 'doing': return ['done', 'delegate', 'defer', 'wait', 'cancel'];
    case 'waiting': return ['done', 'delegate', 'defer', 'cancel'];
    case 'review': return ['verify', 'reopen', 'cancel'];
    case 'deferred': return ['reopen', 'cancel'];
    default: return ['reopen'];
  }
}

// The change for an action, or 'report' when closing goes through the card «Задача выполнена?».
export function changeFor(action, task, arg, now = new Date()) {
  switch (action) {
    case 'accept': return { status: 'todo', roles: { executors: ['me'] } };
    case 'delegate': return { roles: { executors: [arg], controller: 'me' } };
    case 'defer': return { status: 'deferred', remind_at: arg };
    case 'wait': return { status: 'waiting', waiting_for: { party: arg, since: now.toISOString() } };
    case 'done': return delegated(task) ? { status: 'review', proposed: null } : 'report';
    case 'verify': return 'report';
    case 'reopen': return { status: 'todo' };
    case 'cancel': return { status: 'cancelled' };
    default: return null;
  }
}

const dayOf = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

// Due dates in one tap; «на неделе» is the nearest Friday still ahead (from Friday on — the next one).
export function dueChips(now = new Date()) {
  const at = (days) => { const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days); return dayOf(date); };
  const weekday = now.getDay();
  const toFriday = weekday >= 1 && weekday <= 4 ? 5 - weekday : (5 - weekday + 7) % 7 || 7;
  return [{ label: 'сегодня', due: at(0) }, { label: 'завтра', due: at(1) }, { label: 'на неделе', due: at(toFriday) }];
}

const telegramOf = (view) => view.event?.payload?.data?.telegram;

// A party's name: the label, else the name in the task's conversations, else the number or the text.
export function partyName(party, views = []) {
  if (PARTY_LABELS[party]) return PARTY_LABELS[party];
  if (party.startsWith('name:')) return party.slice(5);
  if (party.startsWith('tel:')) {
    const number = party.slice(4);
    for (const view of views) {
      const data = view.event?.payload?.data?.call ?? view.event?.payload?.data?.sms;
      if (data?.number === number && data.name?.trim()) return data.name.trim();
    }
    return number;
  }
  for (const view of views) {
    const telegram = telegramOf(view);
    if (telegram && partyOf(view.event.author) === party) return telegram.from_name || telegram.chat_title || party;
  }
  return party;
}

// Who a task can be handed to from its conversations: the authors of its messages (not me), without repeats.
export function delegateOptions(views) {
  const seen = new Map();
  for (const view of views) {
    const party = partyOf(view.event.author);
    if (party !== 'me' && !seen.has(party)) seen.set(party, { party, name: partyName(party, views) });
  }
  return [...seen.values()];
}
