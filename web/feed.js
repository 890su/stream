// The centre of the screen (CONCEPT.md §5): the conversation queue (home, queuehome.js), one conversation (its task
// plaques on top, its messages in a row), the dashboard («Сейчас», dashboard.js, from «Задачи» in the left panel),
// Задачи (a task list by the panel's filter) and Лента (all messages in a row: bursts, chains, day pills); filters,
// paging and live updates. A redraw keeps the row the reader looks at where it was; back from a conversation the
// queue shows the tile it was opened from.
import { listEntries, cachedEvents, cacheEvents } from './db.js';
import { createMediaLoader, createPager } from './feedpage.js';
import { createBubble, bubbleSignature } from './bubble.js';
import { project, bursts, chains, sourceKey } from './projection.js';
import { foldTasks, tasksByMessage, questionsByMessage, isOpen, taskMembers } from './taskfold.js';
import { questionOptions } from './question.js';
import { aiQuestionsByMessage } from './questions.js';
import { proposalsByMessage, proposalOptions } from './proposals.js';
import { GROUPINGS } from './tasklist.js';
import { taskViewNodes } from './taskview.js';
import { pulseBlocks, pulseCount, PULSE_DEFAULTS } from './pulse.js';
import { dashboardNodes } from './dashboard.js';
import { createQueueHome } from './queuehome.js';
import { foldPeople, foldCounterparties, markCounterparties } from './contacts.js';
import { viewStore } from './viewstore.js';
import { foldProjects, markNext } from './projects.js';
import { holdRender } from './holdrender.js';
import { dayKey, dayLabel } from './days.js';
import { conversations, conversationKeys } from './conversations.js';
import { queueList } from './queue.js';
import { linkMarks } from './linkmark.js';
import { rowOnScreen, putBack } from './scrollpin.js';
import { cutSegments } from './topic.js';
import { grow, shrink, reduced, play } from './motion.js';

const NEAR_BOTTOM = 120;
const NEAR_TOP = 160;
const MODES = ['home', 'now', 'conversations', 'tasks', 'feed']; // home — the queue (queuehome.js), now — the dashboard
const OLD_MODES = { cases: 'conversations', messages: 'feed' }; // views saved by earlier versions
const DEFAULT_CONVERSATIONS = { queue: { since: '2026-11-13T00:00:00Z', snooze: { minutes: [15, 60, 180], noon: { hour: 12, until_hour: 11 }, evening: { hour: 18, until_hour: 17 },
  tomorrow_day: { hour: 13, from_hour: 17 }, morning: { hour: 9 } } } };

