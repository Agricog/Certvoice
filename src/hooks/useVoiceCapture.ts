/**
 * CertVoice — useVoiceCapture Hook (Universal)
 *
 * Unified voice capture that automatically selects the best strategy:
 *
 *   1. Web Speech API (Chrome/Edge desktop & Android)
 *      - Free, instant, live interim transcript
 *      - Uses browser's built-in speech service
 *
 *   2. MediaRecorder + Cloudflare Workers AI Whisper (iOS, Safari, Firefox, all others)
 *      - Records audio locally via MediaRecorder API
 *      - Sends to speech-to-text worker for server-side transcription
 *      - Works on every modern browser including iOS Safari
 *      - No live transcript (shows "Recording..." then full result)
 *
 * The external interface is identical regardless of strategy — callers
 * (VoiceCapture.tsx, CircuitRecorder.tsx) don't need to know which path runs.
 *
 * Detection logic:
 *   - iOS (any browser): Always MediaRecorder (Apple forces WebKit, Web Speech freezes)
 *   - Safari macOS: Always MediaRecorder (continuous mode unreliable)
 *   - Firefox: Always MediaRecorder (no Web Speech API)
 *   - Chrome/Edge on Android/Desktop: Web Speech API (free, live transcript)
 *
 * Privacy:
 *   - Web Speech path: audio processed by Google's speech service (never hits CertVoice)
 *   - MediaRecorder path: audio sent to CertVoice speech-to-text worker (Whisper on Cloudflare)
 *   - In both cases only the text transcript is sent to Claude for field extraction
 *
 * @module hooks/useVoiceCapture
 */

import { useState, useRef, useCallback, useEffect } from 'react'
import { useAuth } from '@clerk/clerk-react'

// ============================================================
// TYPES
// ============================================================

export type VoiceCaptureStatus =
  | 'idle'
  | 'recording'
  | 'processing'
  | 'error'
  | 'unsupported'

export type CaptureMethod = 'webspeech' | 'mediarecorder'

export interface VoiceCaptureError {
  type:
    | 'not-allowed'
    | 'no-speech'
    | 'audio-capture'
    | 'network'
    | 'aborted'
    | 'unsupported'
    | 'transcription-failed'
    | 'unknown'
  message: string
}

export interface UseVoiceCaptureReturn {
  status: VoiceCaptureStatus
  liveTranscript: string
  finalTranscript: string
  error: VoiceCaptureError | null
  durationMs: number
  isSupported: boolean
  captureMethod: CaptureMethod
  startRecording: () => void
  stopRecording: () => Promise<string>
  reset: () => void
}

// ============================================================
// CONSTANTS
// ============================================================

const API_BASE = (typeof import.meta !== 'undefined' ? import.meta.env?.VITE_API_BASE_URL : '') ?? ''
const STT_ENDPOINT = `${API_BASE}/api/speech/transcribe`

// ============================================================
// STRATEGY DETECTION
// ============================================================

function detectCaptureMethod(): CaptureMethod {
  if (typeof window === 'undefined') return 'mediarecorder'

  const ua = navigator.userAgent

  // iOS — all browsers forced to use WebKit, Web Speech API freezes UI
  if (/iPad|iPhone|iPod/.test(ua) && !(window as unknown as Record<string, unknown>).MSStream) {
    return 'mediarecorder'
  }

  // Safari on macOS — continuous mode unreliable, no interim results
  if (/^((?!chrome|android).)*safari/i.test(ua)) {
    return 'mediarecorder'
  }

  // Firefox — no Web Speech API
  if (!window.SpeechRecognition && !window.webkitSpeechRecognition) {
    return 'mediarecorder'
  }

  // Chrome, Edge, Opera on desktop/Android — full Web Speech API support
  return 'webspeech'
}

function isAnyCaptureSupported(): boolean {
  if (typeof window === 'undefined') return false
  // Either Web Speech API or MediaRecorder must be available
  const hasWebSpeech = !!(window.SpeechRecognition ?? window.webkitSpeechRecognition)
  const hasMediaRecorder = !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder)
  return hasWebSpeech || hasMediaRecorder
}

