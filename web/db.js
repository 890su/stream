// IndexedDB on the device: settings, the outbox queue and the cached journal.
let connection;

function open() {
  connection ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('stream', 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('outbox', { keyPath: 'event.id' });
      db.createObjectStore('settings', { keyPath: 'key' });
      db.createObjectStore('feed', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { connection = undefined; reject(request.error); };
    request.onblocked = () => { connection = undefined; reject(new Error('Закройте другие окна Stream и повторите')); };
  });
  return connection;
}

export async function transact(storeName, mode, operation) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const request = operation(transaction.objectStore(storeName));
    transaction.oncomplete = () => resolve(request?.result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error('Не удалось сохранить запись на устройстве'));
  });
}

export const listEntries = () => transact('outbox', 'readonly', (store) => store.getAll());
export const saveEntry = (entry) => transact('outbox', 'readwrite', (store) => store.put(entry));
export const removeEntry = (id) => transact('outbox', 'readwrite', (store) => store.delete(id));
export const getSetting = async (key) => (await transact('settings', 'readonly', (store) => store.get(key)))?.value;
export const setSetting = (key, value) => transact('settings', 'readwrite', (store) => store.put({ key, value }));
// The cached journal in memory: read from the device once, then kept in step by cacheEvents — the only writer of
// the feed store. Every redraw reads it; getAll of the whole journal each time made opening a conversation slow.
let memory;
const loaded = () => (memory ??= transact('feed', 'readonly', (store) => store.getAll())
  .then((list) => new Map(list.map((event) => [event.id, event])), (error) => { memory = undefined; throw error; }));
export const cachedEvents = async () => [...(await loaded()).values()];
export async function cacheEvents(events) {
  await transact('feed', 'readwrite', (store) => { for (const event of events) store.put(event); });
  if (memory) { const copy = await memory; for (const event of events) copy.set(event.id, event); }
}
