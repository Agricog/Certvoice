/**
 * CertVoice — useOffline Hook
 *
 * Provides offline detection, pending sync count, and queue management.
 * Communicates with the service worker via postMessage to track
 * queued requests and trigger manual sync.
 *
 * Queue types: voice_extraction | pdf_generation | photo_upload | certificate_save
 *
 * @module hooks/useOffline
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { captureError } from '../utils/errorTracking'

// ============================================================
// TYPES
// ============================================================

export type OfflineQueueType =
  | 'voice_extraction'
  | 'pdf_generation'
  | 'photo_upload'
  | 'certificate_save'

export interface OfflineStatus {
  /** Whether the device currently has network connectivity */
  isOnline: boolean
  /** Number of requests waiting to be synced */
  pendingSync: number
  /** Whether a sync operation is currently in progress */
  isSyncing: boolean
  /** Timestamp of the last successful sync, or null */
  lastSyncAt: number | null
  /** Queue an action for offline replay */
  queueOfflineAction: (
    type: OfflineQueueType,
    url: string,
    method: 'POST' | 'PUT',
    data: Record<string, unknown>
  ) => Promise<string | null>
  /** Manually trigger sync of queued requests */
  triggerSync: () => void
  /** Refresh the pending count from the service worker */
  refreshPendingCount: () => void
}

// ============================================================
// CONSTANTS
// ============================================================

const OFFLINE_DB_NAME = 'certvoice-offline'
const OFFLINE_STORE_NAME = 'offline-requests'
const OFFLINE_DB_VERSION = 1

// ============================================================
// HOOK
// ============================================================

export function useOffline(): OfflineStatus {
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  )
  const [pendingSync, setPendingSync] = useState<number>(0)
  const [isSyncing, setIsSyncing] = useState<boolean>(false)
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null)

  const syncingRef = useRef<boolean>(false)

  // ---- Online/offline event listeners ----
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true)
      // Auto-trigger sync when connectivity returns
      triggerSyncInternal()
    }

    const handleOffline = () => {
      setIsOnline(false)
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- Listen for service worker messages ----
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (!event.data) return

      if (event.data.type === 'PENDING_COUNT') {
        setPendingSync(event.data.data?.count ?? 0)
      }

      if (event.data.type === 'SYNC_COMPLETE') {
        setIsSyncing(false)
        syncingRef.current = false
        setLastSyncAt(Date.now())
        // Refresh count after sync
        requestPendingCount()
      }
    }

    try {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.ready
          .then((registration) => {
            const reg = registration as ServiceWorkerRegistration & {
              sync?: { register: (tag: string) => Promise<void> }
            }
            if (reg.sync) {
              return reg.sync.register('sync-offline-requests')
            }
            fallbackManualSync()
            return
          })
          .catch(() => {
            fallbackManualSync()
          })
      } else {
        fallbackManualSync()
      }
    } catch {
      syncingRef.current = false
      setIsSyncing(false)
    }

  // ---- Initial pending count ----
  useEffect(() => {
    requestPendingCount()
  }, [])

  // ---- Request pending count from service worker ----
  const requestPendingCount = useCallback(() => {
    try {
      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({
          type: 'GET_PENDING_COUNT',
        })
      } else {
        // Fallback: read from IndexedDB directly
        getPendingCountDirect().then(setPendingSync).catch(() => setPendingSync(0))
      }
    } catch {
      // Service worker not available
    }
  }, [])

  // ---- Trigger sync via service worker ----
  const triggerSyncInternal = useCallback(() => {
    if (syncingRef.current) return
    if (!navigator.onLine) return

    syncingRef.current = true
    setIsSyncing(true)

    try {
      if ('serviceWorker' in navigator && 'sync' in ServiceWorkerRegistration.prototype) {
        navigator.serviceWorker.ready
          .then((registration) => {
            return registration.sync.register('sync-offline-requests')
          })
          .catch(() => {
            // Background Sync not supported — tell SW to sync manually
            fallbackManualSync()
          })
      } else {
        fallbackManualSync()
      }
    } catch {
      syncingRef.current = false
      setIsSyncing(false)
    }
  }, [])

  const fallbackManualSync = useCallback(() => {
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'TRIGGER_SYNC' })
    } else {
      syncingRef.current = false
      setIsSyncing(false)
    }
  }, [])

  // ---- Queue an action for offline replay ----
  const queueOfflineAction = useCallback(
    async (
      type: OfflineQueueType,
      url: string,
      method: 'POST' | 'PUT',
      data: Record<string, unknown>
    ): Promise<string | null> => {
      try {
        const db = await openOfflineDB()
        const id = crypto.randomUUID()

        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(OFFLINE_STORE_NAME, 'readwrite')
          const store = tx.objectStore(OFFLINE_STORE_NAME)

          const entry = {
            id,
            url,
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
            type,
            timestamp: Date.now(),
            retryCount: 0,
          }

          const request = store.add(entry)
          request.onsuccess = () => resolve()
          request.onerror = () => reject(request.error)
        })

        setPendingSync((prev) => prev + 1)

        // If online, trigger sync immediately
        if (navigator.onLine) {
          triggerSyncInternal()
        }

        return id
      } catch (error) {
        captureError(error, 'useOffline.queueOfflineAction')
        return null
      }
    },
    [triggerSyncInternal]
  )

  return {
    isOnline,
    pendingSync,
    isSyncing,
    lastSyncAt,
    queueOfflineAction,
    triggerSync: triggerSyncInternal,
    refreshPendingCount: requestPendingCount,
  }
}

// ============================================================
// INDEXED-DB HELPERS (direct access fallback)
// ============================================================

function openOfflineDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(OFFLINE_STORE_NAME)) {
        const store = db.createObjectStore(OFFLINE_STORE_NAME, {
          keyPath: 'id',
        })
        store.createIndex('timestamp', 'timestamp', { unique: false })
        store.createIndex('type', 'type', { unique: false })
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function getPendingCountDirect(): Promise<number> {
  const db = await openOfflineDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_STORE_NAME, 'readonly')
    const store = tx.objectStore(OFFLINE_STORE_NAME)
    const countRequest = store.count()
    countRequest.onsuccess = () => resolve(countRequest.result)
    countRequest.onerror = () => reject(countRequest.error)
  })
}

export default useOffline
