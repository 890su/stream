// The AI's question in the head of a conversation (triage-ai-v21 `ask`, docs/plans/2026-11-23-conversation-records-
// design.md «Очередь — всё распределено»): «❓ текст», its options as buttons and «Своими словами…». It stands where
// the AI's offer «ИИ: «…»» stands (cardhead.js); the queue tile shows it short (convlist.js). An answer writes the
// owner's `answer_question` correction (the AI log settles the question by it) and the chosen change: a link to the
// record — my `task_change` adding the messages, so it is my action in the queue —, a new record of mine, or nothing.
// askChoices, answerEvents, conversationQuestions and shortAsk are pure; askLine builds the DOM.
import { makeCorrection, makeTaskChange } from './shared.js';

const ASK_SHORT = 56; // characters of the question on a queue tile

// The options as choices: { index (of the option, for the correction), label, kind: 'link' | 'create' | 'nothing',
// taskId?, title?, template? }. An option naming a record this device does not know is left out.
export function askChoices(question, tasksById) {
  const choices = [];
  (question?.options ?? []).forEach((option, index) => {
    const label = String(option.label ?? '').trim();
    if (!label) return;
    if (option.task_id) { if (tasksById.has(option.task_id)) choices.push({ index, label, kind: 'link', taskId: option.task_id }); return; }
    if (option.nothing) { choices.push({ index, label, kind: 'nothing' }); return; }
    if (option.title) choices.push({ index, label, kind: 'create', title: option.title, ...(option.template ? { template: option.template } : {}) });
  });
  return choices;
}

// The entries an answer writes, the change first, the answer last. `choice` — one of askChoices, or { text } — words.
// `taskId` — the id of a new record (tests pass one). The answer names the latest message of the question: the
// queue treats it as handled with everything before it (projection.js `decided`).
export function answerEvents(question, choice, { taskId = crypto.randomUUID() } = {}) {
  const ids = question.messageIds ?? [];
  const anchor = ids.at(-1);
  const entries = [];
  if (choice.kind === 'link') entries.push(makeTaskChange(choice.taskId, { op: 'update', add: ids }));
  if (choice.kind === 'create') {
    entries.push(makeTaskChange(taskId, { op: 'create', title: choice.title.slice(0, 200), roles: { author: 'me', responsible: 'me', executors: ['me'] },
      status: 'todo', add: ids, ...(choice.template ? { template: choice.template } : {}) }));
  }
  const words = choice.text?.trim();
  entries.push(makeCorrection(anchor, 'answer_question', { question: question.id, ...(words ? { answer: words.slice(0, 500) } : { option: choice.index }) }));
  return entries;
}

// The waiting questions about a conversation's messages (questions.js aiQuestionsByMessage), each once, the newest
// first.
export function conversationQuestions(conversation, questions) {
  const found = new Map();
  for (const view of conversation?.views ?? []) {
    if (view.deleted) continue;
    const question = questions.get(view.id);
    if (question && !found.has(question.id)) found.set(question.id, question);
  }
  return [...found.values()].sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
}

// The question on a queue tile: «❓ …», cut short.
export function shortAsk(text) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  return `❓ ${clean.length > ASK_SHORT ? `${clean.slice(0, ASK_SHORT - 1).trimEnd()}…` : clean}`;
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// One question: «❓ текст», a button per choice, «Своими словами…» (a field; Enter sends). `answer(question, choice)`
// writes it (chatview.js).
export function askLine({ question, tasksById, answer }) {
  const box = element('div', 'ask-line');
  box.dataset.question = question.id;
  box.append(element('span', 'ask-text', `❓ ${question.text}`));
  const buttons = element('div', 'ask-options');
  for (const choice of askChoices(question, tasksById)) {
    const chip = element('button', `chip suggest ask-option${choice.kind === 'nothing' ? ' muted' : ''}`, choice.label);
    chip.type = 'button';
    chip.onclick = () => answer(question, choice);
    buttons.append(chip);
  }
  const own = element('button', 'chip suggest muted ask-own', 'Своими словами…');
  own.type = 'button';
  own.onclick = () => {
    const input = element('input', 'card-topic-input ask-input');
    input.placeholder = 'Ответ для ИИ…';
    input.setAttribute('aria-label', `Ответ на вопрос ИИ: ${question.text}`);
    input.enterKeyHint = 'send';
    input.maxLength = 500;
    input.onkeydown = (event) => {
      if (event.key === 'Escape') { input.replaceWith(own); return; }
      if (event.key !== 'Enter' || !input.value.trim()) return;
      event.preventDefault();
      answer(question, { text: input.value });
    };
    own.replaceWith(input);
    input.focus();
  };
  buttons.append(own);
  box.append(buttons);
  return box;
}
