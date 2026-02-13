/**
 * CertVoice — InspectionChecklist Component
 *
 * Schedule of Inspections (70+ items) from BS 7671 Appendix 6.
 * Each item gets an outcome code via tap interaction.
 * Non-pass items can have voice notes added.
 *
 * Outcome Codes:
 *   - PASS: Satisfactory (tick)
 *   - C1: Danger present
 *   - C2: Potentially dangerous
 *   - C3: Improvement recommended
 *   - FI: Further investigation
 *   - NV: Not verified
 *   - LIM: Limitation
 *   - NA: Not applicable
 */

import { useState, useCallback, useMemo } from 'react'
import {
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  HelpCircle,
  MinusCircle,
  ChevronDown,
  ChevronUp,
  FileText,
  Zap,
  Shield,
  Box,
  Cable,
  Droplets,
  MapPin,
} from 'lucide-react'
import type { InspectionItem, InspectionOutcome } from '../types/eicr'
import { sanitizeText } from '../utils/sanitization'
import { captureError } from '../utils/errorTracking'
import { trackChecklistProgress, trackFeatureUsed } from '../utils/analytics'

// ============================================================
// TYPES
// ============================================================

interface InspectionChecklistProps {
  items: InspectionItem[]
  onItemChange: (itemId: string, outcome: InspectionOutcome | null, notes: string) => void
  onBulkPass: (sectionNumber: number) => void
}

interface SectionConfig {
  number: number
  title: string
  icon: React.ReactNode
  items: InspectionItem[]
}

// ============================================================
// OUTCOME CONFIG
// ============================================================

interface OutcomeConfig {
  label: string
  shortLabel: string
  color: string
  bgColor: string
  borderColor: string
  icon: React.ReactNode
}

const OUTCOME_CONFIG: Record<InspectionOutcome, OutcomeConfig> = {
  PASS: {
    label: 'Pass',
    shortLabel: '✓',
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-500/15',
    borderColor: 'border-emerald-500',
    icon: <CheckCircle2 className="w-4 h-4" />,
  },
  C1: {
    label: 'C1 - Danger',
    shortLabel: 'C1',
    color: 'text-red-400',
    bgColor: 'bg-red-500/15',
    borderColor: 'border-red-500',
    icon: <AlertCircle className="w-4 h-4" />,
  },
  C2: {
    label: 'C2 - Potentially Dangerous',
    shortLabel: 'C2',
    color: 'text-orange-400',
    bgColor: 'bg-orange-500/15',
    borderColor: 'border-orange-500',
    icon: <AlertTriangle className="w-4 h-4" />,
  },
  C3: {
    label: 'C3 - Improvement',
    shortLabel: 'C3',
    color: 'text-amber-400',
    bgColor: 'bg-amber-500/15',
    borderColor: 'border-amber-500',
    icon: <HelpCircle className="w-4 h-4" />,
  },
  FI: {
    label: 'FI - Investigate',
    shortLabel: 'FI',
    color: 'text-purple-400',
    bgColor: 'bg-purple-500/15',
    borderColor: 'border-purple-500',
    icon: <HelpCircle className="w-4 h-4" />,
  },
  NV: {
    label: 'Not Verified',
    shortLabel: 'N/V',
    color: 'text-slate-400',
    bgColor: 'bg-slate-500/15',
    borderColor: 'border-slate-500',
    icon: <MinusCircle className="w-4 h-4" />,
  },
  LIM: {
    label: 'Limitation',
    shortLabel: 'LIM',
    color: 'text-slate-400',
    bgColor: 'bg-slate-500/15',
    borderColor: 'border-slate-500',
    icon: <MinusCircle className="w-4 h-4" />,
  },
  NA: {
    label: 'Not Applicable',
    shortLabel: 'N/A',
    color: 'text-slate-500',
    bgColor: 'bg-slate-600/15',
    borderColor: 'border-slate-600',
    icon: <MinusCircle className="w-4 h-4" />,
  },
}

// Quick outcome buttons shown for each item
const QUICK_OUTCOMES: InspectionOutcome[] = ['PASS', 'C2', 'C3', 'NA']

