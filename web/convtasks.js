// Plaques of a conversation's tasks on top of the conversation (CONCEPT.md §2.5): status, executor, due date.
// A tap opens the task's details on the right. partyName and plaqueFacts are pure (tested in node).
import { isOpen, STATUSES, dueState } from './taskfold.js';
import { PARTY_LABELS } from './parties.js';
import { chatOf } from './projection.js';

const day = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'short' });

// A party in words: Я / ИИ / Система, a name, else a name found in the conversation's messages, else as it is.
export function partyName(party, conversation) {
  if (!party) return '';
  if (PARTY_LABELS[party]) return PARTY_LABELS[party];
  if (party.startsWith('name:')) return party.slice(5);
  if (party === conversation?.key) return conversation.title;
  const views = conversation?.views ?? [];
  if (party.startsWith('tg:')) {
    const id = party.slice(3);
    const sender = views.find((view) => String(view.event.payload?.data?.telegram?.from_id ?? '') === id);
    if (sender) return sender.event.payload.data.telegram.from_name;
  }
  if (party.startsWith('group:tg:')) {
    const chat = views.map((view) => chatOf(view.event)).find((item) => item && String(item.chat_id) === party.slice(9));
    if (chat) return chat.title;
  }
  return party;
}

// The open, not filed tasks of a conversation, newest change first: { id, title, facts, proposed }.
export function plaqueFacts(conversation, now = new Date()) {
  return conversation.tasks.filter((task) => isOpen(task) && !task.filed)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((task) => {
      const facts = [task.proposed === 'done' ? 'готово?' : STATUSES[task.status] ?? task.status];
      const executor = task.roles?.executors?.[0];
      if (executor) facts.push(partyName(executor, conversation));
      if (task.due) facts.push(`${dueState(task, now) === 'overdue' ? 'просрочено, ' : ''}до ${day.format(new Date(task.due))}`);
      return { id: task.id, title: task.title, facts: facts.join(' · '), status: task.status, overdue: dueState(task, now) === 'overdue' };
    });
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// `onOpen(taskId)` — show the task's details. null when the conversation has no open tasks.
export function convTasks(conversation, { onOpen }) {
  const plaques = plaqueFacts(conversation);
  if (!plaques.length) return null;
  const box = element('div', 'conv-plaques');
  for (const plaque of plaques) {
    const button = element('button', `conv-plaque ${plaque.status}${plaque.overdue ? ' overdue' : ''}`);
    button.type = 'button';
    button.dataset.task = plaque.id;
    button.append(element('span', 'conv-plaque-title', plaque.title), element('span', 'conv-plaque-meta', plaque.facts));
    button.onclick = () => onOpen(plaque.id);
    box.append(button);
  }
  return box;
}
