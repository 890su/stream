// The conversation queue on the main screen (owner, 2026-11-22: the queue is home again, the left panel keeps only
// «Задачи» and «Контакты»): the longest waiting on top, the newest last, under them the folded «Архив» of handled
// conversations, five at a time (convarchive.js); an archive tile swiped either way comes back to the queue. An empty
// queue says «Всё распределено ✓» with how many were dealt with today (design 2026-11-23); the top bar counts the
// waiting ones (viewswitch.js). Tiles,
// swipes (and the mouse at a tile's edge) — convlist.js, convquick.js. feed.js
// places the nodes and keeps the row being read across redraws (scrollpin.js).
import { convRow } from './convlist.js';
import { queueList, archiveList, handledToday } from './queue.js';
import { createArchive } from './convarchive.js';
import { PULSE_DEFAULTS } from './pulse.js';

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// `scroller`, `list` — the centre; `render(options)` — the centre's redraw (pin, reveal); `active()` — the queue is on
// screen; `open(key)` / `openTask(id)` — what a tap opens.
export function createQueueHome({ scroller, list, render, active, hasOlder, loadOlder, convQuick, limits, open, openTask }) {
  const archive = createArchive({ scroller, list, active, hasOlder, loadOlder,
    render: ({ pin = null, reveal = false } = {}) => render({ quiet: true, pin, reveal }) });

  // `conversations` — all of them with their queue (conversations.js); `tags` — the tag filter; `questions` — the AI's
  // waiting questions by message (questions.js), «❓ …» on a tile.
  function nodes({ conversations, tags, counterparties, questions = new Map(), now = new Date() }) {
    const tagged = (view) => tags.every((tag) => view.tags.includes(tag));
    const shown = conversations.filter((item) => item.views.some(tagged));
    const waiting = queueList(shown);
    const hotHours = (limits.pulse ?? PULSE_DEFAULTS).hot_wait_hours;
    const tile = (item, inArchive) => convRow(item, { now, hotHours, counterparties, questions, archived: inArchive, decorate: inArchive ? convQuick?.decorateArchived : convQuick?.decorate, on: {
      open: (key) => open(key),
      task: (id) => openTask(id),
      newTask: (title) => convQuick?.newTask(item, title),
    } });
    const children = waiting.map((item) => tile(item, false));
    if (!waiting.length && tags.length) children.push(element('div', 'empty', 'Под фильтр ничего не подходит.'));
    else if (!waiting.length) {
      const done = element('div', 'empty queue-done');
      done.append(element('strong', 'queue-done-title', 'Всё распределено ✓'), element('span', 'queue-done-count', ` · разобрано сегодня: ${handledToday(conversations, now)}`));
      children.push(done);
    }
    children.push(...archive.nodes(archiveList(shown), (item) => tile(item, true)));
    return children;
  }

  return { nodes, reveal: () => archive.reveal() };
}
