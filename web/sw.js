// The server replaces __BUILD__ with the content hash of the app shell (src/server/static.ts).
import { saveEntry } from '/v/__BUILD__/db.js';
import { entryFromShare } from '/v/__BUILD__/shared.js';

const BUILD = '__BUILD__';
const CACHE = `stream-shell-${BUILD}`;
const VERSIONED = ['app.js', 'composer.js', 'voice.js', 'bubble.js', 'feed.js', 'outbox.js', 'sync.js', 'db.js', 'shared.js', 'live.js', 'styles.css'];
const STATIC = ['/manifest.json', '/capture-config.json', '/icon-192.png', '/icon-512.png', '/fonts/inter-latin-wght-normal.woff2', '/fonts/inter-cyrillic-wght-normal.woff2'];
const SHELL = ['/', ...STATIC, ...VERSIONED.map((file) => `/v/${BUILD}/${file}`)];
// The page and settings come from the network when it answers, so a new version shows on the next open.
const NETWORK_FIRST = new Set(['/', '/capture-config.json', '/manifest.json']);
const NETWORK_TIMEOUT_MS = 4000;

self.addEventListener('install', (event) => {
  // cache: 'reload' skips every HTTP cache on the way, including proxy and CDN browser TTLs.
  event.waitUntil(caches.open(CACHE)
    .then((cache) => cache.addAll(SHELL.map((url) => new Request(url, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('stream-shell-') && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

async function networkFirst(url, key) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(new Request(url, { cache: 'no-store', signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS) }));
    if (response.ok) await cache.put(key, response.clone());
    return response;
  } catch {
    return (await cache.match(key)) ?? Response.error();
  }
}

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
  if (NETWORK_FIRST.has(key)) { event.respondWith(networkFirst(url.href, key)); return; }
  // Versioned files never change under the same URL: the cache is always right.
  event.respondWith(caches.open(CACHE).then(async (cache) => (await cache.match(key)) ?? fetch(request)));
});
