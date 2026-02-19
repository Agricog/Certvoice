/**
 * CertVoice — EIC Design Form (Section D)
 *
 * Captures design details for new electrical installations:
 *   - Maximum demand assessment
 *   - Design confirmations (OCPD, circuit sizing, disconnection times)
 *   - SPD (surge protection) assessment per Chapter 44
 *   - Energy efficiency considerations (Reg 132.19)
 *
 * EIC-only component — not used by EICR or Minor Works.
 *
 * **File: src/components/DesignForm.tsx** (create new)
 *
 * @module components/DesignForm
 */

import { useCallback } from 'react'
import { Ruler, Check, AlertTriangle, Zap, Shield } from 'lucide-react'
import type { DesignDetails } from '../types/eic'

// ============================================================
// TYPES
// ============================================================

interface DesignFormProps {
  design: DesignDetails
  onDesignChange: (updated: DesignDetails) => void
  disabled?: boolean
}

// ============================================================
// EMPTY DEFAULT
// ============================================================

export const EMPTY_DESIGN: DesignDetails = {
  maxDemand: null,
  maxDemandUnit: 'AMPS',
  numberOfPhases: 1,
  ocpdCharacteristicsAppropriate: false,
  circuitsAdequatelySized: false,
  disconnectionTimesAchievable: false,
  spdAssessmentDone: false,
  spdRequired: false,
  spdFitted: false,
  energyEfficiencyDetails: '',
  designComments: '',
}

// ============================================================
// COMPONENT
// ============================================================

