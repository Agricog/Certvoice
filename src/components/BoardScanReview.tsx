/**
 * CertVoice — BoardScanReview Component
 *
 * Bulk review grid for AI-extracted circuits from a board photo scan.
 * Mobile-first card layout — each circuit is an editable card with
 * confidence indicators and include/exclude toggle.
 *
 * Flow:
 *   1. Receives scanned circuits from BoardScanCapture
 *   2. Displays as editable cards (not a table — better on phones)
 *   3. Confidence dots: green (high), amber (medium), red (low)
 *   4. Sparky taps to edit any field inline
 *   5. Checkbox per circuit to include/exclude
 *   6. "Confirm All" creates CircuitDetail[] with test results empty
 *
 * Drop into: src/components/BoardScanReview.tsx
 *
 * @module components/BoardScanReview
 */

import { useState, useCallback } from 'react'
import { Check, X, AlertTriangle, CircuitBoard, Eye, EyeOff } from 'lucide-react'
import type { ScannedCircuit } from '../hooks/useBoardScan'

// ============================================================
// TYPES
// ============================================================

interface BoardScanReviewProps {
  boardReference: string
  circuits: ScannedCircuit[]
  onConfirm: (circuits: ScannedCircuit[]) => void
  onCancel: () => void
}

interface EditableCircuit extends ScannedCircuit {
  included: boolean
}

// ============================================================
// CONFIDENCE DOT
// ============================================================

const CONFIDENCE_STYLES: Record<string, { dot: string; label: string }> = {
  high: { dot: 'bg-certvoice-green', label: 'High confidence' },
  medium: { dot: 'bg-certvoice-amber', label: 'Check this' },
  low: { dot: 'bg-certvoice-red', label: 'Verify carefully' },
}

