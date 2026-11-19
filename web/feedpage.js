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

// `render` redraws the centre; `readsDown` — a list (reads from the top) rather than a chat (from the bottom).
export function createPager({ scroller, historyState, notify, render, readsDown }) {
  let before;
  let loadingOlder = false;
  let refreshing;

  async function fetchPage(older) {
    const token = await getSetting('ownerToken');
    if (!token || !navigator.onLine) return false;
    const query = older && before ? `?before=${encodeURIComponent(before)}` : '';
    const response = await fetch(`/api/events${query}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error(response.status === 401 ? 'Токен не принят. Откройте ⋮ → Доступ' : 'Лента временно недоступна');
    const page = await response.json();
    await cacheEvents(page.events);
    // People, counterparties and projects in full (contacts design §3): older ones may lie beyond the first page.
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

  return { refresh, loadOlder };
}
