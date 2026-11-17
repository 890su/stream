// Right panel «Задачи» (CONCEPT.md §2.8): my open tasks by default, others by filter; a task card with its
// messages, status and assignee. Opens with the ✓ button in the top bar or a right-to-left swipe on the feed.
import { visibleTasks, ASSIGNEES, STATUSES, isOpen } from './taskfold.js';
import { snippet } from './projection.js';
import { makeTaskChange } from './shared.js';

const FILTERS = [['me', 'Мои'], ['ai', 'ИИ'], ['system', 'Система'], ['person', 'Люди'], ['all', 'Все']];
const clock = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const SWIPE_PX = 70;

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

export function setupTaskPanel({ feed, composer, notify }) {
  const panel = document.querySelector('#tasks');
  const backdrop = document.querySelector('#tasks-backdrop');
  const filtersBox = document.querySelector('#tasks-filters');
  const list = document.querySelector('#tasks-list');
  let who = 'me';
  let done = false;
  let openId = null; // the task whose card is shown

  const save = (taskId, change) => composer.queue(makeTaskChange(taskId, change)).catch((error) => notify(error.message));

  function place() {
    const top = document.querySelector('.topbar').getBoundingClientRect().bottom;
    const bottom = window.innerHeight - document.querySelector('.composer-area').getBoundingClientRect().top;
    document.documentElement.style.setProperty('--drawer-top', `${Math.max(0, top)}px`);
    document.documentElement.style.setProperty('--drawer-bottom', `${Math.max(0, bottom)}px`);
  }

  function filters() {
    const chips = FILTERS.map(([key, label]) => {
      const count = visibleTasks(feed.tasks(), { who: key, done }).length;
      const chip = button(`chip ${who === key ? 'on' : 'suggest'}`, count ? `${label} ${count}` : label, () => { who = key; openId = null; render(); });
      chip.setAttribute('aria-pressed', String(who === key));
      return chip;
    });
    chips.push(button('chip suggest tasks-done', done ? 'Открытые' : 'Готовые', () => { done = !done; openId = null; render(); }));
    filtersBox.replaceChildren(...chips);
  }

  function row(task) {
    const item = button(`task-row ${task.status}`, undefined, () => { openId = task.id; render(); });
    const title = element('span', 'task-title', task.title);
    const meta = element('span', 'task-meta');
    const parts = [STATUSES[task.status] ?? task.status];
    if (who === 'all' || task.assignee !== 'me') parts.push(task.assignee === 'person' && task.person ? task.person : ASSIGNEES[task.assignee]);
    parts.push(`${task.messages.length} сообщ.`);
    if (task.confidence !== undefined && task.confidence < 0.6) parts.push('проверьте');
    meta.textContent = parts.join(' · ');
    item.append(title, meta);
    return item;
  }

  function card(task) {
    const box = element('div', 'task-card');
    box.append(button('link-button task-back', '‹ Все задачи', () => { openId = null; render(); }));
    box.append(element('h3', 'task-card-title', task.title));
    const origin = task.createdBy === 'me' ? 'создана вами' : `создана разбором${task.confidence !== undefined ? ` · уверенность ${Math.round(task.confidence * 100)}%` : ''}`;
    box.append(element('p', 'task-card-meta', `${STATUSES[task.status]} · ${origin} · ${clock.format(new Date(task.createdAt))}`));
    if (task.note) box.append(element('p', 'task-card-meta', task.note));
    const assignees = element('div', 'chips task-assignees');
    for (const [key, label] of Object.entries(ASSIGNEES)) {
      const chip = button(`chip ${task.assignee === key ? 'on' : 'suggest'}`, label, () => save(task.id, { op: 'update', assignee: key }));
      chip.setAttribute('aria-pressed', String(task.assignee === key));
      assignees.append(chip);
    }
    box.append(element('p', 'picker-section', 'Исполнитель'), assignees);
    const actions = element('div', 'task-actions');
    if (isOpen(task)) {
      actions.append(button('primary', 'Готово', () => save(task.id, { op: 'update', status: 'done' }).then(() => notify('Задача выполнена', { label: 'Вернуть', run: () => save(task.id, { op: 'update', status: 'todo' }) }))));
      if (task.status === 'inbox') actions.append(button('link-button', 'Принять', () => save(task.id, { op: 'update', status: 'todo' })));
      actions.append(button('link-button', 'Отменить', () => save(task.id, { op: 'update', status: 'cancelled' })));
    } else actions.append(button('link-button', 'Вернуть в работу', () => save(task.id, { op: 'update', status: 'todo' })));
    box.append(actions);
    box.append(element('p', 'picker-section', 'Сообщения'));
    for (const id of task.messages) {
      const view = feed.view(id);
      const item = button('task-message', undefined, () => { close(); feed.jump(id); }, 'Показать сообщение в ленте');
      item.append(element('span', 'task-message-text', view ? snippet(view) : 'сообщение ещё не загружено'),
        element('span', 'task-message-time', view ? clock.format(new Date(view.event.ts)) : ''));
      const unlink = button('icon-button task-unlink', '×', (event) => { event.stopPropagation(); save(task.id, { op: 'update', remove: [id] }); }, 'Убрать сообщение из задачи');
      const line = element('div', 'task-message-line');
      line.append(item, unlink);
      box.append(line);
    }
    return box;
  }

  function render() {
    if (panel.hidden) return;
    filters();
    const task = openId && feed.tasks().find((item) => item.id === openId);
    if (task) { list.replaceChildren(card(task)); return; }
    const tasks = visibleTasks(feed.tasks(), { who, done });
    list.replaceChildren(...(tasks.length ? tasks.map(row) : [element('p', 'drawer-empty', done ? 'Готовых задач нет' : who === 'me' ? 'Ваших открытых задач нет' : 'Задач нет')]));
  }

  function open(taskId = null) {
    openId = taskId;
    place();
    panel.hidden = false; backdrop.hidden = false;
    void panel.offsetWidth;
    panel.classList.add('open');
    if (!history.state?.tasks) history.pushState({ tasks: true }, '');
    render();
  }

  function close() {
    if (panel.hidden) return;
    panel.classList.remove('open');
    backdrop.hidden = true;
    setTimeout(() => { if (!panel.classList.contains('open')) panel.hidden = true; }, 230);
    if (history.state?.tasks) history.back();
  }

  // «В задачу» on a message: a task of mine with this message; the card opens to rename or reassign.
  async function createFrom(view) {
    const id = crypto.randomUUID();
    await save(id, { op: 'create', title: snippet(view).slice(0, 120), assignee: 'me', status: 'todo', add: [view.id] });
    open(id);
  }

  // Right-to-left swipe on the feed opens the panel (left-to-right opens the left drawer, drawer.js).
  let start = null;
  const feedArea = document.querySelector('#messages');
  feedArea.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' || document.body.classList.contains('selecting')) { start = null; return; }
    start = { x: event.clientX, y: event.clientY };
  });
  feedArea.addEventListener('pointerup', (event) => {
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    start = null;
    if (dx < -SWIPE_PX && Math.abs(dx) > Math.abs(dy) * 1.5) open();
  });
  panel.addEventListener('pointerdown', (event) => { start = { x: event.clientX, y: event.clientY, panel: true }; });
  panel.addEventListener('pointerup', (event) => {
    if (!start?.panel || event.pointerType === 'mouse') { start = null; return; }
    const dx = event.clientX - start.x;
    start = null;
    if (dx > SWIPE_PX) close();
  });
  document.body.addEventListener('click', (event) => {
    const mark = event.target.closest('[data-task-open]');
    if (mark) { event.stopPropagation(); open(mark.dataset.taskOpen); }
  });
  document.querySelector('#tasks-button').onclick = () => (panel.hidden ? open() : close());
  document.querySelector('#tasks-close').onclick = close;
  backdrop.onclick = close;
  window.addEventListener('popstate', () => { if (!panel.hidden && !history.state?.tasks) { panel.classList.remove('open'); backdrop.hidden = true; panel.hidden = true; } });

  return { render, open, close, createFrom };
}
