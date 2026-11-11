import { listEntries, saveEntry, removeEntry, getSetting, cacheEvents } from './db.js';
import { syncEntries } from './sync.js';

let active;
let requestTimeoutMs;
export async function enqueue(entry) {
  await saveEntry(entry);
  window.dispatchEvent(new Event('queue-change'));
}

export function synchronize() {
  active ??= (async () => {
    const run = async () => syncEntries({ list: listEntries, save: saveEntry, remove: removeEntry }, await getSetting('ownerToken'), fetch,
      (event) => cacheEvents([event]), requestTimeoutMs);
    return navigator.locks ? navigator.locks.request('stream-sync', run) : run();
  })().finally(() => { active = undefined; window.dispatchEvent(new Event('queue-change')); });
  return active;
}

export function startSync(config, showError) {
  requestTimeoutMs = config.request_timeout_ms;
  let delay = config.retry_initial_ms;
  let timer;
  let stopped = false;
  let running = false;
  const run = async () => {
    if (running || stopped) return;
    running = true;
    clearTimeout(timer);
    try { delay = await synchronize() ? config.retry_initial_ms : Math.min(delay * 2, config.retry_max_ms); }
    catch (error) { showError(error.message); delay = Math.min(delay * 2, config.retry_max_ms); }
    running = false;
    if (!stopped) timer = setTimeout(run, delay);
  };
  window.addEventListener('online', run);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) run(); });
  run();
  return () => { stopped = true; clearTimeout(timer); };
}
