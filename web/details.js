// What was chosen by a tap (CONCEPT.md §5). A task opens on the main screen, over the list (#task-screen, design
// 2026-11-20 stage 2): its card with the participants line and the conversation under it; the system back closes it.
// The right panel is the day plan (dayplan.js: tasks by days — a day, 4 or 7) by default — the 📅 button, a swipe from
// the right, the column of a wide screen; a message, a person or a counterparty opens there too; a left-to-right
// swipe closes it.
// While a task is open, the composer writes into it — to the participant chosen in the card when they have a chat.
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
import { dayPlan } from './dayplan.js';

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
  let current = null; // the right panel: { kind: 'planner' | 'message' | 'person' | 'counterparty', id }
  const screen = document.querySelector('#task-screen');
  const screenBody = document.querySelector('#task-screen-body');
  let taskId = null; // the task open on the main screen
  let replyKey = null; // the chat the card put into the composer as the recipient

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
  const render = holdRender(document.querySelector('#details'), () => { draw(); drawTask(); });
  const redrawTask = () => drawTask();

  // The task card on the main screen.
  function drawTask() {
    if (!taskId || screen.hidden) return;
    const task = feed.task(taskId);
    if (!task) { closeTask(); return; }
    const scroll = screenBody.scrollTop;
    const typing = Boolean(document.activeElement?.closest?.('.checklist-add'));
    // «В дело…» offers the tasks of the same conversations first, then the latest changed.
    const mine = new Set(feed.conversations().filter((item) => item.tasks.some((other) => other.id === task.id)).flatMap((item) => item.tasks.map((other) => other.id)));
    const others = [...feed.tasks()].sort((a, b) => Number(mine.has(b.id)) - Number(mine.has(a.id)) || b.updatedAt.localeCompare(a.updatedAt));
    screenBody.replaceChildren(taskDetails(task, { views: feed.taskViews(task.id), bubble: (view) => feed.bubble(view), save: (change) => save(task.id, change), saveTo: save, others, notify, projects: feed.projects(),
      doneCards, fields: config.tasks?.report_fields ?? {}, directory: directory(),
      bar: quick ? barContext(task, { feed, quick, openConversation }) : null,
      conversations: feed.conversations(), redraw: redrawTask, onConversation: steer }));
    screenBody.scrollTop = scroll;
    if (typing) screenBody.querySelector('.checklist-add input')?.focus({ preventScroll: true });
    requestAnimationFrame(place); // the input row changes height (its participants line hides under the card)
  }

  // The answer goes to the participant chosen in the card when they have a chat; else it is a note in the task.
  function steer(conversation) {
    const reply = conversation?.reply ?? null;
    const key = reply ? `${reply.account}:${reply.chat_id}` : null;
    if (key === replyKey) return;
    replyKey = key;
    composer.chat(reply);
  }

  function showTask(id) {
    const same = taskId === id;
    taskId = id;
    place();
    screen.hidden = false;
    // On a phone the right panel gives way to the card, and its history entry becomes the card's (a back of its own
    // would race the card's entry and close the card).
    if (!isWide() && history.state?.details) { hide(); history.replaceState({ task: true }, ''); }
    else if (!history.state?.task) history.pushState({ task: true }, '');
    if (!isWide() && current) hide();
    composer.enterTopic({ last: () => feed.taskViews(id).at(-1) }, 'Сообщение в задачу');
    onRender();
    drawTask();
    if (!same) screenBody.scrollTop = 0;
  }

  function hideTask() {
    if (!taskId) return;
    taskId = null;
    screen.hidden = true;
    screenBody.replaceChildren();
    composer.leaveTopic();
    if (replyKey) { replyKey = null; composer.chat(null); }
    onRender();
    feed.render(); // a completion card shown in the card goes back to the feed
  }

  // `quiet` — another view takes the screen: the card's history entry is given to it instead of popped.
  function closeTask({ quiet = false } = {}) {
    const had = Boolean(taskId);
    hideTask();
    if (!had || !history.state?.task) return;
    if (quiet) history.replaceState(null, ''); else history.back();
  }

  function draw() {
    onRender(); // the view switch counts the open task's conversations
    // The day plan: what is open there when nothing else is; on a wide screen the column shows it by default.
    if (!current || current.kind === 'planner') {
      if (!current && !isWide()) return;
      if (panel.hidden) return;
      heading.textContent = 'План';
      const scroll = body.scrollTop;
      body.replaceChildren(dayPlan({ tasks: feed.tasks(), onOpenTask: (id) => openTask(id), redraw: draw }));
      body.scrollTop = scroll;
      return;
    }
    if (panel.hidden) return;
    const scroll = body.scrollTop;
    const typing = Boolean(document.activeElement?.closest?.('.checklist-add')); // adding items one after another
    if (current.kind === 'person' || current.kind === 'counterparty') {
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
    if (!taskId) composer.leaveTopic();
    draw();
    if (!same) body.scrollTop = 0;
  }

  // The screen swipe from the right (swipezones.js): what was open here last.
  let last = null;
  const openPlanner = () => show({ kind: 'planner', id: 'plan' });
  const reopen = () => { if (current) return true; openPlanner(); return true; };
  const openTask = (id) => showTask(id);
  const openMessage = (id) => show({ kind: 'message', id });
  const openPerson = (id) => show({ kind: 'person', id });
  const openCounterparty = (id) => show({ kind: 'counterparty', id });
  // The chain title above a message: its first open task, else its latest task, else the message itself.
  function openFor(view) {
    const task = taskOfMessage(view, tasksById());
    if (task) openTask(task.id); else openMessage(view.id);
  }

  function hide() {
    if (isWide()) { current = null; if (!taskId) composer.leaveTopic(); feed.render(); draw(); return; }
    if (panel.hidden) return;
    current = null;
    panel.classList.remove('open');
    backdrop.hidden = true;
    if (!taskId) composer.leaveTopic();
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
  window.addEventListener('popstate', () => {
    if (!isWide() && !history.state?.details) hide();
    if (taskId && !history.state?.task && !history.state?.details) hideTask();
  });
  document.querySelector('#task-screen-back').onclick = () => closeTask();
  // Crossing the breakpoint: a column of its own, or a panel that slides over the feed.
  const dock = (wide) => {
    panel.classList.remove('open'); backdrop.hidden = true;
    if (wide) { panel.hidden = false; render(); return; }
    if (current) { current = null; if (!taskId) composer.leaveTopic(); }
    panel.hidden = true;
  };
  onWideChange(dock);
  if (isWide()) dock(true);
  window.addEventListener('resize', () => { if (!panel.hidden || !screen.hidden) place(); });

  document.querySelector('#planner-button').onclick = () => (current?.kind === 'planner' && !isWide() ? close() : openPlanner());

  return { render, openTask, openMessage, openPerson, openCounterparty, openPlanner, openFor, createFrom, close, closeTask, reopen,
    current: () => (taskId ? { kind: 'task', id: taskId } : current), taskOpen: () => Boolean(taskId), screen,
    panel, isOpen: () => !isWide() && panel.classList.contains('open') };
}
