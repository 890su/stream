// The «Задачи» view in the centre (CONCEPT.md §5, 2026-11-19): the chips of the main lists on top, sections of a
// list («Просрочено · Сегодня · …», data in registry/filters.json), one row per task with its own actions — the
// «Готово» mark, swipes (taskquick.js) and the due date on the right. A tap on the row opens the task's details.
import { STATUSES, dueState } from './taskfold.js';
import { withWhom } from './conversations.js';
import { partyName } from './parties.js';
import { matchesFilter } from './filters.js';

const day = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'short' });
const weekday = new Intl.DateTimeFormat('ru', { weekday: 'short' });
const DAY = 86_400_000;
const dayStart = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// The due date as a word: { text, state } — «просрочено», «сегодня», «завтра», a weekday within a week, else a date.
// null without a due date. Pure (tested in node).
export function dueLabel(task, now = new Date()) {
  if (!task.due) return null;
  const state = dueState(task, now);
  if (state === 'overdue') return { text: 'просрочено', state };
  const date = new Date(`${String(task.due).slice(0, 10)}T00:00:00`);
  const days = Math.round((dayStart(date) - dayStart(now)) / DAY);
  if (days === 0) return { text: 'сегодня', state: 'today' };
  if (days === 1) return { text: 'завтра', state: 'later' };
  if (days > 1 && days < 7) return { text: weekday.format(date), state: 'later' };
  return { text: day.format(date), state: 'later' };
}

// The facts of a row under its title, in order: status (not for plain «сделать»), «готово?», who does it (every
// list but the first, `showAssignee`), with whom, «проверьте». Pure (tested in node).
export function rowParts(task, views, { showAssignee = false } = {}) {
  const parts = [];
  if (task.status !== 'todo') parts.push(STATUSES[task.status] ?? task.status);
  if (task.proposed === 'done') parts.push('готово?');
  const who = task.roles?.executors?.[0] ?? task.roles?.responsible;
  if (showAssignee && who) parts.push(partyName(who, views));
  const whom = withWhom(views).slice(0, 2).join(', ');
  if (whom) parts.push(whom);
  if (task.confidence !== undefined && task.confidence < 0.6) parts.push('проверьте');
  return parts;
}

// Tasks split by the filter's sections — each task into the first section it matches; a list without sections is
// one untitled section. Empty sections are dropped. Pure (tested in node).
export function sectionsOf(tasks, filter, now = new Date()) {
  if (!filter.sections?.length) return [{ id: 'all', title: null, tasks }];
  const sections = filter.sections.map((section, index) => ({ id: section.id ?? String(index), title: section.title, folded: !!section.folded, tasks: [] }));
  for (const task of tasks) {
    const index = filter.sections.findIndex((section) => matchesFilter(task, section, { now }));
    if (index >= 0) sections[index].tasks.push(task);
  }
  return sections.filter((section) => section.tasks.length);
}

// The number on a list's chip: its tasks outside folded sections («Дальше» does not count as «to do now»).
export function listCount(tasks, filter, now = new Date()) {
  return sectionsOf(tasks, filter, now).filter((section) => !section.folded).reduce((sum, section) => sum + section.tasks.length, 0);
}

// One task row: «Готово» mark · title and facts · due date. `quick` (taskquick.js) adds the mark and the swipes.
export function taskRow(task, views, { onOpen, showAssignee, quick }) {
  const item = element('div', `task-item ${task.status}${task.proposed === 'done' ? ' proposed' : ''}`);
  item.dataset.task = task.id;
  const main = element('button', 'task-main');
  main.type = 'button';
  main.append(element('span', 'task-title', task.title));
  const parts = rowParts(task, views, { showAssignee });
  if (parts.length) main.append(element('span', 'task-meta', parts.join(' · ')));
  main.onclick = () => onOpen(task.id);
  const due = dueLabel(task);
  item.append(main);
  if (due) item.append(element('span', `task-due ${due.state}`, due.text));
  quick?.decorate(item, task);
  return item;
}

// A section header: title and count; a folded section is a button that unfolds it.
export function sectionHeader(section, { open, onToggle }) {
  const head = element(section.folded ? 'button' : 'div', 'task-section');
  if (section.folded) {
    head.type = 'button';
    head.setAttribute('aria-expanded', String(open));
    head.onclick = onToggle;
  }
  head.append(element('span', 'task-section-title', section.title), element('span', 'task-section-count', String(section.tasks.length)));
  return head;
}

// The chips of the main lists (`pinned`) with counts, the current list always among them, and «Ещё…».
// `counts` — Map filter id -> number.
export function listChips(filters, current, counts, { onPick, onMore }) {
  const bar = element('div', 'task-lists');
  bar.setAttribute('role', 'tablist');
  bar.setAttribute('aria-label', 'Списки задач');
  const shown = filters.filter((filter) => filter.pinned || filter.id === current.id);
  for (const filter of shown) {
    const on = filter.id === current.id;
    const chip = element('button', `chip task-list${on ? ' on' : ''}`);
    chip.type = 'button';
    chip.setAttribute('role', 'tab');
    chip.setAttribute('aria-selected', String(on));
    chip.append(element('span', '', filter.title));
    const count = counts.get(filter.id) ?? 0;
    if (count) chip.append(element('span', 'task-list-count', String(count)));
    chip.onclick = () => onPick(filter.id);
    bar.append(chip);
  }
  const more = element('button', 'chip task-list more', 'Ещё…');
  more.type = 'button';
  more.setAttribute('aria-label', 'Все списки задач');
  more.onclick = onMore;
  bar.append(more);
  return bar;
}

export function emptyTasks(filter) {
  const texts = { today: 'На сегодня всё. Новое появится здесь само.', new: 'Разбирать нечего.', waiting: 'Ни от кого ничего не ждёте.', control: 'Поручений на контроле нет.' };
  return element('div', 'empty', texts[filter.id] ?? `Задач в списке «${filter.title}» нет.`);
}
