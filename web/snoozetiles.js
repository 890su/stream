// In place of a queue tile after a left swipe (owner, 2026-11-22): tiles to put the conversation off — 15 / 30 /
// 60 minutes, morning, day, evening, night (a part of the day already gone means tomorrow), a day of the next ten —
// and «↧ В конец очереди», «🗄 В архив». ✕, a tap outside or Escape gives the tile back. Live redraws of the centre
// wait while the tiles are open (holdrender.js). The choices are swipeChoices (snooze.js).
import { swipeChoices } from './snooze.js';
import { holding } from './holdrender.js';

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function tile(className, icon, label, run, hint = '') {
  const node = element('button', className);
  node.type = 'button';
  if (icon) node.append(element('span', 'choice-icon', icon));
  node.append(element('span', 'choice-label', label));
  if (hint) node.append(element('span', 'choice-hint', hint));
  node.onclick = (event) => { event.stopPropagation(); run(); };
  return node;
}

// `on` — { snooze(until), requeue(), archive() }.
export function snoozeTiles(row, { now = new Date(), config, on }) {
  if (row.querySelector('.conv-choices')) return;
  document.querySelectorAll('.conv-choices').forEach((open) => open.closeChoices?.());
  const { times, days } = swipeChoices(now, config);
  const box = element('div', 'conv-choices');
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', 'Отложить беседу');
  const close = () => {
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', escape);
    holding(box, false);
    box.remove();
    row.classList.remove('choosing');
  };
  const pick = (run) => () => { close(); run(); };
  const outside = (event) => { if (!box.contains(event.target)) close(); };
  const escape = (event) => { if (event.key === 'Escape') close(); };
  box.closeChoices = close;

  const grid = element('div', 'choice-times');
  grid.append(...times.map((item) => tile('choice', item.icon, item.label, pick(() => on.snooze(item.until)), item.tomorrow ? 'завтра' : '')));
  const strip = element('div', 'choice-days');
  strip.append(...days.map((item) => tile('choice day', '', item.label, pick(() => on.snooze(item.until)))));
  const acts = element('div', 'choice-acts');
  acts.append(tile('choice act', '↧', 'В конец очереди', pick(() => on.requeue())), tile('choice act', '🗄', 'В архив', pick(() => on.archive())),
    tile('choice close', '', '✕', close));
  acts.lastChild.setAttribute('aria-label', 'Отмена');
  box.append(grid, strip, acts);
  row.classList.add('choosing');
  row.append(box);
  holding(box);
  setTimeout(() => { document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', escape); });
  grid.firstChild?.focus({ preventScroll: true });
}
