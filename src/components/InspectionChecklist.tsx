import { useState, useCallback, useMemo } from 'react';
import {
  ClipboardCheck,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  AlertTriangle,
  Search,
  Filter,
  RotateCcw,
  MessageSquare,
} from 'lucide-react';
import { sanitizeText } from '../utils/sanitization';
import { captureError } from '../utils/errorTracking';
import { trackInspectionEvent } from '../utils/analytics';
import type { InspectionItem, InspectionOutcome } from '../types/eicr';

// ─── Constants ───────────────────────────────────────────────────────────────

const OUTCOME_OPTIONS: {
  value: InspectionOutcome;
  label: string;
  shortLabel: string;
  className: string;
}[] = [
  { value: 'pass', label: 'Pass', shortLabel: '✓', className: 'bg-cv-green/15 border-cv-green text-cv-green' },
  { value: 'C1', label: 'C1', shortLabel: 'C1', className: 'bg-cv-red/15 border-cv-red text-cv-red' },
  { value: 'C2', label: 'C2', shortLabel: 'C2', className: 'bg-cv-amber/15 border-cv-amber text-cv-amber' },
  { value: 'C3', label: 'C3', shortLabel: 'C3', className: 'bg-cv-green/15 border-cv-green text-cv-green' },
  { value: 'FI', label: 'FI', shortLabel: 'FI', className: 'bg-cv-amber/15 border-cv-amber text-cv-amber' },
  { value: 'N/V', label: 'Not Verified', shortLabel: 'N/V', className: 'bg-cv-surface-2 border-cv-text-muted text-cv-text-muted' },
  { value: 'LIM', label: 'Limitation', shortLabel: 'LIM', className: 'bg-cv-surface-2 border-cv-text-muted text-cv-text-muted' },
  { value: 'N/A', label: 'Not Applicable', shortLabel: 'N/A', className: 'bg-cv-surface-2 border-cv-border text-cv-text-muted' },
];

type FilterType = 'all' | 'incomplete' | 'issues';

interface InspectionSection {
  id: string;
  title: string;
  subtitle: string;
  items: InspectionItemDef[];
}

interface InspectionItemDef {
  ref: string;
  description: string;
  regulation?: string;
}

// ─── Full BS 7671 Inspection Schedule ────────────────────────────────────────

