// IndexedDB storage. Photos are stored as Blobs next to the log, so nothing
// leaves the device. Every save runs in one transaction: an entry and its
// photos are stored together or not at all.

const NAME = 'damplog';
const STORES = ['issues', 'entries', 'photos', 'meta'];
let opening;

function open() {
  opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, 1);
    req.onupgradeneeded = () => {
      for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s, { keyPath: 'id' });
    };
    req.onsuccess = () => {
      const db = req.result;
      // The browser closes the connection when site data is cleared, and another
      // tab may need it closed to reset the database. Either way, forget it so the
      // next save opens a fresh one.
      db.onclose = () => { opening = null; };
      db.onversionchange = () => {
        db.close();
        opening = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      opening = null;
      reject(req.error);
    };
    req.onblocked = () => {
      opening = null;
      reject(new Error('Close other DampLog tabs and reload this one.'));
    };
  });
  return opening;
}

/** A transaction on a live connection, reconnecting once if the old one was closed. */
async function transaction(stores, mode) {
  try {
    return (await open()).transaction(stores, mode);
  } catch (err) {
    if (err?.name !== 'InvalidStateError') throw err;
    opening = null;
    return (await open()).transaction(stores, mode);
  }
}

function finished(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('The save was cancelled.'));
  });
}

export async function loadAll() {
  const tx = await transaction(STORES, 'readonly');
  const all = (store) => new Promise((resolve, reject) => {
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const [issues, entries, photos, meta] = await Promise.all(STORES.map(all));
  const record = (key) => {
    const { id, ...rest } = meta.find((m) => m.id === key) ?? {};
    return rest;
  };
  // The AI key is its own record so it never ends up in a backup file.
  return { issues, entries, photos, home: record('home'), ai: record('ai') };
}

/**
 * Saves { storeName: [records] } and deletes { storeName: [ids] } in one transaction.
 * With `replace`, every store is emptied first.
 */
export async function save(put = {}, { remove = {}, replace = false } = {}) {
  const tx = await transaction(STORES, 'readwrite');
  if (replace) for (const s of STORES) tx.objectStore(s).clear();
  for (const [store, ids] of Object.entries(remove)) for (const id of ids ?? []) tx.objectStore(store).delete(id);
  for (const [store, items] of Object.entries(put)) for (const item of items ?? []) tx.objectStore(store).put(item);
  return finished(tx);
}

export const saveHome = (home) => save({ meta: [{ id: 'home', ...home }] });
export const saveAi = (config) => save({ meta: [{ id: 'ai', ...config }] });
