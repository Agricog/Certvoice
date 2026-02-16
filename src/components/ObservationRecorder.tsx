/**
 * CertVoice — ObservationRecorder Component
 *
 * Voice capture for defects, non-compliances, and observations.
 *
 * Flow:
 *   1. Inspector taps mic, describes the defect
 *   2. AI extracts: description, classification code, regulation, remedial action
 *   3. Inspector reviews and confirms classification
 *   4. PhotoCapture allows evidence photos during review
 *   5. Observation added to Section K with photo keys
 *
 * Classification codes determine the overall report assessment:
 *   C1 or C2 → UNSATISFACTORY
 *   C3 only → SATISFACTORY
 *   FI → UNSATISFACTORY (must investigate)
 */

import { useState, useCallback } from 'react'
import {
  Check,
  X,
  RotateCcw,
  AlertTriangle,
  Shield,
  BookOpen,
} from 'lucide-react'
import VoiceCapture from './VoiceCapture'
import PhotoCapture from './PhotoCapture'
import { useAIExtraction } from '../hooks/useAIExtraction'
import type { ExtractionContext } from '../hooks/useAIExtraction'
import type { Observation, ClassificationCode } from '../types/eicr'
import { CLASSIFICATION_DEFINITIONS } from '../utils/bs7671'
import { preprocessTranscript } from '../utils/speechParser'
import { trackObservationCaptured } from '../utils/analytics'

// ============================================================
// TYPES
// ============================================================

interface ObservationRecorderProps {
  /** UUID of the certificate — required for R2 storage path scoping */
  certificateId: string
  /** Current location from room selector */
  locationContext: string
  /** Current distribution board reference */
  dbContext: string
  /** Next item number for auto-increment */
  nextItemNumber: number
  /** Earthing type (passed to AI context) */
  earthingType: string | null
  /** Existing circuit numbers (passed to AI context) */
  existingCircuits: string[]
  /** Existing observation when editing (loads saved photoKeys, text, etc.) */
  editingObservation?: Partial<Observation> | null
  /** Called when inspector confirms an observation */
  onObservationConfirmed: (observation: Partial<Observation>) => void
  /** Called when recorder is cancelled */
  onCancel: () => void
}

type RecorderStep = 'capture' | 'review' | 'confirmed'

// ============================================================
// CLASSIFICATION BADGE
// ============================================================

const CODE_STYLES: Record<ClassificationCode, { bg: string; text: string; border: string }> = {
  C1: { bg: 'bg-certvoice-red/15', text: 'text-certvoice-red', border: 'border-certvoice-red/30' },
  C2: { bg: 'bg-certvoice-amber/15', text: 'text-certvoice-amber', border: 'border-certvoice-amber/30' },
  C3: { bg: 'bg-certvoice-green/15', text: 'text-certvoice-green', border: 'border-certvoice-green/30' },
  FI: { bg: 'bg-certvoice-accent/15', text: 'text-certvoice-accent', border: 'border-certvoice-accent/30' },
}