function ConfidenceDot({ level }: { level: string }) {
  const style = CONFIDENCE_STYLES[level] ?? CONFIDENCE_STYLES.low
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full ${style.dot}`}
      title={style.label}
    />
  )
}

// ============================================================
// COMPONENT
// ============================================================

export default function BoardScanReview({
  boardReference,
  circuits: initialCircuits,
  onConfirm,
  onCancel,
}: BoardScanReviewProps) {
  const [circuits, setCircuits] = useState<EditableCircuit[]>(
    initialCircuits.map((c) => ({ ...c, included: true }))
  )

  const includedCount = circuits.filter((c) => c.included).length
  const lowConfidenceCount = circuits.filter(
    (c) => c.included && (c.confidence === 'low' || c.confidence === 'medium')
  ).length

  // --- Toggle include/exclude ---
  const toggleInclude = useCallback((idx: number) => {
    setCircuits((prev) => {
      const updated = [...prev]
      const circuit = updated[idx]
      if (circuit) {
        updated[idx] = { ...circuit, included: !circuit.included }
      }
      return updated
    })
  }, [])

  // --- Update a field ---
  const updateField = useCallback(
    (idx: number, field: keyof ScannedCircuit, value: string | number | null) => {
      setCircuits((prev) => {
        const updated = [...prev]
        const circuit = updated[idx]
        if (circuit) {
          updated[idx] = { ...circuit, [field]: value }
        }
        return updated
      })
    },
    []
  )

  // --- Confirm selected circuits ---
  const handleConfirm = useCallback(() => {
    const selected = circuits
      .filter((c) => c.included)
      .map(({ included: _, ...circuit }) => circuit)

    if (selected.length === 0) return
    onConfirm(selected)
  }, [circuits, onConfirm])

  // --- Include/exclude all ---
  const handleToggleAll = useCallback(() => {
    const allIncluded = circuits.every((c) => c.included)
    setCircuits((prev) => prev.map((c) => ({ ...c, included: !allIncluded })))
  }, [circuits])

  return (
    <div className="cv-panel space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CircuitBoard className="w-4 h-4 text-certvoice-accent" />
          <h3 className="cv-section-title">
            Review Scanned Circuits
            {boardReference && (
              <span className="text-certvoice-muted font-normal ml-1">— {boardReference}</span>
            )}
          </h3>
        </div>
        <button
          onClick={onCancel}
          className="text-certvoice-muted hover:text-certvoice-text text-xs"
          type="button"
        >
          Cancel
        </button>
      </div>

      {/* Summary bar */}
      <div className="flex items-center justify-between text-xs">
        <span className="text-certvoice-muted">
          {includedCount} of {circuits.length} circuit{circuits.length !== 1 ? 's' : ''} selected
        </span>
        <div className="flex items-center gap-3">
          {lowConfidenceCount > 0 && (
            <span className="flex items-center gap-1 text-certvoice-amber">
              <AlertTriangle className="w-3 h-3" />
              {lowConfidenceCount} to check
            </span>
          )}
          <button
            type="button"
            onClick={handleToggleAll}
            className="text-certvoice-accent hover:text-certvoice-accent/80 font-semibold"
          >
            {circuits.every((c) => c.included) ? 'Deselect All' : 'Select All'}
          </button>
        </div>
      </div>

      {/* Circuit cards */}
      <div className="space-y-2">
        {circuits.map((circuit, idx) => (
          <div
            key={`scan-${idx}`}
            className={`rounded-lg border p-3 transition-all ${
              circuit.included
                ? 'border-certvoice-border bg-certvoice-surface'
                : 'border-certvoice-border/50 bg-certvoice-surface/50 opacity-50'
            }`}
          >
            {/* Row 1: Circuit number, description, confidence, toggle */}
            <div className="flex items-center gap-2 mb-2">
              <button
                type="button"
                onClick={() => toggleInclude(idx)}
                className={`w-6 h-6 rounded flex items-center justify-center shrink-0 border transition-colors ${
                  circuit.included
                    ? 'bg-certvoice-accent border-certvoice-accent text-white'
                    : 'border-certvoice-border text-certvoice-muted hover:border-certvoice-accent'
                }`}
              >
                {circuit.included ? (
                  <Eye className="w-3 h-3" />
                ) : (
                  <EyeOff className="w-3 h-3" />
                )}
              </button>

              <div className="flex items-center gap-1.5 min-w-0 flex-1">
                <ConfidenceDot level={circuit.confidence} />
                <span className="text-xs font-bold text-certvoice-text shrink-0">
                  Cct {circuit.circuitNumber}
                </span>
                <span className="text-xs text-certvoice-muted truncate">
                  {circuit.circuitDescription}
                </span>
              </div>

              {circuit.ocpdType && circuit.ocpdRating && (
                <span className="text-[10px] font-mono text-certvoice-accent shrink-0">
                  {circuit.ocpdType}{circuit.ocpdRating}A
                </span>
              )}
            </div>

            {/* Row 2: Editable fields (only shown when included) */}
            {circuit.included && (
              <div className="grid grid-cols-2 gap-2">
                {/* Circuit Number */}
                <div>
                  <label className="cv-data-label">Circuit No.</label>
                  <input
                    type="text"
                    value={circuit.circuitNumber}
                    onChange={(e) => updateField(idx, 'circuitNumber', e.target.value)}
                    className="w-full bg-certvoice-bg border border-certvoice-border rounded px-2 py-1.5
                               text-xs text-certvoice-text focus:border-certvoice-accent focus:outline-none"
                  />
                </div>

                {/* Description */}
                <div>
                  <label className="cv-data-label">Description</label>
                  <input
                    type="text"
                    value={circuit.circuitDescription}
                    onChange={(e) => updateField(idx, 'circuitDescription', e.target.value)}
                    className="w-full bg-certvoice-bg border border-certvoice-border rounded px-2 py-1.5
                               text-xs text-certvoice-text focus:border-certvoice-accent focus:outline-none"
                  />
                </div>

                {/* OCPD Type */}
                <div>
                  <label className="cv-data-label">MCB Type</label>
                  <select
                    value={circuit.ocpdType ?? ''}
                    onChange={(e) => updateField(idx, 'ocpdType', e.target.value || null)}
                    className="w-full bg-certvoice-bg border border-certvoice-border rounded px-2 py-1.5
                               text-xs text-certvoice-text focus:border-certvoice-accent focus:outline-none"
                  >
                    <option value="">—</option>
                    <option value="B">B</option>
                    <option value="C">C</option>
                    <option value="D">D</option>
                  </select>
                </div>

                {/* OCPD Rating */}
                <div>
                  <label className="cv-data-label">Rating (A)</label>
                  <select
                    value={circuit.ocpdRating ?? ''}
                    onChange={(e) =>
                      updateField(idx, 'ocpdRating', e.target.value ? Number(e.target.value) : null)
                    }
                    className="w-full bg-certvoice-bg border border-certvoice-border rounded px-2 py-1.5
                               text-xs text-certvoice-text focus:border-certvoice-accent focus:outline-none"
                  >
                    <option value="">—</option>
                    {[6, 10, 16, 20, 25, 32, 40, 45, 50, 63, 80, 100].map((r) => (
                      <option key={r} value={r}>{r}A</option>
                    ))}
                  </select>
                </div>

                {/* RCD Type */}
                <div>
                  <label className="cv-data-label">RCD Type</label>
                  <select
                    value={circuit.rcdType ?? ''}
                    onChange={(e) => updateField(idx, 'rcdType', e.target.value || null)}
                    className="w-full bg-certvoice-bg border border-certvoice-border rounded px-2 py-1.5
                               text-xs text-certvoice-text focus:border-certvoice-accent focus:outline-none"
                  >
                    <option value="">None</option>
                    <option value="A">Type A</option>
                    <option value="AC">Type AC</option>
                    <option value="B">Type B</option>
                    <option value="F">Type F</option>
                    <option value="S">Type S (time-delayed)</option>
                  </select>
                </div>

                {/* RCD Rating */}
                <div>
                  <label className="cv-data-label">RCD mA</label>
                  <select
                    value={circuit.rcdRating ?? ''}
                    onChange={(e) =>
                      updateField(idx, 'rcdRating', e.target.value ? Number(e.target.value) : null)
                    }
                    className="w-full bg-certvoice-bg border border-certvoice-border rounded px-2 py-1.5
                               text-xs text-certvoice-text focus:border-certvoice-accent focus:outline-none"
                  >
                    <option value="">—</option>
                    {[10, 30, 100, 300].map((r) => (
                      <option key={r} value={r}>{r}mA</option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Action buttons */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleConfirm}
          disabled={includedCount === 0}
          className="cv-btn-primary flex-1 flex items-center justify-center gap-2
                     disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Check className="w-4 h-4" />
          Confirm {includedCount} Circuit{includedCount !== 1 ? 's' : ''}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="cv-btn-secondary flex items-center justify-center gap-2 px-4"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
