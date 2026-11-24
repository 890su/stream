// Resolves task conversations and renders their messages and activity.

import { isParty, partyOfEvent, PARTY_LABELS } from './parties.js';
import { chatOf } from './projection.js';
import { TRIGGER_PX, zoneOf } from './swipezones.js';
import { describeChange } from './taskfold.js';

export function conversationParty(conversation) {
  const { key, group, title } = conversation;
  const party = key.startsWith('tg:') && (group || key.startsWith('tg:-')) ? `group:${key}` : key;
  if ((party.startsWith('tg:') || party.startsWith('group:tg:') || party.startsWith('tel:')) && isParty(party)) return party;
  if (/^(?:wa|viber|tel):/.test(key)) {
    const name = (key.startsWith('tel:') ? key.slice(4) : title ?? '').trim().slice(0, 115);
    return name ? `name:${name}` : null;
  }
  return null;
}

// Name-only chats can be read when unambiguous. Callers never use such a match as a recipient.
export function partyConversation(party, conversations) {
  const matches = conversations.filter((item) => conversationParty(item) === party);
  return matches.length === 1 ? matches[0] : null;
}

// Who wrote last among the participants: a group message counts for the group tile when the group is a participant;
// a muted participant (no answers go to them) is skipped. null — nobody but me.
export function lastSpeaker(views, parties, muted = []) {
  const known = new Set(parties);
  const off = new Set(muted);
  for (const view of [...views].reverse()) {
    const chat = chatOf(view.event);
    const group = chat?.group || view.event?.payload?.data?.telegram?.chat_type === 'group' || view.event?.payload?.data?.telegram?.chat_type === 'supergroup';
    const candidates = [group ? `group:tg:${view.event.payload.data.telegram?.chat_id ?? chat?.chat_id}` : null, partyOfEvent(view.event)];
    const party = candidates.find((item) => item && item !== 'me' && known.has(item) && !off.has(item));
    if (party) return party;
  }
  return null;
}

// The order of the tiles: the remembered recent ones first (the chosen one leftmost), then the rest as the task names
// them. Without a remembered choice the first is whoever wrote last in the task, else «Я».
export function cardOrder(parties, { stored = [], lastAuthor = null } = {}) {
  const known = new Set(parties);
  const recent = stored.filter((party) => known.has(party));
  const first = recent.length ? [] : [lastAuthor && known.has(lastAuthor) ? lastAuthor : parties.includes('me') ? 'me' : parties[0]].filter(Boolean);
  return [...new Set([...recent, ...first, ...parties])];
}

// Who the card's conversation is with (owner, 2026-11-22): the chosen interlocutor; null — the task's comments (the
// chosen one switched off, or nobody to talk to); not chosen yet (undefined, or one no longer in the task) — the most
// recent one that is not muted.
export function pickParty(chosen, parties, recent, muted = []) {
  if (chosen === null) return null;
  if (chosen && parties.includes(chosen)) return chosen;
  return recent.find((party) => parties.includes(party) && !muted.includes(party)) ?? null;
}

// The people of the conversations the task's messages come from (a task made from a chat), in the order of the
// conversations list — the card talks with them even when they have no role in the task.
export function messageParties(task, conversations) {
  const ids = new Set(task.messages ?? []);
  const parties = conversations.filter((item) => item.views.some((view) => ids.has(view.id))).map(conversationParty).filter(Boolean);
  return [...new Set(parties)];
}

// The task's comments: notes of mine, the AI's and the system's in the task — not chat messages, my replies to a chat
// or calls and SMS (those are in the conversations).
export function commentViews(views) {
  return views.filter((view) => ['me', 'ai', 'system'].includes(view.event.author) && !view.event.payload?.data?.outbound
    && view.event.kind !== 'call' && view.event.kind !== 'sms');
}

// After a swipe the chosen tile moves leftmost only once the owner starts typing (design 2026-11-21).
export function frontOrder(order, party, typed) {
  if (!typed || !order.includes(party)) return order;
  return [party, ...order.filter((item) => item !== party)];
}

// The pager keeps its order even while the strip moves the selected tile to the front.
export function pagerOrder(parties, previous = []) {
  return [...previous.filter((party) => parties.includes(party)), ...parties.filter((party) => !previous.includes(party))];
}