const INSPECTION_SECTIONS: InspectionSection[] = [
  {
    id: '1.0',
    title: '1.0 Intake Equipment',
    subtitle: 'Visual inspection only',
    items: [
      { ref: '1.1', description: 'Service cable' },
      { ref: '1.2', description: 'Service head' },
      { ref: '1.3', description: 'Earthing arrangements' },
      { ref: '1.4', description: 'Meter tails' },
      { ref: '1.5', description: 'Metering equipment' },
      { ref: '1.6', description: 'Isolator (where present)' },
    ],
  },
  {
    id: '2.0',
    title: '2.0 Parallel/Alternative Sources',
    subtitle: 'Alternative supply arrangements',
    items: [
      { ref: '2.1', description: 'Switched alternative to public supply', regulation: '551.6' },
      { ref: '2.2', description: 'Parallel with public supply', regulation: '551.7' },
    ],
  },
  {
    id: '3.0',
    title: '3.0 Earthing & Bonding',
    subtitle: 'Earthing arrangements (411.3; Chapter 54)',
    items: [
      { ref: '3.1', description: "Presence/condition of distributor's earthing", regulation: '542.1.2' },
      { ref: '3.2', description: 'Earthing conductor size adequacy', regulation: '542.3; 543.1.1' },
      { ref: '3.3', description: 'Earthing conductor connections', regulation: '542.3.2' },
      { ref: '3.4', description: 'Accessibility of earthing conductor', regulation: '543.3.2' },
      { ref: '3.5', description: 'Main protective bonding conductor sizes', regulation: '544.1' },
      { ref: '3.6', description: 'Main protective bonding connections', regulation: '543.3.2; 544.1.2' },
      { ref: '3.7', description: 'Accessibility of bonding connections', regulation: '543.3.2' },
      { ref: '3.8', description: 'Earthing/bonding labels', regulation: '514.13.1' },
    ],
  },
  {
    id: '4.0',
    title: '4.0 Consumer Unit / Distribution Board',
    subtitle: 'DB inspection items',
    items: [
      { ref: '4.1', description: 'Adequacy of working space/accessibility', regulation: '132.12; 513.1' },
      { ref: '4.2', description: 'Security of fixing', regulation: '134.1.1' },
      { ref: '4.3', description: 'Condition of enclosure IP rating', regulation: '416.2' },
      { ref: '4.4', description: 'Condition of enclosure fire rating', regulation: '421.1.201; 526.5' },
      { ref: '4.5', description: 'Enclosure not damaged/deteriorated', regulation: '651.2' },
      { ref: '4.6', description: 'Presence of main linked switch', regulation: '462.1.201' },
      { ref: '4.7', description: 'Operation of main switch — functional check', regulation: '643.10' },
      { ref: '4.8', description: 'Manual operation of CBs and RCDs', regulation: '643.10' },
      { ref: '4.9', description: 'Presence of RCD test notice', regulation: '514.12.2' },
      { ref: '4.10', description: 'Correct identification of circuits', regulation: '514.8.1; 514.9.1' },
      { ref: '4.11', description: 'Alternative supply warning notice', regulation: '514.15' },
      { ref: '4.12', description: 'Other required labelling', regulation: 'Section 514' },
      { ref: '4.13', description: 'Compatibility of protective devices — correct type/rating', regulation: '411.3.2; 432; 433' },
      { ref: '4.14', description: 'Protection against mechanical damage at entry', regulation: '522.8.1/.5/.11' },
      { ref: '4.15', description: 'Single-pole devices in line conductor only', regulation: '132.14.1; 530.3.3' },
      { ref: '4.16', description: 'Protection against electromagnetic effects at entry', regulation: '521.5.1' },
      { ref: '4.17', description: 'RCDs for fault protection', regulation: '411.4.204; 411.5.2; 531.2' },
      { ref: '4.18', description: 'RCDs for additional protection', regulation: '411.3.3; 415.1' },
      { ref: '4.19', description: 'SPD functional indicator confirmed', regulation: '651.4' },
      { ref: '4.20', description: 'All conductor connections tight and secure', regulation: '526.1' },
      { ref: '4.21', description: 'Generating set as switched alternative', regulation: '551.6' },
      { ref: '4.22', description: 'Generating set in parallel', regulation: '551.7' },
    ],
  },
  {
    id: '5.0',
    title: '5.0 Final Circuits',
    subtitle: 'Circuit wiring and protection',
    items: [
      { ref: '5.1', description: 'Identification of conductors', regulation: '514.3.1' },
      { ref: '5.2', description: 'Cables correctly supported', regulation: '521.10.202; 522.8.5' },
      { ref: '5.3', description: 'Condition of insulation of live parts', regulation: '416.1' },
      { ref: '5.4', description: 'Non-sheathed cables in enclosure', regulation: '521.10.1' },
      { ref: '5.5', description: 'Adequacy of cables for current-carrying capacity', regulation: 'Section 523' },
      { ref: '5.6', description: 'Adequacy of protective devices for fault protection', regulation: '411.3' },
      { ref: '5.7', description: 'Coordination between conductors and overload devices', regulation: '433.1; 533.2.1' },
      { ref: '5.8', description: 'Presence/adequacy of CPCs', regulation: '411.3.1; Section 543' },
      { ref: '5.9', description: 'Wiring systems appropriate for installation type', regulation: 'Section 522' },
      { ref: '5.10', description: 'Cables in prescribed zones', regulation: '522.6.202' },
      { ref: '5.11', description: 'Cables with earthed armour/sheath or protected', regulation: '522.6.204' },
      { ref: '5.12', description: 'Additional protection by 30mA RCD: socket-outlets ≤32A', regulation: '411.3.3' },
      { ref: '5.12b', description: 'Additional protection: mobile equipment outdoors', regulation: '411.3.3' },
      { ref: '5.12c', description: 'Additional protection: concealed cables <50mm depth', regulation: '522.6.202/.203' },
      { ref: '5.12d', description: 'Additional protection: cables in metal partitions', regulation: '522.6.203' },
      { ref: '5.12e', description: 'Additional protection: luminaires in domestic premises', regulation: '411.3.4' },
      { ref: '5.13', description: 'Fire barriers and sealing', regulation: 'Section 527' },
      { ref: '5.14', description: 'Band II separated from Band I', regulation: '528.1' },
      { ref: '5.15', description: 'Cables separated from comms cabling', regulation: '528.2' },
      { ref: '5.16', description: 'Cables separated from non-electrical services', regulation: '528.3' },
      { ref: '5.17', description: 'Termination of cables at enclosures', regulation: 'Section 526' },
      { ref: '5.18', description: 'Condition of accessories: sockets, switches, JBs', regulation: '651.2' },
      { ref: '5.19', description: 'Suitability of accessories for environment', regulation: '512.2' },
      { ref: '5.20', description: 'Adequacy of working space', regulation: '132.12; 513.1' },
      { ref: '5.21', description: 'Single-pole devices in line conductors only', regulation: '132.14.1' },
    ],
  },
  {
    id: '6.0',
    title: '6.0 Bathroom / Shower',
    subtitle: 'Special location requirements (Section 701)',
    items: [
      { ref: '6.1', description: 'Additional protection by 30mA RCD', regulation: '701.411.3.3' },
      { ref: '6.2', description: 'SELV/PELV requirements met', regulation: '701.414.4.5' },
      { ref: '6.3', description: 'Shaver supply unit compliant', regulation: '701.512.3' },
      { ref: '6.4', description: 'Supplementary bonding (unless not required)', regulation: '701.415.2' },
      { ref: '6.5', description: '230V sockets at least 2.5m from zone 1', regulation: '701.512.3' },
      { ref: '6.6', description: 'Suitability of equipment for zone IP rating', regulation: '701.512.2' },
      { ref: '6.7', description: 'Suitability of accessories for zone', regulation: '701.512.3' },
      { ref: '6.8', description: 'Suitability of current-using equipment for position', regulation: '701.55' },
    ],
  },
  {
    id: '7.0',
    title: '7.0 Other Special Locations',
    subtitle: 'Part 7 special locations',
    items: [
      { ref: '7.1', description: 'Special locations inspected and recorded separately' },
    ],
  },
  {
    id: '8.0',
    title: '8.0 Prosumer Installations',
    subtitle: 'Chapter 82 — Solar PV, battery, EV',
    items: [
      { ref: '8.1', description: 'Additional inspection items per Chapter 82' },
    ],
  },
];

