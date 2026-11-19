// The centre of the screen (CONCEPT.md §5) in three views: Беседы (the list by state; a tap opens one
// conversation — its task plaques on top, its messages in a row), Задачи (a task list by a saved filter) and
// Лента (all messages in a row: bursts, chains, day pills); filters, paging and live updates.
import { listEntries, cachedEvents, cacheEvents, getSetting } from './db.js';
import { createBubble, bubbleSignature } from './bubble.js';
import { project, bursts, chains, sourceKey } from './projection.js';
import { foldTasks, tasksByMessage, questionsByMessage, isOpen, taskMembers } from './taskfold.js';
import { visibleTasks } from './filters.js';
import { questionOptions } from './question.js';
import { taskRow, emptyTasks, sectionsOf, sectionHeader, listChips, listCount } from './tasklist.js';
import { dayKey, dayLabel } from './days.js';
import { conversations, conversationKeys } from './conversations.js';
import { convRow, doneRow, splitDone } from './convlist.js';
import { convTasks } from './convtasks.js';
import { grow, shrink, reduced, play } from './motion.js';

const NEAR_BOTTOM = 120;
const NEAR_TOP = 160;
const MODES = ['conversations', 'tasks', 'feed'];
const OLD_MODES = { cases: 'conversations', messages: 'feed' }; // views saved by earlier versions
const DEFAULT_CONVERSATIONS = { quiet_days: 7, urgent_tags: [], states: ['urgent', 'mine', 'theirs', 'quiet', 'done'] };

