// IndexedDB storage: the app state as one JSON document, and photos as blobs.
const DB_NAME = 'bar-stock';

let dbPromise;
function open() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('kv');
      req.result.createObjectStore('photos');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function run(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
  });
}

export const loadState = () => run('kv', 'readonly', (s) => s.get('state'));
export const saveState = (state) => run('kv', 'readwrite', (s) => s.put(state, 'state'));
export const savePhoto = (id, blob) => run('photos', 'readwrite', (s) => s.put(blob, id));
export const getPhoto = (id) => run('photos', 'readonly', (s) => s.get(id));
export const deletePhoto = (id) => run('photos', 'readwrite', (s) => s.delete(id));
