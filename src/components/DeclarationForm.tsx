/**
 * CertVoice — DeclarationForm Component (Section G)
 *
 * Captures the formal declaration required on every EICR:
 *   - Inspector details (name, position, company, address, registration)
 *   - Inspector signature via SignatureCapture
 *   - Qualified Supervisor (QS) details and signature
 *   - Date fields for inspection and QS authorisation
 *
 * Pre-fill strategy:
 *   On mount, if declaration fields are empty and engineerProfile is provided,
 *   auto-populate inspector name, company, address, position, registration,
 *   and inspector signature from the profile. The user can override any field.
 *
 * @module components/DeclarationForm
 */

import { useState, useCallback, useEffect } from 'react'
import {
  User,
  Building2,
  MapPin,
  BadgeCheck,
  CalendarDays,
  Shield,
  UserCheck,
} from 'lucide-react'
import SignatureCapture from './SignatureCapture'
import type { Declaration } from '../types/eicr'
import type { EngineerProfile } from '../types/eicr'
import type { GetToken } from '../services/uploadService'

// ============================================================
// TYPES
// ============================================================

interface DeclarationFormProps {
  /** UUID of the certificate — required for R2 signature storage */
  certificateId: string
  /** Current declaration state (controlled from parent) */
  declaration: Declaration
  /** Called on every field change */
  onDeclarationChange: (declaration: Declaration) => void
  /** Auth token provider (from useApiToken hook) */
  getToken: GetToken
  /** Engineer profile for auto-fill (from Settings/API) */
  engineerProfile?: EngineerProfile | null
  /** Disable all inputs (e.g. when certificate is issued) */
  disabled?: boolean
}

// ============================================================
// EMPTY DECLARATION
// ============================================================

export const EMPTY_DECLARATION: Declaration = {
  inspectorName: '',
  inspectorSignatureKey: null,
  companyName: '',
  position: '',
  companyAddress: '',
  dateInspected: '',
  qsName: '',
  qsSignatureKey: null,
  qsDate: '',
  registrationNumber: '',
}

// ============================================================
// HELPERS
// ============================================================

/** Format ISO date string to YYYY-MM-DD for input[type=date] */
function toDateInputValue(iso: string): string {
  if (!iso) return ''
  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso
  // Full ISO — extract date portion
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toISOString().split('T')[0] ?? ''
}

/** Convert YYYY-MM-DD to ISO string for storage */
function fromDateInputValue(value: string): string {
  if (!value) return ''
  return new Date(`${value}T00:00:00`).toISOString()
}

// ============================================================
// COMPONENT
// ============================================================

