/**
 * CertVoice — Sync Service
 *
 * Background sync engine that watches connectivity and pushes
 * dirty certificates to the API when online.
 *
 * Strategy:
 *   1. Every certificate change saves to IndexedDB immediately (instant)
 *   2. Certificate is marked dirty
 *   3. When online, sync service picks up dirty certs and calls /sync endpoint
 *   4. On success, marks certificate clean
 *   5. On failure, retries with exponential backoff (max 3 retries)
 *
 * The sync service uses the bulk /sync endpoint rather than individual
 * circuit/observation calls — simpler, fewer requests, idempotent.
 *
 * Usage:
 *   const sync = createSyncService(getToken)
 *   sync.start()        // begin watching
 *   sync.syncNow()      // trigger immediate sync
 *   sync.stop()         // cleanup
 *   sync.onStatusChange((status) => ...)  // UI updates
 *
 * @module services/syncService
 */

import {
  getDirtyCertificates,
  markSynced,
  isOnline,
  onConnectivityChange,
} from './offlineStore'
import type { StoredCertificate } from './offlineStore'
import { syncCertificate } from './certificateApi'

// ============================================================
// TYPES
// ============================================================

export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'error' | 'synced'

export interface SyncServiceState {
  status: SyncStatus
  pendingCount: number
  lastSyncedAt: string | null
  lastError: string | null
}

type StatusCallback = (state: SyncServiceState) => void

// ============================================================
// CONSTANTS
// ============================================================

const SYNC_INTERVAL_MS = 30_000      // check every 30s when online
const RETRY_BASE_MS = 5_000          // first retry after 5s
const MAX_RETRIES = 3

// ============================================================
// SERVICE
// ============================================================

export function createSyncService(
  getToken: () => Promise<string | null>
) {
  let intervalId: ReturnType<typeof setInterval> | null = null
  let cleanupConnectivity: (() => void) | null = null
  let statusCallbacks: StatusCallback[] = []
  let isSyncing = false
  let retryCount = 0

  const state: SyncServiceState = {
    status: isOnline() ? 'idle' : 'offline',
    pendingCount: 0,
    lastSyncedAt: null,
    lastError: null,
  }

  // --- Notify listeners ---
  function notify(): void {
    statusCallbacks.forEach((cb) => {
      try { cb({ ...state }) } catch { /* ignore callback errors */ }
    })
  }

  function setState(updates: Partial<SyncServiceState>): void {
    Object.assign(state, updates)
    notify()
  }

  // --- Core sync logic ---
  async function syncAll(): Promise<void> {
    if (isSyncing) return
    if (!isOnline()) {
      setState({ status: 'offline' })
      return
    }

    isSyncing = true
    setState({ status: 'syncing' })

    try {
      const dirtyCerts = await getDirtyCertificates()
      setState({ pendingCount: dirtyCerts.length })

      if (dirtyCerts.length === 0) {
        setState({ status: 'synced', pendingCount: 0 })
        retryCount = 0
        isSyncing = false
        return
      }

      let syncedCount = 0

      for (const stored of dirtyCerts) {
        try {
          await syncOneCertificate(stored)
          syncedCount++
          setState({ pendingCount: dirtyCerts.length - syncedCount })
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Sync failed'
          console.error(`[SyncService] Failed to sync ${stored.id}:`, message)
          // Continue with next cert — don't block on one failure
        }
      }

      const remaining = dirtyCerts.length - syncedCount

      if (remaining === 0) {
        setState({
          status: 'synced',
          pendingCount: 0,
          lastSyncedAt: new Date().toISOString(),
          lastError: null,
        })
        retryCount = 0
      } else {
        setState({
          status: 'error',
          pendingCount: remaining,
          lastError: `${remaining} certificate(s) failed to sync`,
        })
        scheduleRetry()
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sync failed'
      setState({ status: 'error', lastError: message })
      scheduleRetry()
    } finally {
      isSyncing = false
    }
  }

  async function syncOneCertificate(stored: StoredCertificate): Promise<void> {
    const cert = stored.data
    if (!cert.id) throw new Error('Certificate has no ID')

    await syncCertificate(getToken, cert.id, cert)
    await markSynced(stored.id)
  }

  // --- Retry with backoff ---
  function scheduleRetry(): void {
    if (retryCount >= MAX_RETRIES) {
      setState({ status: 'error', lastError: 'Max retries reached. Will retry on next interval.' })
      retryCount = 0
      return
    }

    retryCount++
    const delay = RETRY_BASE_MS * Math.pow(2, retryCount - 1)
    setTimeout(() => {
      if (isOnline()) syncAll()
    }, delay)
  }

  // --- Connectivity handler ---
  function handleConnectivityChange(online: boolean): void {
    if (online) {
      setState({ status: 'idle' })
      // Sync immediately when coming back online
      syncAll()
    } else {
      setState({ status: 'offline' })
    }
  }

  // --- Public API ---
  return {
    /** Start watching for changes and connectivity */
    start(): void {
      // Set initial state
      setState({ status: isOnline() ? 'idle' : 'offline' })

      // Watch connectivity
      cleanupConnectivity = onConnectivityChange(handleConnectivityChange)

      // Periodic sync check
      intervalId = setInterval(() => {
        if (isOnline() && !isSyncing) syncAll()
      }, SYNC_INTERVAL_MS)

      // Initial sync
      if (isOnline()) syncAll()
    },

    /** Stop watching */
    stop(): void {
      if (intervalId) {
        clearInterval(intervalId)
        intervalId = null
      }
      if (cleanupConnectivity) {
        cleanupConnectivity()
        cleanupConnectivity = null
      }
      statusCallbacks = []
    },

    /** Trigger immediate sync */
    syncNow(): void {
      if (isOnline() && !isSyncing) syncAll()
    },

    /** Subscribe to status changes */
    onStatusChange(callback: StatusCallback): () => void {
      statusCallbacks.push(callback)
      // Emit current state immediately
      callback({ ...state })
      return () => {
        statusCallbacks = statusCallbacks.filter((cb) => cb !== callback)
      }
    },

    /** Get current state */
    getState(): SyncServiceState {
      return { ...state }
    },
  }
}
