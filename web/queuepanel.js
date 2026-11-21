// The conversation queue in the left panel (docs/plans/2026-11-21-workspace-redesign-design.md): the longest waiting
// on top (owner, 2026-11-21: the most important on top), the newest last, under them the folded «Архив» of handled
// conversations, five at a time (convarchive.js); pinned chats («Избранные») and a search by name or number above.
// A redraw keeps the row being read where it was (scrollpin.js); the first one starts at the top. Tiles, swipes, ⏱
// and ↧ as before (convlist.js, convquick.js).
import { convRow } from './convlist.js';
import { queueList, archiveList } from './queue.js';
import { createArchive } from './convarchive.js';
import { rowOnScreen, putBack } from './scrollpin.js';
import { snoozeMenu } from './snooze.js';
import { favourites, searchConversations } from './favourites.js';
import { PULSE_DEFAULTS } from './pulse.js';

const NEAR_TOP = 40;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function age(ts) {
  const days = Math.floor((Date.now() - Date.parse(ts)) / 86_400_000);
  return days <= 0 ? 'сегодня' : `${days} дн. назад`;
}

// `box` — the queue's list inside the panel, `scroller` — the panel body that scrolls; `active()` — the queue is on
// screen; `open(key)` / `openTask(id)` — what a tap opens; `pinned()` — the composer's pinned chats.
export function createQueuePanel({ box, scroller, feed, convQuick, limits, active, open, openTask, pinned }) {
  const favouritesBox = document.querySelector('#drawer-contacts');
  const favouritesSection = document.querySelector('#drawer-favourites');
  const search = document.querySelector('#drawer-search');
  const searchToggle = document.querySelector('#drawer-search-toggle');
  const searchInput = document.querySelector('#drawer-search-input');
  const searchResults = document.querySelector('#drawer-search-results');
  let rendered = false;
  let saved = null; // the row on screen when the panel was hidden: it comes back there
  const archive = createArchive({ scroller, list: box, render: (options) => render(options), active, hasOlder: feed.hasOlder, loadOlder: feed.loadOlder });

  function contactRow({ key, title }, last) {
    const on = feed.conversationKey() === key;
    const row = element('button', `drawer-contact${on ? ' on' : ''}`);
    row.type = 'button';
    row.append(element('span', 'drawer-title', title), element('span', 'drawer-count', last ? age(last) : 'нет сообщений'));
    row.setAttribute('aria-pressed', String(on));
    row.onclick = () => { setSearch(false); open(key); };
    return row;
  }

  function renderTop() {
    const known = new Map(feed.conversations().map((item) => [item.key, item]));
    const rows = favourites(pinned()).map((item) => contactRow(item, known.get(item.key)?.last));
    favouritesSection.hidden = !rows.length;
    favouritesBox.replaceChildren(...rows);
    if (!search.hidden) {
      const query = searchInput.value.trim();
      const hits = searchConversations(feed.conversations(), query).map((item) => contactRow(item, item.last));
      searchResults.replaceChildren(...(query && !hits.length ? [element('p', 'drawer-empty', 'Беседа не найдена')] : hits));
    }
  }

  function setSearch(on) {
    search.hidden = !on;
    searchToggle.setAttribute('aria-expanded', String(on));
    if (on) { renderTop(); searchInput.focus(); } else { searchInput.value = ''; searchResults.replaceChildren(); }
  }
  searchToggle.onclick = () => setSearch(search.hidden);
  searchInput.oninput = renderTop;

  // `pin` — a row to keep in place (the archive's own), `reveal` — the archive was just opened.
  function render({ pin = null, reveal = false } = {}) {
    renderTop();
    const now = new Date();
    const tagged = (view) => feed.tagFilter().every((tag) => view.tags.includes(tag));
    const shown = feed.conversations().filter((item) => item.views.some(tagged));
    const waiting = queueList(shown);
    const config = feed.queueConfig();
    const hotHours = (limits.pulse ?? PULSE_DEFAULTS).hot_wait_hours;
    const tile = (item, inArchive) => convRow(item, { now, hotHours, counterparties: feed.counterparties(), archived: inArchive, decorate: inArchive ? null : convQuick?.decorate, on: {
      open: (key) => open(key),
      task: (id) => openTask(id),
      newTask: (title) => convQuick?.newTask(item, title),
      snooze: (anchor) => snoozeMenu(anchor, { config, onPick: (until) => convQuick?.snooze(item, until) }),
      requeue: () => convQuick?.requeue(item),
    } });
    const children = waiting.map((item) => tile(item, false));
    if (!waiting.length) children.push(element('div', 'empty', feed.tagFilter().length ? 'Под фильтр ничего не подходит.' : 'Очередь пуста — всё разобрано. Новые сообщения появятся здесь.'));
    children.push(...archive.nodes(archiveList(shown), (item) => tile(item, true)));
    const nearTop = scroller.scrollTop < NEAR_TOP;
    const held = saved ?? (rendered && !pin && !nearTop ? rowOnScreen(scroller, box) : null);
    saved = null;
    box.replaceChildren(...children);
    if (pin && putBack(scroller, box, pin)) { /* the row stays where it was */ }
    else if (held) putBack(scroller, box, held);
    else scroller.scrollTop = 0; // the longest waiting on top
    if (reveal) archive.reveal();
    rendered = true;
  }

  // Before the panel hides (a phone): remember the row being read, so reopening shows it again.
  const remember = () => { if (scroller.clientHeight) saved = rowOnScreen(scroller, box); };
  return { render, remember, closeSearch: () => setSearch(false) };
}
