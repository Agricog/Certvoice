/**
 * CertVoice — EIC Departures List (Section E)
 *
 * Records any departures from BS 7671 in the installation design
 * or construction. Each departure must include:
 *   - The regulation departed from
 *   - Description of the departure
 *   - Justification for why it's acceptable
 *   - Who agreed the departure
 *
 * Unlike EICR observations (C1/C2/C3/FI), departures are not
 * classification-coded. If the work doesn't comply and can't be
 * justified, the EIC should not be issued.
 *
 * **File: src/components/DeparturesList.tsx** (create new)
 *
 * @module components/DeparturesList
 */

import { useState, useCallback } from 'react'
import { Plus, Trash2, AlertTriangle, FileText, ChevronDown, ChevronUp, Check } from 'lucide-react'
import type { Departure } from '../types/eic'
import { sanitizeText } from '../utils/sanitization'

// ============================================================
// TYPES
// ============================================================

interface DeparturesListProps {
  departures: Departure[]
  onDeparturesChange: (updated: Departure[]) => void
  disabled?: boolean
}

// ============================================================
// EMPTY DEFAULT
// ============================================================

export function createEmptyDeparture(itemNumber: number): Departure {
  return {
    id: crypto.randomUUID(),
    itemNumber,
    regulationReference: '',
    description: '',
    justification: '',
    agreedBy: '',
  }
}

// ============================================================
// COMPONENT
// ============================================================

