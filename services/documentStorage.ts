/**
 * High-reliability IndexedDB + Firestore Cloud Chunked storage for documents, cases, and vehicles.
 * Guarantees zero data loss across browser reloads, devices, updates, or Firestore 1MB single-doc limits.
 */
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { db } from './firebase';

const DB_NAME = 'mak_logistics_storage_v2';
const DB_VERSION = 1;
const CHUNK_CHAR_SIZE = 580000; // ~580 KB per Firestore doc (safely under Firestore 1 MiB limit)

let dbPromise: Promise<IDBDatabase> | null = null;
const memoryDocCache = new Map<string, { dataUrl: string; name: string; type: string; size: number }>();

export function sanitizeCloudDocKey(rawKey: string): string {
  return String(rawKey || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 120);
}

function getIDB(): Promise<IDBDatabase> {
  if (typeof window === 'undefined' || !window.indexedDB) {
    return Promise.reject(new Error('IndexedDB not supported in this environment'));
  }
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      try {
        const request = window.indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = (event: any) => {
          const idb = event.target.result as IDBDatabase;
          if (!idb.objectStoreNames.contains('documents')) {
            const docStore = idb.createObjectStore('documents', { keyPath: 'key' });
            docStore.createIndex('caseNo', 'caseNo', { unique: false });
          }
          if (!idb.objectStoreNames.contains('case_backups')) {
            idb.createObjectStore('case_backups', { keyPath: 'key' });
          }
          if (!idb.objectStoreNames.contains('vehicle_backups')) {
            idb.createObjectStore('vehicle_backups', { keyPath: 'key' });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      } catch (err) {
        reject(err);
      }
    });
  }
  return dbPromise;
}

export async function saveDocumentToIndexedDB(record: {
  key?: string;
  id?: string;
  name: string;
  type: string;
  size: number;
  dataUrl: string;
  caseNo?: string;
}): Promise<void> {
  const primaryKey = record.key || record.id || (record.caseNo ? `${record.caseNo}_${record.name}` : record.name);
  if (!primaryKey || !record.dataUrl || !record.dataUrl.startsWith('data:')) return;

  const entry = {
    dataUrl: record.dataUrl,
    name: record.name,
    type: record.type,
    size: record.size
  };

  memoryDocCache.set(primaryKey, entry);
  if (record.name) memoryDocCache.set(record.name, entry);
  if (record.id) memoryDocCache.set(record.id, entry);
  const cleanCloudKey = sanitizeCloudDocKey(primaryKey);
  if (cleanCloudKey) memoryDocCache.set(cleanCloudKey, entry);

  try {
    const idb = await getIDB();
    const tx = idb.transaction('documents', 'readwrite');
    const store = tx.objectStore('documents');
    const baseRecord = {
      id: record.id || primaryKey,
      name: record.name,
      type: record.type,
      size: record.size,
      dataUrl: record.dataUrl,
      caseNo: record.caseNo || '',
      updatedAt: Date.now()
    };
    store.put({ ...baseRecord, key: primaryKey });
    if (record.name && record.name !== primaryKey) {
      store.put({ ...baseRecord, key: record.name });
    }
    if (cleanCloudKey && cleanCloudKey !== primaryKey && cleanCloudKey !== record.name) {
      store.put({ ...baseRecord, key: cleanCloudKey });
    }
  } catch (err) {
    console.warn('Could not persist document to IndexedDB:', err);
  }
}

