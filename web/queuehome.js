// The conversation queue on the main screen (owner, 2026-11-22: the queue is home again, the left panel keeps only
// «Задачи» and «Контакты»): the longest waiting on top, the newest last, under them the folded «Архив» of handled
// conversations, five at a time (convarchive.js); an archive tile swiped either way comes back to the queue. Tiles,
// swipes (and the mouse at a tile's edge) — convlist.js, convquick.js. feed.js
// places the nodes and keeps the row being read across redraws (scrollpin.js).
import { convRow } from './convlist.js';
import { queueList, archiveList } from './queue.js';
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

  // `conversations` — all of them with their queue (conversations.js); `tags` — the tag filter.
  function nodes({ conversations, tags, counterparties, now = new Date() }) {
    const tagged = (view) => tags.every((tag) => view.tags.includes(tag));
    const shown = conversations.filter((item) => item.views.some(tagged));
    const waiting = queueList(shown);
    const hotHours = (limits.pulse ?? PULSE_DEFAULTS).hot_wait_hours;
    const tile = (item, inArchive) => convRow(item, { now, hotHours, counterparties, archived: inArchive, decorate: inArchive ? convQuick?.decorateArchived : convQuick?.decorate, on: {
      open: (key) => open(key),
      task: (id) => openTask(id),
      newTask: (title) => convQuick?.newTask(item, title),
    } });
    const children = waiting.map((item) => tile(item, false));
    if (!waiting.length) children.push(element('div', 'empty', tags.length ? 'Под фильтр ничего не подходит.' : 'Очередь пуста — всё разобрано. Новые сообщения появятся здесь.'));
    children.push(...archive.nodes(archiveList(shown), (item) => tile(item, true)));
    return children;
  }

  return { nodes, reveal: () => archive.reveal() };
}
