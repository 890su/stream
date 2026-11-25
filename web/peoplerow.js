// The line over the input of an open conversation (owner, 2026-11-21): only who I talk with — one tile per chat
// that can be answered (a person in Telegram BY or PL, Viber, WhatsApp; a group), no roles, no «Я», no «Система».
// As in the task card, the chosen one stands leftmost with 📣 and gets the reply; a tap on another chooses it, a tap
// on the chosen one switches it off — the next message is then a note in the conversation. Roles stay in the task
// card. Pure helpers are tested in node.
import { chatOf } from './projection.js';
import { partyOfEvent } from './parties.js';
import { accountTitle } from './tgbubble.js';

// The task of a conversation: the one it is named after (`task:<id>`), else its latest changed open task.
export function conversationTask(conversation) {
  if (!conversation) return null;
  const tasks = conversation.tasks ?? [];
  if (conversation.key?.startsWith('task:')) return tasks.find((task) => task.id === conversation.key.slice(5)) ?? null;
  const open = tasks.filter((task) => !task.filed && !['done', 'cancelled'].includes(task.status));
  return [...open].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0] ?? null;
}

// Who writes in a conversation: me and every other author, once.
export function chatParties(conversation) {
  const parties = ['me'];
  for (const view of conversation?.views ?? []) {
    if (view.deleted) continue;
    const party = partyOfEvent(view.event);
    if (party && !parties.includes(party)) parties.push(party);
  }
  return parties;
}

// The chats of a conversation a reply can go to, the latest first: { key, account, chat_id, title, group, last }.
// Only messenger chats with an address (a WhatsApp or Viber chat without a phone cannot be answered from here).
export function replyChats(conversation) {
  const chats = new Map();
  for (const view of conversation?.views ?? []) {
    if (view.deleted) continue;
    const data = view.event?.payload?.data ?? {};
    if (!data.telegram && !data.viber && !data.whatsapp && !data.outbound && !data.sms) continue;
    const chat = chatOf(view.event);
    if (!chat || chat.chat_id === '' || chat.chat_id === undefined || chat.chat_id === null) continue;
    const last = view.event.ts;
    const known = chats.get(chat.key);
    if (!known || last >= known.last) chats.set(chat.key, { ...chat, last, title: chat.title || known?.title || 'Чат' });
  }
  return [...chats.values()].sort((a, b) => b.last.localeCompare(a.last) || a.key.localeCompare(b.key));
}

// The tiles' order: the chosen chat leftmost, then the rest, the latest first.
export function rowOrder(chats, chosenKey) {
  const chosen = chats.find((chat) => chat.key === chosenKey);
  return chosen ? [chosen, ...chats.filter((chat) => chat !== chosen)] : chats;
}

const PERSON = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8.5" r="3.6"/><path d="M4.8 20a7.2 7.2 0 0 1 14.4 0"/></svg>';
const GROUP = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8.5" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><path d="M15.5 5.8a3 3 0 0 1 0 5.4M17.5 14.2A5.5 5.5 0 0 1 20.5 19"/></svg>';
const channel = (account) => (account === 'viber' ? 'Viber' : account === 'sms' ? 'SMS' : account.startsWith('whatsapp_') ? 'WA' : accountTitle(account).replace(/^Telegram\s*/, ''));

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// `chosen(conversation)` — the chosen chat or null; `onPick(chat | null)` — a tap chose one or switched it off.
export function setupPeopleRow({ chosen, onPick }) {
  const row = document.querySelector('#people-row');
  function render(conversation) {
    const chats = conversation && conversation.key !== 'me' ? replyChats(conversation) : [];
    if (!chats.length) { row.hidden = true; row.replaceChildren(); return; }
    const current = chosen(conversation);
    const box = element('div', 'card-people strip');
    const line = element('div', 'people-row');
    const cloud = element('div', 'people-cloud');
    const inner = element('div', 'people-cloud-inner');
    for (const chat of rowOrder(chats, current?.key)) {
      const on = chat.key === current?.key;
      const tile = element('span', `person-tile${on ? ' selected' : ''}`);
      const body = element('button', 'person-tile-body');
      body.type = 'button';
      body.setAttribute('aria-pressed', String(on));
      body.setAttribute('aria-label', `${chat.title}, ${accountTitle(chat.account)}: ${on ? 'ответ уходит сюда, выключить' : 'отвечать сюда'}`);
      const icon = element('span', 'person-tile-icon');
      icon.innerHTML = chat.group ? GROUP : PERSON;
      body.append(icon, element('span', 'person-tile-caption', chat.title), element('small', 'person-tile-channel', channel(chat.account)));
      body.onclick = () => onPick(on ? null : chat);
      tile.append(body);
      if (on) tile.append(element('span', 'person-tile-speaker', '📣'));
      inner.append(tile);
    }
    cloud.append(inner);
    line.append(cloud);
    box.append(line);
    row.replaceChildren(box);
    row.hidden = false;
  }
  return { render };
}
