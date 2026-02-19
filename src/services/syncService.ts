/**
 * CertVoice — Sync Service (v4)
 *
 * Background sync engine — watches connectivity and pushes dirty
 * certificates to the API when online.
 *
 * v4 changes:
 *   - Photo queue: uploads offline-queued photos to R2 before cert sync
 *   - Replaces offline:xxx temp keys with real R2 keys in cert data
 *
 * v3 changes:
 *   - Multi-cert-type: handles EICR (sync endpoint) and MW (create+update)
 *   - MW certs use createCertificate + updateCertificate with typeData
 *   - EICR certs continue using /sync endpoint for boards/circuits/observations
 *
 * v2 changes:
 *   - Auth-aware: pauses sync on ApiAuthError (no token / expired session)
 *   - Rate-limit-aware: reads retryAfterSeconds from ApiRateLimitError
 *   - Last-write-wins: sends lastModified timestamp with each sync
 *   - Smarter backoff: uses Retry-After from 429 instead of fixed intervals
 *
 * Strategy:
 *   1. Every certificate change saves to IndexedDB immediately (instant)
 *   2. Certificate is marked dirty with lastModified timestamp
 *   3. When online + authenticated, sync service:
 *      a. Drains photo queue first (upload blobs, replace temp keys)
 *      b. Then syncs dirty certificates
 *   4. EICR: calls /sync endpoint with boards/circuits/observations
 *   5. MW: calls createCertificate (if new) or updateCertificate (if exists)
 *   6. On success: marks certificate clean
 *   7. On auth failure: pauses sync, sets status to 'auth-required'
 *   8. On rate limit: backs off for Retry-After seconds
 *   9. On other failure: exponential backoff (max 3 retries per cert)
 *
 * @module services/syncService
 */

import {
  getDirtyCertificates,
  markSynced,
  isOnline,
  onConnectivityChange,
  getPendingPhotos,
  removePhotoQueueItem,
  getCertificate as getLocalCertificate,
  saveCertificate as saveToLocal,
} from './offlineStore'
import type { StoredCertificate, QueuedPhoto } from './offlineStore'
import {
  syncCertificate,
  createCertificate,
  updateCertificate,
  ApiAuthError,
  ApiRateLimitError,
} from './certificateApi'
import { uploadFile, } from './uploadService'
import type { Observation, Declaration } from '../types/eicr'

// ============================================================
// TYPES
// ============================================================

