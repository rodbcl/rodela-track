// IndexedDB — armazenamento local no iPhone
const DB_NAME = 'rodela-track';
const DB_VERSION = 1;

let dbPromise;

export function openDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = req.result;
        if (e.oldVersion < 1) {
          db.createObjectStore('templates', { keyPath: 'id' });
          const s = db.createObjectStore('sessions', { keyPath: 'id' });
          s.createIndex('date', 'date');
          db.createObjectStore('kv'); // chave/valor: rascunho, configurações
        }
        // v2 (módulo Dieta) será adicionado aqui
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const txDone = (t) => new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = t.onabort = () => rej(t.error); });

export async function getAll(store) {
  const db = await openDB();
  return reqP(db.transaction(store).objectStore(store).getAll());
}

export async function get(store, key) {
  const db = await openDB();
  return reqP(db.transaction(store).objectStore(store).get(key));
}

export async function put(store, value, key) {
  const db = await openDB();
  const t = db.transaction(store, 'readwrite');
  const os = t.objectStore(store);
  if (key === undefined) os.put(value); else os.put(value, key);
  return txDone(t);
}

export async function putMany(store, values) {
  const db = await openDB();
  const t = db.transaction(store, 'readwrite');
  const os = t.objectStore(store);
  for (const v of values) os.put(v);
  return txDone(t);
}

export async function del(store, key) {
  const db = await openDB();
  const t = db.transaction(store, 'readwrite');
  t.objectStore(store).delete(key);
  return txDone(t);
}

/** Substitui templates e treinos (restauração de backup). */
export async function replaceAll({ templates = [], sessions = [] }) {
  const db = await openDB();
  const t = db.transaction(['templates', 'sessions'], 'readwrite');
  const ts = t.objectStore('templates');
  const ss = t.objectStore('sessions');
  ts.clear(); ss.clear();
  for (const x of templates) ts.put(x);
  for (const x of sessions) ss.put(x);
  return txDone(t);
}

export async function wipe() {
  const db = await openDB();
  const t = db.transaction(['templates', 'sessions', 'kv'], 'readwrite');
  for (const s of ['templates', 'sessions', 'kv']) t.objectStore(s).clear();
  return txDone(t);
}
