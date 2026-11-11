import { listEntries, cachedEvents, cacheEvents, getSetting } from './db.js';

const labels = { text: 'Текст', voice: 'Голос', photo: 'Фото', file: 'Файл', link: 'Ссылка' };
const formatter = new Intl.DateTimeFormat('ru', { dateStyle: 'short', timeStyle: 'short' });

export function setupFeed(notify) {
  const feed = document.querySelector('#feed-list');
  const more = document.querySelector('#more');
  const urls = new Set();
  let before;
  let rendering;
  let renderedSignature;

  function blobUrl(blob) {
    const url = URL.createObjectURL(blob);
    urls.add(url);
    return url;
  }

  function card(event, queued) {
    const article = document.createElement('article');
    const heading = document.createElement('div');
    heading.className = 'event-heading';
    const kind = document.createElement('strong');
    kind.textContent = labels[event.kind] ?? 'Событие';
    const time = document.createElement('time');
    time.dateTime = event.ts;
    time.textContent = formatter.format(new Date(event.ts));
    heading.append(kind, time);
    const status = document.createElement('p');
    status.className = queued?.error ? 'state error' : 'state';
    status.textContent = queued ? queued.error || 'В очереди' : 'Принято';
    article.append(heading, status);
    if (event.payload.text) {
      const body = document.createElement('p'); body.className = 'event-text'; body.textContent = event.payload.text; article.append(body);
    }
    if (event.payload.url) {
      try {
        const parsed = new URL(event.payload.url);
        if (['http:', 'https:'].includes(parsed.protocol)) {
          const link = document.createElement('a'); link.href = parsed.href; link.textContent = event.payload.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; article.append(link);
        }
      } catch { /* Malformed source URLs remain in the original journal payload. */ }
    }
    for (const reference of event.payload.media ?? []) {
      const button = document.createElement('button');
      button.className = 'secondary media-button';
      button.textContent = reference.mime.startsWith('audio/') ? 'Слушать запись' : reference.mime.startsWith('image/') ? 'Открыть фото' : 'Открыть файл';
      button.onclick = async () => {
        button.disabled = true;
        try {
          let blob = queued?.files.find((file) => file.id === reference.media_id)?.blob;
          if (!blob) {
            const response = await fetch(`/api/media/${reference.media_id}`, { headers: { Authorization: `Bearer ${await getSetting('ownerToken')}` } });
            if (!response.ok) throw new Error('Файл пока недоступен. Проверьте сеть и токен');
            blob = await response.blob();
          }
          const url = blobUrl(blob);
          if (reference.mime.startsWith('audio/')) {
            const audio = document.createElement('audio'); audio.controls = true; audio.src = url; button.replaceWith(audio); audio.play().catch(() => {});
          } else if (reference.mime.startsWith('image/')) {
            const image = document.createElement('img'); image.src = url; image.alt = 'Фото из события'; button.replaceWith(image);
          } else {
            const link = document.createElement('a'); link.href = url; link.download = reference.media_id; link.textContent = 'Скачать файл'; button.replaceWith(link); link.click();
          }
        } catch (error) { notify(error.message); button.disabled = false; }
      };
      article.append(button);
    }
    return article;
  }

  async function render() {
    const queued = await listEntries();
    const pending = new Map(queued.map((entry) => [entry.event.id, entry]));
    const events = new Map((await cachedEvents()).map((event) => [event.id, event]));
    for (const entry of queued) events.set(entry.event.id, entry.event);
    const sorted = [...events.values()].sort((a, b) => (b.received_at ?? b.ts).localeCompare(a.received_at ?? a.ts));
    const signature = JSON.stringify([sorted, queued.map((entry) => [entry.event.id, entry.error])]);
    if (signature === renderedSignature) return;
    renderedSignature = signature;
    for (const url of urls) URL.revokeObjectURL(url);
    urls.clear();
    feed.replaceChildren(...sorted.map((event) => card(event, pending.get(event.id))));
    if (!sorted.length) { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = 'Здесь появятся ваши записи'; feed.append(empty); }
    document.querySelector('#queue-count').textContent = queued.length ? `В очереди ${queued.length}` : 'Очередь пуста';
  }

  async function refresh(loadMore = false) {
    if (rendering) return rendering;
    rendering = (async () => {
      try {
        const token = await getSetting('ownerToken');
        if (token && navigator.onLine) {
          const response = await fetch(`/api/events${loadMore && before ? `?before=${encodeURIComponent(before)}` : ''}`, { headers: { Authorization: `Bearer ${token}` } });
          if (!response.ok) throw new Error(response.status === 401 ? 'Обновите токен в настройках' : 'Лента временно недоступна');
          const page = await response.json();
          await cacheEvents(page.events);
          before = page.next_before;
          more.hidden = !before;
        }
      } catch (error) { notify(error.message); }
      await render();
    })().finally(() => { rendering = undefined; });
    return rendering;
  }
  more.onclick = () => refresh(true);
  return { refresh, render };
}
