/**
 * CertVoice — Offline Store (IndexedDB)
 *
 * Provides offline-first persistence for certificates and photo blobs.
 * Every change is written to IndexedDB immediately (instant, no network).
 * The sync service reads from here and pushes to the API when online.
 *
 * Stores:
 *   certificates  — Full certificate state (mirrors React state)
 *   syncQueue     — Pending operations to sync when online
 *   photoQueue    — Blobs queued for R2 upload when back online (v2)
 *
 * @module services/offlineStore
 */

import type { EICRCertificate } from '../types/eicr'

// ============================================================
// CONSTANTS
// ============================================================

const DB_NAME = 'certvoice-offline'
const DB_VERSION = 2
const CERT_STORE = 'certificates'
const SYNC_STORE = 'syncQueue'
const PHOTO_STORE = 'photoQueue'

// ============================================================
// TYPES
// ============================================================

export type SyncOperation =
  | { type: 'add-circuit'; certId: string; data: Record<string, unknown>; timestamp: number }
  | { type: 'update-circuit'; certId: string; circuitId: string; data: Record<string, unknown>; timestamp: number }
  | { type: 'delete-circuit'; certId: string; circuitId: string; timestamp: number }
  | { type: 'add-observation'; certId: string; data: Record<string, unknown>; timestamp: number }
  | { type: 'update-observation'; certId: string; obsId: string; data: Record<string, unknown>; timestamp: number }
  | { type: 'delete-observation'; certId: string; obsId: string; timestamp: number }
  | { type: 'add-board'; certId: string; data: Record<string, unknown>; timestamp: number }
  | { type: 'update-board'; certId: string; boardId: string; data: Record<string, unknown>; timestamp: number }
  | { type: 'update-certificate'; certId: string; data: Record<string, unknown>; timestamp: number }
  | { type: 'full-sync'; certId: string; timestamp: number }

export interface SyncQueueItem {
  id?: number // auto-increment
  operation: SyncOperation
  retries: number
  createdAt: string
}

export interface StoredCertificate {
  id: string
  data: Partial<EICRCertificate>
  lastModified: string
  lastSynced: string | null
  isDirty: boolean
}

export interface QueuedPhoto {
  id?: number
  /** Temporary key used in photoKeys/signatureKey until upload completes */
  tempKey: string
  /** Certificate this photo belongs to */
  certId: string
  /** 'photo' or 'signature' */
  fileType: 'photo' | 'signature'
  /** The actual image blob (stored natively in IndexedDB) */
  blob: Blob
  /** MIME type */
  contentType: string
  /** Original or generated filename */
  filename: string
  createdAt: string
}

// ============================================================
// DATABASE
// ============================================================

let dbInstance: IDBDatabase | null = null

function openDB(): Promise<IDBDatabase> {
  if (dbInstance) return Promise.resolve(dbInstance)

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = (event) => {
      const db = request.result
      const oldVersion = event.oldVersion

      // v1 stores: certificates + syncQueue
      if (oldVersion < 1) {
        const certStore = db.createObjectStore(CERT_STORE, { keyPath: 'id' })
        certStore.createIndex('isDirty', 'isDirty', { unique: false })
        certStore.createIndex('lastModified', 'lastModified', { unique: false })

        db.createObjectStore(SYNC_STORE, { keyPath: 'id', autoIncrement: true })
      }

      // v2 store: photoQueue (blobs awaiting R2 upload)
      if (oldVersion < 2) {
        if (!db.objectStoreNames.contains(PHOTO_STORE)) {
          const photoStore = db.createObjectStore(PHOTO_STORE, { keyPath: 'id', autoIncrement: true })
          photoStore.createIndex('certId', 'certId', { unique: false })
          photoStore.createIndex('tempKey', 'tempKey', { unique: true })
        }
      }
    }

    request.onsuccess = () => {
      dbInstance = request.result
      resolve(dbInstance)
    }

    request.onerror = () => {
      reject(new Error('Failed to open IndexedDB'))
    }
  })
}

// ============================================================
// CERTIFICATE OPERATIONS
// ============================================================