export default function DeclarationForm({
  certificateId,
  declaration,
  onDeclarationChange,
  getToken,
  engineerProfile,
  disabled = false,
}: DeclarationFormProps) {
  const [hasAutoFilled, setHasAutoFilled] = useState(false)

  // --- Auto-fill from engineer profile (once, only if fields are empty) ---
  useEffect(() => {
    if (hasAutoFilled || !engineerProfile || disabled) return

    const needsFill =
      !declaration.inspectorName &&
      !declaration.companyName &&
      !declaration.registrationNumber

    if (!needsFill) {
      setHasAutoFilled(true)
      return
    }

    const filled: Declaration = {
      ...declaration,
      inspectorName: engineerProfile.fullName || declaration.inspectorName,
      companyName: engineerProfile.companyName || declaration.companyName,
      companyAddress: engineerProfile.companyAddress || declaration.companyAddress,
      position: engineerProfile.position || declaration.position,
      registrationNumber: engineerProfile.registrationNumber || declaration.registrationNumber,
      inspectorSignatureKey: engineerProfile.signatureKey || declaration.inspectorSignatureKey,
    }

    onDeclarationChange(filled)
    setHasAutoFilled(true)
  }, [engineerProfile, declaration, hasAutoFilled, disabled, onDeclarationChange])

  // --- Field change handler ---
  const handleChange = useCallback(
    (field: keyof Declaration, value: string | null) => {
      onDeclarationChange({ ...declaration, [field]: value })
    },
    [declaration, onDeclarationChange]
  )

  // --- Signature handlers ---
  const handleInspectorSignature = useCallback(
    (key: string | null) => {
      handleChange('inspectorSignatureKey', key)
    },
    [handleChange]
  )

  const handleQsSignature = useCallback(
    (key: string | null) => {
      handleChange('qsSignatureKey', key)
    },
    [handleChange]
  )

  // --- Completion status ---
  const inspectorComplete =
    Boolean(declaration.inspectorName) &&
    Boolean(declaration.companyName) &&
    Boolean(declaration.registrationNumber) &&
    Boolean(declaration.inspectorSignatureKey) &&
    Boolean(declaration.dateInspected)

  const qsComplete =
    Boolean(declaration.qsName) &&
    Boolean(declaration.qsSignatureKey) &&
    Boolean(declaration.qsDate)

  return (
    <div className="space-y-6">
      {/* ================================================================
          INSPECTOR SECTION
          ================================================================ */}
      <div className="cv-panel space-y-4">
        <div className="flex items-center gap-2">
          <User className="w-4 h-4 text-certvoice-accent" />
          <h3 className="cv-section-title">Inspector Details</h3>
          {inspectorComplete && (
            <span className="ml-auto cv-badge-pass text-[10px]">COMPLETE</span>
          )}
        </div>

        {/* Inspector Name */}
        <div className="space-y-1">
          <label
            htmlFor="dec-inspector-name"
            className="cv-data-label flex items-center gap-1.5"
          >
            <User className="w-3 h-3" />
            Inspector Name (in capitals on form)
          </label>
          <input
            id="dec-inspector-name"
            type="text"
            value={declaration.inspectorName}
            onChange={(e) => handleChange('inspectorName', e.target.value)}
            disabled={disabled}
            placeholder="e.g. JOHN SMITH"
            autoComplete="name"
            className="cv-input w-full uppercase"
          />
        </div>

        {/* Position */}
        <div className="space-y-1">
          <label
            htmlFor="dec-position"
            className="cv-data-label flex items-center gap-1.5"
          >
            <BadgeCheck className="w-3 h-3" />
            Position / Job Title
          </label>
          <input
            id="dec-position"
            type="text"
            value={declaration.position}
            onChange={(e) => handleChange('position', e.target.value)}
            disabled={disabled}
            placeholder="e.g. Approved Electrician"
            autoComplete="organization-title"
            className="cv-input w-full"
          />
        </div>

        {/* Company + Registration — side by side on larger screens */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <label
              htmlFor="dec-company"
              className="cv-data-label flex items-center gap-1.5"
            >
              <Building2 className="w-3 h-3" />
              Company Name
            </label>
            <input
              id="dec-company"
              type="text"
              value={declaration.companyName}
              onChange={(e) => handleChange('companyName', e.target.value)}
              disabled={disabled}
              placeholder="Trading name"
              autoComplete="organization"
              className="cv-input w-full"
            />
          </div>
          <div className="space-y-1">
            <label
              htmlFor="dec-registration"
              className="cv-data-label flex items-center gap-1.5"
            >
              <Shield className="w-3 h-3" />
              Registration No.
            </label>
            <input
              id="dec-registration"
              type="text"
              value={declaration.registrationNumber}
              onChange={(e) => handleChange('registrationNumber', e.target.value)}
              disabled={disabled}
              placeholder="NICEIC / NAPIT / ELECSA"
              className="cv-input w-full"
            />
          </div>
        </div>

        {/* Company Address */}
        <div className="space-y-1">
          <label
            htmlFor="dec-address"
            className="cv-data-label flex items-center gap-1.5"
          >
            <MapPin className="w-3 h-3" />
            Company Address
          </label>
          <textarea
            id="dec-address"
            value={declaration.companyAddress}
            onChange={(e) => handleChange('companyAddress', e.target.value)}
            disabled={disabled}
            rows={2}
            placeholder="Full company address with postcode"
            autoComplete="street-address"
            className="cv-input w-full resize-none"
          />
        </div>

        {/* Date of Inspection */}
        <div className="space-y-1">
          <label
            htmlFor="dec-date-inspected"
            className="cv-data-label flex items-center gap-1.5"
          >
            <CalendarDays className="w-3 h-3" />
            Date of Inspection
          </label>
          <input
            id="dec-date-inspected"
            type="date"
            value={toDateInputValue(declaration.dateInspected)}
            onChange={(e) =>
              handleChange('dateInspected', fromDateInputValue(e.target.value))
            }
            disabled={disabled}
            className="cv-input w-full"
          />
        </div>

        {/* Inspector Signature */}
        <div className="space-y-1">
          <div className="cv-data-label">Inspector Signature</div>
          <SignatureCapture
            certificateId={certificateId}
            signatureKey={declaration.inspectorSignatureKey}
            onSignatureChange={handleInspectorSignature}
            getToken={getToken}
            label="Inspector Signature"
            disabled={disabled}
          />
        </div>
      </div>

      {/* ================================================================
          QUALIFIED SUPERVISOR SECTION
          ================================================================ */}
      <div className="cv-panel space-y-4">
        <div className="flex items-center gap-2">
          <UserCheck className="w-4 h-4 text-certvoice-accent" />
          <h3 className="cv-section-title">Qualified Supervisor (QS)</h3>
          {qsComplete && (
            <span className="ml-auto cv-badge-pass text-[10px]">COMPLETE</span>
          )}
        </div>

        <div className="bg-certvoice-bg rounded-lg border border-certvoice-border p-3">
          <p className="text-xs text-certvoice-muted leading-relaxed">
            The QS reviews and authorises the report. If you are the QS, enter
            your details here as well. For solo operators registered as both
            inspector and QS, the same name and signature are acceptable.
          </p>
        </div>

        {/* QS Name */}
        <div className="space-y-1">
          <label
            htmlFor="dec-qs-name"
            className="cv-data-label flex items-center gap-1.5"
          >
            <UserCheck className="w-3 h-3" />
            QS Name (in capitals on form)
          </label>
          <input
            id="dec-qs-name"
            type="text"
            value={declaration.qsName}
            onChange={(e) => handleChange('qsName', e.target.value)}
            disabled={disabled}
            placeholder="e.g. JOHN SMITH"
            autoComplete="name"
            className="cv-input w-full uppercase"
          />
        </div>

        {/* QS Date */}
        <div className="space-y-1">
          <label
            htmlFor="dec-qs-date"
            className="cv-data-label flex items-center gap-1.5"
          >
            <CalendarDays className="w-3 h-3" />
            Date Report Authorised
          </label>
          <input
            id="dec-qs-date"
            type="date"
            value={toDateInputValue(declaration.qsDate)}
            onChange={(e) =>
              handleChange('qsDate', fromDateInputValue(e.target.value))
            }
            disabled={disabled}
            className="cv-input w-full"
          />
        </div>

        {/* QS Signature */}
        <div className="space-y-1">
          <div className="cv-data-label">QS Signature</div>
          <SignatureCapture
            certificateId={certificateId}
            signatureKey={declaration.qsSignatureKey}
            onSignatureChange={handleQsSignature}
            getToken={getToken}
            label="QS Signature"
            disabled={disabled}
          />
        </div>
      </div>

      {/* ================================================================
          STATUS SUMMARY
          ================================================================ */}
      <div
        className={`cv-panel p-3 flex items-center gap-2 ${
          inspectorComplete && qsComplete
            ? 'border-certvoice-green/30 bg-certvoice-green/5'
            : 'border-certvoice-amber/30 bg-certvoice-amber/5'
        }`}
      >
        <Shield
          className={`w-4 h-4 shrink-0 ${
            inspectorComplete && qsComplete
              ? 'text-certvoice-green'
              : 'text-certvoice-amber'
          }`}
        />
        <span
          className={`text-xs font-semibold ${
            inspectorComplete && qsComplete
              ? 'text-certvoice-green'
              : 'text-certvoice-amber'
          }`}
        >
          {inspectorComplete && qsComplete
            ? 'Section G complete — both signatures captured'
            : inspectorComplete
              ? 'Inspector complete — QS signature required'
              : 'Inspector details and signature required'}
        </span>
      </div>
    </div>
  )
}
