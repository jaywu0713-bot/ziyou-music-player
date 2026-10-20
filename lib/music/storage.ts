import type { LibraryState } from './model.ts';
const DB_NAME = 'ziyou-music';
export function openLibraryDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2);
    request.onupgradeneeded = () => {
      for (const name of ['library', 'covers'])
        if (!request.result.objectStoreNames.contains(name))
          request.result.createObjectStore(name);
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('请关闭其他自用页面后重试。'));
  });
}
export async function readLibrary(): Promise<LibraryState | undefined> {
  const db = await openLibraryDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('library', 'readonly');
    const request = tx.objectStore('library').get('state');
    tx.oncomplete = () => {
      db.close();
      resolve(request.result);
    };
    tx.onabort = tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}
// A single transaction persists metadata and directory handles together.
export async function writeLibrary(state: LibraryState): Promise<void> {
  const db = await openLibraryDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('library', 'readwrite');
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onabort = tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
    try {
      tx.objectStore('library').put(state, 'state');
    } catch (e) {
      db.close();
      reject(e);
    }
  });
}

export async function coverStorage<T>(
  key: string,
  operation: 'read' | 'write' | 'delete',
  value?: T,
): Promise<T | undefined> {
  const db = await openLibraryDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(
      'covers',
      operation === 'read' ? 'readonly' : 'readwrite',
    );
    const store = tx.objectStore('covers');
    const request =
      operation === 'read'
        ? store.get(key)
        : operation === 'write'
          ? store.put(value, key)
          : store.delete(key);
    tx.oncomplete = () => {
      db.close();
      resolve(operation === 'read' ? request.result : undefined);
    };
    tx.onabort = tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

export async function deleteTrackCovers(trackId: string): Promise<void> {
  const db = await openLibraryDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('covers', 'readwrite');
    const cursor = tx.objectStore('covers').openCursor();
    cursor.onsuccess = () => {
      const row = cursor.result;
      if (!row) return;
      if (
        typeof row.key === 'string' &&
        (row.key === `metadata:${trackId}` || row.key === `custom:${trackId}` ||
          row.key.startsWith(`embedded:${trackId}:`))
      )
        row.delete();
      row.continue();
    };
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onabort = tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}
