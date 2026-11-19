// Right panel «Подробности» (CONCEPT.md §5): what was chosen by a tap — a task or a message. Opens only by
// a tap (task plaque in a conversation, task row, task mark, history icon, chain title); a left-to-right swipe closes it.
// While a task is open, the composer writes into it.
import { makeTaskChange, makeCorrection, makePersonChange, makeCounterpartyChange, ownTask } from './shared.js';
import { inChat } from './actions.js';
import { personCard } from './personcard.js';
import { barContext } from './tasksheet.js';
import { counterpartyCard } from './counterpartycard.js';
import { reportKeys } from './donecard.js';
import { snippet, chatOf, sourceKey } from './projection.js';
import { STATUSES, taskOfMessage } from './taskfold.js';
import { accountTitle } from './tgbubble.js';
import { versionCard } from './versioncard.js';
import { taskDetails } from './taskdetails.js';
import { isWide, onWideChange } from './layout.js';
import { holdRender } from './holdrender.js';

const clock = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const SOURCES = { me: 'мои заметки', phone: 'телефон', system: 'система' };

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function setupDetails({ feed, composer, notify, doneCards, config, quick, onRender = () => {}, openConversation = () => {} }) {
  const panel = document.querySelector('#details');
  const backdrop = document.querySelector('#details-backdrop');
  const body = document.querySelector('#details-body');
  const heading = document.querySelector('#details-heading');
  let current = null; // { kind: 'task' | 'message', id }

  const save = (taskId, change) => composer.queue(makeTaskChange(taskId, change)).catch((error) => notify(error.message));
  const tasksById = () => new Map(feed.tasks().map((task) => [task.id, task]));
  // The directory for «Кто контрагент?» and the cards (contacts design §6).
  const queue = (entry) => composer.queue(entry).catch((error) => { notify(error.message); throw error; });
  const directory = () => ({ counterparties: feed.counterparties(), people: feed.people(),
    saveCounterparty: (id, change) => queue(makeCounterpartyChange(id, change)), savePerson: (id, change) => queue(makePersonChange(id, change)).catch(() => {}),
    onOpen: (id) => openCounterparty(id) });

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
    box.append(element('p', 'picker-section', 'Задачи'));
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

  // While a name is typed or a list of choices is open in the panel, a live update waits (holdrender.js).
  const render = holdRender(document.querySelector('#details'), draw);
  function draw() {
    onRender(); // the view switch counts the open task's conversations
    if (!current) {
      // On a wide screen the column stays: a hint until something is chosen.
      if (isWide()) { heading.textContent = 'Подробности'; body.replaceChildren(element('p', 'details-empty', 'Выберите задачу или сообщение: здесь появятся его свойства, переписка и история. Касание плашки задачи в беседе, строки задачи или значка под сообщением.')); }
      return;
    }
    if (panel.hidden) return;
    const scroll = body.scrollTop;
    const typing = Boolean(document.activeElement?.closest?.('.checklist-add')); // adding items one after another
    if (current.kind === 'task') {
      const task = feed.task(current.id);
      if (!task) { close(); return; }
      heading.textContent = 'Задача';
      // «В дело…» offers the tasks of the same conversations first, then the latest changed.
      const mine = new Set(feed.conversations().filter((item) => item.tasks.some((other) => other.id === task.id)).flatMap((item) => item.tasks.map((other) => other.id)));
      const others = [...feed.tasks()].sort((a, b) => Number(mine.has(b.id)) - Number(mine.has(a.id)) || b.updatedAt.localeCompare(a.updatedAt));
      body.replaceChildren(taskDetails(task, { views: feed.taskViews(task.id), bubble: (view) => feed.bubble(view), save: (change) => save(task.id, change), saveTo: save, others, notify, projects: feed.projects(),
        doneCards, fields: config.tasks?.report_fields ?? {}, directory: directory(),
        bar: quick ? barContext(task, { feed, quick, openConversation }) : null }));
    } else if (current.kind === 'person' || current.kind === 'counterparty') {
      // The directory's cards (contacts design §6).
      const dir = directory();
      const cardCtx = { ...dir, tasks: feed.tasks(), onOpenPerson: openPerson, onOpenCounterparty: openCounterparty, onOpenTask: openTask };
      const item = (current.kind === 'person' ? dir.people : dir.counterparties).find((entry) => entry.id === current.id);
      // Just created: the feed folds it on its next render, which redraws this panel.
      if (!item) { heading.textContent = 'Сохраняется…'; body.replaceChildren(); return; }
      heading.textContent = current.kind === 'person' ? item.name : item.title;
      body.replaceChildren(current.kind === 'person' ? personCard(item, cardCtx) : counterpartyCard(item, cardCtx));
    } else {
      const view = feed.view(current.id);
      if (!view) { close(); return; }
      heading.textContent = 'Сообщение';
      body.replaceChildren(messageDetails(view));
    }
    body.scrollTop = scroll;
    if (typing) body.querySelector('.checklist-add input')?.focus({ preventScroll: true });
  }

  function show(next) {
    const same = current?.kind === next.kind && current?.id === next.id;
    current = next;
    last = next;
    panel.hidden = false;
    if (!isWide()) {
      place();
      backdrop.hidden = false;
      void panel.offsetWidth; // the closed position first, so the opening slides in
      panel.classList.add('open');
      if (!history.state?.details) history.pushState({ details: true }, '');
    }
    if (next.kind === 'task') composer.enterTopic({ last: () => feed.taskViews(next.id).at(-1) }, 'Сообщение в задачу');
    else composer.leaveTopic();
    render();
    if (!same) body.scrollTop = 0;
  }

  // The screen swipe from the right (swipezones.js): what was open here last.
  let last = null;
  const reopen = () => { if (!last || current) return Boolean(current); show(last); return true; };
  const openTask = (id) => show({ kind: 'task', id });
  const openMessage = (id) => show({ kind: 'message', id });
  const openPerson = (id) => show({ kind: 'person', id });
  const openCounterparty = (id) => show({ kind: 'counterparty', id });
  // The chain title above a message: its first open task, else its latest task, else the message itself.
  function openFor(view) {
    const task = taskOfMessage(view, tasksById());
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
  // A message of a chat goes into a conversation of its own, named by this task (an own note does so by itself).
  async function createFrom(view) {
    const id = crypto.randomUUID();
    await save(id, ownTask(snippet(view).slice(0, 120), view.id));
    if (inChat(view) && !view.split) await composer.queue(makeCorrection(view.id, 'split')).catch((error) => notify(error.message));
    openTask(id);
  }

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

  return { render, openTask, openMessage, openPerson, openCounterparty, openFor, createFrom, close, reopen, current: () => current,
    panel, isOpen: () => !isWide() && panel.classList.contains('open') };
}
