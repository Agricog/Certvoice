/**
 * CertVoice — VoiceCapture Component
 *
 * The primary voice capture interface:
 *   - Large mic button with recording/processing states
 *   - Visual waveform animation during recording
 *   - Live transcript display with interim results
 *   - Error handling with clear user guidance
 *   - Duration timer
 *   - Unsupported browser fallback
 *
 * Used by CircuitRecorder, ObservationRecorder, and SupplyDetails.
 */

import { useCallback } from 'react'
import { Mic, MicOff, AlertCircle, Loader2 } from 'lucide-react'
import { useVoiceCapture } from '../hooks/useVoiceCapture'
import type { VoiceCaptureStatus } from '../hooks/useVoiceCapture'
import { trackVoiceStart, trackVoiceComplete, trackVoiceError } from '../utils/analytics'

// ============================================================
// TYPES
// ============================================================

interface VoiceCaptureProps {
  /** Called when recording stops with a final transcript */
  onTranscript: (transcript: string, durationMs: number) => void
  /** Current location context (e.g. "Kitchen") for analytics */
  locationContext?: string
  /** Whether to disable the button (e.g. during AI extraction) */
  disabled?: boolean
  /** Compact mode for inline use */
  compact?: boolean
}

// ============================================================
// STATUS CONFIG
// ============================================================

interface StatusConfig {
  buttonClass: string
  iconColor: string
  label: string
  sublabel: string
}

function getStatusConfig(status: VoiceCaptureStatus): StatusConfig {
  switch (status) {
    case 'recording':
      return {
        buttonClass: 'border-certvoice-red bg-certvoice-red/15 animate-pulse-record',
        iconColor: 'text-certvoice-red',
        label: 'Recording...',
        sublabel: 'Tap to stop',
      }
    case 'processing':
      return {
        buttonClass: 'border-certvoice-amber bg-certvoice-amber/15 animate-pulse-process',
        iconColor: 'text-certvoice-amber',
        label: 'Processing...',
        sublabel: 'Extracting fields',
      }
    case 'error':
      return {
        buttonClass: 'border-certvoice-red/50 bg-certvoice-red/10',
        iconColor: 'text-certvoice-red',
        label: 'Error',
        sublabel: 'Tap to try again',
      }
    case 'unsupported':
      return {
        buttonClass: 'border-certvoice-border bg-certvoice-surface-2 opacity-50',
        iconColor: 'text-certvoice-muted',
        label: 'Not Supported',
        sublabel: 'Use Chrome or Edge',
      }
    default:
      return {
        buttonClass: 'border-certvoice-accent bg-certvoice-accent/10 hover:scale-105 hover:shadow-glow-accent',
        iconColor: 'text-certvoice-accent',
        label: 'Tap to Record',
        sublabel: 'Speak your findings',
      }
  }
}

// ============================================================
// FORMAT HELPERS
// ============================================================

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  if (minutes > 0) {
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
  }
  return `0:${remainingSeconds.toString().padStart(2, '0')}`
}

// ============================================================
// WAVEFORM COMPONENT
// ============================================================

function Waveform({ visible }: { visible: boolean }) {
  if (!visible) return null

  return (
    <div className="flex items-center justify-center gap-0.5 h-8 mt-3">
      {Array.from({ length: 7 }).map((_, i) => (
        <div
          key={i}
          className="w-0.5 bg-certvoice-red rounded-full animate-wave"
          style={{
            animationDelay: `${i * 0.08}s`,
            height: '6px',
          }}
        />
      ))}
    </div>
  )
}

// ============================================================
// COMPONENT
// ============================================================

