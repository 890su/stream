// The centre of the screen (CONCEPT.md §5) in three views: Беседы (the queue, oldest at the bottom; above it the folded
// «Архив» of handled conversations, five at a time; a tap opens one conversation — its task plaques on top, its messages
// in a row), Задачи (a task list by a saved filter) and Лента (all messages in a row: bursts, chains, day pills);
// filters, paging and live updates. A redraw keeps the row the reader looks at where it was.
import { listEntries, cachedEvents, cacheEvents } from './db.js';
import { createMediaLoader, createPager } from './feedpage.js';
import { createBubble, bubbleSignature } from './bubble.js';
import { project, bursts, chains, sourceKey } from './projection.js';
import { foldTasks, tasksByMessage, questionsByMessage, isOpen, taskMembers } from './taskfold.js';
import { questionOptions } from './question.js';
import { GROUPINGS } from './tasklist.js';
import { taskViewNodes } from './taskview.js';
import { pulseBlocks, pulseCount, PULSE_DEFAULTS } from './pulse.js';
import { foldPeople, foldCounterparties, markCounterparties } from './contacts.js';
import { viewStore } from './viewstore.js';
import { foldProjects, markNext } from './projects.js';
import { holdRender } from './holdrender.js';
import { dayKey, dayLabel } from './days.js';
import { conversations, conversationKeys } from './conversations.js';
import { convRow } from './convlist.js';
import { queueList, archiveList } from './queue.js';
import { createArchive } from './convarchive.js';
import { rowOnScreen, putBack } from './scrollpin.js';
import { snoozeMenu } from './snooze.js';
import { convTasks } from './convtasks.js';
import { grow, shrink, reduced, play } from './motion.js';

const NEAR_BOTTOM = 120;
const NEAR_TOP = 160;
const MODES = ['conversations', 'tasks', 'feed'];
const OLD_MODES = { cases: 'conversations', messages: 'feed' }; // views saved by earlier versions
const DEFAULT_CONVERSATIONS = { queue: { since: '2026-11-13T00:00:00Z', snooze: { minutes: [15, 60, 180], noon: { hour: 12, until_hour: 11 }, evening: { hour: 18, until_hour: 17 },
  tomorrow_day: { hour: 13, from_hour: 17 }, morning: { hour: 9 } } } };

