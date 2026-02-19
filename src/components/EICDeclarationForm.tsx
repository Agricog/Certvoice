/**
 * CertVoice — EIC Declaration Form (Section F)
 *
 * Three separate declarations required on an EIC:
 *   1. Designer — "I designed this installation to BS 7671"
 *   2. Constructor — "I constructed it to BS 7671 and the design"
 *   3. Inspector — "I inspected and tested it, it complies"
 *
 * On most domestic jobs a single electrician fills all three roles.
 * The "Same person for all roles" toggle auto-copies name, company,
 * address, position, scheme body, and registration number across
 * all three declarations — only dates differ.
 *
 * Auto-fills from engineer profile on first load (same as EICR).
 *
 * **File: src/components/EICDeclarationForm.tsx** (create new)
 *
 * @module components/EICDeclarationForm
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import {
  FileSignature,
  UserCheck,
  ChevronDown,
  ChevronUp,
  Check,
  Users,
  Ruler,
  HardHat,
  Search,
} from 'lucide-react'
import type {
  EICDeclarations,
  DesignerDeclaration,
  ConstructorDeclaration,
  InspectorDeclaration,
  SchemeBody,
} from '../types/eic'
import type { EngineerProfile } from '../types/eicr'

// ============================================================
// TYPES
// ============================================================

interface EICDeclarationFormProps {
  declarations: EICDeclarations
  onDeclarationsChange: (updated: EICDeclarations) => void
  engineerProfile: EngineerProfile | null
  disabled?: boolean
}

type RoleKey = 'designer' | 'constructor' | 'inspector'

// ============================================================
// EMPTY DEFAULTS
// ============================================================

const EMPTY_DESIGNER: DesignerDeclaration = {
  name: '',
  companyName: '',
  companyAddress: '',
  position: '',
  schemeBody: null,
  registrationNumber: '',
  dateSigned: '',
  signatureKey: null,
}

const EMPTY_CONSTRUCTOR: ConstructorDeclaration = {
  name: '',
  companyName: '',
  companyAddress: '',
  position: '',
  schemeBody: null,
  registrationNumber: '',
  dateSigned: '',
  signatureKey: null,
}

const EMPTY_INSPECTOR: InspectorDeclaration = {
  name: '',
  companyName: '',
  companyAddress: '',
  position: '',
  schemeBody: null,
  registrationNumber: '',
  dateInspected: '',
  dateSigned: '',
  signatureKey: null,
  qsName: '',
  qsSignatureKey: null,
  qsDateSigned: '',
}

export const EMPTY_DECLARATIONS: EICDeclarations = {
  designer: { ...EMPTY_DESIGNER },
  constructor: { ...EMPTY_CONSTRUCTOR },
  inspector: { ...EMPTY_INSPECTOR },
  samePersonAllRoles: true,
}

// ============================================================
// CONSTANTS
// ============================================================

const SCHEME_BODIES: { value: SchemeBody; label: string }[] = [
  { value: 'NICEIC', label: 'NICEIC' },
  { value: 'NAPIT', label: 'NAPIT' },
  { value: 'ELECSA', label: 'ELECSA' },
  { value: 'STROMA', label: 'Stroma' },
  { value: 'CERTSURE', label: 'Certsure' },
  { value: 'OTHER', label: 'Other' },
]

const ROLE_CONFIG: { key: RoleKey; label: string; icon: typeof Ruler; description: string }[] = [
  {
    key: 'designer',
    label: 'Designer',
    icon: Ruler,
    description: 'I certify that the design of the installation complies with BS 7671',
  },
  {
    key: 'constructor',
    label: 'Constructor',
    icon: HardHat,
    description: 'I certify that the construction complies with BS 7671 and the design',
  },
  {
    key: 'inspector',
    label: 'Inspector',
    icon: Search,
    description: 'I certify that I have inspected and tested the installation and it complies',
  },
]

/** Shared fields that get copied when samePersonAllRoles is true */
const COPYABLE_FIELDS = [
  'name',
  'companyName',
  'companyAddress',
  'position',
  'schemeBody',
  'registrationNumber',
] as const

// ============================================================
// COMPONENT
// ============================================================