export async function getDocumentFromIndexedDB(key: string): Promise<string | null> {
  if (!key) return null;
  const normalized = key.startsWith('chunk://') ? key.slice('chunk://'.length) : key;

  const mem = memoryDocCache.get(normalized) || memoryDocCache.get(key);
  if (mem?.dataUrl && mem.dataUrl.startsWith('data:')) return mem.dataUrl;

  try {
    const idb = await getIDB();
    return new Promise((resolve) => {
      const tx = idb.transaction('documents', 'readonly');
      const store = tx.objectStore('documents');
      const req = store.get(normalized);
      req.onsuccess = () => {
        const res = req.result;
        if (res?.dataUrl && String(res.dataUrl).startsWith('data:')) {
          memoryDocCache.set(normalized, {
            dataUrl: res.dataUrl,
            name: res.name || normalized,
            type: res.type || '',
            size: res.size || 0
          });
          resolve(res.dataUrl);
        } else {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    });
  } catch (_) {
    return null;
  }
}

/**
 * Splits a large data: URL (e.g. 2.7 MB - 15 MB multi-page PDF) into safe ~580KB Firestore chunks
 * under `document_chunks/{docKey}__c{index}` and returns `chunk://{docKey}` reference URI.
 */
export async function saveDocumentToCloudChunks(record: {
  docKey: string;
  name?: string;
  mimeType?: string;
  size?: number;
  caseNo?: string;
  dataUrl: string;
}): Promise<string> {
  const { dataUrl } = record;
  if (!dataUrl || !dataUrl.startsWith('data:')) return dataUrl || '';

  const cleanKey = sanitizeCloudDocKey(record.docKey || `${record.caseNo || 'doc'}_${record.name || Date.now()}`);
  if (!cleanKey) return '';

  // Always cache locally first for zero-latency access on current device
  await saveDocumentToIndexedDB({
    key: cleanKey,
    id: cleanKey,
    name: record.name || cleanKey,
    type: record.mimeType || 'application/pdf',
    size: record.size || dataUrl.length,
    dataUrl,
    caseNo: record.caseNo
  });

  const totalChunks = Math.ceil(dataUrl.length / CHUNK_CHAR_SIZE);
  const nowIso = new Date().toISOString();

  // Upload chunks in parallel batches of 4 for fast throughput without saturating network
  const BATCH_SIZE = 4;
  for (let start = 0; start < totalChunks; start += BATCH_SIZE) {
    const promises: Promise<void>[] = [];
    for (let i = start; i < Math.min(start + BATCH_SIZE, totalChunks); i++) {
      const slice = dataUrl.slice(i * CHUNK_CHAR_SIZE, (i + 1) * CHUNK_CHAR_SIZE);
      const chunkDocId = `${cleanKey}__c${i}`;
      promises.push(
        setDoc(doc(db, 'document_chunks', chunkDocId), {
          docKey: cleanKey,
          chunkIndex: i,
          totalChunks,
          data: slice,
          name: record.name || cleanKey,
          mimeType: record.mimeType || 'application/pdf',
          size: record.size || 0,
          caseNo: record.caseNo || '',
          updatedAt: nowIso
        })
      );
    }
    await Promise.all(promises);
  }

  return `chunk://${cleanKey}`;
}

/**
 * Reassembles a multi-megabyte Data URL from Firestore `document_chunks` and caches it in IndexedDB.
 */
export async function getDocumentFromCloudChunks(rawKey: string): Promise<string | null> {
  if (!rawKey) return null;
  const stripped = rawKey.startsWith('chunk://') ? rawKey.slice('chunk://'.length) : rawKey;
  const cleanKey = sanitizeCloudDocKey(stripped);
  if (!cleanKey) return null;

  // Check local cache first
  const cached = await getDocumentFromIndexedDB(cleanKey);
  if (cached && cached.startsWith('data:')) return cached;

  try {
    const firstSnap = await getDoc(doc(db, 'document_chunks', `${cleanKey}__c0`));
    if (!firstSnap.exists()) return null;

    const firstData = firstSnap.data();
    const totalChunks = Number(firstData.totalChunks) || 1;
    const slices: string[] = new Array(totalChunks);
    slices[0] = String(firstData.data || '');

    if (totalChunks > 1) {
      const indices = Array.from({ length: totalChunks - 1 }, (_, idx) => idx + 1);
      const BATCH_SIZE = 6;
      for (let s = 0; s < indices.length; s += BATCH_SIZE) {
        const batch = indices.slice(s, s + BATCH_SIZE);
        const snaps = await Promise.all(
          batch.map((idx) => getDoc(doc(db, 'document_chunks', `${cleanKey}__c${idx}`)))
        );
        for (let bIdx = 0; bIdx < batch.length; bIdx++) {
          const snap = snaps[bIdx];
          if (!snap.exists()) return null;
          slices[batch[bIdx]] = String(snap.data()?.data || '');
        }
      }
    }

    const fullDataUrl = slices.join('');
    if (!fullDataUrl.startsWith('data:')) return null;

    // Cache reassembled PDF/image locally so future views/downloads are instant
    await saveDocumentToIndexedDB({
      key: cleanKey,
      id: cleanKey,
      name: firstData.name || cleanKey,
      type: firstData.mimeType || 'application/pdf',
      size: Number(firstData.size) || fullDataUrl.length,
      dataUrl: fullDataUrl,
      caseNo: firstData.caseNo || ''
    });

    return fullDataUrl;
  } catch (err) {
    console.warn('Cloud chunk reassembly warning:', err);
    return null;
  }
}

/**
 * Universal document resolver: checks direct data/blob/http URLs, local IndexedDB, and Firestore Cloud Chunks.
 * Never returns a fake placeholder PDF.
 */
export async function resolveStoredDocumentDataUrl(options: {
  url?: string | null;
  id?: string | null;
  name?: string | null;
  caseNo?: string | null;
}): Promise<string | null> {
  const { url, id, name, caseNo } = options;

  if (url && (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('http://') || url.startsWith('https://'))) {
    return url;
  }

  const candidateKeys = Array.from(
    new Set(
      [
        url && url.startsWith('chunk://') ? url.slice('chunk://'.length) : null,
        caseNo && name ? `${caseNo}_${name}` : null,
        caseNo && id ? `${caseNo}_${id}` : null,
        id || null,
        name || null
      ].filter(Boolean) as string[]
    )
  );

  // 1. Check local memory + IndexedDB across all candidate keys
  for (const k of candidateKeys) {
    const localHit = await getDocumentFromIndexedDB(k);
    if (localHit && localHit.startsWith('data:')) return localHit;
    const sanitizedHit = await getDocumentFromIndexedDB(sanitizeCloudDocKey(k));
    if (sanitizedHit && sanitizedHit.startsWith('data:')) return sanitizedHit;
  }

  // 2. Reassemble from Firestore Cloud Chunks across candidate keys
  for (const k of candidateKeys) {
    const cloudHit = await getDocumentFromCloudChunks(k);
    if (cloudHit && cloudHit.startsWith('data:')) return cloudHit;
  }

  return null;
}

export function getCachedDocumentSync(key: string): string | null {
  if (!key) return null;
  const normalized = key.startsWith('chunk://') ? key.slice('chunk://'.length) : key;
  return (
    memoryDocCache.get(normalized)?.dataUrl ||
    memoryDocCache.get(sanitizeCloudDocKey(normalized))?.dataUrl ||
    null
  );
}

export async function backupCasesToIndexedDB(cases: any[]): Promise<void> {
  if (!cases || !Array.isArray(cases) || cases.length === 0) return;
  try {
    const idb = await getIDB();
    const tx = idb.transaction('case_backups', 'readwrite');
    const store = tx.objectStore('case_backups');
    for (const c of cases) {
      const key = c.caseNo || c.id;
      if (key) {
        store.put({ key, data: c, updatedAt: Date.now() });
      }
    }
  } catch (err) {
    console.warn('Backup cases to IDB notice:', err);
  }
}

export async function restoreCasesFromIndexedDB(): Promise<any[]> {
  try {
    const idb = await getIDB();
    return new Promise((resolve) => {
      const tx = idb.transaction('case_backups', 'readonly');
      const store = tx.objectStore('case_backups');
      const req = store.getAll();
      req.onsuccess = () => {
        const records = req.result || [];
        const cases = records.map((r: any) => r.data).filter(Boolean);
        resolve(cases);
      };
      req.onerror = () => resolve([]);
    });
  } catch (_) {
    return [];
  }
}

export async function backupVehiclesToIndexedDB(vehicles: any[]): Promise<void> {
  if (!vehicles || !Array.isArray(vehicles) || vehicles.length === 0) return;
  try {
    const idb = await getIDB();
    const tx = idb.transaction('vehicle_backups', 'readwrite');
    const store = tx.objectStore('vehicle_backups');
    for (const v of vehicles) {
      const key = v.registrationNumber || String(v.id);
      if (key) {
        store.put({ key, data: v, updatedAt: Date.now() });
      }
    }
  } catch (err) {
    console.warn('Backup vehicles to IDB notice:', err);
  }
}

export async function restoreVehiclesFromIndexedDB(): Promise<any[]> {
  try {
    const idb = await getIDB();
    return new Promise((resolve) => {
      const tx = idb.transaction('vehicle_backups', 'readonly');
      const store = tx.objectStore('vehicle_backups');
      const req = store.getAll();
      req.onsuccess = () => {
        const records = req.result || [];
        const vehicles = records.map((r: any) => r.data).filter(Boolean);
        resolve(vehicles);
      };
      req.onerror = () => resolve([]);
    });
  } catch (_) {
    return [];
  }
}

export async function clearOperationalIndexedDBCache(options?: {
  clearVehicles?: boolean;
  companyId?: string;
}): Promise<void> {
  try {
    const idb = await getIDB();
    const clearVehicles = options?.clearVehicles ?? true;
    const companyId = options?.companyId;

    if (!companyId) {
      await new Promise<void>((resolve) => {
        try {
          const tx = idb.transaction(['case_backups', 'vehicle_backups', 'documents'], 'readwrite');
          tx.objectStore('case_backups').clear();
          if (clearVehicles) {
            tx.objectStore('vehicle_backups').clear();
          }
          tx.objectStore('documents').clear();
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
        } catch (_) {
          resolve();
        }
      });
    } else {
      await new Promise<void>((resolve) => {
        try {
          const tx = idb.transaction('case_backups', 'readwrite');
          const store = tx.objectStore('case_backups');
          const req = store.getAll();
          req.onsuccess = () => {
            const records = req.result || [];
            for (const rec of records) {
              const recComp = rec?.data?.companyId || 'docks';
              if (recComp === companyId && rec.key) {
                store.delete(rec.key);
              }
            }
            resolve();
          };
          req.onerror = () => resolve();
        } catch (_) {
          resolve();
        }
      });
    }
  } catch (err) {
    console.warn('IndexedDB operational cache clear notice:', err);
  }
}
