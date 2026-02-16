/**
 * CertVoice — useVoiceCapture Hook
 *
 * Wraps the Web Speech API (SpeechRecognition) for voice capture.
 * Configured for UK English trade speech with continuous mode and
 * interim results for live transcript display.
 *
 * Types for SpeechRecognition are in src/types/speech-recognition.d.ts
 *
 * Browser support:
 *   - Chrome/Edge: Full support (uses Google speech service)
 *   - Safari: Partial (no interim results, limited continuous)
 *   - Firefox: No support (fallback to manual entry)
 *
 * Privacy:
 *   - Audio is processed by the browser's speech service (Google/Apple)
 *   - Raw audio is NEVER sent to CertVoice servers
 *   - Only the text transcript is sent to Claude for extraction
 */

import { useState, useRef, useCallback, useEffect } from 'react'

// ============================================================
// TYPES
// ============================================================

export type VoiceCaptureStatus =
  | 'idle'
  | 'recording'
  | 'processing'
  | 'error'
  | 'unsupported'

export interface VoiceCaptureError {
  type:
    | 'not-allowed'
    | 'no-speech'
    | 'audio-capture'
    | 'network'
    | 'aborted'
    | 'unsupported'
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
  startRecording: () => void
  stopRecording: () => string
  reset: () => void
}

// ============================================================
// BROWSER SUPPORT CHECK
// ============================================================

function getSpeechRecognition(): SpeechRecognition | null {
  if (typeof window === 'undefined') return null

  const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition
  if (!Ctor) return null

  return new Ctor()
}

function isSpeechSupported(): boolean {
  if (typeof window === 'undefined') return false
  return !!(window.SpeechRecognition ?? window.webkitSpeechRecognition)
}

// ============================================================
// HOOK
// ============================================================

export function useVoiceCapture(): UseVoiceCaptureReturn {
  const isSupported = isSpeechSupported()

  const [status, setStatus] = useState<VoiceCaptureStatus>(
    isSupported ? 'idle' : 'unsupported'
  )
  const [liveTranscript, setLiveTranscript] = useState('')
  const [finalTranscript, setFinalTranscript] = useState('')
  const [error, setError] = useState<VoiceCaptureError | null>(null)
  const [durationMs, setDurationMs] = useState(0)

  const recognitionRef = useRef<SpeechRecognition | null>(null)
  const startTimeRef = useRef(0)
  const durationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const finalTextRef = useRef('')
  const stoppedManuallyRef = useRef(false)

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.abort()
        recognitionRef.current = null
      }
      if (durationTimerRef.current) {
        clearInterval(durationTimerRef.current)
      }
    }
  }, [])

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
    setDurationMs(Date.now() - startTimeRef.current)
  }, [])

  const mapError = useCallback((errorCode: string): VoiceCaptureError => {
    switch (errorCode) {
      case 'not-allowed':
        return {
          type: 'not-allowed',
          message: 'Microphone permission denied. Please allow microphone access in your browser settings.',
        }
      case 'no-speech':
        return {
          type: 'no-speech',
          message: 'No speech detected. Please try again and speak clearly.',
        }
      case 'audio-capture':
        return {
          type: 'audio-capture',
          message: 'Could not capture audio. Please check your microphone is connected.',
        }
      case 'network':
        return {
          type: 'network',
          message: 'Network error. Speech recognition requires an internet connection.',
        }
      case 'aborted':
        return {
          type: 'aborted',
          message: 'Recording was cancelled.',
        }
      default:
        return {
          type: 'unknown',
          message: 'Speech recognition error: ' + errorCode,
        }
    }
  }, [])

  // --- Start Recording ---
  const startRecording = useCallback(() => {
    if (!isSupported) {
      setError({
        type: 'unsupported',
        message: 'Speech recognition is not supported in this browser. Please use Chrome or Edge.',
      })
      setStatus('unsupported')
      return
    }

    // Reset state
    setError(null)
    setLiveTranscript('')
    setFinalTranscript('')
    finalTextRef.current = ''
    stoppedManuallyRef.current = false

    const recognition = getSpeechRecognition()
    if (!recognition) {
      setError({
        type: 'unsupported',
        message: 'Could not initialise speech recognition.',
      })
      setStatus('error')
      return
    }

    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-GB'
    // Safari: disable continuous mode (causes UI freeze)
const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent)
if (isSafari) {
  recognition.continuous = false
  recognition.interimResults = false
}
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
      // 'no-speech' during active recording is not fatal
      if (event.error === 'no-speech') {
        return
      }

      // 'aborted' after manual stop is expected
      if (event.error === 'aborted' && stoppedManuallyRef.current) {
        return
      }

      stopDurationTimer()
      setError(mapError(event.error))
      setStatus('error')
    }

    recognition.onend = () => {
      stopDurationTimer()
      // Preserve error status — onend fires after onerror
      setStatus((prev) => (prev === 'error' ? prev : 'idle'))
    }

    recognitionRef.current = recognition

    try {
      recognition.start()
    } catch {
      setError({
        type: 'unknown',
        message: 'Failed to start recording. Please try again.',
      })
      setStatus('error')
    }
  }, [isSupported, startDurationTimer, stopDurationTimer, mapError])

  // --- Stop Recording ---
  // Returns the final transcript string directly from the ref
  // (React state may not have flushed yet when the caller reads it)
  const stopRecording = useCallback((): string => {
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

  // --- Reset ---
  const reset = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.abort()
      recognitionRef.current = null
    }

    stopDurationTimer()
    stoppedManuallyRef.current = false
    finalTextRef.current = ''
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
    startRecording,
    stopRecording,
    reset,
  }
}
