// Right panel «Подробности» (CONCEPT.md §5): what was chosen by a tap — a case (task) or a message. Opens only by
// a tap (case header button, task row, task mark, history icon, chain title); a left-to-right swipe closes it.
// While a case is open, the composer writes into it.
import { makeTaskChange } from './shared.js';
import { snippet, chatOf, sourceKey } from './projection.js';
import { caseOf } from './cases.js';
import { STATUSES } from './taskfold.js';
import { accountTitle } from './tgbubble.js';
import { versionCard } from './versioncard.js';
import { taskDetails } from './taskdetails.js';
import { isWide, onWideChange } from './layout.js';

const SWIPE_PX = 70;
const clock = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const SOURCES = { me: 'мои заметки', phone: 'телефон', system: 'система' };

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function setupDetails({ feed, composer, notify, doneCards, config }) {
  const panel = document.querySelector('#details');
  const backdrop = document.querySelector('#details-backdrop');
  const body = document.querySelector('#details-body');
  const heading = document.querySelector('#details-heading');
  let current = null; // { kind: 'task' | 'message', id }

  const save = (taskId, change) => composer.queue(makeTaskChange(taskId, change)).catch((error) => notify(error.message));
  const tasksById = () => new Map(feed.tasks().map((task) => [task.id, task]));

  function place() {
    const top = document.querySelector('.topbar').getBoundingClientRect().bottom;
    const bottom = window.innerHeight - document.querySelector('.composer-area').getBoundingClientRect().top;
    document.documentElement.style.setProperty('--drawer-top', `${Math.max(0, top)}px`);
    document.documentElement.style.setProperty('--drawer-bottom', `${Math.max(0, bottom)}px`);
  }

  function messageDetails(view) {
    const box = element('div', 'details-messagecard');
    const card = versionCard(view);
    box.append(card);
    const source = chatOf(view.event)?.title ? `${accountTitle(chatOf(view.event).account)} · ${chatOf(view.event).title}` : SOURCES[sourceKey(view.event)] ?? view.event.source;
    box.append(element('p', 'details-meta', `${clock.format(new Date(view.event.ts))} · ${source}${view.edited ? ' · изменено' : ''}`));
    if (view.tags.length) box.append(element('p', 'details-meta', view.tags.join(' ')));
    box.append(element('p', 'picker-section', 'Дела'));
    const tasks = view.taskIds.map((id) => tasksById().get(id)).filter(Boolean);
    for (const task of tasks) {
      const row = element('button', `task-row ${task.status}`);
      row.type = 'button';
      row.append(element('span', 'task-title', task.title), element('span', 'task-meta', STATUSES[task.status] ?? task.status));
      row.onclick = () => openTask(task.id);
      box.append(row);
    }
    if (!tasks.length) {
      const make = element('button', 'link-button', 'Сделать задачей');
      make.type = 'button';
      make.onclick = () => createFrom(view);
      box.append(make);
    }
    requestAnimationFrame(() => card.ready?.());
    return box;
  }

  function render() {
    if (!current) {
      // On a wide screen the column stays: a hint until something is chosen.
      if (isWide()) { heading.textContent = 'Подробности'; body.replaceChildren(element('p', 'details-empty', 'Выберите дело, задачу или сообщение: здесь появятся его свойства, переписка и история. Касание заголовка дела, строки задачи или значка под сообщением.')); }
      return;
    }
    if (panel.hidden) return;
    const scroll = body.scrollTop;
    if (current.kind === 'task') {
      const task = feed.task(current.id);
      if (!task) { close(); return; }
      heading.textContent = 'Дело';
      body.replaceChildren(taskDetails(task, { views: feed.caseViews(task.id), bubble: (view) => feed.bubble(view), save: (change) => save(task.id, change),
        doneCards, fields: config.tasks?.report_fields ?? {} }));
    } else {
      const view = feed.view(current.id);
      if (!view) { close(); return; }
      heading.textContent = 'Сообщение';
      body.replaceChildren(messageDetails(view));
    }
    body.scrollTop = scroll;
  }

  function show(next) {
    const same = current?.kind === next.kind && current?.id === next.id;
    current = next;
    panel.hidden = false;
    if (!isWide()) {
      place();
      backdrop.hidden = false;
      void panel.offsetWidth; // the closed position first, so the opening slides in
      panel.classList.add('open');
      if (!history.state?.details) history.pushState({ details: true }, '');
    }
    if (next.kind === 'task') composer.enterTopic({ last: () => feed.caseViews(next.id).at(-1) }, 'Сообщение в дело');
    else composer.leaveTopic();
    render();
    if (!same) body.scrollTop = 0;
  }

  const openTask = (id) => show({ kind: 'task', id });
  const openMessage = (id) => show({ kind: 'message', id });
  // The chain title above a message: its case if it has one, else the message itself.
  function openFor(view) {
    const task = caseOf(view, tasksById());
    if (task) openTask(task.id); else openMessage(view.id);
  }

  function hide() {
    if (isWide()) { current = null; composer.leaveTopic(); feed.render(); render(); return; }
    if (panel.hidden) return;
    current = null;
    panel.classList.remove('open');
    backdrop.hidden = true;
    composer.leaveTopic();
    feed.render(); // a completion card shown here goes back to the feed
    setTimeout(() => { if (!panel.classList.contains('open')) panel.hidden = true; }, 230);
  }

  function close() {
    hide();
    if (!isWide() && history.state?.details) history.back();
  }

  // «Сделать задачей»: a task of mine with this message; its details open to rename or reassign.
  async function createFrom(view) {
    const id = crypto.randomUUID();
    await save(id, { op: 'create', title: snippet(view).slice(0, 120), assignee: 'me', status: 'todo', add: [view.id] });
    openTask(id);
  }

  let start = null;
  panel.addEventListener('pointerdown', (event) => { start = event.pointerType === 'mouse' || isWide() ? null : { x: event.clientX, y: event.clientY }; });
  panel.addEventListener('pointerup', (event) => {
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    start = null;
    if (dx > SWIPE_PX && Math.abs(dx) > Math.abs(dy) * 1.5) close();
  });
  document.body.addEventListener('click', (event) => {
    const mark = event.target.closest('[data-task-open]');
    if (mark) { event.stopPropagation(); openTask(mark.dataset.taskOpen); }
  });
  document.querySelector('#details-close').onclick = close;
  backdrop.onclick = close;
  window.addEventListener('popstate', () => { if (!isWide() && !history.state?.details) hide(); });
  // Crossing the breakpoint: a column of its own, or a panel that slides over the feed.
  const dock = (wide) => {
    panel.classList.remove('open'); backdrop.hidden = true;
    if (wide) { panel.hidden = false; render(); return; }
    if (current) { current = null; composer.leaveTopic(); }
    panel.hidden = true;
  };
  onWideChange(dock);
  if (isWide()) dock(true);
  window.addEventListener('resize', () => { if (!panel.hidden) place(); });

  return { render, openTask, openMessage, openFor, createFrom, close, current: () => current };
}
