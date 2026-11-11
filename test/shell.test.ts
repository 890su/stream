import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readdirSync } from 'node:fs';
import { fixture } from './helpers.ts';
import { VERSIONED, buildId } from '../src/server/static.ts';

const list = (source: string, name: string) =>
  JSON.parse(new RegExp(`const ${name} = (\\[[^\\n]+\\]);`).exec(source)![1]!.replaceAll("'", '"')) as string[];

test('every offline shell asset and manifest entry is served with the expected content', async () => {
  const f = await fixture();
  try {
    const worker = await (await fetch(f.base + '/sw.js')).text();
    const build = await buildId();
    assert.doesNotMatch(worker, /__BUILD__/);
    assert.match(worker, new RegExp(`const BUILD = '${build}'`));
    assert.deepEqual(list(worker, 'VERSIONED'), VERSIONED);
    for (const asset of ['/', ...list(worker, 'STATIC'), ...VERSIONED.map((file) => `/v/${build}/${file}`)]) {
      const response = await fetch(f.base + asset);
      assert.equal(response.status, 200, asset);
      assert.ok((await response.arrayBuffer()).byteLength, asset);
    }
    const manifest = await (await fetch(f.base + '/manifest.json')).json();
    assert.equal(manifest.display, 'standalone');
    assert.deepEqual(manifest.shortcuts.map((item: { url: string }) => item.url), ['/?mode=voice', '/?mode=text', '/?mode=photo']);
    assert.equal(manifest.share_target.method, 'POST');
    assert.equal(manifest.share_target.action, '/share-target');
    for (const size of [192, 512]) {
      const bytes = Buffer.from(await (await fetch(`${f.base}/icon-${size}.png`)).arrayBuffer());
      assert.equal(bytes.readUInt32BE(16), size);
      assert.equal(bytes.readUInt32BE(20), size);
    }
    const config = await (await fetch(f.base + '/capture-config.json')).json();
    assert.ok(config.retry_initial_ms < config.retry_max_ms);
    assert.ok(config.request_timeout_ms > 0);
  } finally { await f.stop(); }
});

test('every client file is versioned, so caches can never mix two builds', () => {
  const files = readdirSync(new URL('../web/', import.meta.url)).filter((file) => /\.(js|css)$/.test(file) && file !== 'sw.js');
  assert.deepEqual([...files].sort(), [...VERSIONED].sort());
});

test('page and worker are always revalidated; versioned files are immutable; old builds are gone', async () => {
  const f = await fixture();
  try {
    const build = await buildId();
    const page = await fetch(f.base + '/');
    assert.equal(page.headers.get('cache-control'), 'no-cache');
    const html = await page.text();
    assert.match(html, new RegExp(`/v/${build}/app\\.js`));
    assert.match(html, new RegExp(`/v/${build}/styles\\.css`));
    assert.equal((await fetch(f.base + '/sw.js')).headers.get('cache-control'), 'no-cache');
    const asset = await fetch(`${f.base}/v/${build}/app.js`);
    assert.match(asset.headers.get('cache-control')!, /immutable/);
    for (const gone of ['/v/000000000000/app.js', `/v/${build}/unknown.js`, '/app.js', '/styles.css']) {
      assert.equal((await fetch(f.base + gone)).status, 404, gone);
    }
  } finally { await f.stop(); }
});
