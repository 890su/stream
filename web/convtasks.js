// Plaques of a conversation's tasks on top of the conversation (CONCEPT.md §2.5), one line each and stuck to the
// top while the conversation scrolls (feed.css): the «Готово» mark and swipes (taskquick.js), title, status, executor,
// due date. A tap opens the task's details on the right. plaqueFacts is pure (tested in node).
import { isOpen, STATUSES, dueState } from './taskfold.js';
import { partyName } from './parties.js';

const day = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'short' });

// The open, not filed tasks of a conversation, newest change first: { id, title, facts, proposed }.
export function plaqueFacts(conversation, now = new Date()) {
  return conversation.tasks.filter((task) => isOpen(task) && !task.filed)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((task) => {
      const facts = [task.proposed === 'done' ? 'готово?' : STATUSES[task.status] ?? task.status];
      const executor = task.roles?.executors?.[0];
      if (executor) facts.push(partyName(executor, conversation.views));
      if (task.due) facts.push(`${dueState(task, now) === 'overdue' ? 'просрочено, ' : ''}до ${day.format(new Date(task.due))}`);
      return { id: task.id, task, title: task.title, facts: facts.join(' · '), status: task.status, overdue: dueState(task, now) === 'overdue' };
    });
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// `onOpen(taskId)` — show the task's details; `quick` — the row actions (taskquick.js). null when the conversation
// has no open tasks.
export function convTasks(conversation, { onOpen, quick }) {
  const plaques = plaqueFacts(conversation);
  if (!plaques.length) return null;
  const box = element('div', 'conv-plaques');
  for (const plaque of plaques) {
    const item = element('div', `conv-plaque ${plaque.status}${plaque.overdue ? ' overdue' : ''}`);
    item.dataset.task = plaque.id;
    const main = element('button', 'conv-plaque-main');
    main.type = 'button';
    main.append(element('span', 'conv-plaque-title', plaque.title), element('span', 'conv-plaque-meta', plaque.facts));
    main.onclick = () => onOpen(plaque.id);
    item.append(main);
    quick?.decorate(item, plaque.task);
    box.append(item);
  }
  return box;
}
