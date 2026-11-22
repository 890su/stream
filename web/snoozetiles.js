// In place of a queue tile after a left swipe (owner, 2026-11-22), one row in the tile's own height: three dials like
// a bike code lock — minutes (5 / 15 / 25 / 55), a part of the day (утро, день, вечер, ночь), a date (today and the
// next days; a tap on it opens the calendar) — turned by the ︿ ﹀ arrows, the wheel or a drag up and down; then
// «🗄» puts the conversation away until the dialled time, or with nothing dialled into the archive until the task
// day or a new message; «↧» to the end of the queue, «✕» gives the tile back (a tap outside or Escape too). Minutes
// exclude the part of the day and the date, and back. Live redraws of the centre wait while it is open
// (holdrender.js). The time is composeUntil (snooze.js).
import { swipeChoices, composeUntil, dayWord } from './snooze.js';
import { holding } from './holdrender.js';

const STEP_PX = 22; // a drag this far turns a dial one step
const clock = new Intl.DateTimeFormat('ru', { hour: '2-digit', minute: '2-digit' });
const short = new Intl.DateTimeFormat('ru', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
const CHEVRON = (up) => `<svg viewBox="0 0 24 12" aria-hidden="true"><path d="${up ? 'M3 10 12 3l9 7' : 'M3 2l9 7 9-7'}"/></svg>`;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(className, html, label, run) {
  const node = element('button', className);
  node.type = 'button';
  node.innerHTML = html;
  node.setAttribute('aria-label', label);
  node.onclick = (event) => { event.stopPropagation(); run(); };
  return node;
}

// A date from the system calendar, as days from today; null if cancelled.
function pickDay(now) {
  return new Promise((resolve) => {
    const input = Object.assign(document.createElement('input'), { type: 'date', className: 'snooze-date' });
    const pad = (n) => String(n).padStart(2, '0');
    input.min = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    let done = false;
    const finish = (value) => { if (done) return; done = true; input.remove(); resolve(value); };
    input.onchange = () => {
      if (!input.value) { finish(null); return; }
      const [year, month, day] = input.value.split('-').map(Number);
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      finish(Math.round((new Date(year, month - 1, day) - today) / 86_400_000));
    };
    input.onblur = () => setTimeout(() => finish(null), 300);
    document.body.append(input);
    try { input.showPicker(); } catch { input.focus(); }
  });
}

// One dial: ︿, the value (its icon when nothing is dialled), ﹀. `count` values; `index` -1 — nothing; turning wraps
// through «nothing» like a lock. `label(i)`, `onTurn(i)`, `onTap()` — a tap on the value (the date's calendar);
// `turns` — name → turn(step), for the drag of the row (snoozeTiles).
function dial({ name, icon, count, index, label, onTurn, onTap = null, turns }) {
  const box = element('div', `dial${index >= 0 ? ' set' : ''}`);
  box.dataset.dial = name;
  box.setAttribute('role', 'spinbutton');
  box.setAttribute('aria-label', name);
  box.setAttribute('aria-valuetext', index >= 0 ? label(index) : 'не выбрано');
  box.tabIndex = 0;
  const turn = (step) => { const next = ((index + 1 + step + count + 1) % (count + 1)) - 1; onTurn(next); };
  turns[name] = turn;
  const value = element('button', 'dial-value', index >= 0 ? label(index) : icon);
  value.type = 'button';
  value.tabIndex = -1;
  value.onclick = (event) => { event.stopPropagation(); if (box.closest('.conv-choices')?.dataset.dragged) return; if (onTap) onTap(); else turn(1); };
  box.append(button('dial-arrow', CHEVRON(true), `${name}: больше`, () => turn(1)), value, button('dial-arrow', CHEVRON(false), `${name}: меньше`, () => turn(-1)));
  box.addEventListener('wheel', (event) => { event.preventDefault(); turn(event.deltaY > 0 ? 1 : -1); }, { passive: false });
  box.onkeydown = (event) => {
    if (event.key === 'ArrowUp') { event.preventDefault(); turn(1); } else if (event.key === 'ArrowDown') { event.preventDefault(); turn(-1); }
  };
  return box;
}

// `on` — { snooze(until), archive(), requeue() }.
export function snoozeTiles(row, { now = new Date(), config, on }) {
  if (row.querySelector('.conv-choices')) return;
  document.querySelectorAll('.conv-choices').forEach((open) => open.closeChoices?.());
  const choices = swipeChoices(now, config);
  const pick = {}; // { minutes } | { part, day }
  const turns = {}; // dial name → turn(step); the dials are redrawn on every turn
  const box = element('div', 'conv-choices');
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', 'Отложить беседу');
  const close = () => {
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', escape);
    holding(box, false);
    box.remove();
    row.classList.remove('choosing');
    row.style.minHeight = '';
  };
  const outside = (event) => { if (!box.contains(event.target) && !event.target.closest?.('.snooze-date')) close(); };
  const escape = (event) => { if (event.key === 'Escape') close(); };
  box.closeChoices = close;

  // A drag up on a dial turns it forward, down — back, a step per STEP_PX; the row keeps the drag across redraws.
  let drag = null;
  const move = (event) => {
    const steps = Math.trunc((drag.y - event.clientY) / STEP_PX);
    if (!steps) return;
    drag.y -= steps * STEP_PX;
    box.dataset.dragged = '1';
    turns[drag.name]?.(steps > 0 ? 1 : -1);
  };
  const stop = () => {
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', stop);
    document.removeEventListener('pointercancel', stop);
    drag = null;
    setTimeout(() => { delete box.dataset.dragged; }, 0); // the click after a drag is not a tap on the value
  };
  box.addEventListener('pointerdown', (event) => {
    const node = event.target.closest('.dial');
    if (!node || event.target.closest('.dial-arrow')) return;
    drag = { name: node.dataset.dial, y: event.clientY };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', stop);
    document.addEventListener('pointercancel', stop);
  });

  function draw() {
    const focused = document.activeElement?.closest?.('.dial')?.dataset.dial;
    const until = composeUntil(now, pick, choices);
    const dayIndex = pick.day === undefined ? -1 : pick.day;
    const days = Math.max(choices.days.length, dayIndex + 1);
    const when = until ? (new Date(until).toDateString() === now.toDateString() ? clock : short).format(new Date(until)) : '';
    const set = (change) => { for (const key of Object.keys(pick)) delete pick[key]; Object.assign(pick, change); draw(); };
    const keepDay = () => (pick.day === undefined ? {} : { day: pick.day });
    const keepPart = () => (pick.part === undefined ? {} : { part: pick.part });
    box.replaceChildren(
      dial({ turns, name: 'Минуты', icon: '⏱', count: choices.minutes.length, index: choices.minutes.indexOf(pick.minutes),
        label: (i) => `${choices.minutes[i]} мин`, onTurn: (i) => set(i >= 0 ? { minutes: choices.minutes[i] } : {}) }),
      dial({ turns, name: 'Время дня', icon: '🌗', count: choices.parts.length, index: choices.parts.findIndex((part) => part.key === pick.part),
        label: (i) => choices.parts[i].label, onTurn: (i) => set({ ...keepDay(), ...(i >= 0 ? { part: choices.parts[i].key } : {}) }) }),
      dial({ turns, name: 'Дата', icon: '📅', count: days, index: dayIndex, label: (i) => dayWord(now, i),
        onTurn: (i) => set({ ...keepPart(), ...(i >= 0 ? { day: i } : {}) }),
        onTap: async () => { const day = await pickDay(now); if (day !== null && day >= 0) set({ ...keepPart(), day }); } }),
      action('choice-archive', until ? '⏱' : '🗄', until ? `до ${when}` : 'архив', until ? `Отложить до ${when}` : 'В архив', () => { close(); if (until) on.snooze(until); else on.archive(); }),
      action('choice-end', '↧', 'в конец', 'В конец очереди', () => { close(); on.requeue(); }),
      action('choice-close', '✕', '', 'Отмена', close));
    if (focused) box.querySelector(`[data-dial="${focused}"]`)?.focus({ preventScroll: true });
  }
  const action = (className, icon, text, label, run) => {
    const node = button(`choice-act ${className}`, '', label, run);
    node.append(element('span', 'choice-icon', icon));
    if (text) node.append(element('span', 'choice-hint', text));
    return node;
  };

  draw();
  row.style.minHeight = `${row.offsetHeight}px`; // the dials take the tile's own place, no taller
  row.classList.add('choosing');
  row.append(box);
  holding(box);
  setTimeout(() => { document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', escape); });
  box.querySelector('.dial')?.focus({ preventScroll: true });
}
