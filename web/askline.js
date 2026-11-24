// The AI's question in the head of a conversation (triage-ai-v21 `ask`, docs/plans/2026-11-23-conversation-records-
// design.md «Очередь — всё распределено»): «❓ текст», its options as buttons and «Своими словами…». It stands where
// the AI's offer «ИИ: «…»» stands (cardhead.js); the queue tile shows it short (convlist.js). An answer writes the
// owner's `answer_question` correction (the AI log settles the question by it) and the chosen change: a link to the
// record — my `task_change` adding the messages, so it is my action in the queue —, a new record of mine, or nothing.
// An option of a #поручить question names the executor (and the AI's draft): the record goes to that person, on me
// for «Сделаю сам». An answer in words goes to the AI with the session again (src/tasks/directive.ts ownerAnswerOf).
// askChoices, answerEvents, conversationQuestions and shortAsk are pure; askLine builds the DOM.
import { makeCorrection, makeTaskChange, nameUuid } from './shared.js';

const ASK_SHORT = 56; // characters of the question on a queue tile

// The options as choices: { index (of the option, for the correction), label, kind: 'link' | 'create' | 'nothing',
// taskId?, title?, template?, executor?, draft? }. An option naming a record this device does not know is left out.
export function askChoices(question, tasksById) {
  const choices = [];
  (question?.options ?? []).forEach((option, index) => {
    const label = String(option.label ?? '').trim();
    if (!label) return;
    const assign = { ...(option.executor ? { executor: option.executor } : {}), ...(option.draft ? { draft: option.draft } : {}) };
    if (option.task_id) { if (tasksById.has(option.task_id)) choices.push({ index, label, kind: 'link', taskId: option.task_id, ...assign }); return; }
    if (option.nothing) { choices.push({ index, label, kind: 'nothing' }); return; }
    if (option.title) choices.push({ index, label, kind: 'create', title: option.title, ...(option.template ? { template: option.template } : {}), ...assign });
  });
  return choices;
}

// The id of the record an answer by option `index` makes: one per question and option, on every device.
export const answerTaskId = (question, index) => nameUuid(`answer-task|${question.id}|${index}`);

// The entries an answer writes, the change first, the answer last. `choice` — one of askChoices, or { text } — words.
// Event ids come from the question (one change and one answer per question), so a double tap or a retry is the same
// event and the journal keeps one; a different second answer is refused. The answer names the latest message of the
// question: the queue treats it as handled with everything before it (projection.js `decided`).
export function answerEvents(question, choice, { now = new Date() } = {}) {
  const ids = question.messageIds ?? [];
  const anchor = ids.at(-1);
  const stamp = { id: nameUuid(`answer-change|${question.id}`), ts: now.toISOString() };
  const entries = [];
  // Who does it: the option's executor (under my control when it is someone else), else me.
  const executor = choice.executor ?? 'me';
  const roles = { responsible: 'me', executors: [executor], ...(executor !== 'me' ? { controller: 'me' } : {}) };
  const draft = choice.draft ? { draft: choice.draft } : {};
  if (choice.kind === 'link') entries.push(makeTaskChange(choice.taskId, { op: 'update', add: ids, ...(choice.executor ? { roles, ...draft } : {}) }, stamp));
  if (choice.kind === 'create') {
    entries.push(makeTaskChange(answerTaskId(question, choice.index), { op: 'create', title: choice.title.slice(0, 200), roles: { author: 'me', ...roles },
      status: 'todo', add: ids, ...(choice.template ? { template: choice.template } : {}), ...draft }, stamp));
  }
  const words = choice.text?.trim();
  entries.push(makeCorrection(anchor, 'answer_question', { question: question.id, ...(words ? { answer: words.slice(0, 500) } : { option: choice.index }),
    id: nameUuid(`answer|${question.id}`), ts: stamp.ts }));
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

const sent = new Set(); // questions answered on this page: their line stays locked until the redraw drops it

// Locks or unlocks a line: every button and field of it.
function lock(box, locked) {
  box.classList.toggle('answered', locked);
  for (const control of box.querySelectorAll('button, input')) control.disabled = locked;
}

// One question: «❓ текст», a button per choice, «Своими словами…» (a field; Enter sends). `answer(question, choice)`
// writes it (chatview.js) and resolves to false when it failed — then the line unlocks for another try. The first
// answer locks the line: a second tap does nothing.
export function askLine({ question, tasksById, answer }) {
  const box = element('div', 'ask-line');
  box.dataset.question = question.id;
  box.append(element('span', 'ask-text', `❓ ${question.text}`));
  const send = (choice) => {
    if (sent.has(question.id)) return;
    sent.add(question.id);
    lock(box, true);
    Promise.resolve(answer(question, choice)).then((ok) => { if (ok === false) { sent.delete(question.id); lock(box, false); } });
  };
  const buttons = element('div', 'ask-options');
  for (const choice of askChoices(question, tasksById)) {
    const chip = element('button', `chip suggest ask-option${choice.kind === 'nothing' ? ' muted' : ''}`, choice.label);
    chip.type = 'button';
    chip.onclick = () => send(choice);
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
      const text = input.value;
      input.value = '';
      input.blur(); // the head redraws only when no field holds the focus (chatview.js)
      send({ text });
    };
    own.replaceWith(input);
    input.focus();
  };
  buttons.append(own);
  box.append(buttons);
  if (sent.has(question.id)) lock(box, true);
  return box;
}
