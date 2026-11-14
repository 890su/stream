import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

// App shell files are served under /v/<build>/ so that no cache in between (browser, Cloudflare,
// service worker) can mix files from different versions. The build id is a hash of their content.
export const VERSIONED = ['app.js', 'composer.js', 'voice.js', 'bubble.js', 'feed.js', 'outbox.js', 'sync.js', 'db.js', 'shared.js', 'live.js', 'projection.js', 'actions.js', 'suggest.js', 'tagrow.js', 'thread.js', 'topicscreen.js', 'picker.js', 'select.js', 'styles.css'];
const ROOT_FILES = ['/manifest.json', '/icon-192.png', '/icon-512.png', '/fonts/inter-latin-wght-normal.woff2', '/fonts/inter-cyrillic-wght-normal.woff2', '/fonts/LICENSE'];
const TEMPLATES = ['index.html', 'sw.js'];
const PLACEHOLDER = /__BUILD__/g;
const WEB = new URL('../../web/', import.meta.url);
const CONFIG = new URL('../../registry/capture.json', import.meta.url);

const TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8',
  json: 'application/manifest+json', png: 'image/png', woff2: 'font/woff2',
};
const typeOf = (path: string) => TYPES[path.split('.').pop() ?? ''] ?? 'text/plain; charset=utf-8';
const read = (path: string) => readFile(new URL(path.replace(/^\//, ''), WEB));

export async function buildId(): Promise<string> {
  const hash = createHash('sha256');
  for (const file of [...VERSIONED, ...TEMPLATES]) hash.update(file).update(await read(file));
  hash.update(await readFile(CONFIG));
  return hash.digest('hex').slice(0, 12);
}

export interface StaticFile { body: Buffer | string; headers: Record<string, string> }

const fresh = { 'Cache-Control': 'no-cache' };
const forever = { 'Cache-Control': 'public, max-age=31536000, immutable' };

export async function staticFile(pathname: string): Promise<StaticFile | null> {
  if (pathname === '/' || pathname === '/index.html' || pathname === '/sw.js') {
    const file = pathname === '/sw.js' ? 'sw.js' : 'index.html';
    const body = (await read(file)).toString('utf8').replace(PLACEHOLDER, await buildId());
    return { body, headers: { 'Content-Type': typeOf(file), ...fresh } };
  }
  const versioned = /^\/v\/([0-9a-f]{12})\/([a-z0-9-]+\.(?:js|css))$/.exec(pathname);
  if (versioned) {
    const [, build, file] = versioned;
    if (!VERSIONED.includes(file!) || build !== await buildId()) return null; // an old build is gone
    return { body: await read(file!), headers: { 'Content-Type': typeOf(file!), ...forever } };
  }
  if (ROOT_FILES.includes(pathname)) return { body: await read(pathname), headers: { 'Content-Type': typeOf(pathname), ...fresh } };
  return null;
}
