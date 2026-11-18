// The centre of the screen (CONCEPT.md §5) in three views: Лента (messages in a row: bursts, chains, day pills,
// folded finished tasks), Дела (cases, §2.9) and Задачи (a task list); filters, paging and live updates.
import { listEntries, cachedEvents, cacheEvents, getSetting } from './db.js';
import { createBubble, bubbleSignature } from './bubble.js';
import { project, bursts, chains, sourceKey, chatOf } from './projection.js';
import { foldTasks, tasksByMessage, doneStage, visibleTasks, questionsByMessage } from './taskfold.js';
import { questionOptions } from './question.js';
import { taskRow, emptyTasks } from './tasklist.js';
import { dayKey, dayLabel } from './days.js';
import { feedItems, shownViews, caseMembers } from './cases.js';
import { caseHeader } from './caserow.js';
import { grow, shrink, reduced, play } from './motion.js';

const NEAR_BOTTOM = 120;
const NEAR_TOP = 160;

export function setupFeed({ notify, onQueue, limits, onRender = () => {}, onOpenCase = () => {}, caseCard = () => null }) {
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
  let tagFilter = new Set(); // feed shows messages carrying every selected tag (drawer.js)
  let sourceFilter = null; // 'me' | 'telegram:by' | 'phone' | 'system'… (drawer.js)
  let chatFilter = null; // one messenger chat { key, account, chat_id, title } (app.js, chat bar)
  let taskList = []; // all tasks (CONCEPT.md §2.8), for the right panel
  let showDone = false; // messages of long-finished tasks are hidden unless this is on (drawer.js)
  const expanded = new Set(); // folded rows of finished tasks the reader opened
  let mode = 'cases'; // 'feed' — messages in a row, 'cases' — the feed of cases, 'tasks' — the task list (CONCEPT.md §5)
  let taskFilter = { who: 'me', done: false, due: 'all' }; // the «Задачи» view's own filters (drawer.js)
  const caseState = new Map(); // task id -> { state: 'all' | 'none', at } — the reader's choice under a case header
  let groupNodes = new Map(); // 'case:<task>' | 'done:<tasks>' -> rows under that header, for smooth folding

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

  // `keep` — { key, top }: the header that was tapped stays where it was; `quiet` — no animation of new rows.
  async function render({ bottom = false, keep = null, quiet = false, top = false } = {}) {
    const queued = await listEntries();
    const pending = new Map(queued.map((entry) => [entry.event.id, entry]));
    const events = new Map((await cachedEvents()).map((event) => [event.id, event]));
    for (const entry of queued) events.set(entry.event.id, entry.event);
    const projected = project([...events.values()], new Set(pending.keys()));
    taskList = foldTasks([...events.values()]);
    const byMessage = tasksByMessage(taskList);
    const tasksById = new Map(taskList.map((task) => [task.id, task]));
    const now = new Date();
    const questions = questionsByMessage([...events.values()]);
    for (const view of projected) {
      view.taskIds = byMessage.get(view.id) ?? [];
      view.question = questionOptions(view, questions.get(view.id), tasksById);
      view.doneStage = doneStage(view.taskIds, tasksById, now, limits.tasks?.done_fade_days ?? 2);
    }
    views = new Map(projected.map((view) => [view.id, view]));
    viewList = projected;
    // Archived topics hide all their messages, like archived messages, until "show archived" is on.
    const live = projected.filter((view) => !view.deleted);
    const allChains = chains(live);
    const inArchivedTopic = (view) => allChains.get(view.id)?.archived;
    const tagged = (view) => [...tagFilter].every((tag) => view.tags.includes(tag));
    const inSource = (view) => !sourceFilter || sourceKey(view.event) === sourceFilter;
    const inChat = (view) => !chatFilter || chatOf(view.event)?.key === chatFilter.key;
    // Finished long ago: out of the feed unless «Завершённые» is on (CONCEPT.md §2.8).
    const shown = (view) => showDone || view.doneStage !== 'hidden';
    const visible = live.filter((view) => (showArchive || (!view.archived && !inArchivedTopic(view))) && tagged(view) && inSource(view) && inChat(view) && shown(view));
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
    // Messages whose tasks are all finished fold into one row per task set (CONCEPT.md §2.8).
    const foldKey = (group) => (group.every((view) => view.doneStage) ? group[0].taskIds.slice().sort().join(',') : null);
    const items = [];
    for (const group of bursts(visible)) {
      const key = foldKey(group);
      const previous = items.at(-1);
      if (key && previous?.key === key) previous.views.push(...group);
      else items.push({ key, group, views: [...group] });
    }
    const foldRow = (item) => {
      const titles = [...new Set(item.views[0].taskIds.map((id) => tasksById.get(id)?.title).filter(Boolean))];
      const faded = item.views.every((view) => view.doneStage !== 'collapsed');
      const open = expanded.has(item.key);
      const row = document.createElement('button');
      row.type = 'button';
      row.className = `done-row${faded ? ' faded' : ''}${open ? ' open' : ''}`;
      row.dataset.group = `done:${item.key}`;
      row.textContent = `${open ? '▾' : '▸'} ✓ ${titles.join(' · ')} · ${item.views.length} сообщ.`;
      row.setAttribute('aria-expanded', String(open));
      row.onclick = () => toggleGroup(`done:${item.key}`, open, () => { if (open) expanded.delete(item.key); else expanded.add(item.key); });
      return row;
    };
    if (mode === 'feed') for (const entry of items) {
      if (entry.key) {
        pill(new Date(entry.views[0].event.ts));
        lastTs = Date.parse(entry.views.at(-1).event.ts);
        children.push(foldRow(entry));
        if (!expanded.has(entry.key)) continue;
      }
      const groups = entry.key ? bursts(entry.views) : [entry.group];
      for (const group of groups) renderGroup(group, Boolean(entry.key) && entry.views.every((view) => view.doneStage !== 'collapsed'), false, entry.key ? `done:${entry.key}` : null);
    }
    if (mode === 'cases') renderCases();
    if (mode === 'tasks') renderTasks();
    // Tasks: one row each; contact and tags match a task through any of its messages.
    function renderTasks() {
      const matches = (task) => (!chatFilter && !tagFilter.size) || task.messages.some((id) => {
        const view = views.get(id);
        return view && !view.deleted && (!chatFilter || chatOf(view.event)?.key === chatFilter.key) && tagged(view);
      });
      const shownTasks = visibleTasks(taskList, { ...taskFilter, matches, now });
      for (const task of shownTasks) {
        children.push(taskRow(task, task.messages.map((id) => views.get(id)).filter(Boolean), { onOpen: onOpenCase, showAssignee: taskFilter.who === 'all' }));
      }
      if (!shownTasks.length) children.push(emptyTasks(taskFilter.done, taskFilter.who));
    }
    // Cases: a header, then fresh or chosen messages; messages without a task in between, as they are.
    function renderCases() {
      const now = Date.now();
      const options = { now, freshH: limits.tasks?.fresh_h ?? 6, expandLast: limits.tasks?.expand_last ?? 10 };
      let run = [];
      const flush = () => { for (const group of bursts(run)) renderGroup(group, false); run = []; };
      for (const item of feedItems(visible, tasksById, { now: new Date(now), fadeDays: limits.tasks?.done_fade_days ?? 2, showDone })) {
        if (item.kind === 'message') { run.push(item.view); continue; }
        flush();
        const id = item.task.id;
        const chosen = caseState.get(id);
        // «Hide» lasts until the case gets a new message.
        const state = chosen?.state === 'none' && item.last > chosen.at ? undefined : chosen?.state;
        const views = shownViews(item, state, options);
        pill(new Date(item.last));
        lastTs = item.last;
        children.push(caseHeader(item, { shown: views.length, onOpen: () => onOpenCase(id),
          onToggle: () => toggleGroup(`case:${id}`, views.length > 0, () => caseState.set(id, { state: views.length ? 'none' : 'all', at: item.last })) }));
        for (const group of bursts(views)) renderGroup(group, item.stage === 'faded', true, `case:${id}`);
        // «Задача выполнена?» — last in the case, whatever is folded (CONCEPT.md §2.9).
        const card = caseCard(item.task);
        if (card) { card.classList.add('in-case'); children.push(card); }
      }
      flush();
    }
    function renderGroup(group, dim, inCase = false, groupKey = null) {
      if (!inCase) pill(new Date(group[0].event.ts));
      const close = Date.parse(group[0].event.ts) - lastTs <= limits.burst_gap_min * 60000;
      lastTs = Date.parse(group.at(-1).event.ts);
      let item;
      if (group.length === 1) item = node(group[0]);
      else {
        item = document.createElement('div');
        item.className = 'burst';
        item.append(...group.map((view, index) => node(view, index === 0)));
      }
      item.classList.toggle('close', inCase || (close && children.at(-1)?.className !== 'date-pill'));
      item.classList.toggle('done-dim', dim);
      item.classList.toggle('in-case', inCase);
      if (groupKey) groupNodes.set(groupKey, [...(groupNodes.get(groupKey) ?? []), item]);
      children.push(item);
    }
    if (!visible.length && mode !== 'tasks') {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = chatFilter || sourceFilter || tagFilter.size ? 'Под фильтр ничего не подходит.'
        : showArchive || !projected.length
        ? 'Здесь появятся ваши записи. Напишите, наговорите голосом или приложите фото.'
        : 'Все сообщения в архиве. Показать их: ⋮ → «Показывать архив».';
      children.push(empty);
    }
    list.replaceChildren(...children);
    const anchor = keep && list.querySelector(`[data-group="${CSS.escape(keep.key)}"]`);
    if (anchor) scroller.scrollTop += anchor.getBoundingClientRect().top - keep.top;
    else if (mode === 'tasks') { if (top) scroller.scrollTop = 0; } // the task list reads from the top
    else if (bottom || nearBottom || !rendered) {
      // A new message slides in and the feed glides to it; the first paint goes straight to the bottom.
      const fresh = !quiet && newcomers.length && newcomers.length <= 3;
      scroller.scrollTo({ top: scroller.scrollHeight, behavior: fresh && !reduced() ? 'smooth' : 'auto' });
    }
    if (!quiet && newcomers.length <= 3) {
      for (const id of newcomers) { const node = nodes.get(id)?.node; if (node) play(node, [{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }]); }
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
    node.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
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
      scroller.scrollTop = scroller.scrollHeight - anchor; // keep the reading position
    } catch (error) { notify(error.message); }
    finally { loadingOlder = false; historyState.hidden = true; }
  }

  let stick = true; // the reader is at the bottom: keep them there when photos finish loading
  scroller.addEventListener('scroll', () => {
    stick = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < NEAR_BOTTOM;
    if (scroller.scrollTop < NEAR_TOP) loadOlder();
  }, { passive: true });
  list.addEventListener('load', () => { if (stick) scroller.scrollTop = scroller.scrollHeight; }, true);
  // The keyboard opening or closing resizes the feed: keep the last message glued to the composer.
  new ResizeObserver(() => { if (stick) scroller.scrollTop = scroller.scrollHeight; }).observe(scroller);
  // A live event from any device: cache it like a fetched page and redraw.
  async function receive(event) {
    await cacheEvents([event]);
    await render();
  }

  function setShowArchive(value) { showArchive = value; return render(); }
  function setTagFilter(tags) { tagFilter = new Set(tags); return render({ bottom: true }); }
  function setShowDone(value) { showDone = value; return render(); }
  function setSourceFilter(key) { sourceFilter = key || null; return render({ bottom: true }); }
  function setChatFilter(chat) { chatFilter = chat || null; return render({ bottom: true }); }
  function setMode(next) {
    mode = ['feed', 'cases', 'tasks'].includes(next) ? next : next === 'messages' ? 'feed' : 'cases';
    return render({ bottom: mode !== 'tasks', top: mode === 'tasks', quiet: true });
  }
  function setTaskFilter(change) { taskFilter = { ...taskFilter, ...change }; return render({ top: true }); }
  // Messages of one case, oldest first, for its details (details.js).
  const caseViews = (taskId) => { const task = taskList.find((item) => item.id === taskId); return task ? caseMembers(task, viewList) : []; };

  return { refresh, render, receive, jump, setShowArchive, setTagFilter, tagFilter: () => [...tagFilter], setMode, mode: () => mode, caseViews, setTaskFilter, taskFilter: () => taskFilter,
    task: (id) => taskList.find((task) => task.id === id),
    setSourceFilter, sourceFilter: () => sourceFilter, setChatFilter, chatFilter: () => chatFilter, tasks: () => taskList,
    setShowDone, showDone: () => showDone,
    showArchive: () => showArchive, nextLinked: (id) => visibleList.find((view) => view.continues === id),
    view: (id) => views.get(id), views: () => viewList,
    chain: (id) => chains(visibleList).get(id),
    // A fresh bubble for another surface (topic screen): same rendering and media loading, no feed bookkeeping.
    bubble: (view) => createBubble(view, undefined, { load: (reference) => load(reference), notify, jump, limits }),
    previous: (id) => visibleList[visibleList.findIndex((view) => view.id === id) - 1],
    latest: () => visibleList.at(-1),
    visible: () => visibleList, scrollToBottom: () => { scroller.scrollTop = scroller.scrollHeight; } };
}
