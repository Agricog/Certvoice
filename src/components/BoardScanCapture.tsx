/**
 * CertVoice — BoardScanCapture Component
 *
 * Camera capture for consumer unit circuit schedule labels.
 * Takes photo → compresses → sends to Claude Vision → passes results to BoardScanReview.
 *
 * Flow:
 *   1. Tap camera button → native camera opens (rear-facing)
 *   2. Photo preview with "Scan" button
 *   3. Compress to max 1920px JPEG before sending
 *   4. Send base64 to /api/extract-board-photo
 *   5. On success → pass results to parent for review
 *
 * Drop into: src/components/BoardScanCapture.tsx
 *
 * @module components/BoardScanCapture
 */

import { useState, useCallback, useRef } from 'react'
import { Camera, X, Loader2, RotateCcw, Zap } from 'lucide-react'
import { useBoardScan } from '../hooks/useBoardScan'
import type { BoardScanResult } from '../hooks/useBoardScan'
import type { GetToken } from '../services/uploadService'

// ============================================================
// TYPES
// ============================================================

interface BoardScanCaptureProps {
  getToken: GetToken
  onScanComplete: (result: BoardScanResult) => void
  onCancel: () => void
}

// ============================================================
// IMAGE COMPRESSION
// ============================================================

const MAX_DIMENSION = 1920
const JPEG_QUALITY = 0.85

/**
 * Compress image to max 1920px dimension, JPEG output.
 * Returns base64 string (without data URL prefix) and media type.
 */
async function compressForScan(file: File): Promise<{ base64: string; mediaType: 'image/jpeg' }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)

    img.onload = () => {
      URL.revokeObjectURL(url)

      let { width, height } = img

      // Scale down if larger than max dimension
      if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        const ratio = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height)
        width = Math.round(width * ratio)
        height = Math.round(height * ratio)
      }

      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height

      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('Canvas not supported'))
        return
      }

      ctx.drawImage(img, 0, 0, width, height)

      const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY)
      // Strip "data:image/jpeg;base64," prefix
      const base64 = dataUrl.split(',')[1] ?? ''

      resolve({ base64, mediaType: 'image/jpeg' })
    }

    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Failed to load image'))
    }

    img.src = url
  })
}

// ============================================================
// COMPONENT
// ============================================================

export default function BoardScanCapture({
  getToken,
  onScanComplete,
  onCancel,
}: BoardScanCaptureProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { scan, isScanning, error } = useBoardScan()

  // --- Handle file selection ---
  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Revoke previous preview
    if (previewUrl) URL.revokeObjectURL(previewUrl)

    setSelectedFile(file)
    setPreviewUrl(URL.createObjectURL(file))
  }, [previewUrl])

  // --- Trigger camera ---
  const handleOpenCamera = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  // --- Retake photo ---
  const handleRetake = useCallback(() => {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(null)
    setSelectedFile(null)
    // Reset the input so same file can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [previewUrl])

  // --- Scan the photo ---
  const handleScan = useCallback(async () => {
    if (!selectedFile) return

    try {
      const { base64, mediaType } = await compressForScan(selectedFile)
      const result = await scan(base64, mediaType, getToken)

      if (result) {
        onScanComplete(result)
      }
    } catch {
      // Error handled by hook
    }
  }, [selectedFile, scan, getToken, onScanComplete])

  // --- Cleanup on unmount ---
  // (previewUrl cleanup happens in handleRetake and handleFileChange)

  return (
    <div className="cv-panel space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Camera className="w-4 h-4 text-certvoice-accent" />
          <h3 className="cv-section-title">Scan Board Schedule</h3>
        </div>
        <button
          onClick={onCancel}
          className="text-certvoice-muted hover:text-certvoice-text text-xs"
          type="button"
        >
          Cancel
        </button>
      </div>

      {/* Hidden file input — camera capture on mobile */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png"
        capture="environment"
        onChange={handleFileChange}
        className="hidden"
      />

      {/* No photo yet — show camera button */}
      {!previewUrl && (
        <>
          <div className="bg-certvoice-bg rounded-lg border border-certvoice-border p-3">
            <p className="text-xs text-certvoice-muted leading-relaxed">
              Take a clear photo of the{' '}
              <span className="text-certvoice-accent font-medium">
                circuit schedule label
              </span>{' '}
              on the consumer unit door. AI will extract all circuits automatically.
            </p>
          </div>

          <button
            type="button"
            onClick={handleOpenCamera}
            className="cv-btn-primary w-full flex items-center justify-center gap-2 py-4"
          >
            <Camera className="w-5 h-5" />
            Take Photo of Board
          </button>
        </>
      )}

      {/* Photo preview + scan button */}
      {previewUrl && (
        <>
          <div className="relative rounded-lg overflow-hidden border border-certvoice-border">
            <img
              src={previewUrl}
              alt="Board schedule preview"
              className="w-full max-h-64 object-contain bg-black"
            />
            {isScanning && (
              <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-2">
                <Loader2 className="w-8 h-8 text-certvoice-accent animate-spin" />
                <p className="text-xs text-white font-semibold">Reading circuits...</p>
                <p className="text-[10px] text-white/60">This takes 3-5 seconds</p>
              </div>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="bg-certvoice-red/10 border border-certvoice-red/30 rounded-lg p-3">
              <p className="text-xs text-certvoice-red">{error}</p>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleScan}
              disabled={isScanning}
              className="cv-btn-primary flex-1 flex items-center justify-center gap-2
                         disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isScanning ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Scanning...
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4" />
                  Scan Circuits
                </>
              )}
            </button>
            <button
              type="button"
              onClick={handleRetake}
              disabled={isScanning}
              className="cv-btn-secondary flex items-center justify-center gap-2 px-4
                         disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={onCancel}
              disabled={isScanning}
              className="cv-btn-secondary flex items-center justify-center gap-2 px-4
                         disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </>
      )}
    </div>
  )
}
