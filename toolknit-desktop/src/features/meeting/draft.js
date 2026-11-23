const DATABASE = 'toolknit-meeting-draft';
const STORE = 'drafts';

export function createMeetingDraftStore(storage = globalThis.indexedDB) {
  async function run(mode, action) {
    const db = await new Promise((resolve, reject) => {
      const request = storage.open(DATABASE, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE, mode, { durability: 'strict' });
        const request = action(transaction.objectStore(STORE));
        transaction.oncomplete = () => resolve(request.result);
        transaction.onabort = () => reject(transaction.error);
      });
    } finally {
      db.close();
    }
  }
  return {
    load: () => run('readonly', store => store.get('current')),
    save: draft => run('readwrite', store => store.put(draft, 'current')),
    clear: () => run('readwrite', store => store.delete('current'))
  };
}
