/**
 * Purge du cache IndexedDB des ressources extraites des logements (.sh3x / .sh3d).
 * Conserve les entrées les plus récentes (champ date), avec plafond en nombre et en octets.
 */

const DEFAULT_DB = "SweetHome3DJS";
const DEFAULT_STORE = "Cache";
const DEFAULT_MAX_ENTRIES = 200;
/** ~80 Mo — limite douce avant QuotaExceeded du navigateur */
const DEFAULT_MAX_BYTES = 80 * 1024 * 1024;

/**
 * Estime la taille d'une entrée cache (Blob, ArrayBuffer, string, etc.).
 * @param {*} row
 * @return {number}
 */
export function estimateCacheEntryBytes(row) {
  if (row == null) {
    return 0;
  }
  const content = row.content != null ? row.content : row;
  if (content == null) {
    return 0;
  }
  if (typeof Blob !== "undefined" && content instanceof Blob) {
    return content.size || 0;
  }
  if (typeof ArrayBuffer !== "undefined" && content instanceof ArrayBuffer) {
    return content.byteLength || 0;
  }
  if (ArrayBuffer.isView && ArrayBuffer.isView(content)) {
    return content.byteLength || 0;
  }
  if (typeof content === "string") {
    // Approximation UTF-16 / latin1 stocké
    return content.length * 2;
  }
  if (content && typeof content.size === "number") {
    return content.size;
  }
  try {
    return JSON.stringify(content).length * 2;
  } catch (_) {
    return 0;
  }
}

/**
 * @param {{database?: string, objectStore?: string, maxEntries?: number, maxBytes?: number}} [options]
 * @return {Promise<{deleted: number, kept: number, bytes: number}>}
 */
export function pruneIndexedDBResourceCache(options = {}) {
  const databaseName = options.database || DEFAULT_DB;
  const objectStore = options.objectStore || DEFAULT_STORE;
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

  if (typeof indexedDB === "undefined") {
    return Promise.resolve({ deleted: 0, kept: 0, bytes: 0 });
  }

  return new Promise((resolve) => {
    const request = indexedDB.open(databaseName);
    request.addEventListener("error", () => resolve({ deleted: 0, kept: 0, bytes: 0 }));
    request.addEventListener("upgradeneeded", (ev) => {
      const db = ev.target.result;
      if (!db.objectStoreNames.contains(objectStore)) {
        db.createObjectStore(objectStore, { keyPath: "name" });
      }
    });
    request.addEventListener("success", (ev) => {
      const db = ev.target.result;
      try {
        if (!db.objectStoreNames.contains(objectStore)) {
          db.close();
          resolve({ deleted: 0, kept: 0, bytes: 0 });
          return;
        }
        const tx = db.transaction(objectStore, "readonly");
        const store = tx.objectStore(objectStore);
        const getAll = store.getAll();
        getAll.addEventListener("error", () => {
          db.close();
          resolve({ deleted: 0, kept: 0, bytes: 0 });
        });
        getAll.addEventListener("success", () => {
          const rows = (getAll.result || []).slice();
          rows.sort((a, b) => (b.date || 0) - (a.date || 0));

          let totalBytes = 0;
          for (const row of rows) {
            totalBytes += estimateCacheEntryBytes(row);
          }

          const toDelete = [];
          // 1) Plafond nombre d'entrées
          if (rows.length > maxEntries) {
            toDelete.push(...rows.slice(maxEntries));
          }
          // 2) Plafond octets : retirer les plus anciennes tant que trop gros
          const kept = rows.slice(0, Math.min(rows.length, maxEntries));
          let keptBytes = 0;
          for (const row of kept) {
            keptBytes += estimateCacheEntryBytes(row);
          }
          while (kept.length > 0 && keptBytes > maxBytes) {
            const oldest = kept.pop();
            keptBytes -= estimateCacheEntryBytes(oldest);
            if (toDelete.indexOf(oldest) < 0) {
              toDelete.push(oldest);
            }
          }

          // Dédupliquer par name
          const deleteNames = new Set();
          const uniqueDelete = [];
          for (const row of toDelete) {
            if (row && row.name != null && !deleteNames.has(row.name)) {
              deleteNames.add(row.name);
              uniqueDelete.push(row);
            }
          }

          if (uniqueDelete.length === 0) {
            db.close();
            resolve({ deleted: 0, kept: rows.length, bytes: totalBytes });
            return;
          }

          const writeTx = db.transaction(objectStore, "readwrite");
          const writeStore = writeTx.objectStore(objectStore);
          for (const row of uniqueDelete) {
            writeStore.delete(row.name);
          }
          writeTx.addEventListener("complete", () => {
            db.close();
            resolve({
              deleted: uniqueDelete.length,
              kept: rows.length - uniqueDelete.length,
              bytes: keptBytes,
            });
          });
          writeTx.addEventListener("error", () => {
            db.close();
            resolve({ deleted: 0, kept: rows.length, bytes: totalBytes });
          });
        });
      } catch (ex) {
        try {
          db.close();
        } catch (_) {
          /* ignore */
        }
        resolve({ deleted: 0, kept: 0, bytes: 0 });
      }
    });
  });
}