/** Save full certificate state locally (instant, no network) */
export async function saveCertificate(
  certId: string,
  data: Partial<EICRCertificate>,
  markDirty = true
): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CERT_STORE, 'readwrite')
    const store = tx.objectStore(CERT_STORE)

    const record: StoredCertificate = {
      id: certId,
      data,
      lastModified: new Date().toISOString(),
      lastSynced: markDirty ? null : new Date().toISOString(),
      isDirty: markDirty,
    }

    const request = store.put(record)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(new Error('Failed to save certificate'))
  })
}

/** Load certificate from local store */
export async function getCertificate(certId: string): Promise<StoredCertificate | null> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CERT_STORE, 'readonly')
    const store = tx.objectStore(CERT_STORE)
    const request = store.get(certId)
    request.onsuccess = () => resolve(request.result ?? null)
    request.onerror = () => reject(new Error('Failed to load certificate'))
  })
}

/** List all locally stored certificates */
export async function listLocalCertificates(): Promise<StoredCertificate[]> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CERT_STORE, 'readonly')
    const store = tx.objectStore(CERT_STORE)
    const request = store.getAll()
    request.onsuccess = () => resolve(request.result ?? [])
    request.onerror = () => reject(new Error('Failed to list certificates'))
  })
}

/** Get certificates that need syncing */
export async function getDirtyCertificates(): Promise<StoredCertificate[]> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CERT_STORE, 'readonly')
    const store = tx.objectStore(CERT_STORE)
    const index = store.index('isDirty')
    const request = index.getAll()
    request.onsuccess = () => resolve((request.result ?? []).filter((r: StoredCertificate) => r.isDirty))
    request.onerror = () => reject(new Error('Failed to query dirty certificates'))
  })
}

/** Mark certificate as synced (clean) */
export async function markSynced(certId: string): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CERT_STORE, 'readwrite')
    const store = tx.objectStore(CERT_STORE)
    const getReq = store.get(certId)

    getReq.onsuccess = () => {
      const record = getReq.result as StoredCertificate | undefined
      if (!record) { resolve(); return }

      record.isDirty = false
      record.lastSynced = new Date().toISOString()
      const putReq = store.put(record)
      putReq.onsuccess = () => resolve()
      putReq.onerror = () => reject(new Error('Failed to mark synced'))
    }

    getReq.onerror = () => reject(new Error('Failed to get certificate for sync mark'))
  })
}

/** Delete certificate from local store */
export async function deleteLocalCertificate(certId: string): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CERT_STORE, 'readwrite')
    const store = tx.objectStore(CERT_STORE)
    const request = store.delete(certId)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(new Error('Failed to delete certificate'))
  })
}

/** Update a single field on a stored certificate (used by sync service for serverCertId) */
export async function updateCertificateField(
  localId: string,
  field: string,
  value: unknown
): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CERT_STORE, 'readwrite')
    const store = tx.objectStore(CERT_STORE)
    const getReq = store.get(localId)

    getReq.onsuccess = () => {
      const record = getReq.result as StoredCertificate | undefined
      if (!record) { resolve(); return }

      (record.data as Record<string, unknown>)[field] = value
      const putReq = store.put(record)
      putReq.onsuccess = () => resolve()
      putReq.onerror = () => reject(new Error('Failed to update certificate field'))
    }

    getReq.onerror = () => reject(new Error('Failed to get certificate for field update'))
  })
}

// ============================================================
// PHOTO QUEUE OPERATIONS
// ============================================================

/** Queue a photo blob for upload when back online */
export async function queuePhoto(photo: Omit<QueuedPhoto, 'id'>): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PHOTO_STORE, 'readwrite')
    const store = tx.objectStore(PHOTO_STORE)
    const request = store.add(photo)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(new Error('Failed to queue photo'))
  })
}

/** Get all pending photos awaiting upload */
export async function getPendingPhotos(): Promise<QueuedPhoto[]> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PHOTO_STORE, 'readonly')
    const store = tx.objectStore(PHOTO_STORE)
    const request = store.getAll()
    request.onsuccess = () => resolve(request.result ?? [])
    request.onerror = () => reject(new Error('Failed to get pending photos'))
  })
}

/** Get a single queued photo by its temp key (for local display) */
export async function getQueuedPhotoByKey(tempKey: string): Promise<QueuedPhoto | null> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PHOTO_STORE, 'readonly')
    const store = tx.objectStore(PHOTO_STORE)
    const index = store.index('tempKey')
    const request = index.get(tempKey)
    request.onsuccess = () => resolve(request.result ?? null)
    request.onerror = () => reject(new Error('Failed to get queued photo'))
  })
}

