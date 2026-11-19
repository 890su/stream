// Acting on a task where it is seen (CONCEPT.md §2.8, 2026-11-19): the round «Готово» mark, a swipe right (done)
// and left («Когда?» — due today, tomorrow, this week, a date) on task rows and conversation plaques, and every
// change with «Вернуть» in the toast — the undo is one more task_change with the replaced values.
import { closeChange, undoOf, dueChips } from './taskactions.js';
import { reportKeys } from './donecard.js';
import { makeTaskChange } from './shared.js';
import { reduced } from './motion.js';

const SWIPE_PX = 80;
const EDGE_PX = 24; // a swipe from the screen edge still opens the left panel (drawer.js)

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
export function createTaskQuick({ queue, notify, config }) {
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

  // Horizontal swipe on an item: right — `onRight`, left — `onLeft`. Vertical moves scroll as usual.
  function swipe(item, { onRight, onLeft }) {
    let start = null; // { x, y, horizontal }
    let swiped = false;
    const reset = () => { item.style.transform = ''; delete item.dataset.swipe; item.classList.remove('swiping'); start = null; };
    item.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse' || event.clientX < EDGE_PX || event.target.closest('.task-when')) return;
      event.stopPropagation(); // not the drawer's swipe (drawer.js listens on the feed)
      start = { x: event.clientX, y: event.clientY, horizontal: null };
    });
    item.addEventListener('pointermove', (event) => {
      if (!start) return;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (start.horizontal === null) {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
        start.horizontal = Math.abs(dx) > Math.abs(dy) * 1.5;
        if (!start.horizontal) { reset(); return; }
        item.classList.add('swiping');
      }
      item.style.transform = `translateX(${Math.max(-140, Math.min(140, dx))}px)`;
      item.dataset.swipe = dx > 0 ? 'done' : 'when';
      item.classList.toggle('armed', Math.abs(dx) >= SWIPE_PX);
    });
    const finish = (event) => {
      if (!start?.horizontal) { reset(); return; }
      const dx = event.clientX - start.x;
      reset();
      item.classList.remove('armed');
      swiped = true;
      setTimeout(() => { swiped = false; }, 400);
      if (dx >= SWIPE_PX) onRight(); else if (dx <= -SWIPE_PX) onLeft();
    };
    item.addEventListener('pointerup', finish);
    item.addEventListener('pointercancel', () => { reset(); item.classList.remove('armed'); });
    // A swipe is not a tap: the click after it does not open the details.
    item.addEventListener('click', (event) => { if (swiped) { event.stopPropagation(); event.preventDefault(); } }, true);
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
    if (isOpen) swipe(item, { onRight: () => { item.classList.add('closing'); done(task); }, onLeft: () => whenRow(item, task) });
    if (isOpen && whenFor === task.id) whenRow(item, task, false);
  }

  // A list or view change closes an open «Когда?» row (it would come back later out of context).
  const reset = () => { whenFor = null; };

  return { decorate, done, act, reset };
}
