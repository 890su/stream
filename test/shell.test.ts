import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fixture } from './helpers.ts';

test('every offline shell asset and manifest entry is served with the expected content', async () => {
  const f = await fixture();
  try {
    const worker = readFileSync(new URL('../web/sw.js', import.meta.url), 'utf8');
    const list = /const SHELL = (\[[^\n]+\]);/.exec(worker)![1]!;
    const assets = JSON.parse(list.replaceAll("'", '"')) as string[];
    for (const asset of assets) {
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
