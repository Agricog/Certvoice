/**
 * CertVoice — PhotoCapture Component
 *
 * Camera/gallery image picker for inspection evidence photos.
 * Compresses before upload, shows thumbnails, supports delete.
 * Offline-aware: queues photos in IndexedDB when no signal.
 *
 * Props:
 *   - certificateId: UUID of the certificate
 *   - photoKeys: current R2 keys (controlled from parent)
 *   - onPhotosChange: callback when keys change (add/remove)
 *   - getToken: auth token provider (from useApiToken hook)
 *   - maxPhotos: max photos allowed (default 4)
 *   - disabled: disable capture
 *
 * @module components/PhotoCapture
 */

import { useState, useRef, useCallback, useEffect } from 'react'
import {
  uploadFileOffline,
  getFileUrlOffline,
  deleteFileOffline,
  compressImage,
  type GetToken,
} from '../services/uploadService'

// ============================================================
// TYPES
// ============================================================

interface PhotoItem {
  key: string
  localUrl: string | null
  uploading: boolean
  error: string | null
}

interface PhotoCaptureProps {
  certificateId: string
  photoKeys: string[]
  onPhotosChange: (keys: string[]) => void
  getToken: GetToken
  maxPhotos?: number
  disabled?: boolean
}

// ============================================================
// COMPONENT
// ============================================================