export default function EICDeclarationForm({
  declarations,
  onDeclarationsChange,
  engineerProfile,
  disabled = false,
}: EICDeclarationFormProps) {
  const [expandedRoles, setExpandedRoles] = useState<Set<RoleKey>>(
    new Set(declarations.samePersonAllRoles ? ['designer'] : ['designer', 'constructor', 'inspector'])
  )
  const hasAutoFilled = useRef(false)

  // ── Auto-fill from engineer profile on first load ─────────────────────
  useEffect(() => {
    if (hasAutoFilled.current) return
    if (!engineerProfile) return
    if (declarations.designer.name.trim()) return // already has data

    hasAutoFilled.current = true

    const shared = {
      name: engineerProfile.fullName,
      companyName: engineerProfile.companyName,
      companyAddress: engineerProfile.companyAddress,
      position: engineerProfile.position,
      registrationNumber: engineerProfile.registrationNumber,
      schemeBody: (engineerProfile.schemeBody as SchemeBody) || null,
    }

    const today = new Date().toISOString().split('T')[0]

    onDeclarationsChange({
      ...declarations,
      designer: { ...declarations.designer, ...shared, dateSigned: today },
      constructor: { ...declarations.constructor, ...shared, dateSigned: today },
      inspector: {
        ...declarations.inspector,
        ...shared,
        dateInspected: today,
        dateSigned: today,
      },
    })
  }, [engineerProfile, declarations, onDeclarationsChange])

  // ── Toggle section ────────────────────────────────────────────────────
  const toggleRole = useCallback((role: RoleKey) => {
    setExpandedRoles((prev) => {
      const next = new Set(prev)
      if (next.has(role)) next.delete(role)
      else next.add(role)
      return next
    })
  }, [])

  // ── Same person toggle ────────────────────────────────────────────────
  const handleSamePersonToggle = useCallback(
    (checked: boolean) => {
      if (checked) {
        // Copy designer fields to constructor and inspector
        const source = declarations.designer
        const shared: Record<string, unknown> = {}
        for (const field of COPYABLE_FIELDS) {
          shared[field] = source[field]
        }

        onDeclarationsChange({
          ...declarations,
          samePersonAllRoles: true,
          constructor: { ...declarations.constructor, ...shared },
          inspector: { ...declarations.inspector, ...shared },
        })
        setExpandedRoles(new Set(['designer']))
      } else {
        onDeclarationsChange({ ...declarations, samePersonAllRoles: false })
        setExpandedRoles(new Set(['designer', 'constructor', 'inspector']))
      }
    },
    [declarations, onDeclarationsChange]
  )

  // ── Update a role field ───────────────────────────────────────────────
  const updateRole = useCallback(
    (role: RoleKey, field: string, value: unknown) => {
      const updated = { ...declarations }
      const roleData = { ...updated[role], [field]: value }
      updated[role] = roleData as typeof updated[typeof role]

      // If same person mode and updating a copyable field on designer, propagate
      if (updated.samePersonAllRoles && role === 'designer' && (COPYABLE_FIELDS as readonly string[]).includes(field)) {
        updated.constructor = { ...updated.constructor, [field]: value }
        updated.inspector = { ...updated.inspector, [field]: value }
      }

      onDeclarationsChange(updated)
    },
    [declarations, onDeclarationsChange]
  )

  // ── Auto-fill button ──────────────────────────────────────────────────
  const handleAutoFill = useCallback(() => {
    if (!engineerProfile) return

    const shared = {
      name: engineerProfile.fullName,
      companyName: engineerProfile.companyName,
      companyAddress: engineerProfile.companyAddress,
      position: engineerProfile.position,
      registrationNumber: engineerProfile.registrationNumber,
      schemeBody: (engineerProfile.schemeBody as SchemeBody) || null,
    }

    const today = new Date().toISOString().split('T')[0]

    onDeclarationsChange({
      ...declarations,
      designer: { ...declarations.designer, ...shared, dateSigned: today },
      constructor: { ...declarations.constructor, ...shared, dateSigned: today },
      inspector: {
        ...declarations.inspector,
        ...shared,
        dateInspected: today,
        dateSigned: today,
      },
    })
  }, [engineerProfile, declarations, onDeclarationsChange])

  // ── Completion check ──────────────────────────────────────────────────
  const isRoleComplete = (role: RoleKey): boolean => {
    const d = declarations[role]
    return !!(d.name.trim() && d.companyName.trim() && d.registrationNumber.trim())
  }

  const allComplete = ROLE_CONFIG.every((r) => isRoleComplete(r.key))

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="cv-panel p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileSignature className="w-4 h-4 text-certvoice-accent" />
            <h3 className="text-sm font-bold text-certvoice-text">Declarations — Section F</h3>
          </div>
          <div className="flex items-center gap-2">
            {engineerProfile && !disabled && (
              <button
                type="button"
                onClick={handleAutoFill}
                className="flex items-center gap-1 text-[10px] text-certvoice-accent hover:text-certvoice-accent/80 transition-colors"
              >
                <UserCheck className="w-3 h-3" />
                Fill from profile
              </button>
            )}
            <span
              className={`text-xs font-mono px-2 py-0.5 rounded-full ${
                allComplete
                  ? 'bg-emerald-500/15 text-emerald-400'
                  : 'bg-certvoice-accent/15 text-certvoice-accent'
              }`}
            >
              {ROLE_CONFIG.filter((r) => isRoleComplete(r.key)).length}/3
            </span>
          </div>
        </div>

        {/* Same person toggle */}
        <button
          type="button"
          onClick={() => !disabled && handleSamePersonToggle(!declarations.samePersonAllRoles)}
          disabled={disabled}
          className={`mt-3 w-full flex items-center gap-3 p-3 rounded-lg border transition-colors
            disabled:opacity-50 disabled:cursor-not-allowed ${
            declarations.samePersonAllRoles
              ? 'bg-certvoice-accent/10 border-certvoice-accent/40'
              : 'bg-certvoice-surface-2 border-certvoice-border hover:border-certvoice-muted'
          }`}
        >
          <div
            className={`w-5 h-5 rounded flex items-center justify-center shrink-0 transition-colors ${
              declarations.samePersonAllRoles
                ? 'bg-certvoice-accent text-white'
                : 'bg-certvoice-bg border border-certvoice-border'
            }`}
          >
            {declarations.samePersonAllRoles && <Check className="w-3 h-3" />}
          </div>
          <div className="text-left">
            <p className="text-sm text-certvoice-text font-semibold flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5" />
              Same person for all roles
            </p>
            <p className="text-[10px] text-certvoice-muted mt-0.5">
              Typical for domestic work — designer, constructor, and inspector are the same electrician
            </p>
          </div>
        </button>
      </div>

      {/* Role declarations */}
      {ROLE_CONFIG.map((roleConfig) => {
        const { key, label, icon: Icon, description } = roleConfig
        const isExpanded = expandedRoles.has(key)
        const complete = isRoleComplete(key)

        // In same-person mode, only show designer fields fully + dates for other roles
        const isCollapsedInSameMode = declarations.samePersonAllRoles && key !== 'designer'

        return (
          <div key={key} className="cv-panel !p-0 overflow-hidden">
            {/* Role header */}
            <button
              type="button"
              onClick={() => toggleRole(key)}
              className="w-full text-left p-4 flex items-center justify-between hover:bg-certvoice-surface-2/50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <span className={complete ? 'text-emerald-400' : 'text-certvoice-accent'}>
                  <Icon className="w-4 h-4" />
                </span>
                <div>
                  <div className="text-sm font-semibold text-certvoice-text">{label}</div>
                  <div className="text-[10px] text-certvoice-muted mt-0.5 line-clamp-1">
                    {description}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {complete && <Check className="w-4 h-4 text-emerald-400" />}
                {isExpanded ? (
                  <ChevronUp className="w-4 h-4 text-certvoice-muted" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-certvoice-muted" />
                )}
              </div>
            </button>

            {/* Role fields */}
            {isExpanded && (
              <div className="px-4 pb-4 space-y-3 border-t border-certvoice-border/50">
                {/* Same-person mode: show "copied from designer" notice */}
                {isCollapsedInSameMode && (
                  <div className="pt-3 flex items-center gap-2 text-[10px] text-certvoice-accent">
                    <Users className="w-3 h-3" />
                    Personal details copied from Designer — only date fields shown
                  </div>
                )}

                {/* Personal details — hidden in same-person mode for non-designer */}
                {!isCollapsedInSameMode && (
                  <>
                    <div className="pt-3">
                      <label className="block text-xs font-semibold text-certvoice-text mb-1">
                        Full Name <span className="text-certvoice-red">*</span>
                      </label>
                      <input
                        type="text"
                        value={declarations[key].name}
                        onChange={(e) => updateRole(key, 'name', e.target.value)}
                        placeholder="Full name (as on registration)"
                        disabled={disabled}
                        className="cv-input"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-certvoice-text mb-1">
                          Company <span className="text-certvoice-red">*</span>
                        </label>
                        <input
                          type="text"
                          value={declarations[key].companyName}
                          onChange={(e) => updateRole(key, 'companyName', e.target.value)}
                          placeholder="Trading name"
                          disabled={disabled}
                          className="cv-input"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-certvoice-text mb-1">
                          Position
                        </label>
                        <input
                          type="text"
                          value={declarations[key].position}
                          onChange={(e) => updateRole(key, 'position', e.target.value)}
                          placeholder="e.g. Director"
                          disabled={disabled}
                          className="cv-input"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-certvoice-text mb-1">
                        Company Address
                      </label>
                      <input
                        type="text"
                        value={declarations[key].companyAddress}
                        onChange={(e) => updateRole(key, 'companyAddress', e.target.value)}
                        placeholder="Full address with postcode"
                        disabled={disabled}
                        className="cv-input"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-certvoice-text mb-1">
                          Scheme Body
                        </label>
                        <select
                          value={declarations[key].schemeBody ?? ''}
                          onChange={(e) =>
                            updateRole(key, 'schemeBody', e.target.value || null)
                          }
                          disabled={disabled}
                          className="cv-input"
                        >
                          <option value="">Select...</option>
                          {SCHEME_BODIES.map((s) => (
                            <option key={s.value} value={s.value}>
                              {s.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-certvoice-text mb-1">
                          Registration No. <span className="text-certvoice-red">*</span>
                        </label>
                        <input
                          type="text"
                          value={declarations[key].registrationNumber}
                          onChange={(e) => updateRole(key, 'registrationNumber', e.target.value)}
                          placeholder="Membership number"
                          disabled={disabled}
                          className="cv-input"
                        />
                      </div>
                    </div>
                  </>
                )}

                {/* Date fields — always shown for all roles */}
                <div className="border-t border-certvoice-border/50 pt-3">
                  {key === 'inspector' ? (
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-certvoice-text mb-1">
                          Date Inspected
                        </label>
                        <input
                          type="date"
                          value={(declarations.inspector as InspectorDeclaration).dateInspected}
                          onChange={(e) => updateRole('inspector', 'dateInspected', e.target.value)}
                          disabled={disabled}
                          className="cv-input"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-certvoice-text mb-1">
                          Date Signed
                        </label>
                        <input
                          type="date"
                          value={declarations.inspector.dateSigned}
                          onChange={(e) => updateRole('inspector', 'dateSigned', e.target.value)}
                          disabled={disabled}
                          className="cv-input"
                        />
                      </div>
                    </div>
                  ) : (
                    <div>
                      <label className="block text-xs font-semibold text-certvoice-text mb-1">
                        Date Signed
                      </label>
                      <input
                        type="date"
                        value={declarations[key].dateSigned}
                        onChange={(e) => updateRole(key, 'dateSigned', e.target.value)}
                        disabled={disabled}
                        className="cv-input"
                      />
                    </div>
                  )}
                </div>

                {/* QS fields — inspector only */}
                {key === 'inspector' && (
                  <div className="border-t border-certvoice-border/50 pt-3 space-y-3">
                    <span className="text-xs font-semibold text-certvoice-muted uppercase tracking-wider">
                      Qualified Supervisor (if applicable)
                    </span>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-semibold text-certvoice-text mb-1">
                          QS Name
                        </label>
                        <input
                          type="text"
                          value={(declarations.inspector as InspectorDeclaration).qsName}
                          onChange={(e) => updateRole('inspector', 'qsName', e.target.value)}
                          placeholder="If different from inspector"
                          disabled={disabled}
                          className="cv-input"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-certvoice-text mb-1">
                          QS Date Signed
                        </label>
                        <input
                          type="date"
                          value={(declarations.inspector as InspectorDeclaration).qsDateSigned}
                          onChange={(e) => updateRole('inspector', 'qsDateSigned', e.target.value)}
                          disabled={disabled}
                          className="cv-input"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
