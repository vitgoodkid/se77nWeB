// On-device image cache backed by IndexedDB.
//
// The stylist stores garment/lookbook image *bytes* on the user's device so a
// wardrobe survives indefinitely and works offline, independent of whether the
// fal-hosted URL still resolves. Synced metadata keeps the fal URL as a
// portable fallback for other devices / cache misses.
//
// localStorage (used by useSyncedData) is ~5MB and already holds metadata;
// image blobs need IndexedDB's much larger budget — hence this module.

import { useState, useEffect, useRef } from 'react';

const DB_NAME = 'se77n';
const STORE = 'images';
const DB_VERSION = 1;

let _dbPromise = null;

function openDb() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('no indexedDB')); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('idb open failed'));
  }).catch((e) => { _dbPromise = null; throw e; });
  return _dbPromise;
}

function tx(mode, fn) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    let result;
    const r = fn(store);
    if (r) r.onsuccess = () => { result = r.result; };
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

export async function idbPut(key, blob) {
  try { await tx('readwrite', (s) => s.put(blob, key)); return true; }
  catch { return false; }
}

export async function idbGet(key) {
  try { return (await tx('readonly', (s) => s.get(key))) || null; }
  catch { return null; }
}

export async function idbDel(key) {
  try { await tx('readwrite', (s) => s.delete(key)); return true; }
  catch { return false; }
}

// Resolve a display URL for `key`: prefer the on-device blob, else show the
// fallback URL immediately and lazily cache its bytes (via the host-allowlisted
// /api/img-proxy) for next time. Returns the best currently-known src string.
export function useCachedImage(key, fallbackUrl) {
  const [src, setSrc] = useState(fallbackUrl || null);
  const objUrlRef = useRef(null);

  useEffect(() => {
    let alive = true;
    const revoke = () => {
      if (objUrlRef.current) { URL.revokeObjectURL(objUrlRef.current); objUrlRef.current = null; }
    };

    if (!key) { setSrc(fallbackUrl || null); return revoke; }

    (async () => {
      // 1. On-device hit?
      const blob = await idbGet(key);
      if (!alive) return;
      if (blob) {
        revoke();
        const u = URL.createObjectURL(blob);
        objUrlRef.current = u;
        setSrc(u);
        return;
      }
      // 2. Miss → show fallback now, cache bytes in the background.
      setSrc(fallbackUrl || null);
      if (fallbackUrl && /^https?:\/\//i.test(fallbackUrl)) {
        try {
          const res = await fetch('/api/image?url=' + encodeURIComponent(fallbackUrl));
          if (!res.ok) return;
          const fetched = await res.blob();
          if (!alive) return;
          await idbPut(key, fetched);
          if (!alive) return;
          revoke();
          const u = URL.createObjectURL(fetched);
          objUrlRef.current = u;
          setSrc(u);
        } catch { /* keep fallback */ }
      }
    })();

    return () => { alive = false; revoke(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, fallbackUrl]);

  return src;
}