export default function VoiceCapture({
  onTranscript,
  locationContext = '',
  disabled = false,
  compact = false,
}: VoiceCaptureProps) {
  const {
    status,
    liveTranscript,
    finalTranscript,
    error,
    durationMs,
    isSupported,
    startRecording,
    stopRecording,
    reset,
  } = useVoiceCapture()

  const config = getStatusConfig(status)
  const isRecording = status === 'recording'
  const isDisabled = disabled || status === 'unsupported' || status === 'processing'

  // --- Handle mic button tap ---
  const handleMicTap = useCallback(() => {
    if (isDisabled) return

    if (isRecording) {
      // Stop recording → deliver transcript
      stopRecording()
      const transcript = finalTranscript.trim()
      if (transcript) {
        onTranscript(transcript, durationMs)
        trackVoiceComplete(durationMs, transcript.length)
      }
    } else if (status === 'error') {
      // Reset and try again
      reset()
    } else {
      // Start recording
      startRecording()
      trackVoiceStart(locationContext)
    }
  }, [
    isDisabled,
    isRecording,
    status,
    stopRecording,
    finalTranscript,
    durationMs,
    onTranscript,
    reset,
    startRecording,
    locationContext,
  ])

  // Track errors
  if (error) {
    trackVoiceError(error.type)
  }

  // --- Compact mode (inline mic button only) ---
  if (compact) {
    return (
      <button
        onClick={handleMicTap}
        disabled={isDisabled}
        className={`
          w-12 h-12 rounded-full border-2 flex items-center justify-center
          transition-all duration-200 flex-shrink-0
          ${isDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
          ${config.buttonClass}
        `}
        aria-label={isRecording ? 'Stop recording' : 'Start recording'}
        type="button"
      >
        {isRecording ? (
          <div className="w-4 h-4 bg-certvoice-red rounded-sm" />
        ) : (
          <Mic className={`w-5 h-5 ${config.iconColor}`} />
        )}
      </button>
    )
  }

  // --- Full mode ---
  return (
    <div className="flex flex-col items-center">
      {/* Mic Button */}
      <button
        onClick={handleMicTap}
        disabled={isDisabled}
        className={`
          w-[88px] h-[88px] rounded-full border-[3px] flex items-center justify-center
          transition-all duration-300 relative
          ${isDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
          ${config.buttonClass}
        `}
        aria-label={isRecording ? 'Stop recording' : 'Start recording'}
        type="button"
      >
        {status === 'processing' ? (
          <Loader2 className={`w-8 h-8 ${config.iconColor} animate-spin`} />
        ) : !isSupported ? (
          <MicOff className={`w-8 h-8 ${config.iconColor}`} />
        ) : isRecording ? (
          <div className="w-6 h-6 bg-certvoice-red rounded-md" />
        ) : (
          <Mic className={`w-8 h-8 ${config.iconColor}`} />
        )}
      </button>

      {/* Label */}
      <div className="mt-3 text-center">
        <div
          className={`text-sm font-semibold ${
            isRecording
              ? 'text-certvoice-red'
              : status === 'error'
                ? 'text-certvoice-red'
                : 'text-certvoice-muted'
          }`}
        >
          {config.label}
        </div>
        <div className="text-xs text-certvoice-muted mt-0.5">
          {config.sublabel}
        </div>
      </div>

      {/* Duration */}
      {(isRecording || durationMs > 0) && status !== 'idle' && (
        <div className="mt-2 font-mono text-xs text-certvoice-muted">
          {formatDuration(durationMs)}
        </div>
      )}

      {/* Waveform */}
      <Waveform visible={isRecording} />

      {/* Live Transcript */}
      {liveTranscript && (
        <div className="mt-4 w-full">
          <div className="cv-panel">
            <div className="flex items-center justify-between mb-2">
              <span className="cv-section-title">Voice Transcript</span>
              {isRecording && (
                <span className="cv-badge-fail text-[9px]">LIVE</span>
              )}
            </div>
            <div
              className="font-mono text-[13px] leading-relaxed text-certvoice-text
                         bg-certvoice-bg rounded-lg border border-certvoice-border
                         p-3 min-h-[48px] max-h-32 overflow-y-auto"
            >
              {liveTranscript}
            </div>
          </div>
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="mt-4 w-full">
          <div className="flex items-start gap-2 bg-certvoice-red/10 border border-certvoice-red/30 rounded-lg p-3">
            <AlertCircle className="w-4 h-4 text-certvoice-red flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm text-certvoice-red font-medium">
                {error.message}
              </p>
              {error.type === 'not-allowed' && (
                <p className="text-xs text-certvoice-muted mt-1">
                  On iOS, go to Settings → Safari → Microphone. On Android, tap the
                  lock icon in the address bar.
                </p>
              )}
              {error.type === 'unsupported' && (
                <p className="text-xs text-certvoice-muted mt-1">
                  CertVoice voice capture works best in Chrome or Edge browsers.
                  You can still use manual entry for all fields.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
