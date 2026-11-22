// In place of a queue tile after a left swipe (owner, 2026-11-22), one row in the tile's own height: dials like a
// bike code lock — ⏱ minutes (5 / 15 / 25 / 55), 🌗 the part of the day and 📅 the date, which are one wheel through
// the parts of the days ahead (📅 steps by days, a tap on it opens the calendar). Nothing dialled — the three icons;
// a dialled wheel spreads over all three places, and turning it back past its start brings the icons back. A dial
// turns by its ︿ ﹀, the mouse wheel, the arrow keys, or pressing it and moving the finger up or down: it keeps going
// round while the finger moves and stays where it is let go. The row holds the finger, not the dial, so redrawing the
// dials does not break the drag. Then «🗄» puts the conversation away until the dialled time, or with nothing dialled
// into the archive until the task day or a new message; «↧» to the end of the queue; «✕» gives the tile back (a tap
// outside or Escape too). Live redraws of the centre wait while it is open (holdrender.js).
import { swipeChoices, timeSlots, turnIndex, turnDay } from './snooze.js';
import { holding } from './holdrender.js';

const STEP_PX = 22; // a finger moved this far turns the dial one step
const clock = new Intl.DateTimeFormat('ru', { hour: '2-digit', minute: '2-digit' });
const short = new Intl.DateTimeFormat('ru', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
const CHEVRON = (up) => `<svg viewBox="0 0 24 12" aria-hidden="true"><path d="${up ? 'M3 10 12 3l9 7' : 'M3 2l9 7 9-7'}"/></svg>`;
const NAMES = { minutes: 'Минуты', part: 'Время дня', day: 'Дата' };

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
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

// A dial: ︿, its value (or icon), ﹀. `wheel` — 'minutes' | 'part' | 'day'; `wide` — spread over the three places.
function dialNode(wheel, value, { set = false, wide = false, label }) {
  const box = element('div', `dial${set ? ' set' : ''}${wide ? ' wide' : ''}`);
  box.dataset.wheel = wheel;
  box.tabIndex = 0;
  box.setAttribute('role', 'spinbutton');
  box.setAttribute('aria-label', NAMES[wheel]);
  box.setAttribute('aria-valuetext', label);
  const arrow = (up) => { const node = element('span', 'dial-arrow'); node.dataset.step = up ? '1' : '-1'; node.innerHTML = CHEVRON(up); return node; };
  box.append(arrow(true), element('span', 'dial-value', value), arrow(false));
  return box;
}

// `on` — { snooze(until), archive(), requeue() }.
export function snoozeTiles(row, { now = new Date(), config, on }) {
  if (row.querySelector('.conv-choices')) return;
  document.querySelectorAll('.conv-choices').forEach((open) => open.closeChoices?.());
  const choices = swipeChoices(now, config);
  let slots = timeSlots(now, choices);
  let minute = -1; // index into choices.minutes
  let slot = -1; // index into slots
  const box = element('div', 'conv-choices');
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', 'Отложить беседу');
  const dials = element('div', 'dials');
  const archiveButton = element('button', 'choice-act choice-archive');
  const endButton = element('button', 'choice-act choice-end');
  const closeButton = element('button', 'choice-act choice-close');
  for (const node of [archiveButton, endButton, closeButton]) node.type = 'button';
  box.append(dials, archiveButton, endButton, closeButton);

  const until = () => (minute >= 0 ? new Date(now.getTime() + choices.minutes[minute] * 60_000).toISOString() : slot >= 0 ? slots[slot].until : null);
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

  function turn(wheel, step) {
    if (wheel === 'minutes') { minute = turnIndex(minute, step, choices.minutes.length); slot = -1; }
    else { slot = wheel === 'day' ? turnDay(slot, step, slots) : turnIndex(slot, step, slots.length); minute = -1; }
    draw();
  }

  async function calendar() {
    const day = await pickDay(now);
    if (day === null || day < 0) return;
    slots = timeSlots(now, choices, Math.max(choices.days.length - 1, day));
    slot = slots.findIndex((item) => item.day === day);
    minute = -1;
    draw();
  }

  function draw() {
    const focused = Boolean(document.activeElement?.closest?.('.dial') && box.contains(document.activeElement));
    if (minute >= 0) dials.replaceChildren(dialNode('minutes', `${choices.minutes[minute]} мин`, { set: true, wide: true, label: `${choices.minutes[minute]} минут` }));
    else if (slot >= 0) dials.replaceChildren(dialNode('part', `${slots[slot].label} 📅`, { set: true, wide: true, label: slots[slot].label }));
    else dials.replaceChildren(dialNode('minutes', '⏱', { label: 'не выбрано' }), dialNode('part', '🌗', { label: 'не выбрано' }), dialNode('day', '📅', { label: 'не выбрано' }));
    const time = until();
    const when = time ? (new Date(time).toDateString() === now.toDateString() ? clock : short).format(new Date(time)) : '';
    archiveButton.replaceChildren(element('span', 'choice-icon', time ? '⏱' : '🗄'), element('span', 'choice-hint', time ? `до ${when}` : 'архив'));
    archiveButton.setAttribute('aria-label', time ? `Отложить до ${when}` : 'В архив');
    if (focused) dials.querySelector('.dial')?.focus({ preventScroll: true });
  }
  endButton.append(element('span', 'choice-icon', '↧'), element('span', 'choice-hint', 'в конец'));
  endButton.setAttribute('aria-label', 'В конец очереди');
  closeButton.append(element('span', 'choice-icon', '✕'));
  closeButton.setAttribute('aria-label', 'Отмена');
  archiveButton.onclick = (event) => { event.stopPropagation(); const time = until(); close(); if (time) on.snooze(time); else on.archive(); };
  endButton.onclick = (event) => { event.stopPropagation(); close(); on.requeue(); };
  closeButton.onclick = (event) => { event.stopPropagation(); close(); };

  // The finger: the row of dials holds it (setPointerCapture), so the dials can be redrawn under it. A press and a
  // move up or down turns the dial it started on, a step per STEP_PX, for as long as the finger moves; a press without
  // a move is a tap — an arrow turns once, the date (or the wide time) opens the calendar, another value turns once.
  let drag = null;
  dials.addEventListener('pointerdown', (event) => {
    const dial = event.target.closest('.dial');
    if (!dial || (event.pointerType === 'mouse' && event.button !== 0)) return;
    drag = { id: event.pointerId, wheel: dial.dataset.wheel, y: event.clientY, moved: false,
      step: Number(event.target.closest('.dial-arrow')?.dataset.step ?? 0) };
    try { dials.setPointerCapture(event.pointerId); } catch { /* the move still works over the row */ }
  });
  dials.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    const steps = Math.trunc((drag.y - event.clientY) / STEP_PX);
    if (!steps) return;
    drag.y -= steps * STEP_PX;
    drag.moved = true;
    for (let i = 0; i < Math.abs(steps); i += 1) turn(drag.wheel, steps > 0 ? 1 : -1);
  });
  const release = (event, tap) => {
    if (!drag || event.pointerId !== drag.id) return;
    const { wheel, moved, step } = drag;
    drag = null;
    if (!tap || moved) return;
    if (step) turn(wheel, step);
    else if (wheel === 'day' || (wheel === 'part' && slot >= 0)) calendar();
    else turn(wheel, 1);
  };
  dials.addEventListener('pointerup', (event) => release(event, true));
  dials.addEventListener('pointercancel', (event) => release(event, false));
  dials.addEventListener('click', (event) => event.stopPropagation()); // a tap here never opens the conversation
  dials.addEventListener('wheel', (event) => {
    const dial = event.target.closest('.dial');
    if (!dial) return;
    event.preventDefault();
    turn(dial.dataset.wheel, event.deltaY > 0 ? 1 : -1);
  }, { passive: false });
  dials.addEventListener('keydown', (event) => {
    const dial = event.target.closest('.dial');
    if (!dial) return;
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); turn(dial.dataset.wheel, event.key === 'ArrowUp' ? 1 : -1); }
    else if (event.key === 'Enter' && (dial.dataset.wheel === 'day' || slot >= 0)) { event.preventDefault(); calendar(); }
  });

  draw();
  row.style.minHeight = `${row.offsetHeight}px`; // the dials take the tile's own place, no taller
  row.classList.add('choosing');
  row.append(box);
  holding(box);
  setTimeout(() => { document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', escape); });
  dials.querySelector('.dial')?.focus({ preventScroll: true });
}
