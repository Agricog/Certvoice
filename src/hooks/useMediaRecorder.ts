/**
 * CertVoice — useMediaRecorder Hook
 *
 * Pure audio recording via the MediaRecorder API.
 * Works on all modern browsers including iOS Safari 14.3+.
 *
 * Responsibilities:
 *   - Request microphone permission
 *   - Record audio as a Blob
 *   - Track recording duration
 *   - Select best available MIME type per browser
 *   - Clean up media streams on stop/unmount
 *
 * Does NOT handle transcription — that's the caller's job
 * (send the blob to the speech-to-text worker).
 *
 * @module hooks/useMediaRecorder
 */

import { useState, useRef, useCallback, useEffect } from 'react'

// ============================================================
// TYPES
// ============================================================

export type MediaRecorderStatus =
  | 'idle'
  | 'requesting'    // Waiting for mic permission
  | 'recording'
  | 'stopping'      // Finalising blob after stop
  | 'done'
  | 'error'
  | 'unsupported'

export interface MediaRecorderError {
  type: 'not-allowed' | 'not-found' | 'not-readable' | 'unsupported' | 'unknown'
  message: string
}

export interface UseMediaRecorderReturn {
  status: MediaRecorderStatus
  error: MediaRecorderError | null
  durationMs: number
  mimeType: string | null
  isSupported: boolean
  startRecording: () => Promise<void>
  stopRecording: () => Promise<Blob | null>
  reset: () => void
}

// ============================================================
// BROWSER SUPPORT
// ============================================================

function isMediaRecorderSupported(): boolean {
  if (typeof window === 'undefined') return false
  return !!(typeof navigator.mediaDevices?.getUserMedia === 'function' && typeof window.MediaRecorder === 'function')
}

/**
 * Select the best audio MIME type the browser supports.
 * Priority: webm/opus (smallest, Chrome/Firefox) → mp4 (Safari) → wav (fallback)
 */
function selectMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return 'audio/webm'

  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
    'audio/ogg',
    'audio/wav',
  ]

  for (const type of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(type)) return type
    } catch {
      // isTypeSupported can throw in some browsers
    }
  }

  // Safari iOS sometimes doesn't report support but records mp4 anyway
  return 'audio/mp4'
}

// ============================================================
// HOOK
// ============================================================

