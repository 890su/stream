import { listEntries, cachedEvents, cacheEvents, getSetting } from './db.js';
import { createBubble, bubbleSignature } from './bubble.js';

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

// Like a chat: by the moment the message was written on the phone; server order breaks ties.
function chronological(a, b) {
  const byTime = Date.parse(a.ts) - Date.parse(b.ts);
  if (byTime) return byTime;
  return (a.received_at ?? '￿').localeCompare(b.received_at ?? '￿');
}

export function setupFeed({ notify, onQueue }) {
  const scroller = document.querySelector('#messages');
  const list = document.querySelector('#feed-list');
  const historyState = document.querySelector('#history-state');
  const nodes = new Map(); // event id -> { node, signature }
  const mediaUrls = new Map(); // media id -> object URL, kept for the page lifetime
  let before;
  let loadingOlder = false;
  let refreshing;
  let rendered = false;

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
    const sorted = [...events.values()].sort(chronological);
    onQueue({ total: queued.length, failed: queued.filter((entry) => entry.error).length });

    const nearBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < NEAR_BOTTOM;
    const children = [];
    let lastDay;
    for (const event of sorted) {
      const date = new Date(event.ts);
      if (dayKey(date) !== lastDay) {
        lastDay = dayKey(date);
        const pill = document.createElement('div');
        pill.className = 'date-pill';
        pill.textContent = dayLabel(date);
        children.push(pill);
      }
      const queuedEntry = pending.get(event.id);
      const signature = bubbleSignature(event, queuedEntry);
      let cached = nodes.get(event.id);
      if (!cached || cached.signature !== signature) {
        cached = { signature, node: createBubble(event, queuedEntry, { load: (reference) => load(reference, queuedEntry), notify }) };
        nodes.set(event.id, cached);
      }
      children.push(cached.node);
    }
    if (!sorted.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'Здесь появятся ваши записи. Напишите, наговорите голосом или приложите фото.';
      children.push(empty);
    }
    list.replaceChildren(...children);
    if (bottom || nearBottom || !rendered) scroller.scrollTop = scroller.scrollHeight;
    rendered = true;
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
  return { refresh, render, scrollToBottom: () => { scroller.scrollTop = scroller.scrollHeight; } };
}
