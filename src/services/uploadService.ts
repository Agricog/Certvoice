/**
 * CertVoice — R2 Upload Service
 *
 * Two-step upload flow via certvoice-r2-upload worker:
 *   1. POST /api/upload-url  → get R2 key + upload endpoint
 *   2. PUT  /api/upload/:key → send binary file
 *
 * Also handles download (serves binary) and delete.
 *
 * Offline-aware wrappers (uploadFileOffline, getFileUrlOffline,
 * deleteFileOffline) catch network failures and fall back to the
 * IndexedDB photoQueue. The sync service drains the queue when
 * connectivity returns.
 *
 * Auth: All functions accept a `getToken` callback, injected from the React
 * layer via `useApiToken`. This keeps auth in one place and avoids coupling
 * to `window.Clerk`.
 *
 * @module services/uploadService
 */

import {
  queuePhoto,
  getQueuedPhotoByKey,
  removePhotoByTempKey,
  isOnline,
} from './offlineStore'

// ============================================================
// CONFIG
// ============================================================

const R2_BASE_URL = import.meta.env.VITE_R2_BASE_URL ?? import.meta.env.VITE_API_BASE_URL ?? ''

/** Prefix for offline-queued temp keys */
export const OFFLINE_KEY_PREFIX = 'offline:'

// ============================================================
// TYPES
// ============================================================

export type GetToken = () => Promise<string | null>

export type FileType = 'photo' | 'signature'

export interface UploadResult {
  key: string
  size: number
  contentType: string
}

interface UploadUrlResponse {
  key: string
  uploadEndpoint: string
  maxSize: number
  expiresIn: number
  contentType: string
}

// ============================================================
// UPLOAD — Two-step flow (pure network)
// ============================================================

/**
 * Upload a file to R2 via the two-step worker flow.
 * This is the pure network version — used by syncService to drain the queue.
 *
 * @param file - File or Blob to upload
 * @param fileType - 'photo' or 'signature'
 * @param certificateId - UUID of the certificate (scopes the storage path)
 * @param getToken - Auth token provider (from useApiToken hook)
 * @returns UploadResult with R2 key, or throws on failure
 */
export async function uploadFile(
  file: File | Blob,
  fileType: FileType,
  certificateId: string,
  getToken: GetToken
): Promise<UploadResult> {
  const token = await getToken()
  if (!token) throw new Error('Not authenticated')

  const filename = file instanceof File
    ? file.name
    : `${fileType}-${Date.now()}.${fileType === 'signature' ? 'png' : 'jpg'}`

  const contentType = file.type || (fileType === 'signature' ? 'image/png' : 'image/jpeg')

  // Step 1: Get upload key
  const urlRes = await fetch(`${R2_BASE_URL}/api/upload-url`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      filename,
      contentType,
      fileType,
      certificateId,
    }),
  })

  if (!urlRes.ok) {
    const err = await urlRes.json().catch(() => ({ error: 'Upload URL request failed' }))
    throw new Error((err as { error?: string }).error ?? `Upload URL failed (${urlRes.status})`)
  }

  const urlData = (await urlRes.json()) as UploadUrlResponse

  // Step 2: PUT binary to upload endpoint
  const uploadRes = await fetch(`${R2_BASE_URL}${urlData.uploadEndpoint}`, {
    method: 'PUT',
    headers: {
      'Content-Type': contentType,
      'Authorization': `Bearer ${token}`,
    },
    body: file,
  })

  if (!uploadRes.ok) {
    const err = await uploadRes.json().catch(() => ({ error: 'Upload failed' }))
    throw new Error((err as { error?: string }).error ?? `Upload failed (${uploadRes.status})`)
  }

  const result = (await uploadRes.json()) as { key: string; size: number; contentType: string }

  return {
    key: result.key,
    size: result.size,
    contentType: result.contentType,
  }
}

// ============================================================
// DOWNLOAD — Serve binary via worker (pure network)
// ============================================================

/**
 * Get a download URL (object URL) for an R2 file.
 * Fetches the binary through the worker and creates a blob URL.
 *
 * @param key - R2 storage key
 * @param getToken - Auth token provider
 * @returns Object URL for the file (must be revoked when no longer needed)
 */