export default function PhotoCapture({
  certificateId,
  photoKeys,
  onPhotosChange,
  getToken,
  maxPhotos = 4,
  disabled = false,
}: PhotoCaptureProps) {
  const [photos, setPhotos] = useState<PhotoItem[]>([])
  const [globalError, setGlobalError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Sync photos state with incoming photoKeys (e.g. from saved data)
  useEffect(() => {
    setPhotos((prev) => {
      const existingKeys = new Set(prev.map((p) => p.key))
      const incomingKeys = new Set(photoKeys)

      // Add any keys we don't have locally
      const newItems: PhotoItem[] = photoKeys
        .filter((k) => !existingKeys.has(k))
        .map((key) => ({ key, localUrl: null, uploading: false, error: null }))

      // Keep existing items that are still in photoKeys, plus any currently uploading
      const kept = prev.filter((p) => incomingKeys.has(p.key) || p.uploading)

      return [...kept, ...newItems]
    })
  }, [photoKeys])

  // Load thumbnails for photos that don't have a local URL
  useEffect(() => {
    photos.forEach((photo) => {
      if (!photo.localUrl && !photo.uploading && !photo.error) {
        getFileUrlOffline(photo.key, getToken)
          .then((url) => {
            setPhotos((prev) =>
              prev.map((p) => (p.key === photo.key ? { ...p, localUrl: url } : p))
            )
          })
          .catch(() => {
            // Silently fail — thumbnail just won't show
          })
      }
    })
    // Cleanup blob URLs on unmount
    return () => {
      photos.forEach((p) => {
        if (p.localUrl) URL.revokeObjectURL(p.localUrl)
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photos.length])

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      setGlobalError(null)
      const files = e.target.files
      if (!files || files.length === 0) return

      const remaining = maxPhotos - photoKeys.length
      if (remaining <= 0) {
        setGlobalError(`Maximum ${maxPhotos} photos allowed`)
        return
      }

      const toProcess = Array.from(files).slice(0, remaining)

      for (const file of toProcess) {
        // Validate type
        if (!['image/jpeg', 'image/png'].includes(file.type)) {
          setGlobalError('Only JPEG and PNG files are accepted')
          continue
        }

        // Create placeholder
        const tempKey = `uploading-${Date.now()}-${Math.random().toString(36).slice(2)}`
        const localUrl = URL.createObjectURL(file)

        setPhotos((prev) => [
          ...prev,
          { key: tempKey, localUrl, uploading: true, error: null },
        ])

        try {
          // Compress
          const compressed = await compressImage(file, 1920, 0.85)

          // Upload (queues offline if no signal)
          const result = await uploadFileOffline(compressed, 'photo', certificateId, getToken)

          // Update state with real key (or offline:xxx temp key)
          setPhotos((prev) =>
            prev.map((p) =>
              p.key === tempKey
                ? { ...p, key: result.key, uploading: false }
                : p
            )
          )

          // Notify parent
          onPhotosChange([...photoKeys, result.key])
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Upload failed'
          setPhotos((prev) =>
            prev.map((p) =>
              p.key === tempKey ? { ...p, uploading: false, error: message } : p
            )
          )
        }
      }

      // Reset input so same file can be selected again
      if (fileInputRef.current) fileInputRef.current.value = ''
    },
    [certificateId, maxPhotos, photoKeys, onPhotosChange, getToken]
  )

  const handleDelete = useCallback(
    async (key: string) => {
      // Optimistically remove from UI
      setPhotos((prev) => {
        const removed = prev.find((p) => p.key === key)
        if (removed?.localUrl) URL.revokeObjectURL(removed.localUrl)
        return prev.filter((p) => p.key !== key)
      })

      // Notify parent
      onPhotosChange(photoKeys.filter((k) => k !== key))

      // Delete from R2 or remove from offline queue
      if (!key.startsWith('uploading-')) {
        deleteFileOffline(key, getToken).catch(() => {})
      }
    },
    [photoKeys, onPhotosChange, getToken]
  )

  const handleRetry = useCallback(
    (key: string) => {
      setPhotos((prev) => prev.filter((p) => p.key !== key))
    },
    []
  )

  const canAdd = !disabled && photoKeys.length < maxPhotos

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-gray-700">
          Photos ({photoKeys.length}/{maxPhotos})
        </label>
        {canAdd && (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-blue-700 active:bg-blue-800 transition-colors"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
            </svg>
            Add Photo
          </button>
        )}
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png"
        capture="environment"
        multiple
        className="hidden"
        onChange={handleFileSelect}
        disabled={disabled}
      />

      {/* Error */}
      {globalError && (
        <p className="text-xs text-red-600">{globalError}</p>
      )}

      {/* Thumbnails grid */}
      {photos.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {photos.map((photo) => (
            <div
              key={photo.key}
              className="relative aspect-square overflow-hidden rounded-lg border border-gray-200 bg-gray-50"
            >
              {/* Image */}
              {photo.localUrl && (
                <img
                  src={photo.localUrl}
                  alt="Inspection photo"
                  className={`h-full w-full object-cover ${
                    photo.uploading ? 'opacity-50' : ''
                  }`}
                />
              )}

              {/* Loading placeholder */}
              {!photo.localUrl && !photo.error && (
                <div className="flex h-full items-center justify-center">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
                </div>
              )}

              {/* Upload spinner overlay */}
              {photo.uploading && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                  <div className="h-8 w-8 animate-spin rounded-full border-3 border-white border-t-transparent" />
                </div>
              )}

              {/* Error overlay */}
              {photo.error && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-red-50 p-2 text-center">
                  <svg className="mb-1 h-5 w-5 text-red-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                  </svg>
                  <p className="text-xs text-red-600">{photo.error}</p>
                  <button
                    type="button"
                    onClick={() => handleRetry(photo.key)}
                    className="mt-1 text-xs font-medium text-red-700 underline"
                  >
                    Dismiss
                  </button>
                </div>
              )}

              {/* Delete button */}
              {!photo.uploading && !photo.error && !disabled && (
                <button
                  type="button"
                  onClick={() => handleDelete(photo.key)}
                  className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white hover:bg-black/80 transition-colors"
                  aria-label="Remove photo"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {photos.length === 0 && (
        <button
          type="button"
          onClick={() => canAdd && fileInputRef.current?.click()}
          disabled={!canAdd}
          className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-300 py-6 text-sm text-gray-500 hover:border-blue-400 hover:text-blue-600 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
          </svg>
          Tap to add evidence photos
        </button>
      )}
    </div>
  )
}