export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'error' | 'synced' | 'auth-required'

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
  let retryTimeoutId: ReturnType<typeof setTimeout> | null = null
  let cleanupConnectivity: (() => void) | null = null
  let statusCallbacks: StatusCallback[] = []
  let isSyncing = false
  let retryCount = 0
  let rateLimitPauseUntil = 0

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

  // --- Photo queue processing ---
  /**
   * Upload all queued photos to R2, then replace temp keys in their
   * parent certificates. This runs BEFORE certificate sync so the
   * cert data sent to the server already has real R2 keys.
   */
  async function processPhotoQueue(): Promise<void> {
    let pending: QueuedPhoto[]
    try {
      pending = await getPendingPhotos()
    } catch {
      return // IndexedDB read failed — skip, will retry next cycle
    }

    if (pending.length === 0) return

    for (const photo of pending) {
      try {
        // Upload the blob to R2 (uses pure network function, not offline wrapper)
        const result = await uploadFile(
          photo.blob,
          photo.fileType,
          photo.certId,
          getToken
        )

        const realKey = result.key
        const tempKey = photo.tempKey

        // Replace temp key in the parent certificate's IndexedDB data
        await replaceTempKeyInCert(photo.certId, tempKey, realKey)

        // Remove from photo queue
        if (photo.id != null) {
          await removePhotoQueueItem(photo.id)
        }
      } catch (err) {
        // Auth/rate-limit errors bubble up to stop the whole sync
        if (err instanceof ApiAuthError || err instanceof ApiRateLimitError) {
          throw err
        }
        // Other errors (network hiccup) — skip this photo, retry next cycle
        console.warn(`[SyncService] Photo upload failed for ${photo.tempKey}:`, err)
      }
    }
  }

  /**
   * Find a temp key in a certificate's observations/declaration and
   * replace it with the real R2 key. Marks the cert dirty so the
   * subsequent cert sync pushes the updated keys to the server.
   */
  async function replaceTempKeyInCert(
    certId: string,
    tempKey: string,
    realKey: string
  ): Promise<void> {
    const stored = await getLocalCertificate(certId)
    if (!stored) return

    const cert = stored.data
    let changed = false

    // Search observations → photoKeys
    if (cert.observations) {
      const observations = cert.observations as Observation[]
      for (const obs of observations) {
        if (obs.photoKeys) {
          const idx = obs.photoKeys.indexOf(tempKey)
          if (idx !== -1) {
            obs.photoKeys[idx] = realKey
            changed = true
          }
        }
      }
    }

    // Search declaration → inspector/QS signature keys
    if (cert.declaration) {
      const decl = cert.declaration as Declaration
      if (decl.inspectorSignatureKey === tempKey) {
        decl.inspectorSignatureKey = realKey
        changed = true
      }
      if (decl.qsSignatureKey === tempKey) {
        decl.qsSignatureKey = realKey
        changed = true
      }
    }

    if (changed) {
      // Save back with dirty flag so cert sync picks it up
      await saveToLocal(certId, cert, true)
    }
  }

  // --- Core sync logic ---
  async function syncAll(): Promise<void> {
    if (isSyncing) return
    if (!isOnline()) {
      setState({ status: 'offline' })
      return
    }

    // Respect rate limit pause
    if (Date.now() < rateLimitPauseUntil) {
      const waitSec = Math.ceil((rateLimitPauseUntil - Date.now()) / 1000)
      setState({ status: 'error', lastError: `Rate limited — retrying in ${waitSec}s` })
      return
    }

    // Check token availability before starting
    const token = await getToken()
    if (!token) {
      setState({ status: 'auth-required', lastError: 'Sign in to sync' })
      return
    }

    isSyncing = true
    setState({ status: 'syncing' })

    try {
      // Phase 1: Upload queued photos (replaces temp keys in cert data)
      await processPhotoQueue()

      // Phase 2: Sync dirty certificates
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
          // Auth error — pause everything
          if (err instanceof ApiAuthError) {
            setState({ status: 'auth-required', lastError: 'Sign in to sync' })
            isSyncing = false
            return
          }

          // Rate limit — pause for Retry-After duration
          if (err instanceof ApiRateLimitError) {
            rateLimitPauseUntil = Date.now() + (err.retryAfterSeconds * 1000)
            setState({
              status: 'error',
              lastError: `Rate limited — retrying in ${err.retryAfterSeconds}s`,
            })
            scheduleRetry(err.retryAfterSeconds * 1000)
            isSyncing = false
            return
          }

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
      // Auth/rate-limit from photo queue processing
      if (err instanceof ApiAuthError) {
        setState({ status: 'auth-required', lastError: 'Sign in to sync' })
        isSyncing = false
        return
      }
      if (err instanceof ApiRateLimitError) {
        rateLimitPauseUntil = Date.now() + (err.retryAfterSeconds * 1000)
        setState({
          status: 'error',
          lastError: `Rate limited — retrying in ${err.retryAfterSeconds}s`,
        })
        scheduleRetry(err.retryAfterSeconds * 1000)
        isSyncing = false
        return
      }

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

    // Detect certificate type from stored data
    const raw = cert as unknown as Record<string, unknown>
    const certType = (raw.certificateType as string) ?? 'EICR'

    if (certType === 'MINOR_WORKS') {
      await syncMinorWorksCert(stored)
    } else {
      await syncEicrCert(stored)
    }

    await markSynced(stored.id)
  }

  /**
   * EICR sync — uses /sync endpoint for boards, circuits, observations.
   */
  async function syncEicrCert(stored: StoredCertificate): Promise<void> {
    const cert = stored.data
    await syncCertificate(getToken, cert.id!, cert, stored.lastModified)
  }

  /**
   * Minor Works sync — MW certs store everything in typeData.
   */
  async function syncMinorWorksCert(stored: StoredCertificate): Promise<void> {
    const raw = stored.data as unknown as Record<string, unknown>
    const serverCertId = raw.serverCertId as string | undefined

    const clientDetails = raw.clientDetails as Record<string, string> | undefined
    const clientName = clientDetails?.clientName ?? null
    const clientAddress = clientDetails?.clientAddress ?? null

    const typeData: Record<string, unknown> = {}
    const mwSections = [
      'description', 'installation', 'circuit', 'testResults',
      'declaration', 'nextInspection', 'partPRequired', 'schemeNotification',
    ]
    for (const key of mwSections) {
      if (raw[key] !== undefined) {
        typeData[key] = raw[key]
      }
    }

    if (clientDetails) {
      typeData.clientDetails = clientDetails
    }

    if (serverCertId) {
      await updateCertificate(getToken, serverCertId, {
        clientName,
        clientAddress,
        typeData,
      })
    } else {
      const result = await createCertificate(getToken, {
        certificateType: 'MINOR_WORKS',
        clientName: clientName ?? undefined,
        clientAddress: clientAddress ?? undefined,
        installationAddress: clientAddress ?? undefined,
        typeData,
      })

      try {
        const { updateCertificateField } = await import('./offlineStore')
        await updateCertificateField(stored.id, 'serverCertId', result.id)
      } catch {
        console.warn('[SyncService] Could not store serverCertId back to IndexedDB')
      }
    }
  }

  // --- Retry with backoff ---
  function scheduleRetry(delayMs?: number): void {
    if (retryTimeoutId) {
      clearTimeout(retryTimeoutId)
      retryTimeoutId = null
    }

    if (retryCount >= MAX_RETRIES && !delayMs) {
      setState({ status: 'error', lastError: 'Max retries reached. Will retry on next interval.' })
      retryCount = 0
      return
    }

    retryCount++
    const delay = delayMs ?? RETRY_BASE_MS * Math.pow(2, retryCount - 1)

    retryTimeoutId = setTimeout(() => {
      retryTimeoutId = null
      if (isOnline()) syncAll()
    }, delay)
  }

  // --- Connectivity handler ---
  function handleConnectivityChange(online: boolean): void {
    if (online) {
      setState({ status: 'idle' })
      syncAll()
    } else {
      setState({ status: 'offline' })
    }
  }

  // --- Public API ---
  return {
    /** Start watching for changes and connectivity */
    start(): void {
      setState({ status: isOnline() ? 'idle' : 'offline' })
      cleanupConnectivity = onConnectivityChange(handleConnectivityChange)

      intervalId = setInterval(() => {
        if (isOnline() && !isSyncing) syncAll()
      }, SYNC_INTERVAL_MS)

      if (isOnline()) syncAll()
    },

    /** Stop watching */
    stop(): void {
      if (intervalId) {
        clearInterval(intervalId)
        intervalId = null
      }
      if (retryTimeoutId) {
        clearTimeout(retryTimeoutId)
        retryTimeoutId = null
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