export function setupFeed({ notify, onQueue, limits, onRender = () => {}, onOpenTask = () => {}, onOpenConversation = null, taskCard = () => null, quick = null, onMoreLists = () => {} }) {
  const scroller = document.querySelector('#messages');
  const list = document.querySelector('#feed-list');
  const historyState = document.querySelector('#history-state');
  const nodes = new Map(); // event id -> { node, signature }
  const mediaUrls = new Map(); // media id -> object URL, kept for the page lifetime
  let before;
  let loadingOlder = false;
  let refreshing;
  let rendered = false;
  let showArchive = false;
  let views = new Map(); // message id -> current view, for the action panel
  let viewList = []; // all current views, a new array per render (tag statistics key on it)
  let visibleList = [];
  let tagFilter = new Set(); // messages carrying every selected tag (drawer.js)
  let sourceFilter = null; // 'me' | 'telegram:by' | 'phone' | 'system'… (drawer.js)
  let conversationKey = null; // the open conversation (Беседы) or the contact filter (Задачи, Лента) — chatview.js
  let current = null; // that conversation as of the last render
  let convList = []; // all conversations, ordered by state
  let convKeys = new Map(); // message id -> conversation key (conversations.js)
  let listTop = 0; // where the list was when a conversation opened: «назад» returns there
  let taskList = []; // all tasks (CONCEPT.md §2.8), for the right panel
  const openSections = new Set(); // Задачи: folded sections («Дальше») the owner unfolded
  let showDone = false; // Беседы: finished conversations unfolded; Лента: messages of finished tasks shown (drawer.js)
  let mode = 'conversations';
  const taskFilters = limits.filters?.length ? limits.filters : [{ id: 'all', title: 'Все', all: [] }]; // saved filters (registry/filters.json)
  let taskFilterId = (() => { try { return localStorage.getItem('stream.taskFilter'); } catch { return null; } })();
  const taskFilter = () => taskFilters.find((item) => item.id === taskFilterId) ?? taskFilters[0]; // the first one is the default
  let groupNodes = new Map(); // 'done' -> rows under that header, for smooth folding
  // Lists read from the top; a conversation and the Лента read from the bottom, like a chat.
  const readsDown = () => mode === 'tasks' || (mode === 'conversations' && !conversationKey);

  async function load(reference, queued) {
    if (mediaUrls.has(reference.media_id)) return mediaUrls.get(reference.media_id);
    let blob = queued?.files.find((file) => file.id === reference.media_id)?.blob;
    if (!blob) {
      const response = await fetch(`/api/media/${reference.media_id}`, { headers: { Authorization: `Bearer ${await getSetting('ownerToken')}` } });
      if (!response.ok) throw new Error('Файл пока недоступен. Проверьте сеть и токен');
      blob = await response.blob();
    }
    const url = URL.createObjectURL(blob);
    mediaUrls.set(reference.media_id, url);
    return url;
  }

  // `keep` — { key, top }: the header that was tapped stays where it was; `quiet` — no animation of new rows;
  // `top` — a list goes to the top (true) or to a remembered position (a number).
  async function render({ bottom = false, keep = null, quiet = false, top = false } = {}) {
    const queued = await listEntries();
    const pending = new Map(queued.map((entry) => [entry.event.id, entry]));
    const events = new Map((await cachedEvents()).map((event) => [event.id, event]));
    for (const entry of queued) events.set(entry.event.id, entry.event);
    const projected = project([...events.values()], new Set(pending.keys()));
    taskList = foldTasks([...events.values()], { filedTemplates: limits.tasks?.filed_templates ?? [] });
    const byMessage = tasksByMessage(taskList);
    const tasksById = new Map(taskList.map((task) => [task.id, task]));
    const now = new Date();
    const questions = questionsByMessage([...events.values()]);
    for (const view of projected) {
      view.taskIds = byMessage.get(view.id) ?? [];
      view.question = questionOptions(view, questions.get(view.id), tasksById);
    }
    views = new Map(projected.map((view) => [view.id, view]));
    viewList = projected;
    // Archived topics hide all their messages, like archived messages, until "show archived" is on.
    const live = projected.filter((view) => !view.deleted);
    const allChains = chains(live);
    const inArchivedTopic = (view) => allChains.get(view.id)?.archived;
    const kept = live.filter((view) => showArchive || (!view.archived && !inArchivedTopic(view)));
    const tagged = (view) => [...tagFilter].every((tag) => view.tags.includes(tag));
    const inSource = (view) => !sourceFilter || sourceKey(view.event) === sourceFilter;
    convKeys = conversationKeys(live);
    const inConversation = (view) => !conversationKey || convKeys.get(view.id) === conversationKey;
    // Лента: messages whose tasks are all finished only with «Завершённые» (CONCEPT.md §5).
    const finished = (view) => view.taskIds.length > 0 && view.taskIds.every((id) => !isOpen(tasksById.get(id) ?? { status: 'todo' }));
    convList = conversations(kept, taskList, { now, config: limits.conversations ?? DEFAULT_CONVERSATIONS, keys: convKeys });
    current = conversationKey ? convList.find((item) => item.key === conversationKey) ?? null : null;
    const inside = mode === 'conversations' && Boolean(conversationKey);
    const visible = inside ? kept.filter(inConversation)
      : kept.filter((view) => tagged(view) && inSource(view) && inConversation(view) && (showDone || !finished(view)));
    visibleList = visible;
    onQueue({ total: queued.length, failed: queued.filter((entry) => entry.error).length });

    const nearBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < NEAR_BOTTOM;
    const children = [];
    const newcomers = [];
    groupNodes = new Map();
    const chainOf = chains(visible);
    const nextOf = new Map();
    for (const view of visible) if (view.continues && !nextOf.has(view.continues)) nextOf.set(view.continues, view.id);
    // The topic line goes once per bubble: on its first part.
    const node = (view, first = true) => {
      const queuedEntry = pending.get(view.id);
      const chain = first ? chainOf.get(view.id) : undefined;
      const next = nextOf.get(view.id); // the message that continues this one, for "unlink" under it
      const faded = Boolean(view.archived || inArchivedTopic(view));
      const signature = bubbleSignature(view, queuedEntry, chain) + (next ?? '') + faded;
      let cached = nodes.get(view.id);
      if (!cached && rendered) newcomers.push(view.id);
      if (!cached || cached.signature !== signature) {
        cached = { signature, node: createBubble(view, queuedEntry, { load: (reference) => load(reference, queuedEntry), notify, jump, chain, limits, next, faded }) };
        nodes.set(view.id, cached);
      }
      return cached.node;
    };
    let lastDay;
    let lastTs = 0;
    const pill = (date) => {
      if (dayKey(date) === lastDay) return;
      lastDay = dayKey(date);
      const node = document.createElement('div');
      node.className = 'date-pill';
      node.textContent = dayLabel(date);
      children.push(node);
    };
    // A message and its continuations share one bubble; each keeps its own actions and history.
    // Messages close in time only stand closer together (time alone is not a connection).
    function renderGroup(group) {
      pill(new Date(group[0].event.ts));
      const close = Date.parse(group[0].event.ts) - lastTs <= limits.burst_gap_min * 60000;
      lastTs = Date.parse(group.at(-1).event.ts);
      let item;
      if (group.length === 1) item = node(group[0]);
      else {
        item = document.createElement('div');
        item.className = 'burst';
        item.append(...group.map((view, index) => node(view, index === 0)));
      }
      item.classList.toggle('close', close && children.at(-1)?.className !== 'date-pill');
      children.push(item);
    }
    const empty = (text) => { const box = document.createElement('div'); box.className = 'empty'; box.textContent = text; children.push(box); };
    const filtered = Boolean((mode === 'feed' && sourceFilter) || tagFilter.size || conversationKey);
    if (mode === 'tasks') {
      // The chips of the main lists on top, then the list by its sections (CONCEPT.md §5).
      const filter = taskFilter();
      const matches = taskMatches();
      const counts = new Map(taskFilters.filter((item) => item.pinned || item.id === filter.id)
        .map((item) => [item.id, listCount(visibleTasks(taskList, { filter: item, matches, now }), item, now)]));
      children.push(listChips(taskFilters, filter, counts, { onPick: (id) => setTaskFilter(id), onMore: onMoreLists }));
      const shownTasks = visibleTasks(taskList, { filter, matches, now });
      const row = (task) => taskRow(task, task.messages.map((id) => views.get(id)).filter(Boolean), { onOpen: onOpenTask, showAssignee: filter.id !== taskFilters[0].id, quick });
      for (const section of sectionsOf(shownTasks, filter, now)) {
        const key = `section:${filter.id}:${section.id}`;
        const open = !section.folded || openSections.has(key);
        if (section.title) {
          const head = sectionHeader(section, { open, onToggle: () => toggleGroup(key, open, () => { if (open) openSections.delete(key); else openSections.add(key); }) });
          head.dataset.group = key;
          children.push(head);
        }
        if (open) {
          const rows = section.tasks.map(row);
          if (section.folded) groupNodes.set(key, rows);
          children.push(...rows);
        }
      }
      if (!shownTasks.length) children.push(emptyTasks(filter));
    } else if (mode === 'conversations' && !inside) {
      // The list (CONCEPT.md §5): by state; finished ones folded into one row at the end.
      const { active, done } = splitDone(convList.filter((item) => item.views.some(tagged)));
      for (const item of active) children.push(convRow(item, { onOpen: (key) => (onOpenConversation ?? openConversation)(key) }));
      if (done.length) {
        children.push(doneRow(done.length, { open: showDone, onToggle: () => toggleGroup('done', showDone, () => { showDone = !showDone; }) }));
        if (showDone) groupNodes.set('done', done.map((item) => convRow(item, { onOpen: (key) => (onOpenConversation ?? openConversation)(key) })));
        children.push(...(groupNodes.get('done') ?? []));
      }
      if (!active.length && !done.length) empty(filtered ? 'Под фильтр ничего не подходит.' : 'Здесь появятся беседы: чаты Telegram, звонки и SMS, ваши заметки.');
    } else {
      // One conversation (its task plaques on top) or the Лента: messages in a row.
      const plaques = inside && current ? convTasks(current, { onOpen: onOpenTask, quick }) : null;
      if (plaques) children.push(plaques);
      for (const group of bursts(visible)) renderGroup(group);
      // «Задача выполнена?» — after the conversation's messages (CONCEPT.md §2.9).
      if (inside && current) for (const task of current.tasks) { const card = taskCard(task); if (card) children.push(card); }
      if (!visible.length) empty(inside ? 'В этой беседе нет сообщений.' : filtered ? 'Под фильтр ничего не подходит.'
        : showArchive || !projected.length ? 'Здесь появятся ваши записи. Напишите, наговорите голосом или приложите фото.'
        : 'Все сообщения в архиве. Показать их: ⋮ → «Показывать архив».');
    }
    list.replaceChildren(...children);
    list.classList.toggle('reads-down', readsDown()); // a list starts at the top, a chat at the bottom
    const anchor = keep && list.querySelector(`[data-group="${CSS.escape(keep.key)}"]`);
    if (anchor) scroller.scrollTop += anchor.getBoundingClientRect().top - keep.top;
    else if (readsDown()) { if (top !== false) scroller.scrollTop = typeof top === 'number' ? top : 0; }
    else if (bottom || nearBottom || !rendered) {
      // A new message slides in and the feed glides to it; the first paint goes straight to the bottom.
      const fresh = !quiet && newcomers.length && newcomers.length <= 3;
      scroller.scrollTo({ top: scroller.scrollHeight, behavior: fresh && !reduced() ? 'smooth' : 'auto' });
    }
    if (!quiet && newcomers.length <= 3) {
      for (const id of newcomers) { const node = nodes.get(id)?.node; if (node?.isConnected) play(node, [{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }]); }
    }
    rendered = true;
    onRender();
  }

  // Shows or hides the rows under a header smoothly; the header stays in place.
  function toggleGroup(key, hiding, change) {
    const header = list.querySelector(`[data-group="${CSS.escape(key)}"]`);
    const keep = header ? { key, top: header.getBoundingClientRect().top } : null;
    const apply = async () => { change(); await render({ keep, quiet: true }); if (!hiding) grow(groupNodes.get(key) ?? []); };
    if (hiding) shrink(groupNodes.get(key) ?? [], apply); else apply();
  }

  // Scrolls to a message (from a reply quote) and flashes it.
  function jump(id) {
    const node = nodes.get(id)?.node;
    if (!node?.isConnected) { notify('Исходное сообщение скрыто или ещё не загружено'); return; }
    node.scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' });
    node.classList.remove('flash'); void node.offsetWidth; node.classList.add('flash');
  }

  async function fetchPage(older) {
    const token = await getSetting('ownerToken');
    if (!token || !navigator.onLine) return false;
    const query = older && before ? `?before=${encodeURIComponent(before)}` : '';
    const response = await fetch(`/api/events${query}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error(response.status === 401 ? 'Токен не принят. Откройте ⋮ → Доступ' : 'Лента временно недоступна');
    const page = await response.json();
    await cacheEvents(page.events);
    if (older || before === undefined) before = page.next_before;
    return true;
  }

  function refresh() {
    refreshing ??= (async () => {
      try { await fetchPage(false); } catch (error) { notify(error.message); }
      await render();
      // A short feed cannot be scrolled to the top, so fetch older history right away.
      if (before && scroller.scrollHeight <= scroller.clientHeight) await loadOlder();
    })().finally(() => { refreshing = undefined; });
    return refreshing;
  }

  async function loadOlder() {
    if (loadingOlder || !before) return;
    loadingOlder = true;
    historyState.hidden = false;
    historyState.textContent = 'Загружаем раньше…';
    const anchor = scroller.scrollHeight - scroller.scrollTop;
    try {
      await fetchPage(true);
      await render({ quiet: true });
      if (!readsDown()) scroller.scrollTop = scroller.scrollHeight - anchor; // keep the reading position
    } catch (error) { notify(error.message); }
    finally { loadingOlder = false; historyState.hidden = true; }
  }

  let stick = true; // the reader is at the bottom: keep them there when photos finish loading
  scroller.addEventListener('scroll', () => {
    const atEnd = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < NEAR_BOTTOM;
    stick = !readsDown() && atEnd;
    if (readsDown() ? atEnd : scroller.scrollTop < NEAR_TOP) loadOlder(); // a list reaches older history at its end
  }, { passive: true });
  list.addEventListener('load', () => { if (stick) scroller.scrollTop = scroller.scrollHeight; }, true);
  // The keyboard opening or closing resizes the feed: keep the last message glued to the composer.
  new ResizeObserver(() => { if (stick && !readsDown()) scroller.scrollTop = scroller.scrollHeight; }).observe(scroller);
  // A live event from any device: cache it like a fetched page and redraw.
  async function receive(event) {
    await cacheEvents([event]);
    await render();
  }

  // Opens a conversation (or, with null, goes back to the list where it was); in Задачи and Лента it filters.
  async function openConversation(key) {
    const next = key || null;
    if (next === conversationKey) return;
    const entering = mode === 'conversations' && next && !conversationKey;
    const leaving = mode === 'conversations' && !next && conversationKey;
    if (entering) listTop = scroller.scrollTop;
    conversationKey = next;
    stick = Boolean(next) && mode !== 'tasks';
    await render(leaving ? { top: listTop, quiet: true } : { bottom: true, top: true, quiet: true });
    if (entering || leaving) play(list, [{ opacity: 0, transform: `translateX(${entering ? 24 : -24}px)` }, { opacity: 1, transform: 'none' }]);
  }

  function setShowArchive(value) { showArchive = value; return render(); }
  function setTagFilter(tags) { tagFilter = new Set(tags); return render({ bottom: true, top: true }); }
  function setShowDone(value) { showDone = value; return render(); }
  function setSourceFilter(key) { sourceFilter = key || null; return render({ bottom: true, top: true }); }
  function setMode(next) {
    const wanted = OLD_MODES[next] ?? next;
    mode = MODES.includes(wanted) ? wanted : 'conversations';
    stick = !readsDown();
    return render({ bottom: !readsDown(), top: true, quiet: true });
  }
  // Contact and tag filters match a task through any of its messages.
  const taskMatches = () => (task) => (!conversationKey && !tagFilter.size) || task.messages.some((id) => {
    const view = views.get(id);
    return view && !view.deleted && (!conversationKey || convKeys.get(id) === conversationKey) && [...tagFilter].every((tag) => view.tags.includes(tag));
  });
  function setTaskFilter(id) {
    taskFilterId = id;
    try { localStorage.setItem('stream.taskFilter', id); } catch { /* storage may be blocked */ }
    return render({ top: true });
  }
  // Messages of one task, oldest first, for its details (details.js).
  const taskViews = (taskId) => { const task = taskList.find((item) => item.id === taskId); return task ? taskMembers(task, viewList) : []; };

  return { refresh, render, receive, jump, setShowArchive, setTagFilter, tagFilter: () => [...tagFilter], setMode, mode: () => mode, taskViews, setTaskFilter, taskFilter, taskFilters: () => taskFilters, taskMatches,
    task: (id) => taskList.find((task) => task.id === id),
    openConversation, conversation: () => current, conversationKey: () => conversationKey, conversations: () => convList,
    setSourceFilter, sourceFilter: () => sourceFilter, tasks: () => taskList,
    setShowDone, showDone: () => showDone,
    showArchive: () => showArchive, nextLinked: (id) => visibleList.find((view) => view.continues === id),
    view: (id) => views.get(id), views: () => viewList,
    chain: (id) => chains(visibleList).get(id),
    // A fresh bubble for another surface (details): same rendering and media loading, no feed bookkeeping.
    bubble: (view) => createBubble(view, undefined, { load: (reference) => load(reference), notify, jump, limits }),
    previous: (id) => visibleList[visibleList.findIndex((view) => view.id === id) - 1],
    latest: () => visibleList.at(-1),
    visible: () => visibleList, scrollToBottom: () => { scroller.scrollTop = scroller.scrollHeight; } };
}
