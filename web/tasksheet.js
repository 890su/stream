// The sheet a long press on a task row opens (task card design §1): the task's title and the action bar (taskbar.js)
// sliding up from the bottom, without opening the card. A tap outside, the system back or any action closes it.
// `barContext` is the bar's context for a task — the card uses it too (taskdetails.js).
import { actionBar } from './taskbar.js';
import { inWork, isMineToDo } from './focus.js';
import { backStack } from './backclose.js';
import { reveal } from './motion.js';

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// A personal chat of a participant switched off in the card (participants.js) is not answered from the task.
export const answerable = (conversation, muted = []) => Boolean(conversation.reply) && (conversation.reply.group || !muted.includes(`tg:${conversation.reply.chat_id}`));

// What the bar needs about a task: is it mine to do, the task in work, its messages, the chat to answer in.
export function barContext(task, { feed, quick, openConversation }) {
  const chat = feed.conversations().find((item) => answerable(item, task.muted) && item.tasks.some((other) => other.id === task.id));
  return {
    mine: isMineToDo(task), hasChat: Boolean(chat), views: feed.taskViews(task.id), current: inWork(feed.tasks()).current, quick,
    onReply: chat ? () => openConversation(chat.key) : null,
  };
}

let closeOpen = null; // one sheet at a time

export function openTaskSheet(task, deps) {
  closeOpen?.();
  const backdrop = element('div', 'task-sheet-backdrop');
  const sheet = element('div', 'task-sheet');
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-label', `Действия: ${task.title}`);
  let release = null;
  const close = () => {
    if (!sheet.isConnected) return;
    backdrop.remove();
    sheet.remove();
    release?.();
    closeOpen = null;
  };
  sheet.append(element('p', 'task-sheet-title', task.title), actionBar(task, { ...barContext(task, deps), onDone: close }));
  backdrop.onclick = close;
  document.body.append(backdrop, sheet);
  reveal(sheet, 'translateY(24px)');
  release = backStack?.opened(close) ?? null;
  closeOpen = close;
  sheet.querySelector('.task-bar-button')?.focus({ preventScroll: true });
  return close;
}
