import { sourceKey } from './projection.js';
import { accountTitle } from './tgbubble.js';
import { visibleTasks } from './filters.js';
import { listCount } from './tasklist.js';
import { isWide, onWideChange } from './layout.js';

// Left panel — filters of the centre (CONCEPT.md §5), by view: contacts and tags for every view (kept when the
// view changes); Беседы — «Завершённые»; Лента — «Завершённые» and sources; Задачи — the saved task filters.
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

  // The filter icon opens the drawer (CONCEPT.md §5; no opening swipe — horizontal swipes belong to rows); right to
  // left on the drawer or backdrop closes it. The panel follows the finger; past a third of its width it closes.
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
  for (const surface of [drawer, backdrop]) surface.addEventListener('pointerdown', (event) => { if (isOpen()) begin(event, false); });
  window.addEventListener('pointermove', move, { passive: true });
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', () => { if (drag?.horizontal) show(drag.opening ? false : true); drag = null; });
  window.addEventListener('resize', () => { if (!drawer.hidden) place(); });

  // Contacts: conversations with people (not own notes), latest first. In Беседы a tap opens the conversation;
  // in Задачи and Лента it filters by it (the bar on top removes the filter).
  const CHANNELS = { phone: 'телефон' };
  function renderContacts() {
    const active = feed.conversationKey();
    const rows = feed.conversations().filter((item) => item.key !== 'me').sort((a, b) => b.last.localeCompare(a.last)).map((item) => {
      const row = element('button', `drawer-contact${active === item.key ? ' on' : ''}`);
      row.type = 'button';
      const channels = item.channels.map((channel) => CHANNELS[channel] ?? accountTitle(channel)).join(', ');
      row.append(element('span', 'drawer-title', item.title), element('span', 'drawer-count', `${channels}${item.group ? ' · группа' : ''} · ${item.views.length} · ${age(item.last)}`));
      row.setAttribute('aria-pressed', String(active === item.key));
      row.onclick = () => { close(); onContact(item.key); };
      return row;
    });
    contactsBox.replaceChildren(...(rows.length ? rows : [element('p', 'drawer-empty', 'Контактов пока нет: здесь появятся чаты Telegram и номера телефонов')]));
  }

  // Sources (CONCEPT.md §8.2): my notes, each messenger account, the phone, the system. One at a time.
  const SOURCE_TITLES = { me: 'Мои', phone: 'Телефон', system: 'Система' };
  const sourceTitle = (key) => SOURCE_TITLES[key] ?? (key.startsWith('telegram:') ? accountTitle(key.slice(9)) : key);
  function renderSources() {
    const counts = new Map();
    for (const view of feed.views()) if (!view.deleted) { const key = sourceKey(view.event); counts.set(key, (counts.get(key) ?? 0) + 1); }
    const active = feed.sourceFilter();
    const keys = [...counts.keys()].sort((a, b) => (a === 'me' ? -1 : b === 'me' ? 1 : sourceTitle(a).localeCompare(sourceTitle(b), 'ru')));
    // Лента: sources too. In Беседы there are no sources: a conversation is its channel.
    const sources = feed.mode() === 'feed' && (keys.length > 1 || active) ? keys : [];
    modeBox.replaceChildren(element('h3', 'drawer-section', 'Показывать'), chipRow([doneChip(), ...sources.map((key) => {
      const chip = element('button', `chip ${active === key ? 'on' : 'suggest'}`, `${sourceTitle(key)} ${counts.get(key)}`);
      chip.type = 'button';
      chip.setAttribute('aria-pressed', String(active === key));
      chip.onclick = async () => { await feed.setSourceFilter(active === key ? null : key); onFilterChange(); render(); };
      return chip;
    })]));
  }

  // «Завершённые»: Беседы — finished conversations unfolded at the end of the list; Лента — messages whose tasks
  // are all finished (CONCEPT.md §5).
  function doneChip() {
    const done = element('button', `chip ${feed.showDone() ? 'on' : 'suggest'}`, '✓ Завершённые');
    done.type = 'button';
    done.setAttribute('aria-pressed', String(feed.showDone()));
    done.onclick = async () => { await feed.setShowDone(!feed.showDone()); render(); };
    return done;
  }

  const chipRow = (chips) => { const row = element('div', 'chips'); row.append(...chips); return row; };
  // The «Задачи» view: the saved filters of registry/filters.json with their task counts (CONCEPT.md §5).
  function renderTaskFilters() {
    const current = feed.taskFilter();
    const matches = feed.taskMatches();
    const rows = feed.taskFilters().map((filter) => {
      const row = element('button', `drawer-contact${filter.id === current.id ? ' on' : ''}`);
      row.type = 'button';
      const count = listCount(visibleTasks(feed.tasks(), { filter, matches }), filter);
      row.classList.toggle('empty-list', !count);
      row.append(element('span', 'drawer-title', filter.title), element('span', 'drawer-count', count ? String(count) : ''));
      row.setAttribute('aria-pressed', String(filter.id === current.id));
      row.onclick = async () => { await feed.setTaskFilter(filter.id); onFilterChange(); render(); if (!isWide()) close(); };
      return row;
    });
    modeBox.replaceChildren(element('h3', 'drawer-section', 'Списки'), ...rows);
  }
  // In Задачи the lists come first, above the contacts; elsewhere the view's filters follow the contacts.
  const contactsHead = contactsBox.previousElementSibling;
  function placeModeBox() {
    if (feed.mode() === 'tasks') contactsHead.before(modeBox); else contactsBox.after(modeBox);
  }

  function render() {
    renderContacts();
    placeModeBox();
    if (feed.mode() === 'tasks') renderTaskFilters(); else renderSources();
    document.querySelector('#drawer-title').textContent = { feed: 'Фильтры ленты', conversations: 'Фильтры бесед', tasks: 'Фильтры задач' }[feed.mode()] ?? 'Фильтры';
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
  return { render: () => { if (!drawer.hidden) render(); }, close, open };
}