export async function getFileUrl(key: string, getToken: GetToken): Promise<string> {
  const token = await getToken()
  if (!token) throw new Error('Not authenticated')

  const res = await fetch(`${R2_BASE_URL}/api/download-url`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ key }),
  })

  if (!res.ok) {
    throw new Error(`Download failed (${res.status})`)
  }

  const blob = await res.blob()
  return URL.createObjectURL(blob)
}

// ============================================================
// DELETE (pure network)
// ============================================================

/**
 * Delete a file from R2.
 *
 * @param key - R2 storage key
 * @param getToken - Auth token provider
 */
export async function deleteFile(key: string, getToken: GetToken): Promise<void> {
  const token = await getToken()
  if (!token) throw new Error('Not authenticated')

  const res = await fetch(`${R2_BASE_URL}/api/file`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ key }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Delete failed' }))
    throw new Error((err as { error?: string }).error ?? `Delete failed (${res.status})`)
  }
}

// ============================================================
// OFFLINE-AWARE WRAPPERS
// ============================================================

/**
 * Check if a key is an offline temp key.
 */
export function isOfflineKey(key: string): boolean {
  return key.startsWith(OFFLINE_KEY_PREFIX)
}

/**
 * Upload a file with offline fallback.
 * Tries the network first. On failure when offline, queues the blob
 * in IndexedDB and returns a temporary key (offline:{uuid}).
 * The sync service uploads queued photos and replaces temp keys.
 */
export async function uploadFileOffline(
  file: File | Blob,
  fileType: FileType,
  certificateId: string,
  getToken: GetToken
): Promise<UploadResult> {
  // Try network upload first
  try {
    return await uploadFile(file, fileType, certificateId, getToken)
  } catch (err) {
    // Only queue if actually offline — rethrow auth/server errors
    if (!isOnline()) {
      const tempKey = `${OFFLINE_KEY_PREFIX}${crypto.randomUUID()}`
      const contentType = file.type || (fileType === 'signature' ? 'image/png' : 'image/jpeg')
      const filename = file instanceof File
        ? file.name
        : `${fileType}-${Date.now()}.${fileType === 'signature' ? 'png' : 'jpg'}`

      await queuePhoto({
        tempKey,
        certId: certificateId,
        fileType,
        blob: file,
        contentType,
        filename,
        createdAt: new Date().toISOString(),
      })

      return {
        key: tempKey,
        size: file.size,
        contentType,
      }
    }

    throw err
  }
}

/**
 * Get a file URL with offline fallback.
 * If the key is an offline temp key, loads the blob from IndexedDB.
 * Otherwise fetches from R2 via the worker.
 */
export async function getFileUrlOffline(key: string, getToken: GetToken): Promise<string> {
  if (isOfflineKey(key)) {
    const queued = await getQueuedPhotoByKey(key)
    if (queued) {
      return URL.createObjectURL(queued.blob)
    }
    throw new Error('Offline photo not found in queue')
  }

  return getFileUrl(key, getToken)
}

/**
 * Delete a file with offline fallback.
 * If the key is an offline temp key, removes from the IndexedDB queue.
 * Otherwise deletes from R2 via the worker.
 */
export async function deleteFileOffline(key: string, getToken: GetToken): Promise<void> {
  if (isOfflineKey(key)) {
    await removePhotoByTempKey(key)
    return
  }

  return deleteFile(key, getToken)
}

// ============================================================
// HELPERS
// ============================================================

/**
 * Compress an image file before upload (photos only).
 * Uses canvas to resize and convert to JPEG.
 *
 * @param file - Original image file
 * @param maxDimension - Max width or height in px (default 1920)
 * @param quality - JPEG quality 0-1 (default 0.85)
 * @returns Compressed Blob
 */
export async function compressImage(
  file: File | Blob,
  maxDimension: number = 1920,
  quality: number = 0.85
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)

    img.onload = () => {
      URL.revokeObjectURL(url)

      let { width, height } = img

      // Scale down if needed
      if (width > maxDimension || height > maxDimension) {
        const ratio = Math.min(maxDimension / width, maxDimension / height)
        width = Math.round(width * ratio)
        height = Math.round(height * ratio)
      }

      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height

      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('Canvas context unavailable'))
        return
      }

      ctx.drawImage(img, 0, 0, width, height)

      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob)
          else reject(new Error('Compression failed'))
        },
        'image/jpeg',
        quality
      )
    }

    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Image load failed'))
    }

    img.src = url
  })
}
