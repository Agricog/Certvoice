/**
 * CertVoice — SignatureCapture Component
 *
 * Canvas-based signature pad for Section G declaration.
 * Captures signature as PNG, uploads to R2.
 *
 * Props:
 *   - certificateId: UUID of the certificate
 *   - signatureKey: current R2 key (null if not signed)
 *   - onSignatureChange: callback when key changes
 *   - label: display label (e.g. "Inspector Signature")
 *   - disabled: disable drawing
 *
 * @module components/SignatureCapture
 */

import { useState, useRef, useCallback, useEffect } from 'react'
import { uploadFile, getFileUrl, deleteFile } from '../services/uploadService'

// ============================================================
// TYPES
// ============================================================

interface SignatureCaptureProps {
  certificateId: string
  signatureKey: string | null
  onSignatureChange: (key: string | null) => void
  label?: string
  disabled?: boolean
}

type DrawState = 'empty' | 'drawing' | 'signed' | 'uploading' | 'saved'

// ============================================================
// COMPONENT
// ============================================================

export default function SignatureCapture({
  certificateId,
  signatureKey,
  onSignatureChange,
  label = 'Signature',
  disabled = false,
}: SignatureCaptureProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [hasStrokes, setHasStrokes] = useState(false)
  const [state, setState] = useState<DrawState>(signatureKey ? 'saved' : 'empty')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const lastPoint = useRef<{ x: number; y: number } | null>(null)

  // Load existing signature preview
  useEffect(() => {
    if (signatureKey && !previewUrl) {
      setState('saved')
      getFileUrl(signatureKey)
        .then((url) => setPreviewUrl(url))
        .catch(() => {})
    }
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signatureKey])

  // Canvas setup
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Set canvas resolution to match display size
    const rect = canvas.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    ctx.scale(dpr, dpr)

    // Drawing style
    ctx.strokeStyle = '#1a1a2e'
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
  }, [state])

  // ---- Drawing handlers ----

  const getPoint = useCallback(
    (e: React.TouchEvent | React.MouseEvent): { x: number; y: number } | null => {
      const canvas = canvasRef.current
      if (!canvas) return null
      const rect = canvas.getBoundingClientRect()

      if ('touches' in e) {
        const touch = e.touches[0]
        if (!touch) return null
        return { x: touch.clientX - rect.left, y: touch.clientY - rect.top }
      }
      return { x: (e as React.MouseEvent).clientX - rect.left, y: (e as React.MouseEvent).clientY - rect.top }
    },
    []
  )

  const startDraw = useCallback(
    (e: React.TouchEvent | React.MouseEvent) => {
      if (disabled || state === 'saved' || state === 'uploading') return
      e.preventDefault()
      const point = getPoint(e)
      if (!point) return

      setIsDrawing(true)
      setHasStrokes(true)
      setState('drawing')
      lastPoint.current = point
    },
    [disabled, state, getPoint]
  )

  const draw = useCallback(
    (e: React.TouchEvent | React.MouseEvent) => {
      if (!isDrawing) return
      e.preventDefault()

      const canvas = canvasRef.current
      const ctx = canvas?.getContext('2d')
      const point = getPoint(e)
      if (!ctx || !point || !lastPoint.current) return

      ctx.beginPath()
      ctx.moveTo(lastPoint.current.x, lastPoint.current.y)
      ctx.lineTo(point.x, point.y)
      ctx.stroke()

      lastPoint.current = point
    },
    [isDrawing, getPoint]
  )

  const endDraw = useCallback(() => {
    setIsDrawing(false)
    lastPoint.current = null
  }, [])

  // ---- Actions ----

  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    const dpr = window.devicePixelRatio || 1
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr)
    setHasStrokes(false)
    setState('empty')
    setError(null)
  }, [])

  const handleSave = useCallback(async () => {
    const canvas = canvasRef.current
    if (!canvas || !hasStrokes) return

    setError(null)
    setState('uploading')

    try {
      // Export canvas to PNG blob
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('Canvas export failed'))),
          'image/png'
        )
      })

      // Upload
      const result = await uploadFile(blob, 'signature', certificateId)

      // Set preview from canvas data (avoids extra download)
      const dataUrl = canvas.toDataURL('image/png')
      setPreviewUrl(dataUrl)

      setState('saved')
      onSignatureChange(result.key)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Signature upload failed'
      setError(message)
      setState('drawing')
    }
  }, [certificateId, hasStrokes, onSignatureChange])

  const handleClear = useCallback(async () => {
    // Delete from R2 if saved
    if (signatureKey) {
      deleteFile(signatureKey).catch(() => {})
    }

    // Clean up preview
    if (previewUrl && !previewUrl.startsWith('data:')) {
      URL.revokeObjectURL(previewUrl)
    }
    setPreviewUrl(null)

    onSignatureChange(null)
    clearCanvas()
  }, [signatureKey, previewUrl, onSignatureChange, clearCanvas])

  // ---- Render ----

  const isSaved = state === 'saved' && previewUrl

  return (
    <div className="space-y-2">
      {/* Label */}
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-gray-700">{label}</label>
        {state === 'saved' && (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700">
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
            Signed
          </span>
        )}
      </div>

      {/* Signature display area */}
      <div className="relative overflow-hidden rounded-lg border-2 border-gray-200 bg-white">
        {/* Saved preview */}
        {isSaved ? (
          <div className="relative h-32">
            <img
              src={previewUrl}
              alt="Signature"
              className="h-full w-full object-contain p-2"
            />
            {!disabled && (
              <button
                type="button"
                onClick={handleClear}
                className="absolute right-2 top-2 rounded-md bg-white/80 px-2 py-1 text-xs font-medium text-red-600 shadow-sm ring-1 ring-gray-200 hover:bg-red-50 transition-colors"
              >
                Clear
              </button>
            )}
          </div>
        ) : (
          <>
            {/* Canvas */}
            <canvas
              ref={canvasRef}
              className="h-32 w-full cursor-crosshair touch-none"
              onMouseDown={startDraw}
              onMouseMove={draw}
              onMouseUp={endDraw}
              onMouseLeave={endDraw}
              onTouchStart={startDraw}
              onTouchMove={draw}
              onTouchEnd={endDraw}
              onTouchCancel={endDraw}
            />

            {/* Hint text */}
            {!hasStrokes && !disabled && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <p className="text-sm text-gray-400">Draw your signature here</p>
              </div>
            )}

            {/* Uploading overlay */}
            {state === 'uploading' && (
              <div className="absolute inset-0 flex items-center justify-center bg-white/70">
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
                  Saving…
                </div>
              </div>
            )}
          </>
        )}

        {/* Signature line */}
        {!isSaved && (
          <div className="mx-4 mb-2 border-t border-gray-300" />
        )}
      </div>

      {/* Error */}
      {error && (
        <p className="text-xs text-red-600">{error}</p>
      )}

      {/* Action buttons */}
      {!isSaved && !disabled && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={clearCanvas}
            disabled={!hasStrokes || state === 'uploading'}
            className="flex-1 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 transition-colors"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!hasStrokes || state === 'uploading'}
            className="flex-1 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40 transition-colors"
          >
            {state === 'uploading' ? 'Saving…' : 'Confirm Signature'}
          </button>
        </div>
      )}
    </div>
  )
}