// ============================================================
// WEB SPEECH API HELPERS
// ============================================================

function createSpeechRecognition(): SpeechRecognition | null {
  if (typeof window === 'undefined') return null
  const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition
  if (!Ctor) return null
  return new Ctor()
}

// ============================================================
// MEDIA RECORDER HELPERS
// ============================================================

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
    } catch { /* continue */ }
  }
  return 'audio/mp4'
}

// ============================================================
// HOOK
// ============================================================

export function useVoiceCapture(): UseVoiceCaptureReturn {
  const { getToken } = useAuth()

  const captureMethod = detectCaptureMethod()
  const isSupported = isAnyCaptureSupported()

  const [status, setStatus] = useState<VoiceCaptureStatus>(
    isSupported ? 'idle' : 'unsupported'
  )
  const [liveTranscript, setLiveTranscript] = useState('')
  const [finalTranscript, setFinalTranscript] = useState('')
  const [error, setError] = useState<VoiceCaptureError | null>(null)
  const [durationMs, setDurationMs] = useState(0)

  // Shared refs
  const startTimeRef = useRef(0)
  const durationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Web Speech refs
  const recognitionRef = useRef<SpeechRecognition | null>(null)
  const finalTextRef = useRef('')
  const stoppedManuallyRef = useRef(false)

  // MediaRecorder refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const selectedMimeRef = useRef<string>('audio/webm')
  const resolveStopRef = useRef<((blob: Blob | null) => void) | null>(null)

  // ============================================================
  // CLEANUP
  // ============================================================

  useEffect(() => {
    return () => {
      // Web Speech cleanup
      if (recognitionRef.current) {
        recognitionRef.current.abort()
        recognitionRef.current = null
      }
      // MediaRecorder cleanup
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        try { mediaRecorderRef.current.stop() } catch { /* already stopped */ }
      }
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((t) => t.stop())
        mediaStreamRef.current = null
      }
      // Timer cleanup
      if (durationTimerRef.current) {
        clearInterval(durationTimerRef.current)
      }
    }
  }, [])

  // ============================================================
  // DURATION TIMER (shared)
  // ============================================================

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

  // ============================================================
  // ERROR MAPPING
  // ============================================================

  const mapSpeechError = useCallback((errorCode: string): VoiceCaptureError => {
    switch (errorCode) {
      case 'not-allowed':
        return { type: 'not-allowed', message: 'Microphone permission denied. Please allow microphone access in your browser settings.' }
      case 'no-speech':
        return { type: 'no-speech', message: 'No speech detected. Please try again and speak clearly.' }
      case 'audio-capture':
        return { type: 'audio-capture', message: 'Could not capture audio. Please check your microphone is connected.' }
      case 'network':
        return { type: 'network', message: 'Network error. Speech recognition requires an internet connection.' }
      case 'aborted':
        return { type: 'aborted', message: 'Recording was cancelled.' }
      default:
        return { type: 'unknown', message: 'Speech recognition error: ' + errorCode }
    }
  }, [])

  const mapMediaError = useCallback((err: unknown): VoiceCaptureError => {
    if (err instanceof DOMException) {
      switch (err.name) {
        case 'NotAllowedError':
        case 'PermissionDeniedError':
          return { type: 'not-allowed', message: 'Microphone permission denied. Please allow microphone access in your browser settings.' }
        case 'NotFoundError':
        case 'DevicesNotFoundError':
          return { type: 'audio-capture', message: 'No microphone found. Please connect a microphone and try again.' }
        case 'NotReadableError':
        case 'TrackStartError':
          return { type: 'audio-capture', message: 'Microphone is in use by another application. Please close other apps using the mic.' }
        default:
          return { type: 'unknown', message: `Microphone error: ${err.message}` }
      }
    }
    return { type: 'unknown', message: err instanceof Error ? err.message : 'Failed to access microphone.' }
  }, [])

  // ============================================================
  // WEB SPEECH API — START
  // ============================================================

  const startWebSpeech = useCallback(() => {
    setError(null)
    setLiveTranscript('')
    setFinalTranscript('')
    finalTextRef.current = ''
    stoppedManuallyRef.current = false

    const recognition = createSpeechRecognition()
    if (!recognition) {
      setError({ type: 'unsupported', message: 'Could not initialise speech recognition.' })
      setStatus('error')
      return
    }

    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-GB'
    recognition.maxAlternatives = 1

    recognition.onstart = () => {
      setStatus('recording')
      startDurationTimer()
    }

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = ''
      let final = finalTextRef.current

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        if (!result) continue
        const alternative = result[0]
        if (!alternative) continue

        if (result.isFinal) {
          final += alternative.transcript + ' '
          finalTextRef.current = final
        } else {
          interim += alternative.transcript
        }
      }

      setFinalTranscript(final.trim())
      setLiveTranscript((final + interim).trim())
    }

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error === 'no-speech') return
      if (event.error === 'aborted' && stoppedManuallyRef.current) return

      stopDurationTimer()
      setError(mapSpeechError(event.error))
      setStatus('error')
    }

    recognition.onend = () => {
      stopDurationTimer()
      setStatus((prev) => (prev === 'error' ? prev : 'idle'))
    }

    recognitionRef.current = recognition

    try {
      recognition.start()
    } catch {
      setError({ type: 'unknown', message: 'Failed to start recording. Please try again.' })
      setStatus('error')
    }
  }, [startDurationTimer, stopDurationTimer, mapSpeechError])

  // ============================================================
  // WEB SPEECH API — STOP (returns transcript immediately)
  // ============================================================

  const stopWebSpeech = useCallback((): string => {
    stoppedManuallyRef.current = true

    if (recognitionRef.current) {
      recognitionRef.current.stop()
      recognitionRef.current = null
    }

    stopDurationTimer()

    const final = finalTextRef.current.trim()
    setFinalTranscript(final)
    setLiveTranscript(final)
    setStatus('idle')

    return final
  }, [stopDurationTimer])

  // ============================================================
  // MEDIA RECORDER — START
  // ============================================================

  const startMediaRecorder = useCallback(async () => {
    setError(null)
    setLiveTranscript('')
    setFinalTranscript('')
    audioChunksRef.current = []

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
      mediaStreamRef.current = stream

      const mime = selectMimeType()
      selectedMimeRef.current = mime

      const recorder = new MediaRecorder(stream, {
        mimeType: mime,
        audioBitsPerSecond: 32000,
      })
      mediaRecorderRef.current = recorder

      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data)
        }
      }

      recorder.onerror = () => {
        stopDurationTimer()
        setError({ type: 'unknown', message: 'Recording failed unexpectedly. Please try again.' })
        setStatus('error')
        stream.getTracks().forEach((t) => t.stop())
      }

      recorder.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: mime })
        audioChunksRef.current = []
        stream.getTracks().forEach((t) => t.stop())
        mediaStreamRef.current = null

        if (resolveStopRef.current) {
          resolveStopRef.current(blob)
          resolveStopRef.current = null
        }
      }

      recorder.start(1000)
      setStatus('recording')
      setLiveTranscript('Listening...')
      startDurationTimer()
    } catch (err) {
      setError(mapMediaError(err))
      setStatus('error')

      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((t) => t.stop())
        mediaStreamRef.current = null
      }
    }
  }, [startDurationTimer, stopDurationTimer, mapMediaError])

  // ============================================================
  // MEDIA RECORDER — STOP + TRANSCRIBE
  // ============================================================

  const stopMediaRecorder = useCallback(async (): Promise<string> => {
    stopDurationTimer()

    const recorder = mediaRecorderRef.current
    if (!recorder || recorder.state === 'inactive') {
      setStatus('idle')
      return ''
    }

    // Get the audio blob from the recorder
    const blob = await new Promise<Blob | null>((resolve) => {
      resolveStopRef.current = resolve

      // Safety timeout
      const timeout = setTimeout(() => {
        if (resolveStopRef.current) {
          const fallbackBlob = audioChunksRef.current.length > 0
            ? new Blob(audioChunksRef.current, { type: selectedMimeRef.current })
            : null
          audioChunksRef.current = []
          resolveStopRef.current(fallbackBlob)
          resolveStopRef.current = null

          if (mediaStreamRef.current) {
            mediaStreamRef.current.getTracks().forEach((t) => t.stop())
            mediaStreamRef.current = null
          }
        }
      }, 3000)

      const originalResolve = resolveStopRef.current
      resolveStopRef.current = (b: Blob | null) => {
        clearTimeout(timeout)
        originalResolve(b)
      }

      try {
        recorder.stop()
      } catch {
        clearTimeout(timeout)
        resolveStopRef.current = null
        resolve(null)
      }
    })

    if (!blob || blob.size < 1024) {
      setError({ type: 'no-speech', message: 'Recording too short. Please try again and speak for at least 2 seconds.' })
      setStatus('error')
      return ''
    }

    // Send to speech-to-text worker
    setStatus('processing')
    setLiveTranscript('Transcribing...')

    try {
      const token = await getToken()
      const response = await fetch(STT_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': selectedMimeRef.current,
          Authorization: `Bearer ${token}`,
        },
        body: blob,
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => null) as Record<string, string> | null
        const msg = errorData?.error ?? 'Transcription failed'
        throw new Error(msg)
      }

      const data = await response.json() as { success: boolean; transcript: string; error?: string }

      if (!data.success || !data.transcript) {
        throw new Error(data.error ?? 'No speech detected')
      }

      const transcript = data.transcript.trim()
      setFinalTranscript(transcript)
      setLiveTranscript(transcript)
      setStatus('idle')

      return transcript
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Transcription failed'
      setError({ type: 'transcription-failed', message })
      setStatus('error')
      setLiveTranscript('')
      return ''
    }
  }, [stopDurationTimer, getToken])

  // ============================================================
  // UNIFIED START
  // ============================================================

  const startRecording = useCallback(() => {
    if (!isSupported) {
      setError({ type: 'unsupported', message: 'Voice capture is not supported in this browser.' })
      setStatus('unsupported')
      return
    }

    if (captureMethod === 'webspeech') {
      startWebSpeech()
    } else {
      // startMediaRecorder is async but we fire-and-forget
      // (errors are caught internally and set via state)
      startMediaRecorder().catch(() => {
        setStatus('error')
      })
    }
  }, [isSupported, captureMethod, startWebSpeech, startMediaRecorder])

  // ============================================================
  // UNIFIED STOP — always returns Promise<string>
  // ============================================================

  const stopRecording = useCallback(async (): Promise<string> => {
    if (captureMethod === 'webspeech') {
      return stopWebSpeech()
    } else {
      return stopMediaRecorder()
    }
  }, [captureMethod, stopWebSpeech, stopMediaRecorder])

  // ============================================================
  // RESET
  // ============================================================

  const reset = useCallback(() => {
    // Web Speech cleanup
    if (recognitionRef.current) {
      recognitionRef.current.abort()
      recognitionRef.current = null
    }

    // MediaRecorder cleanup
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try { mediaRecorderRef.current.stop() } catch { /* ignore */ }
    }
    mediaRecorderRef.current = null

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop())
      mediaStreamRef.current = null
    }

    // Timer cleanup
    stopDurationTimer()

    // Reset all state
    stoppedManuallyRef.current = false
    finalTextRef.current = ''
    audioChunksRef.current = []
    resolveStopRef.current = null

    setStatus(isSupported ? 'idle' : 'unsupported')
    setLiveTranscript('')
    setFinalTranscript('')
    setError(null)
    setDurationMs(0)
  }, [isSupported, stopDurationTimer])

  return {
    status,
    liveTranscript,
    finalTranscript,
    error,
    durationMs,
    isSupported,
    captureMethod,
    startRecording,
    stopRecording,
    reset,
  }
}