// Keep the participant strip and inputs out of the edge gesture.
export function bindTalkSwipe(screen, active, move) {
  let start = null;
  screen.addEventListener('touchstart', (event) => {
    start = null;
    if (!active() || event.touches.length !== 1 || event.target.closest?.('input, textarea, .people-cloud')) return;
    const touch = event.touches[0];
    if (zoneOf(touch.clientX, window.innerWidth) !== 'middle') start = touch;
  }, { passive: true });
  screen.addEventListener('touchcancel', () => { start = null; }, { passive: true });
  screen.addEventListener('touchend', (event) => {
    if (!start || !active()) return;
    const touch = event.changedTouches[0];
    const dx = touch.clientX - start.clientX;
    const dy = touch.clientY - start.clientY;
    start = null;
    if (Math.abs(dx) >= TRIGGER_PX && Math.abs(dx) >= Math.abs(dy) * 1.5) move(dx < 0 ? 1 : -1);
  }, { passive: true });
}

// The task's own feed: messages and changes ({ ts, text }) by time.
export function withLog(views, log = []) {
  const items = [...views.map((view) => ({ kind: 'message', view, ts: view.event.ts })), ...log.map((entry) => ({ kind: 'log', ts: entry.ts, text: entry.text }))];
  return items.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
}

const ORDER_KEY = 'stream.cardOrder.';
export const readOrder = (taskId) => { try { return JSON.parse(localStorage.getItem(ORDER_KEY + taskId) ?? '[]'); } catch { return []; } };
export const writeOrder = (taskId, order) => { try { localStorage.setItem(ORDER_KEY + taskId, JSON.stringify(order.slice(0, 12))); } catch { /* storage may be blocked */ } };
const clock = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export function taskActivity(task) {
  return (task.history ?? []).map(({ author, change, ts }) => {
    const party = author === 'me' ? 'me' : change?.processor || author === 'ai' ? 'ai' : 'system';
    const who = { me: 'вы', ai: 'ИИ', system: 'система' }[party];
    return { ts, party, text: `${who}: ${describeChange(change ?? {})}` };
  });
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// One conversation of the task. ctx: { task, party (null — the task's comments), conversation (or null), taskViews,
// bubble(view), unlink(id), name, log ([{ ts, text }] — the task's changes, shown in
// the comments) }. The whole conversation runs in a row, nothing folded (owner, 2026-11-24); the task's own messages
// are marked.
export function talkPane({ task, party, conversation, taskViews, bubble, unlink, name, log = [] }) {
  const box = element('div', 'card-talk');
  const comments = party === null;
  const internal = comments || Object.hasOwn(PARTY_LABELS, party);
  const views = comments ? commentViews(taskViews) : party === 'me' ? taskViews : internal ? taskViews.filter((view) => partyOfEvent(view.event) === party)
    : (conversation?.views ?? []).filter((view) => !view.deleted);
  const head = element('div', 'card-talk-head');
  if (internal || !conversation) head.append(element('span', 'card-talk-title', comments ? 'Комментарии задачи' : internal ? (party === 'me' ? 'Лента задачи' : name) : `${name}: переписки нет`));
  if (!internal && conversation) {
    box.setAttribute('role', 'region');
    box.setAttribute('aria-label', `Переписка: ${name}`);
    head.append(element('span', 'card-talk-title', name));
  }
  box.append(head);
  const list = element('div', 'details-talk');
  const message = (view) => {
    const item = element('div', `details-message${!internal && task.messages.includes(view.id) ? ' task-linked' : ''}`);
    item.append(bubble(view));
    if (task.messages.includes(view.id)) {
      const remove = element('button', 'icon-button details-unlink', '×');
      remove.type = 'button';
      remove.setAttribute('aria-label', 'Убрать сообщение из задачи');
      remove.onclick = (event) => { event.stopPropagation(); unlink(view.id); };
      item.append(remove);
    }
    return item;
  };
  if (internal) {
    const activity = comments || party === 'me' ? log : log.filter((item) => item.party === party);
    for (const item of withLog(views, activity)) {
      if (item.kind === 'message') list.append(message(item.view));
      else {
        const time = element('time', null, clock.format(new Date(item.ts)));
        time.dateTime = item.ts;
        const line = element('div', 'talk-log');
        line.append(time, document.createTextNode(` · ${item.text}`));
        list.append(line);
      }
    }
    if (!views.length && !activity.length) list.append(element('p', 'drawer-empty', comments ? 'Комментариев пока нет: напишите ниже — запись останется в задаче' : 'Записей пока нет'));
    box.append(list);
    return box;
  }
  for (const view of views) list.append(message(view));
  if (!views.length) list.append(element('p', 'drawer-empty', 'Сообщений с этим участником пока нет'));
  box.append(list);
  return box;
}