/** Remove a photo from the queue after successful upload */
export async function removePhotoQueueItem(id: number): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PHOTO_STORE, 'readwrite')
    const store = tx.objectStore(PHOTO_STORE)
    const request = store.delete(id)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(new Error('Failed to remove photo from queue'))
  })
}

/** Remove a queued photo by its temp key (for delete while still offline) */
export async function removePhotoByTempKey(tempKey: string): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PHOTO_STORE, 'readwrite')
    const store = tx.objectStore(PHOTO_STORE)
    const index = store.index('tempKey')
    const getReq = index.getKey(tempKey)

    getReq.onsuccess = () => {
      const key = getReq.result
      if (key == null) { resolve(); return }
      const delReq = store.delete(key)
      delReq.onsuccess = () => resolve()
      delReq.onerror = () => reject(new Error('Failed to remove photo by temp key'))
    }

    getReq.onerror = () => reject(new Error('Failed to find photo by temp key'))
  })
}

/** Get count of queued photos */
export async function pendingPhotoCount(): Promise<number> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PHOTO_STORE, 'readonly')
    const store = tx.objectStore(PHOTO_STORE)
    const request = store.count()
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(new Error('Failed to count queued photos'))
  })
}

// ============================================================
// SYNC QUEUE OPERATIONS
// ============================================================

/** Queue an operation for background sync */
export async function queueSync(operation: SyncOperation): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SYNC_STORE, 'readwrite')
    const store = tx.objectStore(SYNC_STORE)

    const item: SyncQueueItem = {
      operation,
      retries: 0,
      createdAt: new Date().toISOString(),
    }

    const request = store.add(item)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(new Error('Failed to queue sync operation'))
  })
}

/** Get all pending sync operations (FIFO order) */
export async function getPendingSyncs(): Promise<SyncQueueItem[]> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SYNC_STORE, 'readonly')
    const store = tx.objectStore(SYNC_STORE)
    const request = store.getAll()
    request.onsuccess = () => resolve(request.result ?? [])
    request.onerror = () => reject(new Error('Failed to get pending syncs'))
  })
}

/** Remove a processed sync operation */
export async function removeSyncItem(id: number): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SYNC_STORE, 'readwrite')
    const store = tx.objectStore(SYNC_STORE)
    const request = store.delete(id)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(new Error('Failed to remove sync item'))
  })
}

/** Increment retry count for a failed sync */
export async function incrementRetry(id: number): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SYNC_STORE, 'readwrite')
    const store = tx.objectStore(SYNC_STORE)
    const getReq = store.get(id)

    getReq.onsuccess = () => {
      const item = getReq.result as SyncQueueItem | undefined
      if (!item) { resolve(); return }

      item.retries++
      const putReq = store.put(item)
      putReq.onsuccess = () => resolve()
      putReq.onerror = () => reject(new Error('Failed to increment retry'))
    }

    getReq.onerror = () => reject(new Error('Failed to get sync item'))
  })
}

/** Clear all pending syncs (use with caution — e.g. after full sync) */
export async function clearSyncQueue(): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SYNC_STORE, 'readwrite')
    const store = tx.objectStore(SYNC_STORE)
    const request = store.clear()
    request.onsuccess = () => resolve()
    request.onerror = () => reject(new Error('Failed to clear sync queue'))
  })
}

/** Get count of pending syncs */
export async function pendingSyncCount(): Promise<number> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SYNC_STORE, 'readonly')
    const store = tx.objectStore(SYNC_STORE)
    const request = store.count()
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(new Error('Failed to count syncs'))
  })
}

// ============================================================
// CONNECTIVITY CHECK
// ============================================================

/** Check if the device is online */
export function isOnline(): boolean {
  return typeof navigator !== 'undefined' ? navigator.onLine : true
}

/** Listen for connectivity changes */
export function onConnectivityChange(callback: (online: boolean) => void): () => void {
  const handleOnline = () => callback(true)
  const handleOffline = () => callback(false)

  window.addEventListener('online', handleOnline)
  window.addEventListener('offline', handleOffline)

  return () => {
    window.removeEventListener('online', handleOnline)
    window.removeEventListener('offline', handleOffline)
  }
}
