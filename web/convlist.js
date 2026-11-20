// The «Беседы» list (CONCEPT.md §5, §2.5): one row per conversation — title, the last message, channel badges,
// open tasks, the state; finished conversations fold into one row «Завершённые · N» at the end.
// archived ones fold into «Архив · N» after them. rowFacts and splitDone are pure (tested in node); convRow and
// foldRow build the DOM.
import { snippet } from './projection.js';
import { isOpen } from './taskfold.js';

export const STATE_LABELS = { urgent: 'срочно', mine: 'ждёт меня', theirs: 'жду ответа', quiet: '', done: '' };
const CHANNELS = { by: 'BY', pl: 'PL', phone: 'Тел', viber: 'Viber', whatsapp: 'WA', me: 'Я' };
const time = new Intl.DateTimeFormat('ru', { hour: '2-digit', minute: '2-digit' });
const date = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'short' });

const plural = (n, one, few, many) => (n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? few : many);
export const tasksLabel = (n) => `${n} ${plural(n, 'задача', 'задачи', 'задач')}`;

// What a row says: { title, snippet, mine (the last message is mine), when, tasks (open, not filed), label, channels }.
export function rowFacts(conversation, now = new Date()) {
  const last = conversation.views.filter((view) => !view.deleted).at(-1);
  const at = new Date(conversation.last);
  return {
    title: conversation.title,
    snippet: last ? snippet(last) : '',
    mine: last?.event.author === 'me' && conversation.key !== 'me' && !['call', 'sms'].includes(last.event.kind),
    when: at.toDateString() === now.toDateString() ? time.format(at) : date.format(at),
    tasks: conversation.tasks.filter((task) => isOpen(task) && !task.filed).length,
    label: STATE_LABELS[conversation.state] ?? '',
    channels: conversation.channels.map((channel) => CHANNELS[channel] ?? channel),
  };
}

// The list without finished and archived conversations, and those folded away.
export function splitDone(list) {
  const kept = list.filter((item) => !item.archived);
  return { active: kept.filter((item) => item.state !== 'done'), done: kept.filter((item) => item.state === 'done'), archived: list.filter((item) => item.archived) };
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function convRow(conversation, { onOpen, decorate }) {
  const facts = rowFacts(conversation);
  const row = element('button', `conv-row ${conversation.state}`);
  row.type = 'button';
  row.dataset.conversation = conversation.key;
  const head = element('span', 'conv-head');
  head.append(element('span', 'conv-title', facts.title));
  for (const channel of facts.channels) head.append(element('span', 'conv-channel', channel));
  head.append(element('span', 'conv-time', facts.when));
  const line = element('span', 'conv-line');
  line.append(element('span', 'conv-snippet', `${facts.mine ? 'Вы: ' : ''}${facts.snippet}`));
  if (facts.tasks) line.append(element('span', 'conv-tasks', tasksLabel(facts.tasks)));
  if (facts.label) line.append(element('span', `conv-state ${conversation.state}`, facts.label));
  row.append(head, line);
  row.setAttribute('aria-label', [facts.title, facts.label, facts.tasks ? tasksLabel(facts.tasks) : '', facts.snippet].filter(Boolean).join(', '));
  row.onclick = () => onOpen(conversation.key);
  decorate?.(row, conversation); // swipes: to the archive and the task (convquick.js)
  return row;
}

// «Завершённые · N» / «Архив · N»: a tap shows or hides the conversations under it.
const FOLDS = { done: 'Завершённые', archived: 'Архив' };
export function foldRow(key, count, { open, onToggle }) {
  const row = element('button', `conv-done ${key}${open ? ' open' : ''}`, `${open ? '▾' : '▸'} ${FOLDS[key]} · ${count}`);
  row.type = 'button';
  row.dataset.group = key;
  row.setAttribute('aria-expanded', String(open));
  row.onclick = onToggle;
  return row;
}
