// The left panel (docs/plans/2026-11-21-workspace-redesign-design.md): three bodies switched by the flat icons at its
// foot — «Беседы» (the queue, queuepanel.js), «Контакты» (the address book, contactspanel.js) and «Задачи» (the task
// filters, projects and tags, viewpanel.js; in the Лента — its sources). The choice is kept on this device. On a phone
// the panel slides in over the centre (the top-bar icon or a swipe from the left); on a wide screen it is a column.
import { sourceKey } from './projection.js';
import { viewPanel } from './viewpanel.js';
import { viewStore } from './viewstore.js';
import { accountTitle } from './tgbubble.js';
import { isWide, onWideChange } from './layout.js';
import { holdRender } from './holdrender.js';
import { createQueuePanel } from './queuepanel.js';
import { contactsNodes } from './contactspanel.js';

const MODES = ['conversations', 'contacts', 'tasks'];
const MODE_KEY = 'stream.panelMode';
const TITLES = { conversations: 'Беседы', contacts: 'Контакты', tasks: 'Задачи' };

// The stored mode, or «Беседы».
export const panelMode = (stored) => (MODES.includes(stored) ? stored : 'conversations');

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// `onContact(key)` — open a conversation; `onPerson(id)` — a person's card on the right; `onTask(id)` — a task;
// `onTasks()` — show the list of the chosen filter.
export function setupDrawer({ feed, convQuick, limits, onContact, onPerson = () => {}, onTask = () => {}, onTasks = () => {}, pinned = () => [], onFilterChange, onCreateProject = () => {} }) {
  const drawer = document.querySelector('#drawer');
  const backdrop = document.querySelector('#drawer-backdrop');
  const body = drawer.querySelector('.drawer-body');
  const bodies = { conversations: document.querySelector('#panel-conversations'), contacts: document.querySelector('#panel-contacts'), tasks: document.querySelector('#panel-tasks') };
  const tagSection = document.querySelector('#drawer-tag-section');
  const tagCount = document.querySelector('#drawer-tag-count');
  const tagsBox = document.querySelector('#drawer-tags');
  const modeBox = document.querySelector('#drawer-mode');
  const searchToggle = document.querySelector('#drawer-search-toggle');
  const expanded = new Map();
  const contactsState = { query: '' };
  let mode = panelMode((() => { try { return localStorage.getItem(MODE_KEY); } catch { return null; } })());

  // The drawer sits between the top bar and the composer; both stay visible and usable.
  function place() {
    const top = document.querySelector('.topbar').getBoundingClientRect().bottom;
    const bottom = window.innerHeight - document.querySelector('.composer-area').getBoundingClientRect().top;
    document.documentElement.style.setProperty('--drawer-top', `${Math.max(0, top)}px`);
    document.documentElement.style.setProperty('--drawer-bottom', `${Math.max(0, bottom)}px`);
  }
  const isOpen = () => drawer.classList.contains('open');
  const visible = () => !drawer.hidden && (isWide() || isOpen() || drawer.classList.contains('dragging'));

  // A tap in the panel opens something in the centre: on a phone the panel closes first (its history entry is
  // popped), then `go` runs.
  function leaveFor(go) {
    const pending = isOpen() && history.state?.drawer;
    if (pending) window.addEventListener('popstate', () => go(), { once: true });
    close();
    if (!pending) go();
  }

  const queue = createQueuePanel({ box: document.querySelector('#queue-box'), scroller: body, feed, convQuick, limits, pinned,
    active: () => visible() && mode === 'conversations',
    open: (key) => leaveFor(() => onContact(key)),
    openTask: (id) => leaveFor(() => onTask(id)) });

  function show(on) {
    if (isWide()) { render(); return; } // a column of its own on a wide screen: always open
    drawer.classList.remove('dragging'); backdrop.classList.remove('dragging');
    drawer.style.transform = ''; backdrop.style.opacity = '';
    if (on) {
      place();
      drawer.hidden = false; backdrop.hidden = false;
      render();
      void drawer.offsetWidth; // apply the closed position first, so the opening slides in
      drawer.classList.add('open');
      if (!history.state?.drawer) history.pushState({ drawer: true }, '');
    } else {
      if (mode === 'conversations') queue.remember();
      drawer.classList.remove('open');
      backdrop.hidden = true;
      setTimeout(() => { if (!isWide() && !isOpen()) drawer.hidden = true; }, 230);
    }
  }

  function close() {
    if (isWide() || !isOpen()) return;
    show(false);
    if (history.state?.drawer) history.back();
  }

  function open(next = null) {
    if (next) setMode(next, false);
    show(true);
  }

  function setMode(next, draw = true) {
    if (mode === 'conversations' && next !== mode) queue.remember();
    mode = panelMode(next);
    try { localStorage.setItem(MODE_KEY, mode); } catch { /* storage may be blocked */ }
    if (draw) render();
  }
  for (const button of drawer.querySelectorAll('.panel-modes [data-panel]')) button.onclick = () => setMode(button.dataset.panel);

  // The screen swipe from the left (swipezones.js: an edge, or before the first tab) opens the drawer; right to left
  // on the drawer or backdrop closes it. The panel follows the finger; past a third of its width it closes.
  const START_PX = 12;
  let drag = null; // { x, y, opening, width, horizontal }
  // `external` — driven by the screen swipe (swipezones.js, touch events): pointer events leave it alone.
  function begin(event, opening, external = false) {
    if (isWide() || event.pointerType === 'mouse' || document.body.classList.contains('selecting') || document.body.classList.contains('picking')) return;
    drag = { x: event.clientX, y: event.clientY, opening, width: drawer.offsetWidth || 300, horizontal: null, external };
  }
  function move(event) {
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (drag.horizontal === null) {
      if (Math.abs(dx) < START_PX && Math.abs(dy) < START_PX) return;
      drag.horizontal = Math.abs(dx) > Math.abs(dy) * 1.5 && (drag.opening ? dx > 0 : dx < 0);
      if (!drag.horizontal) { drag = null; return; }
      if (drag.opening) { place(); drawer.hidden = false; backdrop.hidden = false; render(); }
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
  for (const surface of [drawer, backdrop]) surface.addEventListener('pointerdown', (event) => { if (isOpen() && !event.target.closest('.conv-tile')) begin(event, false); });
  window.addEventListener('pointermove', (event) => { if (!drag?.external) move(event); }, { passive: true });
  window.addEventListener('pointerup', (event) => { if (!drag?.external) end(event); });
  window.addEventListener('pointercancel', () => { if (drag?.external) return; if (drag?.horizontal) show(drag.opening ? false : true); drag = null; });
  window.addEventListener('resize', () => { if (!drawer.hidden) place(); });

  // Sources (CONCEPT.md §8.2): my notes, each messenger account, the phone, the system. One at a time.
  const SOURCE_TITLES = { me: 'Мои', phone: 'Телефон', viber: 'Viber', whatsapp: 'WhatsApp', system: 'Система' };
  const sourceTitle = (key) => SOURCE_TITLES[key] ?? (key.startsWith('telegram:') ? accountTitle(key.slice(9)) : key);
  function renderSources() {
    const counts = new Map();
    for (const view of feed.views()) if (!view.deleted) { const key = sourceKey(view.event); counts.set(key, (counts.get(key) ?? 0) + 1); }
    const active = feed.sourceFilter();
    const keys = [...counts.keys()].sort((a, b) => (a === 'me' ? -1 : b === 'me' ? 1 : sourceTitle(a).localeCompare(sourceTitle(b), 'ru')));
    const sources = keys.length > 1 || active ? keys : [];
    modeBox.replaceChildren(element('h3', 'drawer-section', 'Показывать'), chipRow([doneChip(), ...sources.map((key) => {
      const chip = element('button', `chip ${active === key ? 'on' : 'suggest'}`, `${sourceTitle(key)} ${counts.get(key)}`);
      chip.type = 'button';
      chip.setAttribute('aria-pressed', String(active === key));
      chip.onclick = async () => { await feed.setSourceFilter(active === key ? null : key); onFilterChange(); render(); };
      return chip;
    })]));
  }

  // «Завершённые» in the Лента: messages whose tasks are all finished (CONCEPT.md §5).
  function doneChip() {
    const done = element('button', `chip ${feed.showDone() ? 'on' : 'suggest'}`, '✓ Завершённые');
    done.type = 'button';
    done.setAttribute('aria-pressed', String(feed.showDone()));
    done.onclick = async () => { await feed.setShowDone(!feed.showDone()); render(); };
    return done;
  }

  const chipRow = (chips) => { const row = element('div', 'chips'); row.append(...chips); return row; };
  function renderTaskFilters() {
    modeBox.replaceChildren(viewPanel({
      store: viewStore, tasks: feed.tasks().filter(feed.taskMatches()), projects: feed.projects(), counterparties: feed.counterparties(), people: feed.people(),
      expanded, onCreateProject, inTasks: feed.mode() === 'tasks', showApply: !isWide() || feed.mode() !== 'tasks',
      done() { leaveFor(() => onTasks()); },
    }));
  }

  function renderTags() {
    const counts = new Map();
    for (const view of feed.views()) if (!view.deleted) for (const tag of view.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    const active = new Set(feed.tagFilter());
    for (const tag of active) if (!counts.has(tag)) counts.set(tag, 0);
    const tags = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ru'));
    tagSection.hidden = !tags.length;
    tagCount.hidden = !active.size;
    tagCount.textContent = String(active.size);
    tagsBox.replaceChildren(...tags.map(([tag, count]) => {
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
    }));
  }

  function render() {
    for (const [key, node] of Object.entries(bodies)) node.hidden = key !== mode;
    for (const button of drawer.querySelectorAll('.panel-modes [data-panel]')) button.setAttribute('aria-pressed', String(button.dataset.panel === mode));
    searchToggle.hidden = mode !== 'conversations';
    const inFeed = feed.mode() === 'feed';
    document.querySelector('#drawer-title').textContent = mode === 'tasks' && inFeed ? 'Фильтры ленты' : TITLES[mode];
    if (drawer.hidden) return; // drawn when it opens
    if (mode === 'conversations') queue.render();
    else if (mode === 'contacts') {
      bodies.contacts.replaceChildren(...contactsNodes({ people: feed.people(), conversations: feed.conversations(), state: contactsState,
        onOpen: (contact) => leaveFor(() => { if (contact.key) onContact(contact.key); onPerson(contact.id); }) }));
    } else {
      if (inFeed) renderSources(); else renderTaskFilters();
      renderTags();
    }
  }

  viewStore.onChange(() => {
    if (!drawer.hidden && mode === 'tasks' && feed.mode() !== 'feed') render();
    onFilterChange();
  });
  document.querySelector('#drawer-button').onclick = () => (isOpen() ? close() : open());
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
  // A new project's name or a contact search being typed survives live updates (holdrender.js).
  const held = holdRender(drawer, () => { if (!drawer.hidden) render(); });
  // The screen swipe from the left (swipezones.js) opens the panel following the finger.
  const swipeDrag = { begin: (point) => begin(point, true, true), move, end };
  return { render: held, close, open, isOpen, drag: swipeDrag, mode: () => mode };
}