// ─── Interfaces ──────────────────────────────────────────────────────────────

interface InspectionChecklistProps {
  items: Record<string, InspectionItem>;
  onItemChange: (ref: string, item: InspectionItem) => void;
  onBatchChange: (updates: Record<string, InspectionItem>) => void;
  readonly?: boolean;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function InspectionChecklist({
  items,
  onItemChange,
  onBatchChange,
  readonly = false,
}: InspectionChecklistProps): JSX.Element {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filter, setFilter] = useState<FilterType>('all');
  const [activeNoteRef, setActiveNoteRef] = useState<string | null>(null);

  // ─── Computed Stats ──────────────────────────────────────────────────────

  const stats = useMemo(() => {
    const totalItems = INSPECTION_SECTIONS.reduce(
      (acc, section) => acc + section.items.length,
      0
    );
    let completed = 0;
    let issues = 0;

    Object.values(items).forEach((item) => {
      if (item.outcome) {
        completed++;
        if (
          item.outcome === 'C1' ||
          item.outcome === 'C2' ||
          item.outcome === 'C3' ||
          item.outcome === 'FI'
        ) {
          issues++;
        }
      }
    });

    return { totalItems, completed, issues, remaining: totalItems - completed };
  }, [items]);

  // ─── Section Toggle ──────────────────────────────────────────────────────