export default function DeparturesList({
  departures,
  onDeparturesChange,
  disabled = false,
}: DeparturesListProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  // ── Add new departure ─────────────────────────────────────────────────
  const handleAdd = useCallback(() => {
    const newDep = createEmptyDeparture(departures.length + 1)
    onDeparturesChange([...departures, newDep])
    setEditingId(newDep.id)
    setExpandedIds((prev) => new Set(prev).add(newDep.id))
  }, [departures, onDeparturesChange])

  // ── Update a departure field ──────────────────────────────────────────
  const handleUpdate = useCallback(
    (id: string, field: keyof Departure, value: string) => {
      const updated = departures.map((d) =>
        d.id === id ? { ...d, [field]: sanitizeText(value) } : d
      )
      onDeparturesChange(updated)
    },
    [departures, onDeparturesChange]
  )

  // ── Delete a departure ────────────────────────────────────────────────
  const handleDelete = useCallback(
    (id: string) => {
      const filtered = departures
        .filter((d) => d.id !== id)
        .map((d, i) => ({ ...d, itemNumber: i + 1 }))
      onDeparturesChange(filtered)
      if (editingId === id) setEditingId(null)
    },
    [departures, onDeparturesChange, editingId]
  )

  // ── Toggle expand/collapse ────────────────────────────────────────────
  const toggleExpanded = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  // ── Check if a departure is complete ──────────────────────────────────
  const isComplete = (d: Departure): boolean =>
    !!(d.regulationReference.trim() && d.description.trim() && d.justification.trim())

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="cv-panel p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-certvoice-accent" />
            <h3 className="text-sm font-bold text-certvoice-text">
              Departures from BS 7671 — Section E
            </h3>
          </div>
          <span className="text-xs font-mono text-certvoice-muted">
            {departures.length} item{departures.length !== 1 ? 's' : ''}
          </span>
        </div>
        <p className="text-[10px] text-certvoice-muted mt-2">
          Record any departures from BS 7671 with justification. If there are none, leave this section empty.
        </p>
      </div>

      {/* No departures state */}
      {departures.length === 0 && (
        <div className="cv-panel text-center py-8">
          <Check className="w-6 h-6 text-emerald-400 mx-auto mb-2" />
          <p className="text-xs text-certvoice-muted">No departures from BS 7671</p>
          <p className="text-[10px] text-certvoice-muted/60 mt-1">
            Add a departure only if the installation does not fully comply
          </p>
        </div>
      )}

      {/* Departure cards */}
      {departures.map((dep) => {
        const isExpanded = expandedIds.has(dep.id)
        const complete = isComplete(dep)

        return (
          <div
            key={dep.id}
            className={`cv-panel !p-0 overflow-hidden transition-colors ${
              !complete && dep.regulationReference.trim()
                ? 'border-certvoice-amber/40'
                : ''
            }`}
          >
            {/* Card header — tap to expand */}
            <button
              type="button"
              onClick={() => toggleExpanded(dep.id)}
              className="w-full text-left p-4 flex items-center justify-between hover:bg-certvoice-surface-2/50 transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-xs font-mono text-certvoice-muted shrink-0">
                  {dep.itemNumber}.
                </span>
                <div className="min-w-0">
                  {dep.regulationReference.trim() ? (
                    <>
                      <span className="text-sm font-semibold text-certvoice-text">
                        Reg {dep.regulationReference}
                      </span>
                      {dep.description.trim() && (
                        <p className="text-xs text-certvoice-muted truncate mt-0.5">
                          {dep.description}
                        </p>
                      )}
                    </>
                  ) : (
                    <span className="text-sm text-certvoice-muted italic">
                      Tap to edit departure
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {complete && (
                  <Check className="w-4 h-4 text-emerald-400" />
                )}
                {!complete && dep.regulationReference.trim() && (
                  <AlertTriangle className="w-4 h-4 text-certvoice-amber" />
                )}
                {isExpanded ? (
                  <ChevronUp className="w-4 h-4 text-certvoice-muted" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-certvoice-muted" />
                )}
              </div>
            </button>

            {/* Expanded content */}
            {isExpanded && (
              <div className="px-4 pb-4 space-y-3 border-t border-certvoice-border/50">
                {/* Regulation reference */}
                <div className="pt-3">
                  <label className="block text-xs font-semibold text-certvoice-text mb-1">
                    Regulation Reference
                    <span className="text-certvoice-red ml-0.5">*</span>
                  </label>
                  <input
                    type="text"
                    value={dep.regulationReference}
                    onChange={(e) => handleUpdate(dep.id, 'regulationReference', e.target.value)}
                    placeholder="e.g. 411.3.3"
                    disabled={disabled}
                    className="w-full px-3 py-2 bg-certvoice-surface-2 border border-certvoice-border rounded-lg
                               text-sm text-certvoice-text font-mono placeholder:text-certvoice-muted/50
                               focus:outline-none focus:border-certvoice-accent focus:ring-1 focus:ring-certvoice-accent/30
                               disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                </div>

                {/* Description */}
                <div>
                  <label className="block text-xs font-semibold text-certvoice-text mb-1">
                    Description of Departure
                    <span className="text-certvoice-red ml-0.5">*</span>
                  </label>
                  <textarea
                    value={dep.description}
                    onChange={(e) => handleUpdate(dep.id, 'description', e.target.value)}
                    placeholder="Describe what differs from the regulation requirement..."
                    rows={2}
                    disabled={disabled}
                    className="w-full px-3 py-2 bg-certvoice-surface-2 border border-certvoice-border rounded-lg
                               text-sm text-certvoice-text placeholder:text-certvoice-muted/50 resize-none
                               focus:outline-none focus:border-certvoice-accent focus:ring-1 focus:ring-certvoice-accent/30
                               disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                </div>

                {/* Justification */}
                <div>
                  <label className="block text-xs font-semibold text-certvoice-text mb-1">
                    Justification
                    <span className="text-certvoice-red ml-0.5">*</span>
                  </label>
                  <textarea
                    value={dep.justification}
                    onChange={(e) => handleUpdate(dep.id, 'justification', e.target.value)}
                    placeholder="Why this departure is acceptable and safety is maintained..."
                    rows={2}
                    disabled={disabled}
                    className="w-full px-3 py-2 bg-certvoice-surface-2 border border-certvoice-border rounded-lg
                               text-sm text-certvoice-text placeholder:text-certvoice-muted/50 resize-none
                               focus:outline-none focus:border-certvoice-accent focus:ring-1 focus:ring-certvoice-accent/30
                               disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                </div>

                {/* Agreed by */}
                <div>
                  <label className="block text-xs font-semibold text-certvoice-text mb-1">
                    Agreed By
                  </label>
                  <input
                    type="text"
                    value={dep.agreedBy}
                    onChange={(e) => handleUpdate(dep.id, 'agreedBy', e.target.value)}
                    placeholder="e.g. Designer and client"
                    disabled={disabled}
                    className="w-full px-3 py-2 bg-certvoice-surface-2 border border-certvoice-border rounded-lg
                               text-sm text-certvoice-text placeholder:text-certvoice-muted/50
                               focus:outline-none focus:border-certvoice-accent focus:ring-1 focus:ring-certvoice-accent/30
                               disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                </div>

                {/* Delete button */}
                {!disabled && (
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm(`Delete departure ${dep.itemNumber}?`)) {
                        handleDelete(dep.id)
                      }
                    }}
                    className="flex items-center gap-1.5 text-xs text-certvoice-muted hover:text-certvoice-red transition-colors pt-1"
                  >
                    <Trash2 className="w-3 h-3" />
                    Delete departure
                  </button>
                )}

                {/* Incomplete warning */}
                {!complete && dep.regulationReference.trim() && (
                  <div className="flex items-center gap-1.5 text-[10px] text-certvoice-amber">
                    <AlertTriangle className="w-3 h-3 shrink-0" />
                    Regulation, description, and justification are all required
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}

      {/* Add departure button */}
      {!disabled && (
        <button
          type="button"
          onClick={handleAdd}
          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold
                     bg-certvoice-surface-2 border border-dashed border-certvoice-border text-certvoice-muted
                     hover:border-certvoice-accent hover:text-certvoice-accent transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Departure
        </button>
      )}
    </div>
  )
}