export function setupFeed({ notify, onQueue, limits, onRender = () => {}, onOpenTask = () => {}, onOpenConversation = () => {}, taskCard = () => null, quick = null, convQuick = null, onMoreLists = () => {}, projectActions = null }) {
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
  let openCuts = new Set(); // cuts of the open conversation the owner unfolded (topic.js keys)
  let allCuts = false; // «≡»: every cut unfolded
  let convList = []; // all conversations, each with its place in the queue (queue.js)
  let asked = new Map(); // the AI's waiting questions (v21 `ask`) by message (questions.js)
  let convKeys = new Map(); // message id -> conversation key (conversations.js)
  let taskList = []; // all tasks (CONCEPT.md §2.8), for the right panel
  let projectList = []; // all projects (CONCEPT.md §2.11)
  let peopleList = []; let counterpartyList = []; // the directory (contacts.js)
  // The project open in Задачи: the view's project when it shows all open tasks (viewstate.js, viewpanel.js).
  const currentProject = () => { const view = viewStore.get(); return (mode === 'tasks' && view.when === 'all' && projectList.find((item) => item.id === view.where?.project)) || null; };
  const openSections = new Set(); // Задачи: folded sections («Дальше») the owner unfolded
  let showDone = false; // Лента: messages of finished tasks shown (drawer.js)
  let mode = 'home';
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
  // Lists and the dashboard read from the top (the most important on top); a conversation and the Лента read from the
  // bottom, like a chat.
  const readsDown = () => mode === 'tasks' || mode === 'home' || mode === 'now' || (mode === 'conversations' && !conversationKey);
  const atQueue = () => mode === 'home' || (mode === 'conversations' && !conversationKey);
  let queuePin = null; // the queue's row on screen when a conversation or another view took the screen
  // The queue settings (registry/conversations.json); a cached registry of an older version has none.
  const queueConfig = () => (limits.conversations?.queue ? limits.conversations : DEFAULT_CONVERSATIONS);
  const load = createMediaLoader();
  const { refresh, loadOlder, hasOlder } = createPager({ scroller, historyState, notify, render: (...args) => draw(...args), fillSince: () => queueConfig().queue.since });

  const pinRow = (node) => rowOnScreen(scroller, list, node);
  const home = createQueueHome({ scroller, list, render: (options) => draw(options), active: atQueue, hasOlder, loadOlder, convQuick, limits,
    open: (key) => onOpenConversation(key), openTask: (id) => onOpenTask(id) });

  // `keep` — { key, top }: the header that was tapped stays where it was; `quiet` — no animation of new rows;
  // `top` — a list goes to the top (true) or to a remembered position (a number); `pin` — rowOnScreen(): that row stays
  // where it was; `reveal` — the queue's archive was just opened.
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
    const proposals = proposalsByMessage([...events.values()]); // the AI's proposals wait for the owner (proposals.js)
    asked = aiQuestionsByMessage([...events.values()]); // the AI's questions (v21 `ask`) hold their conversations in the queue
    for (const view of projected) {
      view.taskIds = byMessage.get(view.id) ?? [];
      view.links = linkMarks(view, tasksById); // «→ «…» ↩»: the triage's system links (linkmark.js)
      view.question = proposalOptions(view, proposals.get(view.id), tasksById) ?? questionOptions(view, questions.get(view.id), tasksById);
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
    convList = conversations(kept, taskList, { now, config: queueConfig(), keys: convKeys, questions: asked, proposals });
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
      item.classList.remove('in-cut'); // bubbles are cached: a tint from an unfolded cut must not stay
      children.push(item);
    }
    const empty = (text) => { const box = document.createElement('div'); box.className = 'empty'; box.textContent = text; children.push(box); };
    const filtered = Boolean((mode === 'feed' && sourceFilter) || tagFilter.size || conversationKey);
    if (atQueue()) {
      // The queue: the longest waiting on top, the archive under it (queuehome.js).
      children.push(...home.nodes({ conversations: convList, tags: [...tagFilter], counterparties: counterpartyList, questions: asked, now }));
    } else if (mode === 'now') {
      // The dashboard: in work on top, paused and next under it (dashboard.js).
      const viewsOf = (task) => task.messages.map((id) => views.get(id)).filter(Boolean);
      children.push(...dashboardNodes({ tasks: taskList, projects: projectList, viewsOf, now, quick, config: limits.pulse ?? PULSE_DEFAULTS, onOpen: onOpenTask }));
    } else if (mode === 'tasks') {
      // A saved list, or one project by its sections (taskview.js, CONCEPT.md §5, §2.11).
      const viewsOf = (task) => task.messages.map((id) => views.get(id)).filter(Boolean);
      children.push(...taskViewNodes({ tasks: taskList, viewsOf, now, filters: taskFilters, filter: taskFilter(), matches: taskMatches(), grouping, onGroup: nextGrouping,
        onPick: (id) => setTaskFilter(id), onMore: onMoreLists, onOpen: onOpenTask, quick, showDone,
        isOpenSection: (key) => openSections.has(key), toggle: (key, open) => toggleGroup(key, open, () => { if (open) openSections.delete(key); else openSections.add(key); }),
        flip: (key, hiding) => toggleGroup(key, hiding, () => { if (openSections.has(key)) openSections.delete(key); else openSections.add(key); }),
        keepRows: (key, rows) => groupNodes.set(key, rows), project: currentProject(), projects: projectList, projectActions,
        view: viewStore.get(), people: peopleList, counterparties: counterpartyList, onResetView: () => viewStore.reset(),
        pulseConfig: limits.pulse, onOpenProject: (id) => setProject(id) }));
    } else {
      // One conversation — its messages in segments: open ones and cuts by task (topic.js); the Лента — in a row.
      if (inside && current) {
        for (const segment of cutSegments(visible, { tasksById, open: openCuts, all: allCuts, keep: new Set((current.queue?.pending ?? []).map((view) => view.id)) })) {
          if (segment.kind === 'cut') children.push(cutLine(segment));
          if (segment.kind === 'cut' && !segment.open) continue;
          const from = children.length;
          for (const group of bursts(segment.views)) renderGroup(group);
          if (segment.kind === 'cut') for (const item of children.slice(from)) item.classList.add('in-cut');
        }
      } else for (const group of bursts(visible)) renderGroup(group);
      // «Задача выполнена?» — after the conversation's messages (CONCEPT.md §2.9).
      if (inside && current) for (const task of current.tasks) { const card = taskCard(task); if (card) children.push(card); }
      if (!visible.length) empty(inside ? 'В этой беседе нет сообщений.' : filtered ? 'Под фильтр ничего не подходит.'
        : showArchive || !projected.length ? 'Здесь появятся ваши записи. Напишите, наговорите голосом или приложите фото.'
        : 'Все сообщения в архиве. Показать их: ⋮ → «Показывать архив».');
    }
    const chipsLeft = list.querySelector('.task-lists')?.scrollLeft ?? 0; // live redraws keep the chips where they were
    // Off the bottom, a redraw (a live message, older history, the archive) keeps the row on screen where it was.
    const held = rendered && !pin && (readsDown() ? atQueue() && top === false && scroller.scrollTop > NEAR_BOTTOM : !nearBottom) ? pinRow() : null;
    list.replaceChildren(...children);
    const chipsRow = list.querySelector('.task-lists');
    if (chipsRow) chipsRow.scrollLeft = chipsLeft;
    list.classList.toggle('reads-down', readsDown()); // a list starts at the top, a chat at the bottom
    const anchor = keep && list.querySelector(`[data-group="${CSS.escape(keep.key)}"]`);
    if (anchor) scroller.scrollTop += anchor.getBoundingClientRect().top - keep.top;
    else if (pin && putBack(scroller, list, pin)) { /* the row stays where it was */ }
    else if (readsDown()) { if (top !== false) scroller.scrollTop = typeof top === 'number' ? top : 0; else if (held) putBack(scroller, list, held); }
    else if (bottom || nearBottom || !rendered) {
      // A new message slides in and the feed glides to it; the first paint goes straight to the bottom.
      const fresh = !quiet && newcomers.length && newcomers.length <= 3;
      scroller.scrollTo({ top: scroller.scrollHeight, behavior: fresh && !reduced() ? 'smooth' : 'auto' });
    } else if (held) putBack(scroller, list, held);
    if (!quiet && newcomers.length <= 3) {
      for (const id of newcomers) { const node = nodes.get(id)?.node; if (node?.isConnected) play(node, [{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }]); }
    }
    if (reveal && atQueue()) home.reveal();
    rendered = true;
    onRender();
  }

  // A cut (design 2026-11-21): a centred line «Задача · 3» between thin rules; a tap folds or unfolds it in place.
  function cutLine(segment) {
    const line = document.createElement('button');
    line.type = 'button';
    line.className = `cut${segment.open ? ' open' : ''}`;
    line.dataset.row = `cut:${segment.key}`;
    line.setAttribute('aria-expanded', String(segment.open));
    const label = document.createElement('span');
    label.textContent = `${segment.title} · ${segment.views.length}`;
    line.append(label);
    line.onclick = () => {
      if (!segment.open) openCuts.add(segment.key);
      else if (allCuts) { allCuts = false; for (const key of keysOnScreen()) if (key !== segment.key) openCuts.add(key); }
      else openCuts.delete(segment.key);
      void render({ quiet: true, pin: rowOnScreen(scroller, list, line) });
    };
    return line;
  }
  const keysOnScreen = () => [...list.querySelectorAll('.cut')].map((node) => node.dataset.row.slice(4));

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
    if (mode === 'now' || atQueue()) return; // the queue fills itself (feedpage.js), its archive grows by itself
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

  // Opens a conversation (with null it closes, and Беседы give the screen back to the queue, on the tile it was
  // opened from); in Задачи and Лента it filters.
  async function openConversation(key) {
    const next = key || null;
    if (next === conversationKey) return;
    const entering = mode === 'conversations' && next && !conversationKey;
    // The system back may switch the view home before the conversation closes (app.js): leaving all the same.
    const leaving = (mode === 'conversations' || mode === 'home') && !next && conversationKey;
    if (leaving) mode = 'home';
    if (entering && atQueue()) queuePin = pinRow();
    conversationKey = next;
    openCuts = new Set(); allCuts = false; // each conversation opens folded
    stick = Boolean(next) && mode !== 'tasks';
    const pin = leaving ? queuePin : null;
    await render({ bottom: true, top: true, quiet: true, pin });
    if (entering || leaving) play(list, [{ opacity: 0, transform: `translateX(${entering ? 24 : -24}px)` }, { opacity: 1, transform: 'none' }]);
  }

  function setShowArchive(value) { showArchive = value; return render(); }
  function setTagFilter(tags) { tagFilter = new Set(tags); return render({ bottom: true, top: true }); }
  function setShowDone(value) { showDone = value; return render(); }
  function setSourceFilter(key) { sourceFilter = key || null; return render({ bottom: true, top: true }); }
  function setMode(next) {
    quick?.reset?.();
    const wanted = OLD_MODES[next] ?? next;
    if (atQueue()) queuePin = pinRow(); // the queue stays where it was read, and comes back there
    mode = MODES.includes(wanted) ? wanted : 'home';
    stick = !readsDown();
    const pin = atQueue() ? queuePin : null;
    return render({ bottom: !readsDown(), top: true, quiet: true, pin });
  }
  // Contact and tag filters match a task through any of its messages.
  const taskMatches = () => byMessages; // the project, people and counterparty are the view's (viewstate.js)
  const byMessages = (task) => (!conversationKey && !tagFilter.size) || task.messages.some((id) => {
    const view = views.get(id);
    return view && !view.deleted && (!conversationKey || convKeys.get(id) === conversationKey) && [...tagFilter].every((tag) => view.tags.includes(tag));
  });
  // A project in Задачи (null — back to the lists).
  function setProject(id) { quick?.reset?.(); if (id) viewStore.replace({ when: 'all', whose: 'all', where: { project: id } }); else viewStore.reset(); return render({ top: true, quiet: true }); }
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

  return { pulseCount: pulseTotal, refresh, loadOlder, hasOlder, render: draw, receive, jump, setShowArchive, setTagFilter, tagFilter: () => [...tagFilter], setMode, mode: () => mode, taskViews, setTaskFilter, taskFilter, taskFilters: () => taskFilters, taskMatches,
    task: (id) => taskList.find((task) => task.id === id),
    openConversation, conversation: () => current, queueConfig, conversationKey: () => conversationKey, conversations: () => convList,
    questions: () => asked, waitingCount: () => queueList(convList).length,
    setSourceFilter, sourceFilter: () => sourceFilter, tasks: () => taskList,
    projects: () => projectList, project: currentProject, setProject, people: () => peopleList, counterparties: () => counterpartyList,
    setShowDone, showDone: () => showDone,
    allCuts: () => allCuts, setAllCuts: (value) => { allCuts = value; if (!value) openCuts = new Set(); return render({ quiet: true, pin: pinRow() }); },
    showArchive: () => showArchive, nextLinked: (id) => visibleList.find((view) => view.continues === id),
    view: (id) => views.get(id), views: () => viewList,
    chain: (id) => chains(visibleList).get(id),
    // A fresh bubble for another surface (details): same rendering and media loading, no feed bookkeeping.
    bubble: (view) => createBubble(view, undefined, { load: (reference) => load(reference), notify, jump, limits }),
    previous: (id) => visibleList[visibleList.findIndex((view) => view.id === id) - 1],
    latest: () => visibleList.at(-1),
    visible: () => visibleList, scrollToBottom: () => { scroller.scrollTop = scroller.scrollHeight; } };
}
