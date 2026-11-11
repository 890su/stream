import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

test('concurrent online and resume triggers keep one retry timer', async () => {
  const handlers = new Map<string, () => void>();
  const timers = new Map<number, () => void>();
  let sequence = 0;
  let release: (result: boolean) => void = () => {};
  const source = readFileSync(new URL('../web/outbox.js', import.meta.url), 'utf8')
    .replace(/^import .*;$/gm, '').replaceAll('export ', '');
  const context = {
    window: { addEventListener: (name: string, handler: () => void) => handlers.set(name, handler), dispatchEvent: () => {} },
    document: { hidden: false, addEventListener: (name: string, handler: () => void) => handlers.set(name, handler) },
    navigator: {}, getSetting: async () => 'token', cacheEvents: async () => {}, listEntries: async () => [], saveEntry: async () => {}, removeEntry: async () => {},
    syncEntries: () => new Promise<boolean>((resolve) => { release = resolve; }), fetch, Event,
    setTimeout: (callback: () => void) => { timers.set(++sequence, callback); return sequence; },
    clearTimeout: (id: number) => timers.delete(id),
  };
  const start = runInNewContext(`${source}\nstartSync`, context) as (config: unknown, notify: unknown) => () => void;
  const stop = start({ retry_initial_ms: 2, retry_max_ms: 60 }, assert.fail);
  await new Promise((resolve) => setImmediate(resolve));
  handlers.get('online')!(); handlers.get('visibilitychange')!();
  release(true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(timers.size, 1);
  stop();
  assert.equal(timers.size, 0);
});
