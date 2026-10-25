/**
 * Stockage IndexedDB des bibliothèques de meubles importées localement (.sh3f).
 */

const DB_NAME = "SweetHome3DJS";
const STORE = "FurnitureLibs";
const DB_VERSION_BUMP = 1; // open existing DB; create store on upgrade if missing

/**
 * @return {Promise<IDBDatabase>}
 */
function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME);
    request.onerror = () => reject(request.error || new Error("IndexedDB open failed"));
    request.onupgradeneeded = (ev) => {
      const db = ev.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "name" });
      }
    };
    request.onsuccess = (ev) => {
      const db = ev.target.result;
      if (db.objectStoreNames.contains(STORE)) {
        resolve(db);
        return;
      }
      // Store manquant (DB déjà à une version sans FurnitureLibs) : upgrade
      const nextVersion = db.version + DB_VERSION_BUMP;
      db.close();
      const upgrade = indexedDB.open(DB_NAME, nextVersion);
      upgrade.onupgradeneeded = (e2) => {
        const db2 = e2.target.result;
        if (!db2.objectStoreNames.contains(STORE)) {
          db2.createObjectStore(STORE, { keyPath: "name" });
        }
      };
      upgrade.onerror = () => reject(upgrade.error || new Error("IndexedDB upgrade failed"));
      upgrade.onsuccess = (e2) => resolve(e2.target.result);
    };
  });
}

/**
 * @param {IDBDatabase} db
 * @param {"readonly"|"readwrite"} mode
 * @return {IDBObjectStore}
 */
function store(db, mode) {
  return db.transaction(STORE, mode).objectStore(STORE);
}

/**
 * @return {Promise<Array<{name: string, displayName: string, sh3f: Blob, catalog: object, locales?: object, importedAt: number}>>}
 */
export async function listFurnitureLibraries() {
  if (typeof indexedDB === "undefined") {
    return [];
  }
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const req = store(db, "readonly").getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

/**
 * @param {string} name
 * @return {Promise<object|null>}
 */
export async function getFurnitureLibrary(name) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const req = store(db, "readonly").get(name);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

/**
 * @param {string} name
 * @return {Promise<boolean>}
 */
export async function furnitureLibraryExists(name) {
  const row = await getFurnitureLibrary(name);
  return row != null;
}

/**
 * @param {{name: string, displayName: string, sh3f: Blob, catalog: object, locales?: object, pieceCount?: number}} record
 * @return {Promise<void>}
 */
export async function saveFurnitureLibrary(record) {
  const db = await openDb();
  try {
    await new Promise((resolve, reject) => {
      const row = {
        ...record,
        importedAt: record.importedAt || Date.now(),
      };
      const req = store(db, "readwrite").put(row);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

/**
 * @param {string} name
 * @return {Promise<void>}
 */
export async function deleteFurnitureLibrary(name) {
  const db = await openDb();
  try {
    await new Promise((resolve, reject) => {
      const req = store(db, "readwrite").delete(name);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}
