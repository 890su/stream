import { accountTitle } from './tgbubble.js';
import { chatOf, snippet } from './projection.js';
import { makeTaskChange, makePersonChange, ownTask } from './shared.js';
import { personOf } from './contacts.js';
import { personFromConversation } from './personcard.js';
import { reveal, conceal } from './motion.js';

const $ = (selector) => document.querySelector(selector);

// One conversation (CONCEPT.md §2.5, §5): the bar on top with its title. In Беседы it is the conversation screen
// («назад» or the system back returns to the list); in Задачи and Лента it is the contact filter (× removes it).
// The composer's recipient is the conversation's reply chat. Without one (a phone number, a chat with only my
// messages) the composer continues the conversation's last message, so the note stays in it; own notes («Я») are
// plain notes. «Не отслеживать» for Telegram conversations.
export function setupChatView({ feed, composer, correct, notify, openTask = () => {}, openPerson = () => {} }) {
  const bar = $('#chat-bar');
  let key = null;
  let applied = null; // the reply chat this view put into the composer
  const topic = { last: () => feed.conversation()?.views.filter((view) => !view.deleted).at(-1) };

  // The composer follows the conversation: its reply chat once known (unless another recipient was chosen), else
  // a continuation of its last message. The details panel's task topic wins while it is open.
  function steer() {
    const conversation = feed.conversation();
    const reply = conversation?.reply ?? null;
    if (reply && !applied && !composer.recipient()) { composer.chat(reply); applied = reply; }
    const wanted = Boolean(key && key !== 'me' && !reply && conversation);
    if (wanted && !composer.topic()) composer.enterTopic(topic, 'Сообщение в беседу');
    else if (!wanted && composer.topic() === topic) composer.leaveTopic();
  }

  // The bar follows the view: «назад» in Беседы, × elsewhere.
  const sync = () => {
    if (!key) return;
    const conversation = feed.conversation();
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
    $('#chat-person').hidden = !personFromConversation(conversation ?? { key });
    steer();
  };

  // The drawer closes by going back in history; a new entry pushed before that back lands would be popped by it.
  const settled = () => new Promise((resolve) => {
    if (!history.state?.drawer) { resolve(); return; }
    const done = () => { window.removeEventListener('popstate', done); clearTimeout(timer); resolve(); };
    const timer = setTimeout(done, 400);
    window.addEventListener('popstate', done);
  });

  const open = async (next) => {
    if (!next) return;
    await settled();
    // One history entry per stay in conversations: the system back returns to the list.
    if (!history.state?.conversation) history.pushState({ conversation: true }, '');
    if (next !== key) { applied = null; composer.chat(null); }
    key = next;
    await feed.openConversation(next);
    reveal(bar, 'translateY(-8px)');
    sync();
  };
  const close = async () => {
    if (!key) return;
    key = null;
    applied = null;
    conceal(bar, 'translateY(-8px)');
    composer.chat(null);
    if (composer.topic() === topic) composer.leaveTopic();
    await feed.openConversation(null);
  };
  // «назад», ×, the selected «Беседы» tab: through history when the entry is ours, so the system back stays in step.
  const leave = () => { if (history.state?.conversation) history.back(); else close(); };
  window.addEventListener('popstate', () => { if (key && !history.state?.conversation) close(); });
  $('#chat-close').onclick = leave;
  $('#chat-back').onclick = leave;
  // «Контакт»: the person of this conversation from the directory, or a new one from the chat or the number.
  let creatingPerson = false; // a double tap must not make two people: the directory updates on the next render
  $('#chat-person').onclick = async () => {
    if (creatingPerson) return;
    const conversation = feed.conversation();
    const draft = personFromConversation(conversation);
    if (!draft) { notify('Это не беседа с человеком'); return; }
    const party = conversation.key.startsWith('tel:') ? conversation.key : `tg:${draft.telegram[0]}`;
    const known = personOf(party, feed.people());
    if (known) { openPerson(known.id); return; }
    const id = crypto.randomUUID();
    creatingPerson = true;
    try { await composer.queue(makePersonChange(id, { op: 'create', ...draft })); } catch (error) { notify(error.message); return; } finally { setTimeout(() => { creatingPerson = false; }, 1500); }
    openPerson(id);
  };
  // «+ Задача»: a new task for this conversation, from its latest message, titled by the conversation.
  $('#chat-task').onclick = async () => {
    const conversation = feed.conversation();
    const source = conversation?.views.filter((view) => !view.deleted).at(-1);
    if (!source) return;
    const id = crypto.randomUUID();
    const title = `${conversation.title}: ${snippet(source)}`.slice(0, 120);
    try { await composer.queue(makeTaskChange(id, ownTask(title, source.id))); } catch (error) { notify(error.message); return; }
    openTask(id);
    notify(`Задача по беседе «${conversation.title}»`, { label: 'Вернуть', run: () => composer.queue(makeTaskChange(id, { op: 'update', status: 'cancelled' })).catch((error) => notify(error.message)) });
  };
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
    leave();
    notify(`«${conversation.title}» больше не отслеживается`, { label: 'Отменить', run: () => Promise.all(anchors.map((anchor) => correct(anchor, 'track'))) });
  });
  return { open, close, leave, sync, key: () => key };
}
