import { saveEntry } from './db.js';
import { entryFromShare } from './shared.js';

// Bump this version when shell files or capture configuration change.
const CACHE = 'stream-shell-v1';
const SHELL = ['/', '/index.html', '/styles.css', '/app.js', '/capture.js', '/outbox.js', '/feed.js', '/db.js', '/sync.js', '/shared.js', '/manifest.json', '/capture-config.json', '/icon-192.png', '/icon-512.png', '/fonts/inter-latin-wght-normal.woff2', '/fonts/inter-cyrillic-wght-normal.woff2'];

self.addEventListener('install', (event) => { event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL))); });
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('stream-shell-') && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.method === 'POST' && url.pathname === '/share-target') {
    event.respondWith((async () => {
      try {
        const entry = await entryFromShare(await request.formData());
        await saveEntry(entry);
        return Response.redirect(new URL('/?shared=1', self.location.origin), 303);
      } catch {
        return new Response('<!doctype html><html lang="ru"><meta charset="utf-8"><title>Stream</title><p>Не удалось сохранить данные на устройстве. Освободите место и повторите «Поделиться» из исходного приложения.</p><a href="/">Открыть Stream</a></html>', { status: 507, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }
    })());
    return;
  }
  if (request.method !== 'GET' || url.pathname.startsWith('/api/') || url.pathname === '/healthz') return;
  const key = request.mode === 'navigate' && url.pathname === '/' ? '/' : url.pathname;
  if (!SHELL.includes(key)) return;
  // One versioned shell avoids mixing incompatible JavaScript during an offline update.
  event.respondWith(caches.open(CACHE).then(async (cache) => (await cache.match(key)) ?? fetch(request)));
});
