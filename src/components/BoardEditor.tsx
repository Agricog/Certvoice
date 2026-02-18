/**
 * CertVoice — Board Editor (inline)
 *
 * Compact editor for distribution board header fields.
 * Opens inline below the board selector in the Circuits tab.
 * Covers the 4 fields that appear on the circuit schedule:
 *   dbReference, dbLocation, zsAtDb, ipfAtDb
 *
 * @module components/BoardEditor
 */

import { useState, useCallback, useEffect } from 'react'
import { X, Check } from 'lucide-react'
import type { DistributionBoardHeader } from '../types/eicr'

// ============================================================
// TYPES
// ============================================================

interface BoardEditorProps {
  board: DistributionBoardHeader
  onSave: (updated: DistributionBoardHeader) => void
  onCancel: () => void
}

// ============================================================
// COMPONENT
// ============================================================

export default function BoardEditor({ board, onSave, onCancel }: BoardEditorProps) {
  const [dbReference, setDbReference] = useState(board.dbReference ?? '')
  const [dbLocation, setDbLocation] = useState(board.dbLocation ?? '')
  const [zsAtDb, setZsAtDb] = useState(board.zsAtDb?.toString() ?? '')
  const [ipfAtDb, setIpfAtDb] = useState(board.ipfAtDb?.toString() ?? '')

  // Reset if board changes externally
  useEffect(() => {
    setDbReference(board.dbReference ?? '')
    setDbLocation(board.dbLocation ?? '')
    setZsAtDb(board.zsAtDb?.toString() ?? '')
    setIpfAtDb(board.ipfAtDb?.toString() ?? '')
  }, [board])

  const handleSave = useCallback(() => {
    const updated: DistributionBoardHeader = {
      ...board,
      dbReference: dbReference.trim() || board.dbReference,
      dbLocation: dbLocation.trim(),
      zsAtDb: zsAtDb.trim() ? parseFloat(zsAtDb) : null,
      ipfAtDb: ipfAtDb.trim() ? parseFloat(ipfAtDb) : null,
    }
    onSave(updated)
  }, [board, dbReference, dbLocation, zsAtDb, ipfAtDb, onSave])

  return (
    <div className="cv-panel border-certvoice-accent/30 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-certvoice-text">Edit Board</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleSave}
            className="w-7 h-7 rounded-lg flex items-center justify-center
                       text-certvoice-green hover:bg-certvoice-green/10 transition-colors"
            title="Save"
          >
            <Check className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="w-7 h-7 rounded-lg flex items-center justify-center
                       text-certvoice-muted hover:text-certvoice-text transition-colors"
            title="Cancel"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Row 1: Reference + Location */}
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="block text-[10px] font-semibold text-certvoice-muted mb-0.5">Reference</label>
          <input
            type="text"
            value={dbReference}
            onChange={(e) => setDbReference(e.target.value)}
            placeholder="DB1"
            className="w-full px-2 py-1.5 bg-certvoice-surface-2 border border-certvoice-border rounded-lg
                       text-xs text-certvoice-text placeholder:text-certvoice-muted/50
                       focus:outline-none focus:border-certvoice-accent focus:ring-1 focus:ring-certvoice-accent/30"
          />
        </div>
        <div className="col-span-2">
          <label className="block text-[10px] font-semibold text-certvoice-muted mb-0.5">Location</label>
          <input
            type="text"
            value={dbLocation}
            onChange={(e) => setDbLocation(e.target.value)}
            placeholder="e.g. Under stairs cupboard"
            className="w-full px-2 py-1.5 bg-certvoice-surface-2 border border-certvoice-border rounded-lg
                       text-xs text-certvoice-text placeholder:text-certvoice-muted/50
                       focus:outline-none focus:border-certvoice-accent focus:ring-1 focus:ring-certvoice-accent/30"
          />
        </div>
      </div>

      {/* Row 2: Zs at DB + Ipf at DB */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-[10px] font-semibold text-certvoice-muted mb-0.5">Zs at DB (ohm)</label>
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            value={zsAtDb}
            onChange={(e) => setZsAtDb(e.target.value)}
            placeholder="e.g. 0.35"
            className="w-full px-2 py-1.5 bg-certvoice-surface-2 border border-certvoice-border rounded-lg
                       text-xs text-certvoice-text placeholder:text-certvoice-muted/50
                       focus:outline-none focus:border-certvoice-accent focus:ring-1 focus:ring-certvoice-accent/30"
          />
        </div>
        <div>
          <label className="block text-[10px] font-semibold text-certvoice-muted mb-0.5">Ipf at DB (kA)</label>
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            value={ipfAtDb}
            onChange={(e) => setIpfAtDb(e.target.value)}
            placeholder="e.g. 1.5"
            className="w-full px-2 py-1.5 bg-certvoice-surface-2 border border-certvoice-border rounded-lg
                       text-xs text-certvoice-text placeholder:text-certvoice-muted/50
                       focus:outline-none focus:border-certvoice-accent focus:ring-1 focus:ring-certvoice-accent/30"
          />
        </div>
      </div>
    </div>
  )
}
