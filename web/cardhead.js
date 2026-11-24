// The topic line of a card (docs/plans/2026-11-21-workspace-redesign-design.md): every conversation is a topic, and
// its task is empty («+ задача…» to type one), unconfirmed («ИИ: «…»» with ✓ ✕ and why) or real (its title — a tap
// opens the task). Above them, in the same place, the AI's waiting questions (v21 `ask`, askline.js): «❓ …» with its
// options and «Своими словами…».
// topicOf (topic.js) decides the state; this file only draws it.
import { askLine } from './askline.js';

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(className, text, onClick, label) {
  const node = element('button', className, text);
  node.type = 'button';
  node.onclick = onClick;
  if (label) node.setAttribute('aria-label', label);
  return node;
}

// Why the AI made it: the reason of its first change (the AI log), else its note.
export const reasonOf = (task) => task.history?.find((entry) => entry.change?.reason)?.change.reason ?? task.note ?? '';

// `topic` — topicOf(conversation), or null (my own notes «Я»: only the questions); `on`: { openTask(id),
// create(title), confirm(task), reject(task), answer(question, choice) }; `questions` — conversationQuestions
// (askline.js), the newest first; `tasksById` — for the options that name a record.
export function topicLine({ topic, on, questions = [], tasksById = new Map() }) {
  const box = element('div', 'card-topic-line');
  for (const question of questions) box.append(askLine({ question, tasksById, answer: on.answer }));
  if (!topic) return box;
  const chips = element('div', 'card-topic-chips');
  if (topic.state === 'empty') {
    const input = element('input', 'card-topic-input');
    input.placeholder = '+ задача…';
    input.setAttribute('aria-label', 'Новая задача по этой беседе: название');
    input.enterKeyHint = 'done';
    input.onkeydown = (event) => {
      if (event.key !== 'Enter' || !input.value.trim()) return;
      event.preventDefault();
      on.create(input.value.trim().slice(0, 120));
      input.value = '';
      input.blur();
    };
    chips.append(input);
  }
  const reasons = [];
  for (const task of topic.tasks) {
    if (!task.unconfirmed) { chips.append(button('chip suggest card-topic-task', `▸ ${task.title}`, () => on.openTask(task.id), `Задача: ${task.title}`)); continue; }
    const offer = element('span', 'card-topic-offer');
    offer.append(button('card-topic-offer-title', `ИИ: «${task.title}»`, () => on.openTask(task.id), `Задача от ИИ: ${task.title}`),
      button('chip suggest card-topic-yes', '✓', () => on.confirm(task), `Подтвердить задачу «${task.title}»`),
      button('chip suggest muted card-topic-no', '✕', () => on.reject(task), `Отклонить задачу «${task.title}»`));
    chips.append(offer);
    const reason = reasonOf(task);
    if (reason && !reasons.length) reasons.push(reason);
  }
  box.append(chips);
  if (reasons.length) box.append(element('span', 'card-topic-reason', `Почему: ${reasons[0]}`));
  return box;
}