  const toggleSection = useCallback((sectionId: string): void => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) {
        next.delete(sectionId);
      } else {
        next.add(sectionId);
      }
      return next;
    });
  }, []);

  const expandAll = useCallback((): void => {
    setExpandedSections(new Set(INSPECTION_SECTIONS.map((s) => s.id)));
  }, []);

  const collapseAll = useCallback((): void => {
    setExpandedSections(new Set());
  }, []);

  // ─── Item Handlers ───────────────────────────────────────────────────────

  const handleOutcomeChange = useCallback(
    (ref: string, outcome: InspectionOutcome): void => {
      try {
        const existing = items[ref] ?? { ref, outcome: undefined, notes: '' };
        const updated: InspectionItem = { ...existing, outcome };

        onItemChange(ref, updated);
        trackInspectionEvent('checklist_item_set', ref, outcome);
      } catch (err) {
        captureError(err, 'InspectionChecklist.handleOutcomeChange');
      }
    },
    [items, onItemChange]
  );

  const handleNoteChange = useCallback(
    (ref: string, notes: string): void => {
      try {
        const sanitized = sanitizeText(notes);
        const existing = items[ref] ?? { ref, outcome: undefined, notes: '' };
        const updated: InspectionItem = { ...existing, notes: sanitized };
        onItemChange(ref, updated);
      } catch (err) {
        captureError(err, 'InspectionChecklist.handleNoteChange');
      }
    },
    [items, onItemChange]
  );

  // ─── Mark All in Section ─────────────────────────────────────────────────

  const markSectionAs = useCallback(
    (sectionId: string, outcome: InspectionOutcome): void => {
      try {
        const section = INSPECTION_SECTIONS.find((s) => s.id === sectionId);
        if (!section) return;

        const updates: Record<string, InspectionItem> = {};
        section.items.forEach((itemDef) => {
          const existing = items[itemDef.ref];
          // Only update items that don't already have an outcome
          if (!existing?.outcome) {
            updates[itemDef.ref] = {
              ref: itemDef.ref,
              outcome,
              notes: existing?.notes ?? '',
            };
          }
        });

        if (Object.keys(updates).length > 0) {
          onBatchChange(updates);
          trackInspectionEvent('checklist_section_batch', sectionId, outcome);
        }
      } catch (err) {
        captureError(err, 'InspectionChecklist.markSectionAs');
      }
    },
    [items, onBatchChange]
  );

  // ─── Filtering ───────────────────────────────────────────────────────────

  const getFilteredSections = useMemo((): InspectionSection[] => {
    const query = searchQuery.toLowerCase().trim();

    return INSPECTION_SECTIONS.map((section) => {
      let filteredItems = section.items;

      // Search filter
      if (query) {
        filteredItems = filteredItems.filter(
          (item) =>
            item.description.toLowerCase().includes(query) ||
            item.ref.toLowerCase().includes(query) ||
            (item.regulation && item.regulation.toLowerCase().includes(query))
        );
      }

      // Status filter
      if (filter === 'incomplete') {
        filteredItems = filteredItems.filter((item) => !items[item.ref]?.outcome);
      } else if (filter === 'issues') {
        filteredItems = filteredItems.filter((item) => {
          const outcome = items[item.ref]?.outcome;
          return outcome === 'C1' || outcome === 'C2' || outcome === 'C3' || outcome === 'FI';
        });
      }

      return { ...section, items: filteredItems };
    }).filter((section) => section.items.length > 0);
  }, [searchQuery, filter, items]);

  // ─── Section Completion ──────────────────────────────────────────────────

  const getSectionStats = useCallback(
    (section: InspectionSection): { completed: number; total: number; hasIssues: boolean } => {
      let completed = 0;
      let hasIssues = false;

      section.items.forEach((itemDef) => {
        const item = items[itemDef.ref];
        if (item?.outcome) {
          completed++;
          if (
            item.outcome === 'C1' ||
            item.outcome === 'C2' ||
            item.outcome === 'FI'
          ) {
            hasIssues = true;
          }
        }
      });

      return { completed, total: section.items.length, hasIssues };
    },
    [items]
  );

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="cv-panel p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-base font-bold text-cv-text flex items-center gap-2">
              <ClipboardCheck className="w-5 h-5 text-cv-accent" />
              Schedule of Inspections
            </h2>
            <p className="text-xs text-cv-text-muted mt-1">
              {stats.totalItems} items — Tap outcome for each
            </p>
          </div>
        </div>

        {/* Stats bar */}
        <div className="grid grid-cols-3 gap-2 mb-3">
          <div className="bg-cv-bg rounded-lg p-2.5 text-center border border-cv-border">
            <div className="text-lg font-bold text-cv-green font-mono">{stats.completed}</div>
            <div className="text-[10px] text-cv-text-muted uppercase tracking-wider">Done</div>
          </div>
          <div className="bg-cv-bg rounded-lg p-2.5 text-center border border-cv-border">
            <div className="text-lg font-bold text-cv-text-muted font-mono">{stats.remaining}</div>
            <div className="text-[10px] text-cv-text-muted uppercase tracking-wider">Left</div>
          </div>
          <div className="bg-cv-bg rounded-lg p-2.5 text-center border border-cv-border">
            <div className={`text-lg font-bold font-mono ${stats.issues > 0 ? 'text-cv-amber' : 'text-cv-green'}`}>
              {stats.issues}
            </div>
            <div className="text-[10px] text-cv-text-muted uppercase tracking-wider">Issues</div>
          </div>
        </div>

        {/* Progress bar */}
        <div className="w-full bg-cv-border rounded-full h-2">
          <div
            className="bg-cv-accent h-2 rounded-full transition-all duration-500"
            style={{
              width: `${stats.totalItems > 0 ? (stats.completed / stats.totalItems) * 100 : 0}%`,
            }}
          />
        </div>
        <p className="text-xs text-cv-text-muted mt-1.5 text-right">
          {stats.totalItems > 0
            ? `${Math.round((stats.completed / stats.totalItems) * 100)}% complete`
            : '0% complete'}
        </p>
      </div>

      {/* Search and Filter */}
      <div className="cv-panel p-4">
        <div className="flex gap-2 mb-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-cv-text-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search items or regulation..."
              className="cv-data-field w-full pl-9 text-sm"
              maxLength={100}
              aria-label="Search inspection items"
            />
          </div>
        </div>

        {/* Filter buttons */}
        <div className="flex gap-2 mb-3">
          {(
            [
              { value: 'all' as FilterType, label: 'All' },
              { value: 'incomplete' as FilterType, label: `Incomplete (${stats.remaining})` },
              { value: 'issues' as FilterType, label: `Issues (${stats.issues})` },
            ] as const
          ).map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                filter === f.value
                  ? 'bg-cv-accent/15 border-cv-accent text-cv-accent'
                  : 'bg-cv-surface-2 border-cv-border text-cv-text-muted hover:border-cv-text-muted'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Expand/Collapse */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={expandAll}
            className="text-xs text-cv-accent hover:text-cv-accent/80 font-semibold"
          >
            Expand All
          </button>
          <span className="text-cv-border">|</span>
          <button
            type="button"
            onClick={collapseAll}
            className="text-xs text-cv-accent hover:text-cv-accent/80 font-semibold"
          >
            Collapse All
          </button>
        </div>
      </div>

      {/* Sections */}
      {getFilteredSections.map((section) => {
        const sectionStats = getSectionStats(section);
        const isExpanded = expandedSections.has(section.id);

        return (
          <div key={section.id} className="cv-panel overflow-hidden">
            {/* Section Header */}
            <button
              type="button"
              onClick={() => toggleSection(section.id)}
              className="w-full flex items-center justify-between p-4 text-left hover:bg-cv-surface-2/50 transition-colors"
              aria-expanded={isExpanded}
              aria-controls={`checklist-${section.id}`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-cv-text truncate">
                    {section.title}
                  </h3>
                  {sectionStats.hasIssues && (
                    <AlertTriangle className="w-3.5 h-3.5 text-cv-amber flex-shrink-0" />
                  )}
                </div>
                <p className="text-xs text-cv-text-muted mt-0.5">{section.subtitle}</p>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0 ml-3">
                <span className="text-xs font-mono text-cv-text-muted">
                  {sectionStats.completed}/{sectionStats.total}
                </span>
                {sectionStats.completed === sectionStats.total && sectionStats.total > 0 ? (
                  <CheckCircle2 className="w-4 h-4 text-cv-green" />
                ) : isExpanded ? (
                  <ChevronUp className="w-4 h-4 text-cv-text-muted" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-cv-text-muted" />
                )}
              </div>
            </button>

            {/* Section Items */}
            {isExpanded && (
              <div id={`checklist-${section.id}`} className="px-4 pb-4">
                {/* Quick actions */}
                {!readonly && (
                  <div className="flex gap-2 mb-3 pb-3 border-b border-cv-border">
                    <span className="text-[10px] text-cv-text-muted uppercase tracking-wider self-center">
                      Mark remaining:
                    </span>
                    <button
                      type="button"
                      onClick={() => markSectionAs(section.id, 'pass')}
                      className="px-2.5 py-1 rounded text-[10px] font-bold bg-cv-green/15 border border-cv-green text-cv-green hover:bg-cv-green/25 transition-colors"
                    >
                      All Pass
                    </button>
                    <button
                      type="button"
                      onClick={() => markSectionAs(section.id, 'N/A')}
                      className="px-2.5 py-1 rounded text-[10px] font-bold bg-cv-surface-2 border border-cv-border text-cv-text-muted hover:border-cv-text-muted transition-colors"
                    >
                      All N/A
                    </button>
                  </div>
                )}

                {/* Items */}
                <div className="space-y-2">
                  {section.items.map((itemDef) => {
                    const item = items[itemDef.ref];
                    const currentOutcome = item?.outcome;
                    const hasNotes = !!item?.notes;
                    const showNotes = activeNoteRef === itemDef.ref;

                    return (
                      <div
                        key={itemDef.ref}
                        className={`rounded-lg border transition-all ${
                          currentOutcome === 'C1'
                            ? 'border-cv-red/50 bg-cv-red/5'
                            : currentOutcome === 'C2' || currentOutcome === 'FI'
                            ? 'border-cv-amber/50 bg-cv-amber/5'
                            : 'border-cv-border bg-cv-bg'
                        }`}
                      >
                        <div className="p-3">
                          {/* Item description */}
                          <div className="flex items-start gap-2 mb-2">
                            <span className="text-[10px] font-mono text-cv-text-muted font-bold min-w-[2.5rem]">
                              {itemDef.ref}
                            </span>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs text-cv-text leading-relaxed">
                                {itemDef.description}
                              </p>
                              {itemDef.regulation && (
                                <p className="text-[10px] font-mono text-cv-text-muted mt-0.5">
                                  Reg. {itemDef.regulation}
                                </p>
                              )}
                            </div>
                            {/* Notes toggle */}
                            <button
                              type="button"
                              onClick={() =>
                                setActiveNoteRef(showNotes ? null : itemDef.ref)
                              }
                              className={`p-1 rounded transition-colors flex-shrink-0 ${
                                hasNotes
                                  ? 'text-cv-accent'
                                  : 'text-cv-text-muted hover:text-cv-text'
                              }`}
                              aria-label={`${showNotes ? 'Hide' : 'Add'} notes for item ${itemDef.ref}`}
                            >
                              <MessageSquare className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          {/* Outcome buttons */}
                          <div className="flex flex-wrap gap-1">
                            {OUTCOME_OPTIONS.map((option) => (
                              <button
                                key={option.value}
                                type="button"
                                onClick={() =>
                                  !readonly && handleOutcomeChange(itemDef.ref, option.value)
                                }
                                className={`px-2 py-1 rounded text-[10px] font-bold border transition-all ${
                                  currentOutcome === option.value
                                    ? option.className
                                    : 'bg-cv-surface-2 border-cv-border text-cv-text-muted hover:border-cv-text-muted'
                                } ${readonly ? 'pointer-events-none' : 'cursor-pointer'}`}
                                aria-pressed={currentOutcome === option.value}
                                aria-label={`${option.label} for item ${itemDef.ref}`}
                                disabled={readonly}
                              >
                                {option.shortLabel}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Notes input */}
                        {showNotes && (
                          <div className="px-3 pb-3 pt-1 border-t border-cv-border/50">
                            <input
                              type="text"
                              value={item?.notes ?? ''}
                              onChange={(e) => handleNoteChange(itemDef.ref, e.target.value)}
                              placeholder="Add a note for this item..."
                              className="cv-data-field w-full text-xs"
                              maxLength={500}
                              readOnly={readonly}
                              aria-label={`Notes for item ${itemDef.ref}`}
                              autoFocus
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* Empty state */}
      {getFilteredSections.length === 0 && (
        <div className="cv-panel p-8 text-center">
          <Filter className="w-8 h-8 text-cv-text-muted mx-auto mb-2" />
          <p className="text-sm text-cv-text-muted">
            {searchQuery
              ? `No items match "${searchQuery}"`
              : filter === 'incomplete'
              ? 'All items have been completed'
              : 'No issues found'}
          </p>
          <button
            type="button"
            onClick={() => {
              setSearchQuery('');
              setFilter('all');
            }}
            className="text-xs text-cv-accent hover:text-cv-accent/80 font-semibold mt-2 flex items-center gap-1 mx-auto"
          >
            <RotateCcw className="w-3 h-3" />
            Clear filters
          </button>
        </div>
      )}
    </div>
  );
}