function ClassificationBadge({
  code,
  size = 'normal',
}: {
  code: ClassificationCode
  size?: 'normal' | 'large'
}) {
  const style = CODE_STYLES[code]
  const def = CLASSIFICATION_DEFINITIONS[code]

  if (size === 'large') {
    return (
      <div className={`${style.bg} ${style.border} border rounded-lg p-3`}>
        <div className="flex items-center gap-2">
          <span className={`font-bold text-base ${style.text}`}>{code}</span>
          <span className={`text-sm font-semibold ${style.text}`}>
            {def?.meaning ?? ''}
          </span>
        </div>
        <p className="text-xs text-certvoice-muted mt-1">{def?.action ?? ''}</p>
      </div>
    )
  }

  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-md ${style.bg} ${style.text}`}
    >
      {code} — {def?.meaning ?? ''}
    </span>
  )
}

// ============================================================
// COMPONENT
// ============================================================

export default function ObservationRecorder({
  certificateId,
  locationContext,
  dbContext,
  nextItemNumber,
  earthingType,
  existingCircuits,
  editingObservation,
  onObservationConfirmed,
  onCancel,
}: ObservationRecorderProps) {
  // If editing, jump straight to review with existing data
  const isEditing = Boolean(editingObservation)

  const [step, setStep] = useState<RecorderStep>(isEditing ? 'review' : 'capture')
  const [extractedObs, setExtractedObs] = useState<Partial<Observation> | null>(
    isEditing ? (editingObservation ?? null) : null
  )
  const [warnings, setWarnings] = useState<string[]>([])
  const [selectedCode, setSelectedCode] = useState<ClassificationCode | null>(
    isEditing ? (editingObservation?.classificationCode ?? null) : null
  )
  const [photoKeys, setPhotoKeys] = useState<string[]>(
    editingObservation?.photoKeys ?? []
  )

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

  // --- Handle transcript ---
  const handleTranscript = useCallback(
    async (transcript: string, _durationMs: number) => {
      const processed = preprocessTranscript(transcript)
      const result = await extract(processed, context)

      if (result?.success && result.type === 'observation' && result.observation) {
        const obs = result.observation
        setExtractedObs({
          ...obs,
          itemNumber: nextItemNumber,
          location: obs.location ?? locationContext,
        })
        setSelectedCode(obs.classificationCode ?? null)
        setWarnings(result.warnings)
        setStep('review')
      }
    },
    [extract, context, nextItemNumber, locationContext]
  )

  // --- Handle photo keys change ---
  const handlePhotosChange = useCallback((keys: string[]) => {
    setPhotoKeys(keys)
  }, [])

  // --- Change classification code ---
  const handleCodeChange = useCallback((code: ClassificationCode) => {
    setSelectedCode(code)
    setExtractedObs((prev) => {
      if (!prev) return prev
      return { ...prev, classificationCode: code }
    })
  }, [])

  // --- Confirm observation ---
  const handleConfirm = useCallback(() => {
    if (!extractedObs || !selectedCode) return

    const finalObs: Partial<Observation> = {
      ...extractedObs,
      classificationCode: selectedCode,
      photoKeys,
    }

    onObservationConfirmed(finalObs)
    setStep('confirmed')

    trackObservationCaptured(selectedCode, photoKeys.length > 0)
  }, [extractedObs, selectedCode, photoKeys, onObservationConfirmed])

  // --- Retry ---
  const handleRetry = useCallback(() => {
    setStep('capture')
    setExtractedObs(null)
    setSelectedCode(null)
    setWarnings([])
    setPhotoKeys([])
    resetExtraction()
  }, [resetExtraction])

  // ============================================================
  // RENDER: CAPTURE
  // ============================================================

  if (step === 'capture') {
    return (
      <div className="cv-panel space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="cv-section-title">Record Observation</h3>
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
            Describe the defect or non-compliance, e.g.:{' '}
            <span className="text-certvoice-accent font-medium">
              &quot;Bathroom shaver unit, cracked faceplate exposing live terminals,
              that&apos;s a C2 potentially dangerous, needs replacement, regulation
              421.1.201&quot;
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
            <div className="cv-badge-warning">AI extracting observation...</div>
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
          Observation #{nextItemNumber} added
        </p>
        {selectedCode && <ClassificationBadge code={selectedCode} />}
        {photoKeys.length > 0 && (
          <p className="text-[10px] text-certvoice-muted">
            {photoKeys.length} photo{photoKeys.length !== 1 ? 's' : ''} attached
          </p>
        )}
      </div>
    )
  }

  // ============================================================
  // RENDER: REVIEW
  // ============================================================

  if (!extractedObs) return null

  return (
    <div className="cv-panel space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-certvoice-amber" />
          <h3 className="cv-section-title">
            {isEditing ? 'Edit' : 'Review'} Observation #{extractedObs.itemNumber ?? nextItemNumber}
          </h3>
        </div>
      </div>

      {/* Classification Code (large badge + selector) */}
      {selectedCode && <ClassificationBadge code={selectedCode} size="large" />}

      <div className="space-y-2">
        <div className="cv-data-label">Classification Code</div>
        <div className="flex gap-2">
          {(['C1', 'C2', 'C3', 'FI'] as ClassificationCode[]).map((code) => {
            const style = CODE_STYLES[code]
            const isSelected = selectedCode === code
            return (
              <button
                key={code}
                onClick={() => handleCodeChange(code)}
                className={`
                  flex-1 py-2 rounded-lg text-xs font-bold border transition-all
                  ${
                    isSelected
                      ? `${style.bg} ${style.text} ${style.border}`
                      : 'bg-certvoice-surface-2 text-certvoice-muted border-certvoice-border hover:border-certvoice-accent'
                  }
                `}
                type="button"
              >
                {code}
              </button>
            )
          })}
        </div>
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

      {/* Observation Text */}
      <div className="cv-data-field">
        <div className="cv-data-label">Observation</div>
        <textarea
          value={extractedObs.observationText ?? ''}
          onChange={(e) =>
            setExtractedObs((prev) =>
              prev ? { ...prev, observationText: e.target.value } : prev
            )
          }
          rows={3}
          className="w-full bg-transparent text-xs text-certvoice-text border-none outline-none
                     resize-none focus:text-certvoice-accent font-mono leading-relaxed"
        />
      </div>

      {/* Details Grid */}
      <div className="grid grid-cols-2 gap-2">
        <div className="cv-data-field">
          <div className="cv-data-label">Location</div>
          <div className="cv-data-value">{extractedObs.location ?? locationContext}</div>
        </div>
        <div className="cv-data-field">
          <div className="cv-data-label">DB Reference</div>
          <div className="cv-data-value">{extractedObs.dbReference ?? dbContext ?? '—'}</div>
        </div>
        <div className="cv-data-field">
          <div className="cv-data-label">Circuit Ref</div>
          <div className="cv-data-value">{extractedObs.circuitReference ?? '—'}</div>
        </div>
        <div className="cv-data-field flex items-center gap-1">
          <BookOpen className="w-3 h-3 text-certvoice-muted" />
          <div>
            <div className="cv-data-label">Regulation</div>
            <div className="cv-data-value font-mono">
              {extractedObs.regulationReference ?? '—'}
            </div>
          </div>
        </div>
      </div>

      {/* Remedial Action */}
      {extractedObs.remedialAction && (
        <div className="cv-data-field">
          <div className="cv-data-label">Remedial Action</div>
          <textarea
            value={extractedObs.remedialAction}
            onChange={(e) =>
              setExtractedObs((prev) =>
                prev ? { ...prev, remedialAction: e.target.value } : prev
              )
            }
            rows={2}
            className="w-full bg-transparent text-xs text-certvoice-text border-none outline-none
                       resize-none focus:text-certvoice-accent"
          />
        </div>
      )}

      {/* Photo Evidence — replaces placeholder */}
      <PhotoCapture
        certificateId={certificateId}
        photoKeys={photoKeys}
        onPhotosChange={handlePhotosChange}
        maxPhotos={4}
      />

      {/* Action Buttons */}
      <div className="flex gap-2">
        <button
          onClick={handleConfirm}
          disabled={!selectedCode}
          className="cv-btn-primary flex-1 flex items-center justify-center gap-2
                     disabled:opacity-50 disabled:cursor-not-allowed"
          type="button"
        >
          <Check className="w-4 h-4" />
          {isEditing ? 'Update' : 'Confirm'} Observation
        </button>
        {!isEditing && (
          <button
            onClick={handleRetry}
            className="cv-btn-secondary flex items-center justify-center gap-2 px-4"
            type="button"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        )}
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
