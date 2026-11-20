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

// The pane's items: each message, and in «fold» mode runs of other tasks' messages as one fold.
// [{ kind: 'message', view, other } | { kind: 'fold', views }]
export function talkItems(views, taskId, mode = 'dim', linked = new Set()) {
  const items = [];
  for (const view of views) {
    const other = !linked.has(view.id) && !(view.taskIds ?? []).includes(taskId);
    const last = items.at(-1);
    if (other && mode === 'fold') {
      if (last?.kind === 'fold') last.views.push(view); else items.push({ kind: 'fold', views: [view] });
    } else items.push({ kind: 'message', view, other });
  }
  return items;
}

// The task's own feed: messages and changes ({ ts, text }) by time.
export function withLog(views, log = []) {
  const items = [...views.map((view) => ({ kind: 'message', view, ts: view.event.ts })), ...log.map((entry) => ({ kind: 'log', ts: entry.ts, text: entry.text }))];
  return items.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
}

const plural = (n, one, few, many) => (n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? few : many);
export const foldLabel = (n) => `· ${n} ${plural(n, 'сообщение', 'сообщения', 'сообщений')} по другим делам ·`;

const ORDER_KEY = 'stream.cardOrder.';
const MODE_KEY = 'stream.cardOthers';
export const readOrder = (taskId) => { try { return JSON.parse(localStorage.getItem(ORDER_KEY + taskId) ?? '[]'); } catch { return []; } };
export const writeOrder = (taskId, order) => { try { localStorage.setItem(ORDER_KEY + taskId, JSON.stringify(order.slice(0, 12))); } catch { /* storage may be blocked */ } };
export const readMode = () => { try { return localStorage.getItem(MODE_KEY) === 'fold' ? 'fold' : 'dim'; } catch { return 'dim'; } };
const writeMode = (mode) => { try { localStorage.setItem(MODE_KEY, mode); } catch { /* storage may be blocked */ } };
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

// One conversation of the task. ctx: { task, party, conversation (or null), taskViews, bubble(view), unlink(id), name,
// onMode(), log ([{ ts, text }] — the task's changes, shown in «Я») }.
export function talkPane({ task, party, conversation, taskViews, bubble, unlink, name, onMode, log = [] }) {
  const box = element('div', 'card-talk');
  const mode = readMode();
  const internal = Object.hasOwn(PARTY_LABELS, party);
  const views = party === 'me' ? taskViews : internal ? taskViews.filter((view) => partyOfEvent(view.event) === party)
    : (conversation?.views ?? []).filter((view) => !view.deleted);
  const head = element('div', 'card-talk-head');
  if (internal || !conversation) head.append(element('span', 'card-talk-title', internal ? (party === 'me' ? 'Лента задачи' : name) : `${name}: переписки нет`));
  if (!internal && conversation) {
    box.setAttribute('role', 'region');
    box.setAttribute('aria-label', `Переписка: ${name}`);
    const toggle = element('button', 'link-button card-talk-mode', mode === 'fold' ? '◐ другие дела: свёрнуты' : '◐ другие дела: бледнее');
    toggle.type = 'button';
    toggle.setAttribute('aria-label', mode === 'fold' ? 'Показать сообщения по другим делам бледнее' : 'Свернуть сообщения по другим делам');
    toggle.onclick = () => { writeMode(mode === 'fold' ? 'dim' : 'fold'); onMode(); };
    head.append(toggle);
  }
  box.append(head);
  const list = element('div', 'details-talk');
  const message = (view, other) => {
    const item = element('div', `details-message${other ? ' other-task' : internal ? '' : ' task-linked'}`);
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
    const activity = party === 'me' ? log : log.filter((item) => item.party === party);
    for (const item of withLog(views, activity)) {
      if (item.kind === 'message') list.append(message(item.view, false));
      else {
        const time = element('time', null, clock.format(new Date(item.ts)));
        time.dateTime = item.ts;
        const line = element('div', 'talk-log');
        line.append(time, document.createTextNode(` · ${item.text}`));
        list.append(line);
      }
    }
    if (!views.length && !activity.length) list.append(element('p', 'drawer-empty', 'Записей пока нет'));
    box.append(list);
    return box;
  }
  for (const item of talkItems(views, task.id, mode, new Set(taskViews.map((view) => view.id)))) {
    if (item.kind === 'message') { list.append(message(item.view, item.other)); continue; }
    const fold = element('button', 'card-talk-fold', foldLabel(item.views.length));
    fold.type = 'button';
    fold.onclick = () => fold.replaceWith(...item.views.map((view) => message(view, true)));
    list.append(fold);
  }
  if (!views.length) list.append(element('p', 'drawer-empty', 'Сообщений с этим участником пока нет'));
  box.append(list);
  return box;
}
