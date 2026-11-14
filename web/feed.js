import { listEntries, cachedEvents, cacheEvents, getSetting } from './db.js';
import { createBubble, bubbleSignature } from './bubble.js';
import { project, bursts, chains } from './projection.js';

const dayFormat = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'long' });
const dayFormatYear = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'long', year: 'numeric' });
const NEAR_BOTTOM = 120;
const NEAR_TOP = 160;

function dayKey(date) { return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`; }
function dayLabel(date) {
  const today = new Date();
  const yesterday = new Date(); yesterday.setDate(today.getDate() - 1);
  if (dayKey(date) === dayKey(today)) return 'Сегодня';
  if (dayKey(date) === dayKey(yesterday)) return 'Вчера';
  return (date.getFullYear() === today.getFullYear() ? dayFormat : dayFormatYear).format(date);
}

export function setupFeed({ notify, onQueue, limits }) {
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

  async function render({ bottom = false } = {}) {
    const queued = await listEntries();
    const pending = new Map(queued.map((entry) => [entry.event.id, entry]));
    const events = new Map((await cachedEvents()).map((event) => [event.id, event]));
    for (const entry of queued) events.set(entry.event.id, entry.event);
    const projected = project([...events.values()], new Set(pending.keys()));
    views = new Map(projected.map((view) => [view.id, view]));
    viewList = projected;
    const visible = projected.filter((view) => !view.deleted && (showArchive || !view.archived));
    visibleList = visible;
    onQueue({ total: queued.length, failed: queued.filter((entry) => entry.error).length });

    const nearBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < NEAR_BOTTOM;
    const children = [];
    const chainOf = chains(visible);
    // The topic line goes once per bubble: on its first part.
    const node = (view, first = true) => {
      const queuedEntry = pending.get(view.id);
      const chain = first ? chainOf.get(view.id) : undefined;
      const signature = bubbleSignature(view, queuedEntry, chain);
      let cached = nodes.get(view.id);
      if (!cached || cached.signature !== signature) {
        cached = { signature, node: createBubble(view, queuedEntry, { load: (reference) => load(reference, queuedEntry), notify, jump, chain, limits }) };
        nodes.set(view.id, cached);
      }
      return cached.node;
    };
    let lastDay;
    let lastTs = 0;
    // A message and its continuations share one bubble; each keeps its own actions and history.
    // Messages close in time only stand closer together (time alone is not a connection).
    for (const group of bursts(visible)) {
      const date = new Date(group[0].event.ts);
      if (dayKey(date) !== lastDay) {
        lastDay = dayKey(date);
        const pill = document.createElement('div');
        pill.className = 'date-pill';
        pill.textContent = dayLabel(date);
        children.push(pill);
      }
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
    if (!visible.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = showArchive || !projected.length
        ? 'Здесь появятся ваши записи. Напишите, наговорите голосом или приложите фото.'
        : 'Все сообщения в архиве. Показать их: ⋮ → «Показывать архив».';
      children.push(empty);
    }
    list.replaceChildren(...children);
    if (bottom || nearBottom || !rendered) scroller.scrollTop = scroller.scrollHeight;
    rendered = true;
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
      await render();
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

  return { refresh, render, receive, jump, setShowArchive, view: (id) => views.get(id), views: () => viewList,
    chain: (id) => chains(visibleList).get(id),
    previous: (id) => visibleList[visibleList.findIndex((view) => view.id === id) - 1],
    latest: () => visibleList.at(-1), scrollToBottom: () => { scroller.scrollTop = scroller.scrollHeight; } };
}
