import { accountTitle } from './tgbubble.js';

const $ = (selector) => document.querySelector(selector);

// One messenger chat in the feed: the chat bar on top, the chat is the composer's default recipient.
export function setupChatView({ feed, composer, correct, notify }) {
  const bar = $('#chat-bar');
  let current = null;
  const open = async (chat) => {
    if (!chat) return;
    current = chat;
    $('#chat-title').textContent = `${accountTitle(chat.account)} · ${chat.title}`;
    // A personal chat opens in the Telegram app by the user id; a group has no such link.
    const app = $('#chat-app');
    app.hidden = chat.group;
    app.href = chat.group ? '#' : `tg://user?id=${chat.chat_id}`;
    bar.hidden = false;
    composer.chat(chat); // the chat is the default recipient; in a group the bot writes as itself
    await feed.setChatFilter(chat);
  };
  const close = async () => {
    if (!current) return;
    current = null;
    bar.hidden = true;
    composer.chat(null);
    await feed.setChatFilter(null);
  };
  $('#chat-close').onclick = close;
  // «Не отслеживать»: Stream stops writing this chat; what is already written may go to the archive.
  const dialog = $('#untrack');
  $('#chat-untrack').onclick = () => {
    $('#untrack-text').textContent = `Новые сообщения из «${current.title}» больше не попадут в Stream, разбор на них не тратится. Вернуть можно в ⋮ → Система.`;
    dialog.returnValue = '';
    dialog.showModal();
  };
  dialog.addEventListener('close', async () => {
    const choice = dialog.returnValue;
    if (!current || (choice !== 'archive' && choice !== 'keep')) return;
    const messages = feed.visible().filter((view) => view.event.payload?.data?.telegram);
    const anchor = messages.at(-1);
    if (!anchor) { notify('В этом чате нет сообщений, по которым его можно отключить'); return; }
    await correct(anchor, 'untrack');
    if (choice === 'archive') await Promise.all(feed.visible().filter((view) => !view.archived).map((view) => correct(view, 'archive')));
    const title = current.title;
    await close();
    notify(`«${title}» больше не отслеживается`, { label: 'Отменить', run: () => correct(anchor, 'track') });
  });
  return { open, close };
}