export default function DesignForm({
  design,
  onDesignChange,
  disabled = false,
}: DesignFormProps) {

  const update = useCallback(
    <K extends keyof DesignDetails>(field: K, value: DesignDetails[K]) => {
      onDesignChange({ ...design, [field]: value })
    },
    [design, onDesignChange]
  )

  // Count confirmed items for progress indicator
  const confirmations = [
    design.ocpdCharacteristicsAppropriate,
    design.circuitsAdequatelySized,
    design.disconnectionTimesAchievable,
    design.spdAssessmentDone,
  ]
  const confirmedCount = confirmations.filter(Boolean).length

  return (
    <div className="space-y-4">
      {/* ── Maximum Demand ─────────────────────────────────────────────── */}
      <div className="cv-panel p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-certvoice-accent" />
            <h3 className="text-sm font-bold text-certvoice-text">Design — Section D</h3>
          </div>
          <span
            className={`text-xs font-mono px-2 py-0.5 rounded-full ${
              confirmedCount === 4
                ? 'bg-emerald-500/15 text-emerald-400'
                : 'bg-certvoice-accent/15 text-certvoice-accent'
            }`}
          >
            {confirmedCount}/4 confirmed
          </span>
        </div>

        {/* Max demand + unit + phases */}
        <div>
          <label className="block text-xs font-semibold text-certvoice-text mb-1">
            Maximum Demand
          </label>
          <div className="flex gap-2">
            <input
              type="number"
              inputMode="decimal"
              step="any"
              value={design.maxDemand ?? ''}
              onChange={(e) => {
                const v = e.target.value
                update('maxDemand', v === '' ? null : Number(v))
              }}
              placeholder="e.g. 100"
              disabled={disabled}
              className="flex-1 px-3 py-2 bg-certvoice-surface-2 border border-certvoice-border rounded-lg
                         text-sm text-certvoice-text placeholder:text-certvoice-muted/50
                         focus:outline-none focus:border-certvoice-accent focus:ring-1 focus:ring-certvoice-accent/30
                         disabled:opacity-50 disabled:cursor-not-allowed"
            />
            <div className="flex gap-1">
              {(['AMPS', 'KVA'] as const).map((unit) => (
                <button
                  key={unit}
                  type="button"
                  onClick={() => update('maxDemandUnit', unit)}
                  disabled={disabled}
                  className={`px-3 py-2 rounded-lg text-xs font-semibold border transition-colors
                    disabled:opacity-50 disabled:cursor-not-allowed ${
                    design.maxDemandUnit === unit
                      ? 'bg-certvoice-accent/15 border-certvoice-accent text-certvoice-accent'
                      : 'bg-certvoice-surface-2 border-certvoice-border text-certvoice-muted hover:border-certvoice-muted'
                  }`}
                >
                  {unit === 'AMPS' ? 'A' : 'kVA'}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Number of phases */}
        <div>
          <label className="block text-xs font-semibold text-certvoice-text mb-1">
            Number of Phases
          </label>
          <div className="flex gap-2">
            {([1, 3] as const).map((phases) => (
              <button
                key={phases}
                type="button"
                onClick={() => update('numberOfPhases', phases)}
                disabled={disabled}
                className={`flex-1 px-3 py-2 rounded-lg text-xs font-semibold border transition-colors
                  disabled:opacity-50 disabled:cursor-not-allowed ${
                  design.numberOfPhases === phases
                    ? 'bg-certvoice-accent/15 border-certvoice-accent text-certvoice-accent'
                    : 'bg-certvoice-surface-2 border-certvoice-border text-certvoice-muted hover:border-certvoice-muted'
                }`}
              >
                {phases === 1 ? 'Single Phase' : 'Three Phase'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Design Confirmations ──────────────────────────────────────── */}
      <div className="cv-panel p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Ruler className="w-4 h-4 text-certvoice-accent" />
          <h3 className="text-sm font-bold text-certvoice-text">Design Confirmations</h3>
        </div>
        <p className="text-[10px] text-certvoice-muted">
          Confirm each item to declare the design complies with BS 7671
        </p>

        <ConfirmationItem
          label="Overcurrent protective device characteristics are appropriate"
          regulation="Chapters 43 & 53"
          checked={design.ocpdCharacteristicsAppropriate}
          onChange={(v) => update('ocpdCharacteristicsAppropriate', v)}
          disabled={disabled}
        />
        <ConfirmationItem
          label="Circuits adequately sized for intended load"
          regulation="Section 523"
          checked={design.circuitsAdequatelySized}
          onChange={(v) => update('circuitsAdequatelySized', v)}
          disabled={disabled}
        />
        <ConfirmationItem
          label="Earth fault loop impedance values permit automatic disconnection in required time"
          regulation="Sections 411 & 531"
          checked={design.disconnectionTimesAchievable}
          onChange={(v) => update('disconnectionTimesAchievable', v)}
          disabled={disabled}
        />
        <ConfirmationItem
          label="Surge protection risk assessment carried out"
          regulation="Chapter 44"
          checked={design.spdAssessmentDone}
          onChange={(v) => update('spdAssessmentDone', v)}
          disabled={disabled}
        />

        {/* Validation hint */}
        {confirmedCount < 4 && !disabled && (
          <div className="flex items-center gap-1.5 text-[10px] text-certvoice-amber mt-2">
            <AlertTriangle className="w-3 h-3 shrink-0" />
            All design confirmations must be checked before the certificate can be issued
          </div>
        )}
      </div>

      {/* ── SPD Details ───────────────────────────────────────────────── */}
      <div className="cv-panel p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-certvoice-accent" />
          <h3 className="text-sm font-bold text-certvoice-text">Surge Protection</h3>
        </div>

        <div className="flex items-center justify-between py-2">
          <span className="text-sm text-certvoice-text">SPD required (risk assessment)</span>
          <TickButton
            checked={design.spdRequired}
            onChange={(v) => update('spdRequired', v)}
            disabled={disabled}
          />
        </div>

        {design.spdRequired && (
          <div className="flex items-center justify-between py-2">
            <span className="text-sm text-certvoice-text">SPD fitted</span>
            <TickButton
              checked={design.spdFitted}
              onChange={(v) => update('spdFitted', v)}
              disabled={disabled}
            />
          </div>
        )}

        {design.spdRequired && !design.spdFitted && !disabled && (
          <div className="flex items-center gap-1.5 text-[10px] text-certvoice-amber">
            <AlertTriangle className="w-3 h-3 shrink-0" />
            SPD required but not fitted — record departure in Section E
          </div>
        )}
      </div>

      {/* ── Energy Efficiency ─────────────────────────────────────────── */}
      <div className="cv-panel p-4 space-y-3">
        <label className="block text-xs font-semibold text-certvoice-text">
          Energy Efficiency Measures
          <span className="text-certvoice-muted font-normal ml-1">(Reg 132.19)</span>
        </label>
        <textarea
          value={design.energyEfficiencyDetails}
          onChange={(e) => update('energyEfficiencyDetails', e.target.value)}
          placeholder="e.g. LED lighting throughout, PIR sensors in hallways, timer controls on immersion heater"
          rows={2}
          disabled={disabled}
          className="w-full px-3 py-2 bg-certvoice-surface-2 border border-certvoice-border rounded-lg
                     text-sm text-certvoice-text placeholder:text-certvoice-muted/50 resize-none
                     focus:outline-none focus:border-certvoice-accent focus:ring-1 focus:ring-certvoice-accent/30
                     disabled:opacity-50 disabled:cursor-not-allowed"
        />
      </div>

      {/* ── Design Comments ───────────────────────────────────────────── */}
      <div className="cv-panel p-4 space-y-3">
        <label className="block text-xs font-semibold text-certvoice-text">
          Design Comments
        </label>
        <textarea
          value={design.designComments}
          onChange={(e) => update('designComments', e.target.value)}
          placeholder="Any additional notes on the design..."
          rows={3}
          disabled={disabled}
          className="w-full px-3 py-2 bg-certvoice-surface-2 border border-certvoice-border rounded-lg
                     text-sm text-certvoice-text placeholder:text-certvoice-muted/50 resize-none
                     focus:outline-none focus:border-certvoice-accent focus:ring-1 focus:ring-certvoice-accent/30
                     disabled:opacity-50 disabled:cursor-not-allowed"
        />
      </div>
    </div>
  )
}

// ============================================================
// SUB-COMPONENTS
// ============================================================

/** Confirmation checkbox with regulation reference */
function ConfirmationItem({
  label,
  regulation,
  checked,
  onChange,
  disabled,
}: {
  label: string
  regulation: string
  checked: boolean
  onChange: (val: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className={`w-full text-left flex items-start gap-3 p-3 rounded-lg border transition-colors
        disabled:opacity-50 disabled:cursor-not-allowed ${
        checked
          ? 'bg-emerald-500/10 border-emerald-500/40'
          : 'bg-certvoice-surface-2 border-certvoice-border hover:border-certvoice-muted'
      }`}
    >
      <div
        className={`w-5 h-5 rounded flex items-center justify-center shrink-0 mt-0.5 transition-colors ${
          checked
            ? 'bg-emerald-500 text-white'
            : 'bg-certvoice-bg border border-certvoice-border'
        }`}
      >
        {checked && <Check className="w-3 h-3" />}
      </div>
      <div className="min-w-0">
        <p className="text-sm text-certvoice-text leading-snug">{label}</p>
        <p className="text-[10px] text-certvoice-muted font-mono mt-0.5">{regulation}</p>
      </div>
    </button>
  )
}

/** Simple tick/cross toggle button */
function TickButton({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean
  onChange: (val: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className={`w-8 h-8 rounded-lg border flex items-center justify-center transition-colors
        disabled:opacity-50 disabled:cursor-not-allowed ${
        checked
          ? 'bg-emerald-500/15 border-emerald-500 text-emerald-400'
          : 'bg-certvoice-surface-2 border-certvoice-border text-certvoice-muted hover:border-certvoice-muted'
      }`}
    >
      {checked && <Check className="w-4 h-4" />}
    </button>
  )
}
