// Replies to Telegram from the composer (CONCEPT.md §8.2): what the reply carries and whether the bot may
// still answer. Pure: no DOM, no storage.
import { chatOf } from './projection.js';

const REPLY_WINDOW_MS = 24 * 3600 * 1000; // a business bot answers only within 24 hours of an incoming message

// The newest incoming message of the chat is older than 24 hours (or there is none): the bot cannot answer.
// Viber has no such window (the bridge writes as the owner); it answers only by phone (`viberAnswerable`).
export function replyWindowClosed(chat, views, now = Date.now()) {
  if (chat.account === 'viber') return false;
  const last = views.filter((view) => view.event.author !== 'me' && view.event.payload?.data?.telegram && chatOf(view.event)?.key === chat.key).at(-1);
  return !last || now - Date.parse(last.event.ts) > REPLY_WINDOW_MS;
}

// payload.data.outbound for a reply: the chat, and the message it answers when that message is in the chat.
export function outboundData(chat, view, config) {
  if (chat.account === 'viber') return { connector: 'viber', chat_id: chat.chat_id, chat_title: chat.title };
  const answered = view?.event.payload?.data?.telegram;
  return {
    connector: config.telegram?.accounts?.[chat.account]?.connector ?? `telegram_${chat.account}`, chat_id: chat.chat_id, chat_title: chat.title,
    ...(answered && answered.chat_id === chat.chat_id ? { reply_to_message_id: answered.message_id } : {}),
  };
}

// A Viber chat can be answered from the feed only by its phone: Viber hides the number of people not in contacts,
// and a name may be shared by several chats («Неизвестно»).
export const viberAnswerable = (chat) => chat.account !== 'viber' || /^\+\d{6,15}$/.test(chat.chat_id ?? '');
