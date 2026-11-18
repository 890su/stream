import { accountTitle } from './tgbubble.js';
import { chatOf } from './projection.js';
import { reveal, conceal } from './motion.js';

const $ = (selector) => document.querySelector(selector);

// One conversation (CONCEPT.md §2.5, §5): the bar on top with its title. In Беседы it is the conversation screen
// («назад» returns to the list); in Задачи and Лента it is the contact filter (× removes it). The composer's
// recipient is the conversation's reply chat; a phone number or own notes have none — a note to self.
// «Не отслеживать» for Telegram conversations.
export function setupChatView({ feed, composer, correct, notify }) {
  const bar = $('#chat-bar');
  let key = null;
  // The bar follows the view: «назад» in Беседы, × elsewhere.
  const sync = () => {
    const conversation = feed.conversation();
    if (!key) return;
    const inList = feed.mode() === 'conversations';
    $('#chat-back').hidden = !inList;
    $('#chat-close').hidden = inList;
    const chat = conversation?.reply ?? null;
    const channels = (conversation?.channels ?? []).filter((channel) => channel === 'by' || channel === 'pl').map(accountTitle);
    $('#chat-title').textContent = [channels.join(', '), conversation?.title ?? 'Беседа'].filter(Boolean).join(' · ');
    // A personal chat opens in the Telegram app by the user id; a group has no such link.
    const app = $('#chat-app');
    app.hidden = !chat || chat.group;
    app.href = chat && !chat.group ? `tg://user?id=${chat.chat_id}` : '#';
    $('#chat-untrack').hidden = !key.startsWith('tg:');
  };
  const open = async (next) => {
    if (!next) return;
    key = next;
    await feed.openConversation(next);
    reveal(bar, 'translateY(-8px)');
    composer.chat(feed.conversation()?.reply ?? null); // in a group the bot writes as itself
    sync();
  };
  const close = async () => {
    if (!key) return;
    key = null;
    conceal(bar, 'translateY(-8px)');
    composer.chat(null);
    await feed.openConversation(null);
  };
  $('#chat-close').onclick = close;
  $('#chat-back').onclick = close;
  // «Не отслеживать»: Stream stops writing this chat; what is already written may go to the archive.
  const dialog = $('#untrack');
  $('#chat-untrack').onclick = () => {
    $('#untrack-text').textContent = `Новые сообщения из «${feed.conversation()?.title ?? 'чата'}» больше не попадут в Stream, разбор на них не тратится. Вернуть можно в ⋮ → Система.`;
    dialog.returnValue = '';
    dialog.showModal();
  };
  dialog.addEventListener('close', async () => {
    const choice = dialog.returnValue;
    const conversation = feed.conversation();
    if (!key || !conversation || (choice !== 'archive' && choice !== 'keep')) return;
    // Both accounts may carry the chat: each account's chat is switched off by its own latest message.
    const anchors = [...new Map(conversation.views.filter((view) => view.event.payload?.data?.telegram).map((view) => [chatOf(view.event).key, view])).values()];
    if (!anchors.length) { notify('В этом чате нет сообщений, по которым его можно отключить'); return; }
    for (const anchor of anchors) await correct(anchor, 'untrack');
    if (choice === 'archive') await Promise.all(conversation.views.filter((view) => !view.archived).map((view) => correct(view, 'archive')));
    await close();
    notify(`«${conversation.title}» больше не отслеживается`, { label: 'Отменить', run: () => Promise.all(anchors.map((anchor) => correct(anchor, 'track'))) });
  });
  return { open, close, sync, key: () => key };
}
