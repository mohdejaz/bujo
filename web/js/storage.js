/* storage.js - persist the sql.js database to IndexedDB.
 *
 * The whole SQLite file lives as a single Uint8Array under one key. We load it
 * on boot and write it back after any mutating command. Local-only, on-device.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.BujoStorage = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const DB_NAME = "bujo";
  const STORE = "kv";
  const KEY = "db";

  function openIdb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const idb = req.result;
        if (!idb.objectStoreNames.contains(STORE)) idb.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error("indexedDB open blocked"));
    });
  }

  async function loadBytes() {
    const idb = await openIdb();
    return new Promise((resolve, reject) => {
      const tx = idb.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function saveBytes(bytes) {
    const idb = await openIdb();
    return new Promise((resolve, reject) => {
      const tx = idb.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(bytes, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  return { loadBytes, saveBytes };
});
