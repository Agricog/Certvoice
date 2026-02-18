/**
 * CertVoice — Test Instruments Form (EICR Section H)
 *
 * Records multifunction tester details, serial numbers, and calibration dates.
 * Auto-fills from engineer profile on first load if instruments are empty.
 *
 * @module components/TestInstrumentsForm
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { Wrench, UserCheck } from 'lucide-react'
import type { TestInstruments } from '../types/eicr'
import type { EngineerProfile } from '../types/eicr'

// ============================================================
// TYPES
// ============================================================

interface TestInstrumentsFormProps {
  instruments: TestInstruments
  onInstrumentsChange: (updated: TestInstruments) => void
  engineerProfile: EngineerProfile | null
  disabled?: boolean
}

// ============================================================
// EMPTY DEFAULT
// ============================================================

export const EMPTY_INSTRUMENTS: TestInstruments = {
  multifunctionInstrument: '',
  insulationResistance: '',
  continuity: '',
  earthElectrodeResistance: '',
  earthFaultLoopImpedance: '',
  rcdTester: '',
}

// ============================================================
// FIELD CONFIG
// ============================================================

const FIELDS: { key: keyof TestInstruments; label: string; placeholder: string; required: boolean }[] = [
  {
    key: 'multifunctionInstrument',
    label: 'Multifunction Tester',
    placeholder: 'e.g. Megger MFT1741, S/N 12345, Cal 01/2026',
    required: true,
  },
  {
    key: 'insulationResistance',
    label: 'Insulation Resistance Tester',
    placeholder: 'Make, model, serial, cal date (if separate)',
    required: false,
  },
  {
    key: 'continuity',
    label: 'Continuity Tester',
    placeholder: 'Make, model, serial, cal date (if separate)',
    required: false,
  },
  {
    key: 'earthFaultLoopImpedance',
    label: 'Earth Fault Loop Impedance Tester',
    placeholder: 'Make, model, serial, cal date (if separate)',
    required: false,
  },
  {
    key: 'earthElectrodeResistance',
    label: 'Earth Electrode Resistance Tester',
    placeholder: 'Make, model, serial, cal date (if separate)',
    required: false,
  },
  {
    key: 'rcdTester',
    label: 'RCD Tester',
    placeholder: 'Make, model, serial, cal date (if separate)',
    required: false,
  },
]

// ============================================================
// HELPERS
// ============================================================

/** Check if all instrument fields are empty */
function isAllEmpty(instruments: TestInstruments): boolean {
  return Object.values(instruments).every((v) => !v || v.trim() === '')
}

/** Check if profile has instrument data worth auto-filling */
function profileHasInstruments(profile: EngineerProfile | null): boolean {
  if (!profile?.testInstruments) return false
  return !isAllEmpty(profile.testInstruments)
}

// ============================================================
// COMPONENT
// ============================================================

export default function TestInstrumentsForm({
  instruments,
  onInstrumentsChange,
  engineerProfile,
  disabled = false,
}: TestInstrumentsFormProps) {
  const [showOptional, setShowOptional] = useState(false)
  const hasAutoFilled = useRef(false)

  // Auto-fill from profile on first render if instruments are empty
  useEffect(() => {
    if (hasAutoFilled.current) return
    if (!isAllEmpty(instruments)) return
    if (!profileHasInstruments(engineerProfile)) return

    hasAutoFilled.current = true
    onInstrumentsChange({ ...engineerProfile!.testInstruments })
  }, [instruments, engineerProfile, onInstrumentsChange])

  // Check if any optional fields have data (to auto-expand)
  useEffect(() => {
    const hasOptionalData = FIELDS.some(
      (f) => !f.required && instruments[f.key] && instruments[f.key].trim() !== ''
    )
    if (hasOptionalData) setShowOptional(true)
  }, [instruments])

  const handleChange = useCallback(
    (key: keyof TestInstruments, value: string) => {
      onInstrumentsChange({ ...instruments, [key]: value })
    },
    [instruments, onInstrumentsChange]
  )

  const handleAutoFill = useCallback(() => {
    if (!engineerProfile?.testInstruments) return
    onInstrumentsChange({ ...engineerProfile.testInstruments })
  }, [engineerProfile, onInstrumentsChange])

  const requiredFields = FIELDS.filter((f) => f.required)
  const optionalFields = FIELDS.filter((f) => !f.required)

  return (
    <div className="cv-panel p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Wrench className="w-4 h-4 text-certvoice-accent" />
          <h3 className="text-sm font-bold text-certvoice-text">Test Instruments</h3>
          <span className="text-[10px] text-certvoice-muted">Section H</span>
        </div>
        {profileHasInstruments(engineerProfile) && !disabled && (
          <button
            type="button"
            onClick={handleAutoFill}
            className="flex items-center gap-1 text-[10px] text-certvoice-accent hover:text-certvoice-accent/80 transition-colors"
          >
            <UserCheck className="w-3 h-3" />
            Fill from profile
          </button>
        )}
      </div>

      {/* Required fields */}
      {requiredFields.map((field) => (
        <div key={field.key}>
          <label className="block text-xs font-semibold text-certvoice-text mb-1">
            {field.label}
            <span className="text-certvoice-red ml-0.5">*</span>
          </label>
          <input
            type="text"
            value={instruments[field.key] ?? ''}
            onChange={(e) => handleChange(field.key, e.target.value)}
            placeholder={field.placeholder}
            disabled={disabled}
            className="w-full px-3 py-2 bg-certvoice-surface-2 border border-certvoice-border rounded-lg
                       text-sm text-certvoice-text placeholder:text-certvoice-muted/50
                       focus:outline-none focus:border-certvoice-accent focus:ring-1 focus:ring-certvoice-accent/30
                       disabled:opacity-50 disabled:cursor-not-allowed"
          />
          {field.key === 'multifunctionInstrument' && (
            <p className="text-[10px] text-certvoice-muted mt-1">
              Include make, model, serial number, and calibration date
            </p>
          )}
        </div>
      ))}

      {/* Optional fields toggle */}
      {optionalFields.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setShowOptional(!showOptional)}
            className="text-xs text-certvoice-accent hover:text-certvoice-accent/80 transition-colors"
          >
            {showOptional ? 'Hide' : 'Show'} separate instruments ({optionalFields.length})
          </button>

          {showOptional && (
            <div className="space-y-3 pt-1">
              <p className="text-[10px] text-certvoice-muted">
                Only complete these if using separate instruments (not a multifunction tester)
              </p>
              {optionalFields.map((field) => (
                <div key={field.key}>
                  <label className="block text-xs font-semibold text-certvoice-text mb-1">
                    {field.label}
                  </label>
                  <input
                    type="text"
                    value={instruments[field.key] ?? ''}
                    onChange={(e) => handleChange(field.key, e.target.value)}
                    placeholder={field.placeholder}
                    disabled={disabled}
                    className="w-full px-3 py-2 bg-certvoice-surface-2 border border-certvoice-border rounded-lg
                               text-sm text-certvoice-text placeholder:text-certvoice-muted/50
                               focus:outline-none focus:border-certvoice-accent focus:ring-1 focus:ring-certvoice-accent/30
                               disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Validation hint */}
      {!instruments.multifunctionInstrument?.trim() && !disabled && (
        <div className="flex items-center gap-1.5 text-[10px] text-certvoice-amber">
          <span className="w-1.5 h-1.5 rounded-full bg-certvoice-amber shrink-0" />
          Multifunction tester details required for compliance
        </div>
      )}
    </div>
  )
}
