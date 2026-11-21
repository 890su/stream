import { accountTitle } from './tgbubble.js';
import { chatOf, snippet } from './projection.js';
import { makeTaskChange, makePersonChange, ownTask } from './shared.js';
import { personOf } from './contacts.js';
import { personFromConversation } from './personcard.js';
import { reveal, conceal } from './motion.js';
import { setupPeopleRow, conversationTask } from './peoplerow.js';
import { answerable } from './participants.js';
import { snoozeMenu } from './snooze.js';
import { topicOf } from './topic.js';
import { topicLine } from './cardhead.js';
import { tileFacts } from './convlist.js';

const $ = (selector) => document.querySelector(selector);

// One conversation (CONCEPT.md §2.5, §5): the head of its card on top (design 2026-11-21) — who and which channel
// (a tap — the person's card), the topic line (cardhead.js: «+ задача…», the AI's offer with ✓ ✕, the task, the
// «задача» switch), how long it waits with ⏱ ↥ 🗄, «≡» unfolds every cut, the folded details. In Беседы it is the
// conversation screen («назад» or the system back); in Задачи and Лента it is the contact filter (× removes it).
// The composer's recipient is the chat chosen in the line of interlocutors over the input (peoplerow.js): by default
// the chat of the latest incoming message. With none chosen (switched off, a phone number, a chat with only my
// messages) the composer continues the conversation's last message, so the note stays in it; own notes («Я») are
// plain notes. «Не отслеживать» for Telegram conversations.
export function setupChatView({ feed, composer, correct, notify, openTask = () => {}, openPerson = () => {}, openCounterparty = () => {}, convQuick = null, queueConfig = null, onLeave = () => {} }) {
  const bar = $('#chat-bar');
  let key = null;
  let applied = null; // the reply chat this view put into the composer
  // The chat chosen in the line per conversation: a chat, or null — switched off. Not chosen yet — the default.
  const picked = new Map();
  // The default: the chat of the latest incoming message, unless its participant is switched off in the task.
  const chosen = (conversation) => {
    if (!conversation) return null;
    if (picked.has(conversation.key)) return picked.get(conversation.key);
    return conversation.reply && answerable(conversation, conversationTask(conversation)?.muted ?? []) ? conversation.reply : null;
  };
  // Interlocutors over the tags (peoplerow.js): a tap chooses whom the reply goes to.
  const people = setupPeopleRow({ chosen, onPick: (chat) => {
    const conversation = feed.conversation();
    if (!conversation) return;
    picked.set(conversation.key, chat);
    composer.chat(chat);
    applied = chat;
    sync();
  } });
  const topic = { last: () => feed.conversation()?.views.filter((view) => !view.deleted).at(-1) };
  const detailsOpen = new Set(); // conversations whose details the owner unfolded (this session)
  const save = (id, change) => composer.queue(makeTaskChange(id, change)).catch((error) => { notify(error.message); throw error; });
  // The topic line's acts (cardhead.js); each with «Вернуть».
  const topicActs = {
    openTask: (id) => openTask(id),
    async create(title) {
      const conversation = feed.conversation();
      const waiting = (conversation?.queue?.pending ?? []).map((view) => view.id);
      const ids = waiting.length ? waiting : [topic.last()?.id].filter(Boolean);
      if (!ids.length) return;
      const id = crypto.randomUUID();
      await save(id, { ...ownTask(title, ids[0]), add: ids }).catch(() => null);
      notify(`Задача: «${title}»`, { label: 'Вернуть', run: () => save(id, { op: 'update', status: 'cancelled', remove: ids }).catch(() => {}) });
    },
    async confirm(task) {
      await save(task.id, { op: 'update', unconfirmed: false }).catch(() => null);
      notify(`Задача подтверждена: «${task.title}»`, { label: 'Вернуть', run: () => save(task.id, { op: 'update', unconfirmed: true }).catch(() => {}) });
    },
    async reject(task) {
      await save(task.id, { op: 'update', status: 'cancelled' }).catch(() => null);
      notify(`Без задачи: «${task.title}» отклонена`, { label: 'Вернуть', run: () => save(task.id, { op: 'update', status: task.status, unconfirmed: true }).catch(() => {}) });
    },
    async toggle(on) {
      const conversation = feed.conversation();
      if (!conversation) return;
      const current = topicOf(conversation);
      if (!on) {
        const task = current.tasks.find((item) => !item.unconfirmed);
        if (!task) return;
        await save(task.id, { op: 'update', unconfirmed: true }).catch(() => null);
        notify(`«${task.title}» — снова тема, не задача`, { label: 'Вернуть', run: () => save(task.id, { op: 'update', unconfirmed: false }).catch(() => {}) });
        return;
      }
      const offered = current.tasks.find((item) => item.unconfirmed);
      if (offered) { await topicActs.confirm(offered); return; }
      const source = topic.last();
      if (source) await topicActs.create(`${conversation.title}: ${snippet(source)}`.slice(0, 120));
    },
  };

  // The composer follows the conversation: its reply chat once known (unless another recipient was chosen), else
  // a continuation of its last message. The details panel's task topic wins while it is open. A participant switched
  // off in the conversation (its task's `muted`) is not the recipient by default.
  function steer() {
    const conversation = feed.conversation();
    const reply = chosen(conversation);
    // The line's choice goes into the composer unless the owner chose another recipient in «связь».
    const ours = !composer.recipient() || composer.recipient().key === applied?.key;
    if (ours && (reply?.key ?? null) !== (applied?.key ?? null)) { composer.chat(reply); applied = reply; }
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
    // The topic line and the facts: own notes and task notes have no topic of their own.
    const topical = conversation && key !== 'me' && !key.startsWith('task:');
    $('#chat-topic').replaceChildren(...(topical ? [topicLine({ topic: topicOf(conversation), on: topicActs })] : []));
    $('#chat-topic').hidden = !topical;
    const facts = conversation?.queue?.waiting ? tileFacts(conversation, { now: new Date(), hotHours: 2, counterparties: feed.counterparties() }) : null;
    $('#chat-facts').textContent = facts ? `ждёт ${facts.waited}` : conversation?.queue?.snoozedUntil ? 'отложена' : '';
    const unfolded = detailsOpen.has(key);
    $('#chat-details').hidden = !unfolded;
    $('#chat-more').setAttribute('aria-expanded', String(unfolded));
    $('#chat-cuts').setAttribute('aria-pressed', String(feed.allCuts()));
    // A personal chat opens in the Telegram app by the user id; a group has no such link.
    const app = $('#chat-app');
    app.hidden = !chat || chat.group;
    app.href = chat && !chat.group ? `tg://user?id=${chat.chat_id}` : '#';
    $('#chat-untrack').hidden = !key.startsWith('tg:');
    // The queue (CONCEPT.md §2.5): «прочитал, но откладываю» — only for a conversation with someone, only in Беседы.
    for (const id of ['#chat-snooze', '#chat-requeue', '#chat-archive']) $(id).hidden = !inList || key === 'me' || key.startsWith('task:');
    $('#chat-person').hidden = !personFromConversation(conversation ?? { key });
    people.render(conversation);
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
    people.render(null);
    composer.chat(null);
    if (composer.topic() === topic) composer.leaveTopic();
    await feed.openConversation(null);
    onLeave();
  };
  // «назад», ×, the selected «Беседы» tab: through history when the entry is ours, so the system back stays in step.
  const leave = () => { if (history.state?.conversation) history.back(); else close(); };
  window.addEventListener('popstate', () => { if (key && !history.state?.conversation) close(); });
  $('#chat-close').onclick = leave;
  $('#chat-back').onclick = leave;
  // ⏱ ↥ 🗄: the mark goes on the conversation's latest message, then back to the queue. Leaving without them keeps
  // the conversation's place (owner, 2026-11-20).
  const queued = (run) => { const conversation = feed.conversation(); if (!conversation || !convQuick) return; run(conversation); leave(); };
  $('#chat-snooze').onclick = (event) => {
    const conversation = feed.conversation();
    if (conversation && convQuick) snoozeMenu(event.currentTarget, { config: queueConfig(), onPick: (until) => queued((item) => convQuick.snooze(item, until)) });
  };
  $('#chat-requeue').onclick = () => queued((item) => convQuick.requeue(item));
  $('#chat-archive').onclick = () => queued((item) => convQuick.archive(item));
  // «Контакт»: the person of this conversation from the directory, or a new one from the chat or the number.
  let creatingPerson = false; // a double tap must not make two people: the directory updates on the next render
  $('#chat-more').onclick = () => { if (detailsOpen.has(key)) detailsOpen.delete(key); else detailsOpen.add(key); sync(); };
  $('#chat-cuts').onclick = async () => { await feed.setAllCuts(!feed.allCuts()); sync(); };
  $('#chat-title').onclick = () => $('#chat-person').onclick();
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
  // ✨ «Создать задачу» (magic.js): the topic switch on.
  return { open, close, leave, sync, key: () => key, makeTask: () => topicActs.toggle(true) };
}
