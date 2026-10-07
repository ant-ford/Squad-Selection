import type { PersistedRecord, PersistStore } from './persistedQueries';

/**
 * One record in IndexedDB (database `eddy`, store `cache`), with the raw API so
 * nothing is added to the bundle. Every call rejects rather than throws where
 * IndexedDB is missing or refuses (private mode, quota, blocked site data);
 * the persister swallows that.
 */
export function idbStore(key: string): PersistStore {
  let opening: Promise<IDBDatabase> | null = null;

  const open = () => {
    opening ??= new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === 'undefined') throw new Error('no IndexedDB');
      const req = indexedDB.open('eddy', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('cache');
      req.onsuccess = () => {
        const db = req.result;
        // Another tab upgrading, or the browser clearing site data: let go, reopen next time.
        db.onversionchange = () => {
          db.close();
          opening = null;
        };
        db.onclose = () => {
          opening = null;
        };
        resolve(db);
      };
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('IndexedDB blocked'));
    });
    opening.catch(() => {
      opening = null;
    });
    return opening;
  };

  const run = async <T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const db = await open();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction('cache', mode);
      const req = work(tx.objectStore('cache'));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error ?? req.error);
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB aborted'));
    });
  };

  return {
    get: () => run('readonly', (s) => s.get(key)),
    set: async (value: PersistedRecord) => {
      await run('readwrite', (s) => s.put(value, key));
    },
    del: async () => {
      await run('readwrite', (s) => s.delete(key));
    },
  };
}
