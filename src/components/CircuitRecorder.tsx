/**
 * CertVoice — CircuitRecorder Component
 *
 * Per-circuit voice capture → AI extraction → field review grid.
 *
 * Flow:
 *   1. Inspector taps mic, speaks circuit test results
 *   2. VoiceCapture captures transcript
 *   3. speechParser preprocesses trade terminology
 *   4. useAIExtraction sends to Claude proxy
 *   5. Extracted fields shown in editable review grid
 *   6. Inspector confirms → circuit added to certificate
 *
 * Shows the key fields inspectors care about:
 *   Circuit number, description, Zs, R1+R2, IR, RCD time, polarity, status
 */

import { useState, useCallback } from 'react'
import {
  Check,
  X,
  AlertTriangle,
  RotateCcw,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import VoiceCapture from './VoiceCapture'
import { useAIExtraction } from '../hooks/useAIExtraction'
import type { ExtractionContext } from '../hooks/useAIExtraction'
import type { AIExtractionResponse } from '../types/api'
import type { CircuitDetail, TestValue } from '../types/eicr'
import { preprocessTranscript } from '../utils/speechParser'
import { trackCircuitCaptured } from '../utils/analytics'

// ============================================================
// TYPES
// ============================================================

interface CircuitRecorderProps {
  /** Current location from room selector */
  locationContext: string
  /** Current distribution board reference */
  dbContext: string
  /** Existing circuit numbers (to flag duplicates) */
  existingCircuits: string[]
  /** Earthing type (for max Zs lookups) */
  earthingType: string | null
  /** Called when inspector confirms a circuit */
  onCircuitConfirmed: (circuit: Partial<CircuitDetail>) => void
  /** Called when recorder is cancelled */
  onCancel: () => void
}

type RecorderStep = 'capture' | 'review' | 'confirmed'

// ============================================================
// HELPERS
// ============================================================

function formatTestValue(val: TestValue | number | null | undefined): string {
  if (val === null || val === undefined) return '—'
  if (typeof val === 'string') return val
  return String(val)
}

function getStatusBadge(status: string | undefined): { text: string; className: string } {
  switch (status) {
    case 'SATISFACTORY':
      return { text: 'PASS', className: 'cv-badge-pass' }
    case 'UNSATISFACTORY':
      return { text: 'FAIL', className: 'cv-badge-fail' }
    default:
      return { text: 'REVIEW', className: 'cv-badge-warning' }
  }
}

// ============================================================
// COMPONENT
// ============================================================

export default function CircuitRecorder({
  locationContext,
  dbContext,
  existingCircuits,
  earthingType,
  onCircuitConfirmed,
  onCancel,
}: CircuitRecorderProps) {
  const [step, setStep] = useState<RecorderStep>('capture')
  const [extractedCircuit, setExtractedCircuit] = useState<Partial<CircuitDetail> | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [showAllFields, setShowAllFields] = useState(false)

  const {
    status: extractionStatus,
    error: extractionError,
    extract,
    reset: resetExtraction,
  } = useAIExtraction()

  const context: ExtractionContext = {
    locationContext,
    dbContext,
    existingCircuits,
    earthingType,
  }

  // --- Handle transcript from VoiceCapture ---
  const handleTranscript = useCallback(
    async (transcript: string, _durationMs: number) => {
      const processed = preprocessTranscript(transcript)
      const result = await extract(processed, context)

      if (result?.success && result.type === 'circuit' && result.circuit) {
        setExtractedCircuit(result.circuit)
        setWarnings(result.warnings)
        setStep('review')
      }
    },
    [extract, context]
  )

  // --- Confirm circuit ---
  const handleConfirm = useCallback(() => {
    if (!extractedCircuit) return

    onCircuitConfirmed(extractedCircuit)
    setStep('confirmed')

    trackCircuitCaptured(
      extractedCircuit.circuitType ?? 'unknown',
      'voice'
    )
  }, [extractedCircuit, onCircuitConfirmed])

  // --- Retry capture ---
  const handleRetry = useCallback(() => {
    setStep('capture')
    setExtractedCircuit(null)
    setWarnings([])
    resetExtraction()
  }, [resetExtraction])

  // --- Edit a field value ---
  const handleFieldEdit = useCallback(
    (field: keyof CircuitDetail, value: string) => {
      if (!extractedCircuit) return

      setExtractedCircuit((prev) => {
        if (!prev) return prev
        return { ...prev, [field]: value }
      })
    },
    [extractedCircuit]
  )

  // ============================================================
  // RENDER: CAPTURE STEP
  // ============================================================

  if (step === 'capture') {
    return (
      <div className="cv-panel space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="cv-section-title">Record Circuit</h3>
          <button
            onClick={onCancel}
            className="text-certvoice-muted hover:text-certvoice-text text-xs"
            type="button"
          >
            Cancel
          </button>
        </div>

        <div className="bg-certvoice-bg rounded-lg border border-certvoice-border p-3">
          <p className="text-xs text-certvoice-muted leading-relaxed">
            Speak your test results naturally, e.g.:{' '}
            <span className="text-certvoice-accent font-medium">
              &quot;Kitchen ring final, circuit 3, B32 MCB, Zs 0.42, R1+R2 0.31,
              insulation greater than 200 meg, RCD trips at 22 milliseconds, all
              satisfactory&quot;
            </span>
          </p>
        </div>

        <VoiceCapture
          onTranscript={handleTranscript}
          locationContext={locationContext}
          disabled={extractionStatus === 'extracting'}
        />

        {extractionStatus === 'extracting' && (
          <div className="text-center">
            <div className="cv-badge-warning">AI extracting fields...</div>
          </div>
        )}

        {extractionError && (
          <div className="bg-certvoice-red/10 border border-certvoice-red/30 rounded-lg p-3">
            <p className="text-sm text-certvoice-red">{extractionError}</p>
          </div>
        )}
      </div>
    )
  }

  // ============================================================
  // RENDER: CONFIRMED
  // ============================================================

  if (step === 'confirmed') {
    return (
      <div className="cv-panel text-center space-y-3 py-6">
        <div className="w-12 h-12 bg-certvoice-green rounded-full flex items-center justify-center mx-auto">
          <Check className="w-6 h-6 text-white" />
        </div>
        <p className="text-sm font-semibold text-certvoice-green">
          Circuit {extractedCircuit?.circuitNumber} added
        </p>
        <p className="text-xs text-certvoice-muted">
          {extractedCircuit?.circuitDescription} — {locationContext}
        </p>
      </div>
    )
  }

  // ============================================================
  // RENDER: REVIEW STEP
  // ============================================================

  if (!extractedCircuit) return null

  const statusBadge = getStatusBadge(extractedCircuit.status)

  // Primary fields (always visible)
  const primaryFields: Array<{
    label: string
    field: keyof CircuitDetail
    value: string
    highlight?: 'pass' | 'fail' | 'warning'
  }> = [
    {
      label: 'Circuit No.',
      field: 'circuitNumber',
      value: extractedCircuit.circuitNumber ?? '—',
    },
    {
      label: 'Description',
      field: 'circuitDescription',
      value: extractedCircuit.circuitDescription ?? '—',
    },
    {
      label: 'Location',
      field: 'circuitDescription',
      value: locationContext || '—',
    },
    {
      label: 'Zs (Ω)',
      field: 'zs',
      value: formatTestValue(extractedCircuit.zs),
      highlight: extractedCircuit.zs !== null ? 'pass' : undefined,
    },
    {
      label: 'R1+R2 (Ω)',
      field: 'r1r2',
      value: formatTestValue(extractedCircuit.r1r2),
    },
    {
      label: 'IR L-N (MΩ)',
      field: 'irLiveLive',
      value: formatTestValue(extractedCircuit.irLiveLive),
      highlight: extractedCircuit.irLiveLive ? 'pass' : undefined,
    },
    {
      label: 'IR L-E (MΩ)',
      field: 'irLiveEarth',
      value: formatTestValue(extractedCircuit.irLiveEarth),
      highlight: extractedCircuit.irLiveEarth ? 'pass' : undefined,
    },
    {
      label: 'RCD (ms)',
      field: 'rcdDisconnectionTime',
      value: formatTestValue(extractedCircuit.rcdDisconnectionTime),
      highlight: extractedCircuit.rcdDisconnectionTime !== null ? 'pass' : undefined,
    },
  ]

  // Secondary fields (expandable)
  const secondaryFields: Array<{
    label: string
    field: keyof CircuitDetail
    value: string
  }> = [
    { label: 'Wiring Type', field: 'wiringType', value: extractedCircuit.wiringType ?? '—' },
    { label: 'Ref Method', field: 'referenceMethod', value: extractedCircuit.referenceMethod ?? '—' },
    { label: 'No. Points', field: 'numberOfPoints', value: formatTestValue(extractedCircuit.numberOfPoints) },
    { label: 'Live CSA (mm²)', field: 'liveConductorCsa', value: formatTestValue(extractedCircuit.liveConductorCsa) },
    { label: 'CPC CSA (mm²)', field: 'cpcCsa', value: formatTestValue(extractedCircuit.cpcCsa) },
    { label: 'OCPD Type', field: 'ocpdType', value: extractedCircuit.ocpdType ?? '—' },
    { label: 'OCPD Rating (A)', field: 'ocpdRating', value: formatTestValue(extractedCircuit.ocpdRating) },
    { label: 'Max Zs (Ω)', field: 'maxPermittedZs', value: formatTestValue(extractedCircuit.maxPermittedZs) },
    { label: 'RCD Type', field: 'rcdType', value: extractedCircuit.rcdType ?? '—' },
    { label: 'RCD Rating (mA)', field: 'rcdRating', value: formatTestValue(extractedCircuit.rcdRating) },
    { label: 'r1 (Ω)', field: 'r1', value: formatTestValue(extractedCircuit.r1) },
    { label: 'rn (Ω)', field: 'rn', value: formatTestValue(extractedCircuit.rn) },
    { label: 'r2 (Ω)', field: 'r2', value: formatTestValue(extractedCircuit.r2) },
    { label: 'Test Voltage (V)', field: 'irTestVoltage', value: formatTestValue(extractedCircuit.irTestVoltage) },
    { label: 'Polarity', field: 'polarity', value: extractedCircuit.polarity === 'TICK' ? '✓' : extractedCircuit.polarity ?? '—' },
  ]

  return (
    <div className="cv-panel space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 bg-certvoice-green rounded-full flex items-center justify-center">
            <Check className="w-3 h-3 text-white" />
          </div>
          <h3 className="cv-section-title">Review Extracted Fields</h3>
        </div>
        <span className={statusBadge.className}>{statusBadge.text}</span>
      </div>

      {/* Warnings */}
      {warnings.length > 0 && (
        <div className="space-y-1">
          {warnings.map((w, i) => (
            <div
              key={i}
              className="flex items-start gap-2 bg-certvoice-amber/10 border border-certvoice-amber/30 rounded-lg p-2"
            >
              <AlertTriangle className="w-3.5 h-3.5 text-certvoice-amber flex-shrink-0 mt-0.5" />
              <p className="text-xs text-certvoice-amber">{w}</p>
            </div>
          ))}
        </div>
      )}

      {/* Primary Fields Grid */}
      <div className="grid grid-cols-2 gap-2">
        {primaryFields.map((f) => (
          <div key={f.label} className="cv-data-field">
            <div className="cv-data-label">{f.label}</div>
            <div
              className={`cv-data-value ${
                f.highlight === 'pass'
                  ? 'text-certvoice-green'
                  : f.highlight === 'fail'
                    ? 'text-certvoice-red'
                    : f.highlight === 'warning'
                      ? 'text-certvoice-amber'
                      : ''
              }`}
            >
              {f.value}
            </div>
          </div>
        ))}
      </div>

      {/* Expand/Collapse All Fields */}
      <button
        onClick={() => setShowAllFields(!showAllFields)}
        className="w-full flex items-center justify-center gap-1 text-xs text-certvoice-muted
                   hover:text-certvoice-accent py-2 transition-colors"
        type="button"
      >
        {showAllFields ? (
          <>
            <ChevronUp className="w-3 h-3" /> Hide detail fields
          </>
        ) : (
          <>
            <ChevronDown className="w-3 h-3" /> Show all {secondaryFields.length} fields
          </>
        )}
      </button>

      {/* Secondary Fields */}
      {showAllFields && (
        <div className="grid grid-cols-2 gap-2 animate-slide-up">
          {secondaryFields.map((f) => (
            <div key={f.label} className="cv-data-field">
              <div className="cv-data-label">{f.label}</div>
              <input
                type="text"
                value={f.value === '—' ? '' : f.value}
                onChange={(e) => handleFieldEdit(f.field, e.target.value)}
                className="cv-data-value bg-transparent border-none outline-none w-full
                           focus:text-certvoice-accent"
                placeholder="—"
              />
            </div>
          ))}
        </div>
      )}

      {/* Remarks */}
      {extractedCircuit.remarks && (
        <div className="cv-data-field">
          <div className="cv-data-label">Remarks</div>
          <div className="text-xs text-certvoice-text">{extractedCircuit.remarks}</div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex gap-2">
        <button
          onClick={handleConfirm}
          className="cv-btn-primary flex-1 flex items-center justify-center gap-2"
          type="button"
        >
          <Check className="w-4 h-4" />
          Confirm Circuit
        </button>
        <button
          onClick={handleRetry}
          className="cv-btn-secondary flex items-center justify-center gap-2 px-4"
          type="button"
        >
          <RotateCcw className="w-4 h-4" />
        </button>
        <button
          onClick={onCancel}
          className="cv-btn-secondary flex items-center justify-center gap-2 px-4"
          type="button"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