export function setupFeed({ notify, onQueue, limits, onRender = () => {}, onOpenTask = () => {}, onOpenConversation = null, taskCard = () => null, quick = null, convQuick = null, onMoreLists = () => {}, projectActions = null }) {
  const scroller = document.querySelector('#messages');
  const list = document.querySelector('#feed-list');
  const historyState = document.querySelector('#history-state');
  const nodes = new Map(); // event id -> { node, signature }
  let rendered = false;
  let showArchive = false;
  let views = new Map(); // message id -> current view, for the action panel
  let viewList = []; // all current views, a new array per render (tag statistics key on it)
  let visibleList = [];
  let tagFilter = new Set(); // messages carrying every selected tag (drawer.js)
  let sourceFilter = null; // 'me' | 'telegram:by' | 'phone' | 'system'… (drawer.js)
  let conversationKey = null; // the open conversation (Беседы) or the contact filter (Задачи, Лента) — chatview.js
  let current = null; // that conversation as of the last render
  let convList = []; // all conversations, each with its place in the queue (queue.js)
  let convKeys = new Map(); // message id -> conversation key (conversations.js)
  let listPin = null; // the queue's row on screen when a conversation opened: «назад» returns there
  let taskList = []; // all tasks (CONCEPT.md §2.8), for the right panel
  let projectList = []; // all projects (CONCEPT.md §2.11)
  let peopleList = []; let counterpartyList = []; // the directory (contacts.js)
  // The project open in Задачи: the view's project when it shows all open tasks (viewstate.js, viewpanel.js).
  const currentProject = () => { const view = viewStore.get(); return (mode === 'tasks' && view.when === 'all' && projectList.find((item) => item.id === view.where?.project)) || null; };
  const openSections = new Set(); // Задачи: folded sections («Дальше») the owner unfolded
  let showDone = false; // Лента: messages of finished tasks shown (drawer.js)
  let mode = 'conversations';
  const taskFilters = limits.filters?.length ? limits.filters : [{ id: 'all', title: 'Все', all: [] }]; // saved filters (registry/filters.json)
  let taskFilterId = (() => { try { return localStorage.getItem('stream.taskFilter.v3'); } catch { return null; } })();
  const taskFilter = () => taskFilters.find((item) => item.id === taskFilterId) ?? taskFilters[0]; // the first one is the default
  let groupNodes = new Map(); // 'done' -> rows under that header, for smooth folding
  let grouping = (() => { try { return localStorage.getItem('stream.taskGrouping') ?? 'due'; } catch { return 'due'; } })();
  const nextGrouping = () => {
    const keys = Object.keys(GROUPINGS);
    grouping = keys[(keys.indexOf(grouping) + 1) % keys.length];
    try { localStorage.setItem('stream.taskGrouping', grouping); } catch { /* storage may be blocked */ }
    return render({ top: true, quiet: true });
  };
  // Lists read from the top; a conversation and the Лента read from the bottom, like a chat.
  const readsDown = () => mode === 'tasks'; // the queue and a chat start at the bottom, by the input
  // The queue settings (registry/conversations.json); a cached registry of an older version has none.
  const queueConfig = () => (limits.conversations?.queue ? limits.conversations : DEFAULT_CONVERSATIONS);
  const load = createMediaLoader();
  const { refresh, loadOlder, hasOlder } = createPager({ scroller, historyState, notify, render: (...args) => draw(...args), fillSince: () => queueConfig().queue.since });
  const inQueue = () => mode === 'conversations' && !conversationKey;

  const pinRow = (node) => rowOnScreen(scroller, list, node);
  const archive = createArchive({ scroller, list, render: (options) => render(options), active: inQueue, hasOlder, loadOlder });

  // `keep` — { key, top }: the header that was tapped stays where it was; `quiet` — no animation of new rows;
  // `top` — a list goes to the top (true) or to a remembered position (a number); `pin` — rowOnScreen(): that row stays
  // where it was; `reveal` — the archive was just opened: show its rows above the divider.
  async function render({ bottom = false, keep = null, quiet = false, top = false, pin = null, reveal = false } = {}) {
    const queued = await listEntries();
    const pending = new Map(queued.map((entry) => [entry.event.id, entry]));
    const events = new Map((await cachedEvents()).map((event) => [event.id, event]));
    for (const entry of queued) events.set(entry.event.id, entry.event);
    const projected = project([...events.values()], new Set(pending.keys()));
    taskList = foldTasks([...events.values()], { filedTemplates: limits.tasks?.filed_templates ?? [] });
    projectList = foldProjects([...events.values()]);
    peopleList = foldPeople([...events.values()]);
    counterpartyList = foldCounterparties([...events.values()]);
    markCounterparties(taskList, counterpartyList);
    markNext(taskList, projectList); // next actions of projects for «Сегодня»; project titles for rows
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
    convKeys = conversationKeys(live, { tasksById });
    const inConversation = (view) => !conversationKey || convKeys.get(view.id) === conversationKey;
    // Лента: context-only messages and all-finished tasks show with «Завершённые».
    const finished = (view) => view.taskIds.length ? view.taskIds.every((id) => !isOpen(tasksById.get(id) ?? { status: 'todo' })) : view.conversationOnly;
    convList = conversations(kept, taskList, { now, config: queueConfig(), keys: convKeys });
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
      // A saved list, or one project by its sections (taskview.js, CONCEPT.md §5, §2.11).
      const viewsOf = (task) => task.messages.map((id) => views.get(id)).filter(Boolean);
      children.push(...taskViewNodes({ tasks: taskList, viewsOf, now, filters: taskFilters, filter: taskFilter(), matches: taskMatches(), grouping, onGroup: nextGrouping,
        onPick: (id) => setTaskFilter(id), onMore: onMoreLists, onOpen: onOpenTask, quick, showDone,
        isOpenSection: (key) => openSections.has(key), toggle: (key, open) => toggleGroup(key, open, () => { if (open) openSections.delete(key); else openSections.add(key); }),
        flip: (key, hiding) => toggleGroup(key, hiding, () => { if (openSections.has(key)) openSections.delete(key); else openSections.add(key); }),
        keepRows: (key, rows) => groupNodes.set(key, rows), project: currentProject(), projects: projectList, projectActions,
        view: viewStore.get(), people: peopleList, counterparties: counterpartyList, onResetView: () => viewStore.reset(),
        pulseConfig: limits.pulse, onOpenProject: (id) => setProject(id) }));
    } else if (mode === 'conversations' && !inside) {
      // The queue (CONCEPT.md §2.5, §5): the newest moment on top, the oldest at the bottom by the input. Above it the
      // «Архив» divider: open, the last handled conversations stand right above it, earlier ones higher, five at a time.
      const shown = convList.filter((item) => item.views.some(tagged));
      const waiting = queueList(shown);
      const config = queueConfig();
      const hotHours = (limits.pulse ?? PULSE_DEFAULTS).hot_wait_hours;
      const tile = (item, inArchive) => convRow(item, { now, hotHours, counterparties: counterpartyList, archived: inArchive, decorate: inArchive ? null : convQuick?.decorate, on: {
        open: (key) => (onOpenConversation ?? openConversation)(key),
        task: (id) => onOpenTask(id),
        newTask: (title) => convQuick?.newTask(item, title),
        snooze: (anchor) => snoozeMenu(anchor, { config, onPick: (until) => convQuick?.snooze(item, until) }),
        requeue: () => convQuick?.requeue(item),
      } });
      children.push(...archive.nodes(archiveList(shown), (item) => tile(item, true)));
      for (const item of waiting) children.push(tile(item, false));
      if (!waiting.length) empty(filtered ? 'Под фильтр ничего не подходит.' : 'Очередь пуста — всё разобрано. Новые сообщения появятся здесь, внизу.');
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
    const chipsLeft = list.querySelector('.task-lists')?.scrollLeft ?? 0; // live redraws keep the chips where they were
    // Off the bottom, a redraw (a live message, older history, the archive) keeps the row on screen where it was.
    const held = !readsDown() && rendered && !nearBottom && !pin ? pinRow() : null;
    list.replaceChildren(...children);
    const chipsRow = list.querySelector('.task-lists');
    if (chipsRow) chipsRow.scrollLeft = chipsLeft;
    list.classList.toggle('reads-down', readsDown()); // a list starts at the top, a chat at the bottom
    const anchor = keep && list.querySelector(`[data-group="${CSS.escape(keep.key)}"]`);
    if (anchor) scroller.scrollTop += anchor.getBoundingClientRect().top - keep.top;
    else if (readsDown()) { if (top !== false) scroller.scrollTop = typeof top === 'number' ? top : 0; }
    else if (pin && putBack(scroller, list, pin)) { /* the row stays where it was */ }
    else if (bottom || nearBottom || !rendered) {
      // A new message slides in and the feed glides to it; the first paint goes straight to the bottom.
      const fresh = !quiet && newcomers.length && newcomers.length <= 3;
      scroller.scrollTo({ top: scroller.scrollHeight, behavior: fresh && !reduced() ? 'smooth' : 'auto' });
    } else if (held) putBack(scroller, list, held);
    if (reveal) archive.reveal();
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

  let stick = true; // the reader is at the bottom: keep them there when photos finish loading
  scroller.addEventListener('scroll', () => {
    const atEnd = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < NEAR_BOTTOM;
    stick = !readsDown() && atEnd;
    // The queue pulls no history on its scroll (feedpage.js fills it; the open archive grows — convarchive.js).
    if (inQueue()) return;
    if (readsDown() ? atEnd : scroller.scrollTop < NEAR_TOP) loadOlder(); // a list reaches older history at its end
  }, { passive: true });
  list.addEventListener('load', () => { if (stick) scroller.scrollTop = scroller.scrollHeight; }, true);
  // The keyboard opening or closing resizes the feed: keep the last message glued to the composer.
  new ResizeObserver(() => { if (stick && !readsDown()) scroller.scrollTop = scroller.scrollHeight; }).observe(scroller);
  // A live event from any device: cache it like a fetched page and redraw.
  // Updates from outside wait while a project form or a list of choices in the centre is in use (holdrender.js).
  const draw = holdRender(list, render);
  async function receive(event) {
    await cacheEvents([event]);
    await draw();
  }

  // Opens a conversation (or, with null, goes back to the list where it was); in Задачи and Лента it filters.
  async function openConversation(key) {
    const next = key || null;
    if (next === conversationKey) return;
    const entering = mode === 'conversations' && next && !conversationKey;
    const leaving = mode === 'conversations' && !next && conversationKey;
    if (entering) listPin = pinRow();
    conversationKey = next;
    stick = Boolean(next) && mode !== 'tasks';
    await render(leaving ? { pin: listPin, quiet: true } : { bottom: true, top: true, quiet: true });
    if (entering || leaving) play(list, [{ opacity: 0, transform: `translateX(${entering ? 24 : -24}px)` }, { opacity: 1, transform: 'none' }]);
  }

  function setShowArchive(value) { showArchive = value; return render(); }
  function setTagFilter(tags) { tagFilter = new Set(tags); return render({ bottom: true, top: true }); }
  function setShowDone(value) { showDone = value; return render(); }
  function setSourceFilter(key) { sourceFilter = key || null; return render({ bottom: true, top: true }); }
  function setMode(next) {
    quick?.reset?.();
    const wanted = OLD_MODES[next] ?? next;
    mode = MODES.includes(wanted) ? wanted : 'conversations';
    stick = !readsDown();
    return render({ bottom: !readsDown(), top: true, quiet: true });
  }
  // Contact and tag filters match a task through any of its messages.
  const taskMatches = () => byMessages; // the project, people and counterparty are the view's (viewstate.js)
  const byMessages = (task) => (!conversationKey && !tagFilter.size) || task.messages.some((id) => {
    const view = views.get(id);
    return view && !view.deleted && (!conversationKey || convKeys.get(id) === conversationKey) && [...tagFilter].every((tag) => view.tags.includes(tag));
  });
  // A project in Задачи (null — back to the lists).
  function setProject(id) { quick?.reset?.(); if (id) viewStore.replace({ when: 'all', where: { project: id } }); else viewStore.reset(); return render({ top: true, quiet: true }); }
  viewStore.onChange(() => { quick?.reset?.(); void render({ top: true, quiet: true }); });
  function setTaskFilter(id) {
    quick?.reset?.();
    taskFilterId = id;
    try { localStorage.setItem('stream.taskFilter.v3', id); } catch { /* storage may be blocked */ }
    return render({ top: true });
  }
  // Messages of one task, oldest first, for its details (details.js).
  const taskViews = (taskId) => { const task = taskList.find((item) => item.id === taskId); return task ? taskMembers(task, viewList) : []; };

  // The view switch on «Беседы» counts tasks for today.
  const pulseTotal = () => pulseCount(pulseBlocks({ tasks: taskList, now: new Date(), config: limits.pulse ?? PULSE_DEFAULTS }));

  return { pulseCount: pulseTotal, refresh, render: draw, receive, jump, setShowArchive, setTagFilter, tagFilter: () => [...tagFilter], setMode, mode: () => mode, taskViews, setTaskFilter, taskFilter, taskFilters: () => taskFilters, taskMatches,
    task: (id) => taskList.find((task) => task.id === id),
    openConversation, conversation: () => current, queueConfig, conversationKey: () => conversationKey, conversations: () => convList,
    setSourceFilter, sourceFilter: () => sourceFilter, tasks: () => taskList,
    projects: () => projectList, project: currentProject, setProject, people: () => peopleList, counterparties: () => counterpartyList,
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
