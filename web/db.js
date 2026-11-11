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
export const cachedEvents = () => transact('feed', 'readonly', (store) => store.getAll());
export const cacheEvents = (events) => transact('feed', 'readwrite', (store) => { for (const event of events) store.put(event); });