export function useMediaRecorder(): UseMediaRecorderReturn {
  const isSupported = isMediaRecorderSupported()

  const [status, setStatus] = useState<MediaRecorderStatus>(
    isSupported ? 'idle' : 'unsupported'
  )
  const [error, setError] = useState<MediaRecorderError | null>(null)
  const [durationMs, setDurationMs] = useState(0)
  const [mimeType, setMimeType] = useState<string | null>(null)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const startTimeRef = useRef(0)
  const durationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const resolveStopRef = useRef<((blob: Blob | null) => void) | null>(null)

  // --- Cleanup on unmount ---
  useEffect(() => {
    return () => {
      // Stop any active recording
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        try { recorderRef.current.stop() } catch { /* already stopped */ }
      }
      // Release mic stream
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop())
        streamRef.current = null
      }
      // Clear timer
      if (durationTimerRef.current) {
        clearInterval(durationTimerRef.current)
      }
    }
  }, [])

  // --- Duration timer ---
  const startDurationTimer = useCallback(() => {
    startTimeRef.current = Date.now()
    setDurationMs(0)
    durationTimerRef.current = setInterval(() => {
      setDurationMs(Date.now() - startTimeRef.current)
    }, 100)
  }, [])

  const stopDurationTimer = useCallback(() => {
    if (durationTimerRef.current) {
      clearInterval(durationTimerRef.current)
      durationTimerRef.current = null
    }
    if (startTimeRef.current > 0) {
      setDurationMs(Date.now() - startTimeRef.current)
    }
  }, [])

  // --- Map getUserMedia errors ---
  const mapMediaError = useCallback((err: unknown): MediaRecorderError => {
    if (err instanceof DOMException) {
      switch (err.name) {
        case 'NotAllowedError':
        case 'PermissionDeniedError':
          return {
            type: 'not-allowed',
            message: 'Microphone permission denied. Please allow microphone access in your browser settings.',
          }
        case 'NotFoundError':
        case 'DevicesNotFoundError':
          return {
            type: 'not-found',
            message: 'No microphone found. Please connect a microphone and try again.',
          }
        case 'NotReadableError':
        case 'TrackStartError':
          return {
            type: 'not-readable',
            message: 'Microphone is in use by another application. Please close other apps using the mic.',
          }
        default:
          return {
            type: 'unknown',
            message: `Microphone error: ${err.message}`,
          }
      }
    }
    return {
      type: 'unknown',
      message: err instanceof Error ? err.message : 'Failed to access microphone.',
    }
  }, [])

  // ============================================================
  // START RECORDING
  // ============================================================

  const startRecording = useCallback(async () => {
    if (!isSupported) {
      setError({ type: 'unsupported', message: 'Audio recording is not supported in this browser.' })
      setStatus('unsupported')
      return
    }

    // Reset state
    setError(null)
    chunksRef.current = []
    setDurationMs(0)
    setStatus('requesting')

    try {
      // Request mic access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,         // Mono — smaller file, Whisper doesn't need stereo
          sampleRate: 16000,       // Whisper's native sample rate
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
      streamRef.current = stream

      // Select MIME type
      const selectedMime = selectMimeType()
      setMimeType(selectedMime)

      // Create recorder
      const recorder = new MediaRecorder(stream, {
        mimeType: selectedMime,
        audioBitsPerSecond: 32000,  // Low bitrate — speech doesn't need high fidelity
      })
      recorderRef.current = recorder

      // Collect chunks
      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data)
        }
      }

      // Handle unexpected stops (e.g. mic disconnected)
      recorder.onerror = () => {
        stopDurationTimer()
        setError({ type: 'unknown', message: 'Recording failed unexpectedly. Please try again.' })
        setStatus('error')
        // Release stream
        stream.getTracks().forEach((track) => track.stop())
      }

      recorder.onstop = () => {
        // Assemble blob and resolve the stop promise
        const blob = new Blob(chunksRef.current, { type: selectedMime })
        chunksRef.current = []

        // Release mic stream immediately
        stream.getTracks().forEach((track) => track.stop())
        streamRef.current = null

        setStatus('done')

        if (resolveStopRef.current) {
          resolveStopRef.current(blob)
          resolveStopRef.current = null
        }
      }

      // Start — request data every 1 second for smoother handling
      recorder.start(1000)
      setStatus('recording')
      startDurationTimer()
    } catch (err) {
      setError(mapMediaError(err))
      setStatus('error')

      // Clean up stream if it was obtained before the error
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop())
        streamRef.current = null
      }
    }
  }, [isSupported, startDurationTimer, stopDurationTimer, mapMediaError])

  // ============================================================
  // STOP RECORDING — returns a Promise<Blob | null>
  // ============================================================

  const stopRecording = useCallback((): Promise<Blob | null> => {
    stopDurationTimer()

    return new Promise((resolve) => {
      const recorder = recorderRef.current

      if (!recorder || recorder.state === 'inactive') {
        setStatus('idle')
        resolve(null)
        return
      }

      setStatus('stopping')

      // Store resolver — onstop handler will call it
      resolveStopRef.current = resolve

      // Safety timeout — if onstop doesn't fire within 3 seconds, resolve with what we have
      const timeout = setTimeout(() => {
        if (resolveStopRef.current) {
          const mime = mimeType ?? 'audio/webm'
          const blob = chunksRef.current.length > 0
            ? new Blob(chunksRef.current, { type: mime })
            : null
          chunksRef.current = []
          resolveStopRef.current(blob)
          resolveStopRef.current = null
          setStatus(blob ? 'done' : 'error')

          // Clean up stream
          if (streamRef.current) {
            streamRef.current.getTracks().forEach((track) => track.stop())
            streamRef.current = null
          }
        }
      }, 3000)

      // Wrap the original resolver to also clear the timeout
      const originalResolve = resolveStopRef.current
      resolveStopRef.current = (blob: Blob | null) => {
        clearTimeout(timeout)
        originalResolve(blob)
      }

      try {
        recorder.stop()
      } catch {
        clearTimeout(timeout)
        resolveStopRef.current = null
        setStatus('error')
        resolve(null)
      }
    })
  }, [stopDurationTimer, mimeType])

  // ============================================================
  // RESET
  // ============================================================

  const reset = useCallback(() => {
    // Stop recorder if active
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      try { recorderRef.current.stop() } catch { /* ignore */ }
    }
    recorderRef.current = null

    // Release stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }

    // Clear timer
    stopDurationTimer()

    // Reset state
    chunksRef.current = []
    resolveStopRef.current = null
    setStatus(isSupported ? 'idle' : 'unsupported')
    setError(null)
    setDurationMs(0)
    setMimeType(null)
  }, [isSupported, stopDurationTimer])

  return {
    status,
    error,
    durationMs,
    mimeType,
    isSupported,
    startRecording,
    stopRecording,
    reset,
  }
}
