/**
 * CertVoice — R2 Upload Service
 *
 * Two-step upload flow via certvoice-r2-upload worker:
 *   1. POST /api/upload-url  → get R2 key + upload endpoint
 *   2. PUT  /api/upload/:key → send binary file
 *
 * Also handles download (serves binary) and delete.
 *
 * @module services/uploadService
 */

// ============================================================
// CONFIG
// ============================================================

const R2_BASE_URL = import.meta.env.VITE_R2_BASE_URL ?? import.meta.env.VITE_API_BASE_URL ?? ''

// ============================================================
// TYPES
// ============================================================

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
// AUTH TOKEN
// ============================================================

interface ClerkInstance {
  session?: {
    getToken: () => Promise<string | null>
  } | null
}

async function getAuthToken(): Promise<string | null> {
  try {
    const clerk = (window as unknown as { Clerk?: ClerkInstance }).Clerk
    if (!clerk?.session) return null
    return await clerk.session.getToken()
  } catch {
    return null
  }
}

// ============================================================
// UPLOAD — Two-step flow
// ============================================================

/**
 * Upload a file to R2 via the two-step worker flow.
 *
 * @param file - File or Blob to upload
 * @param fileType - 'photo' or 'signature'
 * @param certificateId - UUID of the certificate (scopes the storage path)
 * @returns UploadResult with R2 key, or throws on failure
 */
export async function uploadFile(
  file: File | Blob,
  fileType: FileType,
  certificateId: string
): Promise<UploadResult> {
  const token = await getAuthToken()
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
// DOWNLOAD — Serve binary via worker
// ============================================================

/**
 * Get a download URL (object URL) for an R2 file.
 * Fetches the binary through the worker and creates a blob URL.
 *
 * @param key - R2 storage key
 * @returns Object URL for the file (must be revoked when no longer needed)
 */
export async function getFileUrl(key: string): Promise<string> {
  const token = await getAuthToken()
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
// DELETE
// ============================================================

/**
 * Delete a file from R2.
 *
 * @param key - R2 storage key
 */
export async function deleteFile(key: string): Promise<void> {
  const token = await getAuthToken()
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
