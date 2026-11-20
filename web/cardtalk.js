// The conversation in the task card (docs/plans/2026-11-20-queue-and-task-screen-design.md, stage 2): the participants
// line is always shown; the tile chosen there stands leftmost (the line is a queue of recent ones) and under the line
// is the whole conversation with that participant — messages of this task as they are, of other tasks dimmed or
// folded by «◐». «Я» shows the task's own messages. Pure helpers (tested in node) and the DOM of the pane.

import { partyOfEvent } from './parties.js';
import { chatOf } from './projection.js';

// The conversation of a participant: a Telegram user or group → its chat, a number → `tel:`; others have none.
export function partyConversation(party, conversations) {
  const key = party.startsWith('group:tg:') ? `tg:${party.slice(9)}` : party.startsWith('tg:') || party.startsWith('tel:') ? party : null;
  return key ? conversations.find((item) => item.key === key) ?? null : null;
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

// The pane's items: each message, and in «fold» mode runs of other tasks' messages as one fold.
// [{ kind: 'message', view, other } | { kind: 'fold', views }]
export function talkItems(views, taskId, mode = 'dim') {
  const items = [];
  for (const view of views) {
    const other = !(view.taskIds ?? []).includes(taskId);
    const last = items.at(-1);
    if (other && mode === 'fold') {
      if (last?.kind === 'fold') last.views.push(view); else items.push({ kind: 'fold', views: [view] });
    } else items.push({ kind: 'message', view, other });
  }
  return items;
}

const plural = (n, one, few, many) => (n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? few : many);
export const foldLabel = (n) => `· ${n} ${plural(n, 'сообщение', 'сообщения', 'сообщений')} по другим делам ·`;

const ORDER_KEY = 'stream.cardOrder.';
const MODE_KEY = 'stream.cardOthers';
export const readOrder = (taskId) => { try { return JSON.parse(localStorage.getItem(ORDER_KEY + taskId) ?? '[]'); } catch { return []; } };
export const writeOrder = (taskId, order) => { try { localStorage.setItem(ORDER_KEY + taskId, JSON.stringify(order.slice(0, 12))); } catch { /* storage may be blocked */ } };
export const readMode = () => { try { return localStorage.getItem(MODE_KEY) === 'fold' ? 'fold' : 'dim'; } catch { return 'dim'; } };
const writeMode = (mode) => { try { localStorage.setItem(MODE_KEY, mode); } catch { /* storage may be blocked */ } };

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// The pane under the participants line. ctx: { task, party, conversation (or null), taskViews, bubble(view),
// unlink(id), name, onMode() }.
export function talkPane({ task, party, conversation, taskViews, bubble, unlink, name, onMode }) {
  const box = element('div', 'card-talk');
  const mode = readMode();
  const views = party === 'me' || !conversation ? taskViews : conversation.views.filter((view) => !view.deleted);
  const head = element('div', 'card-talk-head');
  head.append(element('span', 'card-talk-title', party === 'me' ? 'Сообщения задачи' : conversation ? `Переписка с ${name}` : `${name}: переписки нет`));
  if (party !== 'me' && conversation) {
    const toggle = element('button', 'link-button card-talk-mode', mode === 'fold' ? '◐ другие дела: свёрнуты' : '◐ другие дела: бледнее');
    toggle.type = 'button';
    toggle.setAttribute('aria-label', mode === 'fold' ? 'Показать сообщения по другим делам бледнее' : 'Свернуть сообщения по другим делам');
    toggle.onclick = () => { writeMode(mode === 'fold' ? 'dim' : 'fold'); onMode(); };
    head.append(toggle);
  }
  box.append(head);
  const list = element('div', 'details-talk');
  const message = (view, other) => {
    const item = element('div', `details-message${other ? ' other-task' : ''}`);
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
  for (const item of talkItems(views, task.id, party === 'me' ? 'dim' : mode)) {
    if (item.kind === 'message') { list.append(message(item.view, item.other)); continue; }
    const fold = element('button', 'card-talk-fold', foldLabel(item.views.length));
    fold.type = 'button';
    fold.onclick = () => fold.replaceWith(...item.views.map((view) => message(view, true)));
    list.append(fold);
  }
  if (!views.length) list.append(element('p', 'drawer-empty', party === 'me' ? 'Сообщений нет' : 'Сообщений с этим участником пока нет'));
  box.append(list);
  return box;
}
