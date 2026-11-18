import { sourceKey, chatOf } from './projection.js';
import { accountTitle } from './tgbubble.js';
import { visibleTasks } from './filters.js';
import { isWide, onWideChange } from './layout.js';

// Left panel — filters of the centre (CONCEPT.md §5), by view: contacts and tags for every view (kept when the
// view changes); Лента and Дела — «Завершённые» and sources; Задачи — the saved task filters.
const DAY = 86400000;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function age(ts) {
  const days = Math.floor((Date.now() - Date.parse(ts)) / DAY);
  return days <= 0 ? 'сегодня' : `${days} дн. назад`;
}

export function setupDrawer({ feed, onContact, onFilterChange }) {
  const drawer = document.querySelector('#drawer');
  const backdrop = document.querySelector('#drawer-backdrop');
  const contactsBox = document.querySelector('#drawer-contacts');
  const tagsBox = document.querySelector('#drawer-tags');
  const modeBox = document.querySelector('#drawer-mode');

  // The drawer sits between the top bar and the composer; both stay visible and usable.
  function place() {
    const top = document.querySelector('.topbar').getBoundingClientRect().bottom;
    const bottom = window.innerHeight - document.querySelector('.composer-area').getBoundingClientRect().top;
    document.documentElement.style.setProperty('--drawer-top', `${Math.max(0, top)}px`);
    document.documentElement.style.setProperty('--drawer-bottom', `${Math.max(0, bottom)}px`);
  }
  const isOpen = () => drawer.classList.contains('open');

  function show(on) {
    if (isWide()) { render(); return; } // a column of its own on a wide screen: always open
    drawer.classList.remove('dragging'); backdrop.classList.remove('dragging');
    drawer.style.transform = ''; backdrop.style.opacity = '';
    if (on) {
      place(); render();
      drawer.hidden = false; backdrop.hidden = false;
      void drawer.offsetWidth; // apply the closed position first, so the opening slides in
      drawer.classList.add('open');
      if (!history.state?.drawer) history.pushState({ drawer: true }, '');
    } else {
      drawer.classList.remove('open');
      backdrop.hidden = true;
      setTimeout(() => { if (!isOpen()) drawer.hidden = true; }, 230);
    }
  }

  function close() {
    if (isWide() || !isOpen()) return;
    show(false);
    if (history.state?.drawer) history.back();
  }

  function open() { show(true); }

  // Swipe left to right on the feed opens the drawer; right to left on the drawer or backdrop closes it.
  // The panel follows the finger; letting go past a third of its width finishes the move.
  const START_PX = 12;
  let drag = null; // { x, y, opening, width, horizontal }
  function begin(event, opening) {
    if (isWide() || event.pointerType === 'mouse' || document.body.classList.contains('selecting') || document.body.classList.contains('picking')) return;
    drag = { x: event.clientX, y: event.clientY, opening, width: drawer.offsetWidth || 300, horizontal: null };
  }
  function move(event) {
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (drag.horizontal === null) {
      if (Math.abs(dx) < START_PX && Math.abs(dy) < START_PX) return;
      drag.horizontal = Math.abs(dx) > Math.abs(dy) * 1.5 && (drag.opening ? dx > 0 : dx < 0);
      if (!drag.horizontal) { drag = null; return; }
      if (drag.opening) { place(); render(); drawer.hidden = false; backdrop.hidden = false; }
      drawer.classList.add('dragging'); backdrop.classList.add('dragging');
    }
    const offset = drag.opening ? Math.min(0, dx - drag.width) : Math.min(0, dx);
    drawer.style.transform = `translateX(${offset}px)`;
    backdrop.style.opacity = String(1 + offset / drag.width);
  }
  function end(event) {
    if (!drag) return;
    const moved = drag.horizontal ? event.clientX - drag.x : 0;
    const { opening, width, horizontal } = drag;
    drag = null;
    if (!horizontal) return;
    const far = Math.abs(moved) > width / 3;
    if (opening) show(far);
    else if (far) close(); else show(true);
  }
  const feedArea = document.querySelector('#messages');
  feedArea.addEventListener('pointerdown', (event) => { if (!isOpen()) begin(event, true); });
  for (const surface of [drawer, backdrop]) surface.addEventListener('pointerdown', (event) => { if (isOpen()) begin(event, false); });
  window.addEventListener('pointermove', move, { passive: true });
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', () => { if (drag?.horizontal) show(drag.opening ? false : true); drag = null; });
  window.addEventListener('resize', () => { if (!drawer.hidden) place(); });

  // Messenger chats with something in the feed, latest first; tapping one shows only its cases (chat bar).
  function renderContacts() {
    const chats = new Map();
    for (const view of feed.views()) {
      const chat = !view.deleted && chatOf(view.event);
      if (!chat) continue;
      const known = chats.get(chat.key) ?? { chat, count: 0, last: view.event.ts };
      known.count += 1;
      if (view.event.ts > known.last) known.last = view.event.ts;
      if (view.event.payload?.data?.telegram) known.chat = chat; // the chat's own title beats a reply's copy
      chats.set(chat.key, known);
    }
    const active = feed.chatFilter()?.key;
    const rows = [...chats.values()].sort((a, b) => b.last.localeCompare(a.last)).map(({ chat, count, last }) => {
      const row = element('button', `drawer-contact${active === chat.key ? ' on' : ''}`);
      row.type = 'button';
      row.append(element('span', 'drawer-title', chat.title), element('span', 'drawer-count', `${accountTitle(chat.account)}${chat.group ? ' · группа' : ''} · ${count} · ${age(last)}`));
      row.setAttribute('aria-pressed', String(active === chat.key));
      row.onclick = () => { close(); onContact(chat); };
      return row;
    });
    contactsBox.replaceChildren(...(rows.length ? rows : [element('p', 'drawer-empty', 'Контактов пока нет: здесь появятся чаты Telegram')]));
  }

  // Sources (CONCEPT.md §8.2): my notes, each messenger account, the phone, the system. One at a time.
  const SOURCE_TITLES = { me: 'Мои', phone: 'Телефон', system: 'Система' };
  const sourceTitle = (key) => SOURCE_TITLES[key] ?? (key.startsWith('telegram:') ? accountTitle(key.slice(9)) : key);
  function renderSources() {
    const counts = new Map();
    for (const view of feed.views()) if (!view.deleted) { const key = sourceKey(view.event); counts.set(key, (counts.get(key) ?? 0) + 1); }
    const active = feed.sourceFilter();
    const keys = [...counts.keys()].sort((a, b) => (a === 'me' ? -1 : b === 'me' ? 1 : sourceTitle(a).localeCompare(sourceTitle(b), 'ru')));
    // «Завершённые»: messages of tasks finished long ago come back to the feed (CONCEPT.md §2.8).
    const done = element('button', `chip ${feed.showDone() ? 'on' : 'suggest'}`, '✓ Завершённые');
    done.type = 'button';
    done.setAttribute('aria-pressed', String(feed.showDone()));
    done.onclick = async () => { await feed.setShowDone(!feed.showDone()); render(); };
    modeBox.replaceChildren(element('h3', 'drawer-section', 'Показывать'), chipRow([done, ...(keys.length < 2 && !active ? [] : keys).map((key) => {
      const chip = element('button', `chip ${active === key ? 'on' : 'suggest'}`, `${sourceTitle(key)} ${counts.get(key)}`);
      chip.type = 'button';
      chip.setAttribute('aria-pressed', String(active === key));
      chip.onclick = async () => { await feed.setSourceFilter(active === key ? null : key); onFilterChange(); render(); };
      return chip;
    })]));
  }

  const chipRow = (chips) => { const row = element('div', 'chips'); row.append(...chips); return row; };
  // The «Задачи» view: the saved filters of registry/filters.json with their task counts (CONCEPT.md §5).
  function renderTaskFilters() {
    const current = feed.taskFilter();
    const matches = feed.taskMatches();
    const rows = feed.taskFilters().map((filter) => {
      const row = element('button', `drawer-contact${filter.id === current.id ? ' on' : ''}`);
      row.type = 'button';
      row.append(element('span', 'drawer-title', filter.title), element('span', 'drawer-count', String(visibleTasks(feed.tasks(), { filter, matches }).length)));
      row.setAttribute('aria-pressed', String(filter.id === current.id));
      row.onclick = async () => { await feed.setTaskFilter(filter.id); onFilterChange(); render(); };
      return row;
    });
    modeBox.replaceChildren(element('h3', 'drawer-section', 'Списки'), ...rows);
  }

  function render() {
    renderContacts();
    if (feed.mode() === 'tasks') renderTaskFilters(); else renderSources();
    document.querySelector('#drawer-title').textContent = { feed: 'Фильтры ленты', cases: 'Фильтры дел', tasks: 'Фильтры задач' }[feed.mode()] ?? 'Фильтры';
    const counts = new Map();
    for (const view of feed.views()) if (!view.deleted) for (const tag of view.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    const active = new Set(feed.tagFilter());
    const tags = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ru'));
    tagsBox.replaceChildren(...(tags.length ? tags.map(([tag, count]) => {
      const chip = element('button', `chip ${active.has(tag) ? 'on' : 'suggest'}`, `${tag} ${count}`);
      chip.type = 'button';
      chip.setAttribute('aria-pressed', String(active.has(tag)));
      chip.onclick = async () => {
        if (active.has(tag)) active.delete(tag); else active.add(tag);
        await feed.setTagFilter([...active]);
        onFilterChange();
        render();
      };
      return chip;
    }) : [element('p', 'drawer-empty', 'Меток пока нет')]));
  }

  document.querySelector('#drawer-button').onclick = open;
  document.querySelector('#drawer-close').onclick = close;
  backdrop.onclick = close;
  window.addEventListener('popstate', () => { if (isOpen() && !history.state?.drawer) show(false); });
  const dock = (wide) => {
    drawer.classList.remove('open', 'dragging'); drawer.style.transform = ''; backdrop.hidden = true;
    drawer.hidden = !wide;
    if (wide) render();
  };
  onWideChange(dock);
  if (isWide()) dock(true);
  return { render: () => { if (!drawer.hidden) render(); }, close };
}