// Full outcome options in modal
const ALL_OUTCOMES: InspectionOutcome[] = ['PASS', 'C1', 'C2', 'C3', 'FI', 'NV', 'LIM', 'NA']

// ============================================================
// SECTION ICONS
// ============================================================

function getSectionIcon(sectionNumber: number): React.ReactNode {
  switch (sectionNumber) {
    case 1:
      return <Zap className="w-4 h-4" />
    case 2:
      return <Zap className="w-4 h-4" />
    case 3:
      return <Shield className="w-4 h-4" />
    case 4:
      return <Box className="w-4 h-4" />
    case 5:
      return <Cable className="w-4 h-4" />
    case 6:
      return <Droplets className="w-4 h-4" />
    case 7:
      return <MapPin className="w-4 h-4" />
    case 8:
      return <Zap className="w-4 h-4" />
    default:
      return <FileText className="w-4 h-4" />
  }
}

// ============================================================
// COMPONENT
// ============================================================

export default function InspectionChecklist({
  items,
  onItemChange,
  onBulkPass,
}: InspectionChecklistProps) {
  const [expandedSections, setExpandedSections] = useState<Set<number>>(new Set([1]))
  const [selectedItem, setSelectedItem] = useState<string | null>(null)

  // Group items by section
  const sections = useMemo<SectionConfig[]>(() => {
    const grouped = new Map<number, InspectionItem[]>()

    for (const item of items) {
      const existing = grouped.get(item.section) ?? []
      existing.push(item)
      grouped.set(item.section, existing)
    }

    return Array.from(grouped.entries())
      .sort(([a], [b]) => a - b)
      .map(([number, sectionItems]) => ({
        number,
        title: sectionItems[0]?.sectionTitle ?? `Section ${number}`,
        icon: getSectionIcon(number),
        items: sectionItems.sort((a, b) => a.itemRef.localeCompare(b.itemRef, undefined, { numeric: true })),
      }))
  }, [items])

  // Calculate progress
  const progress = useMemo(() => {
    const total = items.length
    const completed = items.filter((i) => i.outcome !== null).length
    const passed = items.filter((i) => i.outcome === 'PASS').length
    const issues = items.filter((i) => i.outcome && ['C1', 'C2', 'C3', 'FI'].includes(i.outcome)).length

    return { total, completed, passed, issues }
  }, [items])

  // Toggle section expansion
  const toggleSection = useCallback((sectionNumber: number) => {
    setExpandedSections((prev) => {
      const next = new Set(prev)
      if (next.has(sectionNumber)) {
        next.delete(sectionNumber)
      } else {
        next.add(sectionNumber)
      }
      return next
    })
  }, [])

  // Handle outcome selection
  const handleOutcomeSelect = useCallback(
    (itemId: string, outcome: InspectionOutcome) => {
      try {
        const item = items.find((i) => i.id === itemId)
        if (!item) return

        // Toggle off if same outcome selected
        const newOutcome = item.outcome === outcome ? null : outcome

        onItemChange(itemId, newOutcome, item.notes)
        trackFeatureUsed('checklist')

        // Track progress
        const completed = items.filter((i) => i.id === itemId ? newOutcome !== null : i.outcome !== null).length
        trackChecklistProgress(completed, items.length)
      } catch (error) {
        captureError(error, 'InspectionChecklist.handleOutcomeSelect')
      }
    },
    [items, onItemChange]
  )

  // Handle notes change
  const handleNotesChange = useCallback(
    (itemId: string, notes: string) => {
      const item = items.find((i) => i.id === itemId)
      if (!item) return

      onItemChange(itemId, item.outcome, sanitizeText(notes))
    },
    [items, onItemChange]
  )

  // Handle bulk pass for section
  const handleBulkPass = useCallback(
    (sectionNumber: number) => {
      try {
        onBulkPass(sectionNumber)
        trackFeatureUsed('checklist')
      } catch (error) {
        captureError(error, 'InspectionChecklist.handleBulkPass')
      }
    },
    [onBulkPass]
  )

  // Calculate section progress
  const getSectionProgress = useCallback(
    (sectionNumber: number) => {
      const sectionItems = items.filter((i) => i.section === sectionNumber)
      const completed = sectionItems.filter((i) => i.outcome !== null).length
      return { completed, total: sectionItems.length }
    },
    [items]
  )

  // ─── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Progress Summary */}
      <div className="cv-panel">
        <div className="flex items-center justify-between mb-3">
          <span className="cv-section-title !mb-0">Schedule of Inspections</span>
          <span className="text-xs font-mono text-certvoice-muted">
            {progress.completed}/{progress.total} items
          </span>
        </div>

        {/* Progress Bar */}
        <div className="h-2 bg-certvoice-surface-2 rounded-full overflow-hidden mb-3">
          <div
            className="h-full bg-gradient-to-r from-certvoice-accent to-emerald-500 transition-all duration-300"
            style={{ width: `${(progress.completed / progress.total) * 100}%` }}
          />
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="cv-data-field !p-2">
            <div className="text-lg font-bold text-emerald-400">{progress.passed}</div>
            <div className="text-[10px] text-certvoice-muted uppercase">Passed</div>
          </div>
          <div className="cv-data-field !p-2">
            <div className="text-lg font-bold text-amber-400">{progress.issues}</div>
            <div className="text-[10px] text-certvoice-muted uppercase">Issues</div>
          </div>
          <div className="cv-data-field !p-2">
            <div className="text-lg font-bold text-certvoice-muted">
              {progress.total - progress.completed}
            </div>
            <div className="text-[10px] text-certvoice-muted uppercase">Remaining</div>
          </div>
        </div>
      </div>

      {/* Sections */}
      {sections.map((section) => {
        const isExpanded = expandedSections.has(section.number)
        const sectionProgress = getSectionProgress(section.number)
        const allPassed = sectionProgress.completed === sectionProgress.total &&
          section.items.every((i) => i.outcome === 'PASS' || i.outcome === 'NA')

        return (
          <div key={section.number} className="cv-panel !p-0 overflow-hidden">
            {/* Section Header */}
            <button
              type="button"
              onClick={() => toggleSection(section.number)}
              className="w-full flex items-center justify-between p-4 hover:bg-certvoice-surface-2/50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <span className={allPassed ? 'text-emerald-400' : 'text-certvoice-accent'}>
                  {section.icon}
                </span>
                <div className="text-left">
                  <div className="text-sm font-semibold text-certvoice-text">
                    {section.number}.0 {section.title}
                  </div>
                  <div className="text-xs text-certvoice-muted">
                    {sectionProgress.completed}/{sectionProgress.total} items
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {allPassed && (
                  <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                )}
                {isExpanded ? (
                  <ChevronUp className="w-4 h-4 text-certvoice-muted" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-certvoice-muted" />
                )}
              </div>
            </button>

            {/* Section Content */}
            {isExpanded && (
              <div className="px-4 pb-4 space-y-2">
                {/* Bulk Pass Button */}
                {sectionProgress.completed < sectionProgress.total && (
                  <button
                    type="button"
                    onClick={() => handleBulkPass(section.number)}
                    className="w-full py-2 px-3 rounded-lg border border-dashed border-emerald-500/50 
                             text-emerald-400 text-xs font-semibold hover:bg-emerald-500/10 transition-colors"
                  >
                    Mark all as Pass
                  </button>
                )}

                {/* Items */}
                {section.items.map((item) => {
                  const config = item.outcome ? OUTCOME_CONFIG[item.outcome] : null
                  const isSelected = selectedItem === item.id
                  const needsNotes = item.outcome && ['C1', 'C2', 'C3', 'FI'].includes(item.outcome)

                  return (
                    <div
                      key={item.id}
                      className={`rounded-lg border transition-all ${
                        config
                          ? `${config.bgColor} ${config.borderColor}`
                          : 'bg-certvoice-surface-2 border-certvoice-border'
                      }`}
                    >
                      {/* Item Header */}
                      <div className="p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-mono text-certvoice-muted">
                                {item.itemRef}
                              </span>
                              {config && (
                                <span className={`text-xs font-bold ${config.color}`}>
                                  {config.shortLabel}
                                </span>
                              )}
                            </div>
                            <p className="text-sm text-certvoice-text mt-0.5 leading-snug">
                              {item.description}
                            </p>
                            {item.regulationRef && (
                              <p className="text-[10px] text-certvoice-muted mt-1 font-mono">
                                Reg: {item.regulationRef}
                              </p>
                            )}
                          </div>
                        </div>

                        {/* Quick Outcome Buttons */}
                        <div className="flex gap-1 mt-3">
                          {QUICK_OUTCOMES.map((outcome) => {
                            const outcomeConfig = OUTCOME_CONFIG[outcome]
                            const isActive = item.outcome === outcome

                            return (
                              <button
                                key={outcome}
                                type="button"
                                onClick={() => handleOutcomeSelect(item.id, outcome)}
                                className={`flex-1 py-1.5 px-2 rounded text-xs font-semibold transition-colors ${
                                  isActive
                                    ? `${outcomeConfig.bgColor} ${outcomeConfig.color} ${outcomeConfig.borderColor} border`
                                    : 'bg-certvoice-bg text-certvoice-muted hover:text-certvoice-text border border-transparent'
                                }`}
                              >
                                {outcomeConfig.shortLabel}
                              </button>
                            )
                          })}
                          <button
                            type="button"
                            onClick={() => setSelectedItem(isSelected ? null : item.id)}
                            className="py-1.5 px-2 rounded text-xs text-certvoice-muted hover:text-certvoice-text 
                                     bg-certvoice-bg transition-colors"
                            aria-label="More options"
                          >
                            •••
                          </button>
                        </div>

                        {/* Extended Options */}
                        {isSelected && (
                          <div className="mt-2 pt-2 border-t border-certvoice-border/50">
                            <div className="grid grid-cols-4 gap-1">
                              {ALL_OUTCOMES.filter((o) => !QUICK_OUTCOMES.includes(o)).map((outcome) => {
                                const outcomeConfig = OUTCOME_CONFIG[outcome]
                                const isActive = item.outcome === outcome

                                return (
                                  <button
                                    key={outcome}
                                    type="button"
                                    onClick={() => {
                                      handleOutcomeSelect(item.id, outcome)
                                      setSelectedItem(null)
                                    }}
                                    className={`py-1.5 px-2 rounded text-xs font-semibold transition-colors ${
                                      isActive
                                        ? `${outcomeConfig.bgColor} ${outcomeConfig.color}`
                                        : 'bg-certvoice-bg text-certvoice-muted hover:text-certvoice-text'
                                    }`}
                                  >
                                    {outcomeConfig.shortLabel}
                                  </button>
                                )
                              })}
                            </div>
                          </div>
                        )}

                        {/* Notes Input for Issues */}
                        {needsNotes && (
                          <div className="mt-2 pt-2 border-t border-certvoice-border/50">
                            <textarea
                              value={item.notes}
                              onChange={(e) => handleNotesChange(item.id, e.target.value)}
                              placeholder="Add notes about this observation..."
                              rows={2}
                              className="w-full bg-certvoice-bg/50 rounded-lg p-2 text-sm text-certvoice-text 
                                       placeholder:text-certvoice-muted/50 outline-none resize-none
                                       border border-certvoice-border/50 focus:border-certvoice-accent"
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ============================================================
// DEFAULT INSPECTION ITEMS
// BS 7671:2018+A2:2022 Schedule of Inspections
// ============================================================

export function createDefaultInspectionItems(): InspectionItem[] {
  const items: Omit<InspectionItem, 'id'>[] = [
    // Section 1: Intake Equipment
    { itemRef: '1.1', section: 1, sectionTitle: 'INTAKE EQUIPMENT', description: 'Service cable', regulationRef: '', outcome: null, notes: '' },
    { itemRef: '1.2', section: 1, sectionTitle: 'INTAKE EQUIPMENT', description: 'Service head', regulationRef: '', outcome: null, notes: '' },
    { itemRef: '1.3', section: 1, sectionTitle: 'INTAKE EQUIPMENT', description: 'Earthing arrangements', regulationRef: '', outcome: null, notes: '' },
    { itemRef: '1.4', section: 1, sectionTitle: 'INTAKE EQUIPMENT', description: 'Meter tails', regulationRef: '', outcome: null, notes: '' },
    { itemRef: '1.5', section: 1, sectionTitle: 'INTAKE EQUIPMENT', description: 'Metering equipment', regulationRef: '', outcome: null, notes: '' },
    { itemRef: '1.6', section: 1, sectionTitle: 'INTAKE EQUIPMENT', description: 'Isolator (where present)', regulationRef: '', outcome: null, notes: '' },

    // Section 2: Alternative/Parallel Sources
    { itemRef: '2.1', section: 2, sectionTitle: 'ALTERNATIVE/PARALLEL SOURCES', description: 'Switched alternative to public supply', regulationRef: '551.6', outcome: null, notes: '' },
    { itemRef: '2.2', section: 2, sectionTitle: 'ALTERNATIVE/PARALLEL SOURCES', description: 'Parallel with public supply', regulationRef: '551.7', outcome: null, notes: '' },

    // Section 3: Earthing/Bonding Arrangements
    { itemRef: '3.1', section: 3, sectionTitle: 'EARTHING/BONDING ARRANGEMENTS', description: "Presence/condition of distributor's earthing", regulationRef: '542.1.2.1/.2', outcome: null, notes: '' },
    { itemRef: '3.2', section: 3, sectionTitle: 'EARTHING/BONDING ARRANGEMENTS', description: 'Earthing conductor size adequacy', regulationRef: '542.3; 543.1.1', outcome: null, notes: '' },
    { itemRef: '3.3', section: 3, sectionTitle: 'EARTHING/BONDING ARRANGEMENTS', description: 'Earthing conductor connections', regulationRef: '542.3.2', outcome: null, notes: '' },
    { itemRef: '3.4', section: 3, sectionTitle: 'EARTHING/BONDING ARRANGEMENTS', description: 'Accessibility of earthing conductor', regulationRef: '543.3.2', outcome: null, notes: '' },
    { itemRef: '3.5', section: 3, sectionTitle: 'EARTHING/BONDING ARRANGEMENTS', description: 'Main protective bonding conductor sizes', regulationRef: '544.1', outcome: null, notes: '' },
    { itemRef: '3.6', section: 3, sectionTitle: 'EARTHING/BONDING ARRANGEMENTS', description: 'Main protective bonding connections', regulationRef: '543.3.2; 544.1.2', outcome: null, notes: '' },
    { itemRef: '3.7', section: 3, sectionTitle: 'EARTHING/BONDING ARRANGEMENTS', description: 'Accessibility of bonding connections', regulationRef: '543.3.2', outcome: null, notes: '' },
    { itemRef: '3.8', section: 3, sectionTitle: 'EARTHING/BONDING ARRANGEMENTS', description: 'Earthing/bonding labels', regulationRef: '514.13.1', outcome: null, notes: '' },

    // Section 4: Consumer Unit / Distribution Board
    { itemRef: '4.1', section: 4, sectionTitle: 'CONSUMER UNIT / DISTRIBUTION BOARD', description: 'Adequacy of working space/accessibility', regulationRef: '132.12; 513.1', outcome: null, notes: '' },
    { itemRef: '4.2', section: 4, sectionTitle: 'CONSUMER UNIT / DISTRIBUTION BOARD', description: 'Security of fixing', regulationRef: '134.1.1', outcome: null, notes: '' },
    { itemRef: '4.3', section: 4, sectionTitle: 'CONSUMER UNIT / DISTRIBUTION BOARD', description: 'Condition of enclosure IP rating', regulationRef: '416.2', outcome: null, notes: '' },
    { itemRef: '4.4', section: 4, sectionTitle: 'CONSUMER UNIT / DISTRIBUTION BOARD', description: 'Condition of enclosure fire rating', regulationRef: '421.1.201; 526.5', outcome: null, notes: '' },
    { itemRef: '4.5', section: 4, sectionTitle: 'CONSUMER UNIT / DISTRIBUTION BOARD', description: 'Enclosure not damaged/deteriorated', regulationRef: '651.2', outcome: null, notes: '' },
    { itemRef: '4.6', section: 4, sectionTitle: 'CONSUMER UNIT / DISTRIBUTION BOARD', description: 'Presence of main linked switch', regulationRef: '462.1.201', outcome: null, notes: '' },
    { itemRef: '4.7', section: 4, sectionTitle: 'CONSUMER UNIT / DISTRIBUTION BOARD', description: 'Operation of main switch - functional check', regulationRef: '643.10', outcome: null, notes: '' },
    { itemRef: '4.8', section: 4, sectionTitle: 'CONSUMER UNIT / DISTRIBUTION BOARD', description: 'Manual operation of CBs and RCDs', regulationRef: '643.10', outcome: null, notes: '' },
    { itemRef: '4.9', section: 4, sectionTitle: 'CONSUMER UNIT / DISTRIBUTION BOARD', description: 'Presence of RCD test notice', regulationRef: '514.12.2', outcome: null, notes: '' },
    { itemRef: '4.10', section: 4, sectionTitle: 'CONSUMER UNIT / DISTRIBUTION BOARD', description: 'Correct identification of circuits', regulationRef: '514.8.1; 514.9.1', outcome: null, notes: '' },
    { itemRef: '4.11', section: 4, sectionTitle: 'CONSUMER UNIT / DISTRIBUTION BOARD', description: 'Alternative supply warning notice', regulationRef: '514.15', outcome: null, notes: '' },
    { itemRef: '4.12', section: 4, sectionTitle: 'CONSUMER UNIT / DISTRIBUTION BOARD', description: 'Other required labelling', regulationRef: 'Section 514', outcome: null, notes: '' },
    { itemRef: '4.13', section: 4, sectionTitle: 'CONSUMER UNIT / DISTRIBUTION BOARD', description: 'Compatibility of protective devices - correct type/rating', regulationRef: '411.3.2; 432; 433', outcome: null, notes: '' },
    { itemRef: '4.14', section: 4, sectionTitle: 'CONSUMER UNIT / DISTRIBUTION BOARD', description: 'Protection against mechanical damage at entry', regulationRef: '522.8.1/.5/.11', outcome: null, notes: '' },
    { itemRef: '4.15', section: 4, sectionTitle: 'CONSUMER UNIT / DISTRIBUTION BOARD', description: 'Single-pole devices in line conductor only', regulationRef: '132.14.1; 530.3.3', outcome: null, notes: '' },
    { itemRef: '4.16', section: 4, sectionTitle: 'CONSUMER UNIT / DISTRIBUTION BOARD', description: 'Protection against electromagnetic effects at entry', regulationRef: '521.5.1', outcome: null, notes: '' },
    { itemRef: '4.17', section: 4, sectionTitle: 'CONSUMER UNIT / DISTRIBUTION BOARD', description: 'RCDs for fault protection', regulationRef: '411.4.204; 411.5.2; 531.2', outcome: null, notes: '' },
    { itemRef: '4.18', section: 4, sectionTitle: 'CONSUMER UNIT / DISTRIBUTION BOARD', description: 'RCDs for additional protection', regulationRef: '411.3.3; 415.1', outcome: null, notes: '' },
    { itemRef: '4.19', section: 4, sectionTitle: 'CONSUMER UNIT / DISTRIBUTION BOARD', description: 'SPD functional indicator confirmed', regulationRef: '651.4', outcome: null, notes: '' },
    { itemRef: '4.20', section: 4, sectionTitle: 'CONSUMER UNIT / DISTRIBUTION BOARD', description: 'All conductor connections tight and secure', regulationRef: '526.1', outcome: null, notes: '' },
    { itemRef: '4.21', section: 4, sectionTitle: 'CONSUMER UNIT / DISTRIBUTION BOARD', description: 'Generating set as switched alternative', regulationRef: '551.6', outcome: null, notes: '' },
    { itemRef: '4.22', section: 4, sectionTitle: 'CONSUMER UNIT / DISTRIBUTION BOARD', description: 'Generating set in parallel', regulationRef: '551.7', outcome: null, notes: '' },

    // Section 5: Final Circuits
    { itemRef: '5.1', section: 5, sectionTitle: 'FINAL CIRCUITS', description: 'Identification of conductors', regulationRef: '514.3.1', outcome: null, notes: '' },
    { itemRef: '5.2', section: 5, sectionTitle: 'FINAL CIRCUITS', description: 'Cables correctly supported', regulationRef: '521.10.202; 522.8.5', outcome: null, notes: '' },
    { itemRef: '5.3', section: 5, sectionTitle: 'FINAL CIRCUITS', description: 'Condition of insulation of live parts', regulationRef: '416.1', outcome: null, notes: '' },
    { itemRef: '5.4', section: 5, sectionTitle: 'FINAL CIRCUITS', description: 'Non-sheathed cables in enclosure', regulationRef: '521.10.1', outcome: null, notes: '' },
    { itemRef: '5.5', section: 5, sectionTitle: 'FINAL CIRCUITS', description: 'Adequacy of cables for current-carrying capacity', regulationRef: 'Section 523', outcome: null, notes: '' },
    { itemRef: '5.6', section: 5, sectionTitle: 'FINAL CIRCUITS', description: 'Adequacy of protective devices for fault protection', regulationRef: '411.3', outcome: null, notes: '' },
    { itemRef: '5.7', section: 5, sectionTitle: 'FINAL CIRCUITS', description: 'Coordination between conductors and overload devices', regulationRef: '433.1; 533.2.1', outcome: null, notes: '' },
    { itemRef: '5.8', section: 5, sectionTitle: 'FINAL CIRCUITS', description: 'Presence/adequacy of CPCs', regulationRef: '411.3.1; Section 543', outcome: null, notes: '' },
    { itemRef: '5.9', section: 5, sectionTitle: 'FINAL CIRCUITS', description: 'Wiring systems appropriate for installation type', regulationRef: 'Section 522', outcome: null, notes: '' },
    { itemRef: '5.10', section: 5, sectionTitle: 'FINAL CIRCUITS', description: 'Cables in prescribed zones', regulationRef: '522.6.202', outcome: null, notes: '' },
    { itemRef: '5.11', section: 5, sectionTitle: 'FINAL CIRCUITS', description: 'Cables with earthed armour/sheath or protected', regulationRef: '522.6.204', outcome: null, notes: '' },
    { itemRef: '5.12', section: 5, sectionTitle: 'FINAL CIRCUITS', description: 'Additional protection by 30mA RCD: socket-outlets ≤32A', regulationRef: '411.3.3', outcome: null, notes: '' },
    { itemRef: '5.12b', section: 5, sectionTitle: 'FINAL CIRCUITS', description: 'Additional protection: mobile equipment outdoors', regulationRef: '411.3.3', outcome: null, notes: '' },
    { itemRef: '5.12c', section: 5, sectionTitle: 'FINAL CIRCUITS', description: 'Additional protection: concealed cables <50mm depth', regulationRef: '522.6.202/.203', outcome: null, notes: '' },
    { itemRef: '5.12d', section: 5, sectionTitle: 'FINAL CIRCUITS', description: 'Additional protection: cables in metal partitions', regulationRef: '522.6.203', outcome: null, notes: '' },
    { itemRef: '5.12e', section: 5, sectionTitle: 'FINAL CIRCUITS', description: 'Additional protection: luminaires in domestic premises', regulationRef: '411.3.4', outcome: null, notes: '' },
    { itemRef: '5.13', section: 5, sectionTitle: 'FINAL CIRCUITS', description: 'Fire barriers and sealing', regulationRef: 'Section 527', outcome: null, notes: '' },
    { itemRef: '5.14', section: 5, sectionTitle: 'FINAL CIRCUITS', description: 'Band II separated from Band I', regulationRef: '528.1', outcome: null, notes: '' },
    { itemRef: '5.15', section: 5, sectionTitle: 'FINAL CIRCUITS', description: 'Cables separated from comms cabling', regulationRef: '528.2', outcome: null, notes: '' },
    { itemRef: '5.16', section: 5, sectionTitle: 'FINAL CIRCUITS', description: 'Cables separated from non-electrical services', regulationRef: '528.3', outcome: null, notes: '' },
    { itemRef: '5.17', section: 5, sectionTitle: 'FINAL CIRCUITS', description: 'Termination of cables at enclosures', regulationRef: 'Section 526', outcome: null, notes: '' },
    { itemRef: '5.18', section: 5, sectionTitle: 'FINAL CIRCUITS', description: 'Condition of accessories: sockets, switches, JBs', regulationRef: '651.2', outcome: null, notes: '' },
    { itemRef: '5.19', section: 5, sectionTitle: 'FINAL CIRCUITS', description: 'Suitability of accessories for environment', regulationRef: '512.2', outcome: null, notes: '' },
    { itemRef: '5.20', section: 5, sectionTitle: 'FINAL CIRCUITS', description: 'Adequacy of working space', regulationRef: '132.12; 513.1', outcome: null, notes: '' },
    { itemRef: '5.21', section: 5, sectionTitle: 'FINAL CIRCUITS', description: 'Single-pole devices in line conductors only', regulationRef: '132.14.1', outcome: null, notes: '' },

    // Section 6: Bathroom / Shower Location
    { itemRef: '6.1', section: 6, sectionTitle: 'BATHROOM / SHOWER LOCATION', description: 'Additional protection by 30mA RCD', regulationRef: '701.411.3.3', outcome: null, notes: '' },
    { itemRef: '6.2', section: 6, sectionTitle: 'BATHROOM / SHOWER LOCATION', description: 'SELV/PELV requirements met', regulationRef: '701.414.4.5', outcome: null, notes: '' },
    { itemRef: '6.3', section: 6, sectionTitle: 'BATHROOM / SHOWER LOCATION', description: 'Shaver supply unit compliant', regulationRef: '701.512.3', outcome: null, notes: '' },
    { itemRef: '6.4', section: 6, sectionTitle: 'BATHROOM / SHOWER LOCATION', description: 'Supplementary bonding (unless not required)', regulationRef: '701.415.2', outcome: null, notes: '' },
    { itemRef: '6.5', section: 6, sectionTitle: 'BATHROOM / SHOWER LOCATION', description: '230V sockets at least 2.5m from zone 1', regulationRef: '701.512.3', outcome: null, notes: '' },
    { itemRef: '6.6', section: 6, sectionTitle: 'BATHROOM / SHOWER LOCATION', description: 'Suitability of equipment for zone IP rating', regulationRef: '701.512.2', outcome: null, notes: '' },
    { itemRef: '6.7', section: 6, sectionTitle: 'BATHROOM / SHOWER LOCATION', description: 'Suitability of accessories for zone', regulationRef: '701.512.3', outcome: null, notes: '' },
    { itemRef: '6.8', section: 6, sectionTitle: 'BATHROOM / SHOWER LOCATION', description: 'Suitability of current-using equipment for position', regulationRef: '701.55', outcome: null, notes: '' },

    // Section 7: Other Special Locations
    { itemRef: '7.1', section: 7, sectionTitle: 'OTHER SPECIAL LOCATIONS', description: 'List any special locations and record separately', regulationRef: 'Part 7', outcome: null, notes: '' },

    // Section 8: Prosumer Installations
    { itemRef: '8.1', section: 8, sectionTitle: 'PROSUMER INSTALLATIONS', description: 'Additional inspection items per Chapter 82 (Solar PV, battery storage, EV charging)', regulationRef: 'Chapter 82', outcome: null, notes: '' },
  ]

  // Add UUIDs
  return items.map((item, index) => ({
    ...item,
    id: `insp-${index.toString().padStart(3, '0')}`,
  }))
}
