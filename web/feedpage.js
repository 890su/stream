// Where the centre's messages come from: media files (a queued blob or /api/media, one object URL each) and
// pages of the journal (/api/events: the latest on refresh, older ones when the reader reaches the end).
import { cacheEvents, getSetting } from './db.js';

export function createMediaLoader() {
  const urls = new Map(); // media id -> object URL, kept for the page lifetime
  return async function load(reference, queued) {
    if (urls.has(reference.media_id)) return urls.get(reference.media_id);
    let blob = queued?.files.find((file) => file.id === reference.media_id)?.blob;
    if (!blob) {
      const response = await fetch(`/api/media/${reference.media_id}`, { headers: { Authorization: `Bearer ${await getSetting('ownerToken')}` } });
      if (!response.ok) throw new Error('Файл пока недоступен. Проверьте сеть и токен');
      blob = await response.blob();
    }
    const url = URL.createObjectURL(blob);
    urls.set(reference.media_id, url);
    return url;
  };
}

// `render` redraws the centre and keeps the reader's place (feed.js); `fillSince()` — how far back the history must
// reach right away (the queue's start: a conversation waiting since then must not wait for a scroll to show up).
// Pages of older history arrive at the top of a chat; in the queue they would add tiles anywhere — so the queue is
// filled once, quietly, and its scroll no longer pulls history (only the opened archive does, through loadOlder).
export function createPager({ scroller, historyState, notify, render, fillSince = () => null }) {
  let before;
  let loadingOlder = false;
  let refreshing;

  async function fetchPage(older, limit = null) {
    const token = await getSetting('ownerToken');
    if (!token || !navigator.onLine) return false;
    const params = new URLSearchParams();
    if (older && before) params.set('before', before);
    if (limit) params.set('limit', String(limit));
    const query = params.size ? `?${params}` : '';
    const response = await fetch(`/api/events${query}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error(response.status === 401 ? 'Токен не принят. Откройте ⋮ → Доступ' : 'Лента временно недоступна');
    const page = await response.json();
    await cacheEvents(page.events);
    // People, counterparties, projects and task changes in full: older ones may lie beyond the first page.
    if (!older) {
      const directory = await fetch('/api/directory', { headers: { Authorization: `Bearer ${token}` } });
      if (directory.ok) await cacheEvents((await directory.json()).events);
    }
    if (older || before === undefined) before = page.next_before;
    return true;
  }

  function refresh() {
    refreshing ??= (async () => {
      try { await fetchPage(false); } catch (error) { notify(error.message); }
      await render();
      await fill();
      // A short chat cannot be scrolled to the top, so fetch older history right away.
      if (before && scroller.scrollHeight <= scroller.clientHeight) await loadOlder();
    })().finally(() => { refreshing = undefined; });
    return refreshing;
  }

  // Older pages back to `fillSince()`, in big pages and with one redraw at the end.
  async function fill() {
    const since = fillSince();
    if (!since || loadingOlder) return;
    loadingOlder = true;
    let fetched = false;
    try {
      while (before && Date.parse(before) > Date.parse(since)) { if (!await fetchPage(true, 100)) break; fetched = true; }
    } catch (error) { notify(error.message); }
    finally { loadingOlder = false; }
    if (fetched) await render({ quiet: true });
  }

  async function loadOlder() {
    if (loadingOlder || !before) return;
    loadingOlder = true;
    historyState.hidden = false;
    historyState.textContent = 'Загружаем раньше…';
    try {
      await fetchPage(true);
      await render({ quiet: true });
    } catch (error) { notify(error.message); }
    finally { loadingOlder = false; historyState.hidden = true; }
  }

  return { refresh, loadOlder, hasOlder: () => Boolean(before) };
}
