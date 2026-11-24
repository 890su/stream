// The task card «По задаче» (CONCEPT.md §5, 2026-11-24): the task's discussion from every conversation and channel in
// time order, each message with a folded «контекст» — its neighbours in its conversation that are not in the task;
// whom the input writes to (the chosen tile; the hint names it) and the long-press list of recipients on «Отправить».
// taskThread, recipientOptions and recipientHint are pure (tested in node); threadPane builds the DOM.
import { commentViews, partyConversation } from './cardtalk.js';
import { replyChats } from './peoplerow.js';
import { accountTitle } from './tgbubble.js';

const CONTEXT = 1; // neighbours on each side, at most

// [{ view, before: [views], after: [views] }] — the task's messages that live in a conversation (not its comments), by
// time; `before`/`after` — up to CONTEXT neighbours of the same conversation, stopping at another message of the task,
// each shown once.
export function taskThread(taskViews, conversations) {
  const comments = new Set(commentViews(taskViews));
  const inTask = new Set(taskViews.map((view) => view.id));
  const where = new Map();
  for (const conversation of conversations) {
    const live = conversation.views.filter((view) => !view.deleted).sort((a, b) => String(a.event.ts).localeCompare(String(b.event.ts)));
    live.forEach((view, index) => where.set(view.id, { list: live, index }));
  }
  const shown = new Set(inTask);
  const take = (list, from, step) => {
    const found = [];
    for (let index = from + step; index >= 0 && index < list.length && found.length < CONTEXT; index += step) {
      const view = list[index];
      if (inTask.has(view.id)) break;
      if (shown.has(view.id)) break;
      found.push(view);
    }
    for (const view of found) shown.add(view.id);
    return step < 0 ? found.reverse() : found;
  };
  return taskViews.filter((view) => !view.deleted && !comments.has(view) && where.has(view.id))
    .sort((a, b) => String(a.event.ts).localeCompare(String(b.event.ts)))
    .map((view) => {
      const { list, index } = where.get(view.id);
      const before = take(list, index, -1);
      const after = take(list, index, 1);
      return { view, before, after };
    });
}

const COMMENT = 'Комментарий к задаче';

// The long-press list: [{ party, chat, label }] — each person with each chat of theirs a reply can go to, the comment last.
export function recipientOptions(parties, conversations, nameOf) {
  const options = [];
  for (const party of parties) {
    const conversation = partyConversation(party, conversations);
    for (const chat of replyChats(conversation)) if (!chat.group) options.push({ party, chat, label: `${nameOf(party)} · ${accountTitle(chat.account)}` });
  }
  options.push({ party: null, chat: null, label: COMMENT });
  return options;
}

// The input's hint: whom a message goes to, short enough for one line on a phone («→ Анна · TG BY»).
const shortChannel = (account) => accountTitle(account).replace(/^Telegram\s*/, 'TG ').replace(/^WhatsApp\s*/, 'WA ');
export function recipientHint(party, conversation, name) {
  if (!party) return COMMENT;
  const chat = replyChats(conversation)[0];
  return chat ? `→ ${name} · ${shortChannel(chat.account)}` : `→ ${name} (нет чата: заметка в задаче)`;
}
