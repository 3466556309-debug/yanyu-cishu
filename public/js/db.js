const DB_NAME = 'yanyu-cishu';
const DB_VERSION = 1;
let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('本机存储打不开'));
  });
  return dbPromise;
}

function requestAsPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function loadLocal(userId) {
  const db = await openDb();
  const tx = db.transaction(['kv', 'outbox'], 'readonly');
  const snapshotRequest = tx.objectStore('kv').get(`snapshot:${userId}`);
  const outboxRequest = tx.objectStore('outbox').get(userId);
  const [snapshot, outbox] = await Promise.all([
    requestAsPromise(snapshotRequest),
    requestAsPromise(outboxRequest),
  ]);
  return { snapshot: snapshot || null, ops: Array.isArray(outbox) ? outbox : [] };
}

export async function saveLocal(userId, snapshot, ops) {
  const db = await openDb();
  const tx = db.transaction(['kv', 'outbox'], 'readwrite');
  tx.objectStore('kv').put(snapshot, `snapshot:${userId}`);
  tx.objectStore('outbox').put(ops, userId);
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function clearLocalUser(userId) {
  const db = await openDb();
  const tx = db.transaction(['kv', 'outbox'], 'readwrite');
  tx.objectStore('kv').delete(`snapshot:${userId}`);
  tx.objectStore('outbox').delete(userId);
  await new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

export async function storageEstimate() {
  if (!navigator.storage?.estimate) return null;
  try { return await navigator.storage.estimate(); } catch { return null; }
}
