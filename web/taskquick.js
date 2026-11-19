// Acting on a task where it is seen (CONCEPT.md §2.8, 2026-11-19): the round «Готово» mark, a swipe right (done)
// and left («Когда?» — due today, tomorrow, this week, a date) on task rows and conversation plaques, and every
// change with «Вернуть» in the toast — the undo is one more task_change with the replaced values.
import { closeChange, undoOf, dueChips } from './taskactions.js';
import { reportKeys } from './donecard.js';
import { makeTaskChange } from './shared.js';
import { reduced } from './motion.js';
import { swipe } from './swipe.js';
import { startWork, pauseWork } from './focus.js';


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

// `queue(event)` — the composer's queue; `notify(text, action)` — the toast; `config` — capture config (tasks).
// `onHold(task)` — a long press (or right click) on a row: the action sheet (tasksheet.js).
export function createTaskQuick({ queue, notify, config, onHold = null }) {
  const tasksConfig = config.tasks ?? {};

  // Saves a change and offers «Вернуть» for it. One change per task at a time: a second tap while the first is
  // being saved (a double tap, a swipe then a tap) does nothing.
  const busy = new Set();
  function act(task, change, message) {
    if (busy.has(task.id)) return;
    busy.add(task.id);
    const undo = undoOf(task, change);
    queue(makeTaskChange(task.id, { op: 'update', ...change }))
      .then(() => notify(message, { label: 'Вернуть', run: () => queue(makeTaskChange(task.id, { op: 'update', ...undo })).catch((error) => notify(error.message)) }))
      .catch((error) => notify(error.message))
      .finally(() => setTimeout(() => busy.delete(task.id), 300));
  }

  const open = (task) => !['done', 'cancelled'].includes(task.status);
  const done = (task) => act(task, closeChange(reportKeys(task, tasksConfig), task.report), `Готово: «${task.title}»`);
  const reopen = (task) => act(task, { status: 'todo' }, `Снова в работе: «${task.title}»`);
  const setDue = (task, due, label) => act(task, { due }, `Срок «${label}»: «${task.title}»`);

  // The «Когда?» row under an item: due date chips, a date field, close. It stays open across redraws (live
  // updates rebuild the rows) until a choice or ×.
  let whenFor = null; // the task whose «Когда?» row is open
  function whenRow(item, task, focus = true) {
    item.querySelector('.task-when')?.remove();
    whenFor = task.id;
    const row = element('div', 'task-when chips');
    row.setAttribute('aria-label', 'Когда сделать');
    const close = () => { whenFor = null; row.remove(); };
    for (const chip of dueChips()) row.append(button('chip suggest', chip.label, () => { close(); setDue(task, chip.due, chip.label); }));
    const date = Object.assign(document.createElement('input'), { type: 'date', className: 'details-due' });
    date.setAttribute('aria-label', 'Срок');
    date.onchange = () => { if (date.value) { close(); setDue(task, date.value, date.value.split('-').reverse().join('.')); } };
    row.append(date, button('icon-button task-when-close', '×', close, 'Закрыть'));
    item.append(row);
    if (focus) row.querySelector('button')?.focus({ preventScroll: true });
  }

  // Adds the «Готово» mark (first child) and the swipes to a task row or plaque.
  function decorate(item, task) {
    const isOpen = open(task);
    const mark = button(`task-check${isOpen ? '' : ' checked'}`, '', () => {
      if (item.classList.contains('closing')) return;
      if (isOpen) {
        item.classList.add('closing');
        setTimeout(() => done(task), reduced() ? 0 : 180);
      } else reopen(task);
    }, isOpen ? `Готово: ${task.title}` : `Вернуть в работу: ${task.title}`);
    mark.append(element('span', 'task-check-ring'));
    item.prepend(mark);
    if (isOpen) swipe(item, { right: 'done', left: 'when', labels: { right: { icon: '✓', text: 'Готово' }, left: { icon: '🕒', text: 'Когда?' } }, skip: (event) => Boolean(event.target.closest('.task-when')), onRight: () => { item.classList.add('closing'); done(task); }, onLeft: () => whenRow(item, task) });
    if (isOpen && whenFor === task.id) whenRow(item, task, false);
    if (onHold) holdOn(item, task);
  }

  // A long press (450 ms without moving) or a right click opens the action sheet; the click after it does not open
  // the card. Moving the finger (a scroll, a swipe) cancels it.
  function holdOn(item, task) {
    let timer = null;
    let at = null;
    let held = false;
    const cancel = () => { clearTimeout(timer); timer = null; };
    item.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse' || event.target.closest('.task-check, .task-when')) return;
      at = { x: event.clientX, y: event.clientY };
      held = false;
      timer = setTimeout(() => { timer = null; held = true; navigator.vibrate?.(10); onHold(task); }, 450);
    });
    item.addEventListener('pointermove', (event) => { if (timer && (Math.abs(event.clientX - at.x) > 10 || Math.abs(event.clientY - at.y) > 10)) cancel(); });
    item.addEventListener('pointerup', cancel);
    item.addEventListener('pointercancel', cancel);
    item.addEventListener('contextmenu', (event) => { event.preventDefault(); cancel(); if (!held) onHold(task); });
    item.addEventListener('click', (event) => { if (held) { held = false; event.stopPropagation(); event.preventDefault(); } }, true);
  }

  // Several tasks changed by one tap (focus.js: «▶ В работу» pauses the current task) — saved in order, and
  // «Вернуть» puts every one back. `parts` — [{ id, change }]; `byId` — the tasks as they were.
  function actAll(parts, byId, message) {
    if (parts.some(({ id }) => busy.has(id))) return Promise.resolve(); // a double tap does nothing
    for (const { id } of parts) busy.add(id);
    const free = () => setTimeout(() => { for (const { id } of parts) busy.delete(id); }, 300);
    const undos = parts.map(({ id, change }) => ({ id, change: { op: 'update', ...undoOf(byId.get(id), change) } }));
    const save = (list) => list.reduce((chain, { id, change }) => chain.then(() => queue(makeTaskChange(id, change))), Promise.resolve());
    return save(parts)
      .then(() => notify(message, { label: 'Вернуть', run: () => save([...undos].reverse()).catch((error) => notify(error.message)) }))
      .catch((error) => notify(error.message))
      .finally(free);
  }
  const byIdOf = (...tasks) => new Map(tasks.filter(Boolean).map((task) => [task.id, task]));
  // «▶ В работу» / «Вернуться»: this task in work, the current one paused with where I stopped.
  const start = (task, current) => actAll(startWork(task, current), byIdOf(task, current), `В работе: «${task.title}»`);
  const pause = (task) => actAll([pauseWork(task)], byIdOf(task), `На паузе: «${task.title}»`);

  // A list or view change closes an open «Когда?» row (it would come back later out of context).
  const reset = () => { whenFor = null; };

  return { decorate, done, act, reset, start, pause };
}
