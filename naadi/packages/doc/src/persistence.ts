import type { LoroDoc } from 'loro-crdt';

const DB_NAME = 'naadi';
const STORE = 'snapshots';
const DB_VERSION = 1;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveSnapshotBytes(roomId: string, bytes: Uint8Array): Promise<void> {
  return putSnapshot(roomId, bytes);
}

async function putSnapshot(roomId: string, bytes: Uint8Array): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(bytes, roomId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function getSnapshot(roomId: string): Promise<Uint8Array | null> {
  const db = await openDB();
  const result = await new Promise<Uint8Array | null>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(roomId);
    req.onsuccess = () => {
      const v = req.result;
      resolve(v instanceof Uint8Array ? v : null);
    };
    req.onerror = () => reject(req.error);
  });
  db.close();
  return result;
}

export async function loadSnapshot(doc: LoroDoc, roomId: string): Promise<boolean> {
  try {
    const bytes = await getSnapshot(roomId);
    if (!bytes) return false;
    doc.import(bytes);
    return true;
  } catch (e) {
    console.warn('[naadi/doc] snapshot load failed', e);
    return false;
  }
}

export interface PersistenceHandle {
  flush(): Promise<void>;
  destroy(): void;
}

const DEBOUNCE_MS = 2000;

export function bindPersistence(doc: LoroDoc, roomId: string): PersistenceHandle {
  let timer: number | undefined;
  let destroyed = false;
  let saving: Promise<void> = Promise.resolve();

  const save = async () => {
    if (destroyed) return;
    const bytes = doc.export({ mode: 'snapshot' });
    saving = putSnapshot(roomId, bytes).catch((e) =>
      console.warn('[naadi/doc] snapshot put failed', e),
    );
    await saving;
  };

  const unsubscribe = doc.subscribe(() => {
    if (destroyed) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(save, DEBOUNCE_MS);
  });

  return {
    async flush() {
      window.clearTimeout(timer);
      await save();
      await saving;
    },
    destroy() {
      destroyed = true;
      window.clearTimeout(timer);
      unsubscribe();
    },
  };
}
