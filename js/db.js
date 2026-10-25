// IndexedDB storage. Photos are stored as Blobs next to the log, so nothing
// leaves the device. Every save runs in one transaction: an entry and its
// photos are stored together or not at all.

const NAME = 'damplog';
const STORES = ['issues', 'entries', 'photos', 'meta'];
let opening;
let current = null;
let snapshot = null;
let onRestored = null;
let restoring = null;

/**
 * Keeps the record safe if the browser clears the database while DampLog is open
 * (a "clear site data" button, a privacy setting, or low storage). The record is
 * still in the open page, so it is written straight back. Without this, the next
 * save would go into a new, empty database, and a refresh would show nothing.
 *
 * getRecords() returns { issues, entries, photos, meta } as they should be stored.
 * done(err, missingPhotoIds) is told when the record has been written back, or why
 * it could not be.
 */
export function keepRecordSafe(getRecords, done) {
  snapshot = getRecords;
  onRestored = done;
}

/** True if a photo's data can still be read. A photo loaded from storage loses its data when the storage is cleared. */
async function readable(photo) {
  try {
    await photo.blob.slice(0, 1).arrayBuffer();
    return true;
  } catch {
    return false;
  }
}

function lost() {
  opening = null;
  current = null;
  if (!snapshot || restoring) return;
  let missing = [];
  restoring = (async () => {
    const records = snapshot();
    const photos = [];
    for (const p of records.photos ?? []) if (await readable(p)) photos.push(p);
    missing = (records.photos ?? []).filter((p) => !photos.includes(p)).map((p) => p.id);
    const keep = { ...records, photos };
    // The browser takes a moment to finish clearing, and closes connections opened
    // in the meantime too. Try again, waiting a little longer each time.
    let failure;
    for (const wait of [50, 250, 750, 1500, 3000]) {
      await new Promise((resolve) => setTimeout(resolve, wait));
      try {
        opening = null;
        current = null;
        const tx = (await open()).transaction(STORES, 'readwrite');
        for (const s of STORES) tx.objectStore(s).clear();
        for (const [store, items] of Object.entries(keep)) for (const item of items ?? []) tx.objectStore(store).put(item);
        await finished(tx);
        return;
      } catch (err) {
        failure = err;
      }
    }
    throw failure;
  })().then(() => onRestored?.(null, missing), (err) => onRestored?.(err, missing)).finally(() => { restoring = null; });
}

function open() {
  opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, 1);
    req.onupgradeneeded = () => {
      for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s, { keyPath: 'id' });
    };
    req.onsuccess = () => {
      const db = req.result;
      current = db;
      // Closed by the browser, not by DampLog: the data may be gone.
      db.onclose = () => { if (current === db) lost(); };
      // Another tab is deleting or upgrading the database on purpose: let it.
      db.onversionchange = () => {
        db.close();
        if (current === db) {
          opening = null;
          current = null;
        }
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

/**
 * A transaction on a live connection. If the browser closed the old one, the
 * record is written back first, so nothing is saved into an empty database.
 */
async function transaction(stores, mode) {
  if (restoring) await restoring;
  try {
    return (await open()).transaction(stores, mode);
  } catch (err) {
    if (err?.name !== 'InvalidStateError') throw err;
    lost();
    if (restoring) await restoring;
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
