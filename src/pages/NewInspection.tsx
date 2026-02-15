/**
 * CertVoice — NewInspection Page
 *
 * Multi-step wizard for starting a new EICR inspection.
 * Captures Sections A-D before moving to the main capture workflow.
 *
 * Steps:
 *   1. Section A: Client Details
 *   2. Section B: Reason for Report
 *   3. Section C: Installation Details
 *   4. Section D: Extent & Limitations
 *   5. Review & Create
 *
 * On completion, creates a new EICRCertificate in DRAFT status
 * and navigates to InspectionCapture.
 */

import { useState, useCallback } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Helmet } from 'react-helmet-async'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  User,
  FileText,
  Building2,
  ClipboardList,
  AlertTriangle,
  Zap,
} from 'lucide-react'
import type {
  EICRCertificate,
  ClientDetails,
  ReportReason,
  InstallationDetails,
  ExtentAndLimitations,
  ReportPurpose,
  PremisesType,
  CertificateStatus,
} from '../types/eicr'
import { validateInput } from '../utils/validation'
import { sanitizeText as _sanitizeText } from '../utils/sanitization'
const sanitizeText = (input: string): string => String(_sanitizeText(input) ?? '')
import { captureError } from '../utils/errorTracking'
import { trackCertificateCreated } from '../utils/analytics'

// ============================================================
// CONSTANTS
// ============================================================

const REPORT_PURPOSES: { value: ReportPurpose; label: string }[] = [
  { value: 'PERIODIC', label: 'Periodic Inspection' },
  { value: 'CHANGE_OF_OCCUPANCY', label: 'Change of Occupancy' },
  { value: 'MORTGAGE', label: 'Mortgage / Sale' },
  { value: 'INSURANCE', label: 'Insurance' },
  { value: 'SAFETY_CONCERN', label: 'Safety Concern' },
  { value: 'OTHER', label: 'Other' },
]

const PREMISES_TYPES: { value: PremisesType; label: string }[] = [
  { value: 'DOMESTIC', label: 'Domestic' },
  { value: 'COMMERCIAL', label: 'Commercial' },
  { value: 'INDUSTRIAL', label: 'Industrial' },
  { value: 'OTHER', label: 'Other' },
]

const STEPS = [
  { label: 'Client', icon: User },
  { label: 'Reason', icon: FileText },
  { label: 'Installation', icon: Building2 },
  { label: 'Extent', icon: ClipboardList },
  { label: 'Review', icon: Check },
] as const

const DEFAULT_EXTENT =
  '100% of the installation within the agreed limitations. ' +
  'The inspection covered all accessible parts of the fixed electrical installation.'

const DEFAULT_LIMITATIONS =
  'Inspection limited to visual examination and testing of accessible parts of the installation. ' +
  'Concealed cables not inspected unless damage or defects were suspected. ' +
  'Consumer\'s equipment and appliances were not inspected.'

// ============================================================
// COMPONENT
// ============================================================

export default function NewInspection() {
  const navigate = useNavigate()
  const [currentStep, setCurrentStep] = useState(0)
  const [errors, setErrors] = useState<Record<string, string>>({})

  // --- Section A: Client Details ---
  const [clientDetails, setClientDetails] = useState<ClientDetails>({
    clientName: '',
    clientAddress: '',
  })

  // --- Section B: Reason for Report ---
  const [reportReason, setReportReason] = useState<ReportReason>({
    purpose: 'PERIODIC',
    inspectionDates: [new Date().toISOString().split('T')[0] ?? ''],
  })

  // --- Section C: Installation Details ---
  const [installationDetails, setInstallationDetails] = useState<InstallationDetails>({
    installationAddress: '',
    occupier: '',
    premisesType: 'DOMESTIC',
    otherDescription: '',
    estimatedAgeOfWiring: null,
    evidenceOfAdditions: false,
    additionsEstimatedAge: null,
    installationRecordsAvailable: false,
    dateOfLastInspection: null,
  })

  // --- Section D: Extent & Limitations ---
  const [extentAndLimitations, setExtentAndLimitations] = useState<ExtentAndLimitations>({
    extentCovered: DEFAULT_EXTENT,
    agreedLimitations: DEFAULT_LIMITATIONS,
    agreedWith: '',
    operationalLimitations: '',
  })

  // ============================================================
  // VALIDATION
  // ============================================================

  const validateStep = useCallback((step: number): boolean => {
    const newErrors: Record<string, string> = {}

    switch (step) {
      case 0: {
        // Section A
        if (!clientDetails.clientName.trim()) {
          newErrors.clientName = 'Client name is required'
        }
        if (!clientDetails.clientAddress.trim()) {
          newErrors.clientAddress = 'Client address is required'
        }
        const nameResult = validateInput(clientDetails.clientName, 'text', 200)
        if (!nameResult.isValid) {
          newErrors.clientName = Object.values(nameResult.errors)[0] ?? 'Invalid input'
        }
        break
      }
      case 1: {
        // Section B
        if (!reportReason.purpose) {
          newErrors.purpose = 'Select a reason'
        }
        if (reportReason.inspectionDates.length === 0 || !reportReason.inspectionDates[0]) {
          newErrors.inspectionDate = 'Inspection date is required'
        }
        break
      }
      case 2: {
        // Section C
        if (!installationDetails.installationAddress.trim()) {
          newErrors.installationAddress = 'Installation address is required'
        }
        if (!installationDetails.premisesType) {
          newErrors.premisesType = 'Select premises type'
        }
        if (installationDetails.premisesType === 'OTHER' && !installationDetails.otherDescription?.trim()) {
          newErrors.otherDescription = 'Please describe the premises'
        }
        break
      }
      case 3: {
        // Section D
        if (!extentAndLimitations.extentCovered.trim()) {
          newErrors.extentCovered = 'Extent of inspection is required'
        }
        if (!extentAndLimitations.agreedLimitations.trim()) {
          newErrors.agreedLimitations = 'Agreed limitations are required'
        }
        break
      }
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }, [clientDetails, reportReason, installationDetails, extentAndLimitations])

  // ============================================================
  // NAVIGATION
  // ============================================================

  const handleNext = useCallback(() => {
    if (!validateStep(currentStep)) return
    setCurrentStep((prev) => Math.min(prev + 1, STEPS.length - 1))
  }, [currentStep, validateStep])

  const handleBack = useCallback(() => {
    setErrors({})
    setCurrentStep((prev) => Math.max(prev - 1, 0))
  }, [])

  const handleStepClick = useCallback(
    (step: number) => {
      // Only allow going back, or to current step
      if (step <= currentStep) {
        setErrors({})
        setCurrentStep(step)
      }
    },
    [currentStep]
  )

  // ============================================================
  // CREATE CERTIFICATE
  // ============================================================

  const handleCreate = useCallback(() => {
    try {
      const status: CertificateStatus = 'DRAFT'
      const now = new Date().toISOString()

      const certificate: Partial<EICRCertificate> = {
        id: crypto.randomUUID(),
        reportNumber: `CV-${Date.now().toString(36).toUpperCase()}`,
        status,
        clientDetails: {
          clientName: sanitizeText(clientDetails.clientName) ?? '',
          clientAddress: sanitizeText(clientDetails.clientAddress) ?? '',
        },
        reportReason: {
          purpose: reportReason.purpose,
          inspectionDates: reportReason.inspectionDates,
        },
        installationDetails: {
          installationAddress: sanitizeText(installationDetails.installationAddress) ?? '',
          occupier: sanitizeText(installationDetails.occupier) ?? '',
          premisesType: installationDetails.premisesType,
          otherDescription: installationDetails.otherDescription
            ? sanitizeText(installationDetails.otherDescription)
            : undefined,
          estimatedAgeOfWiring: installationDetails.estimatedAgeOfWiring,
          evidenceOfAdditions: installationDetails.evidenceOfAdditions,
          additionsEstimatedAge: installationDetails.additionsEstimatedAge,
          installationRecordsAvailable: installationDetails.installationRecordsAvailable,
          dateOfLastInspection: installationDetails.dateOfLastInspection,
        },
        extentAndLimitations: {
          extentCovered: sanitizeText(extentAndLimitations.extentCovered) ?? '',
          agreedLimitations: sanitizeText(extentAndLimitations.agreedLimitations) ?? '',
          agreedWith: sanitizeText(extentAndLimitations.agreedWith) ?? '',
          operationalLimitations: sanitizeText(extentAndLimitations.operationalLimitations) ?? '',
        },
        observations: [],
        distributionBoards: [],
        circuits: [],
        inspectionSchedule: [],
        createdAt: now,
        updatedAt: now,
        pdfKey: null,
        syncStatus: 'PENDING',
      }

      trackCertificateCreated(installationDetails.premisesType)

      // TODO: Save to database via API
      // For now, pass via navigation state
      navigate('/inspection/capture', { state: { certificate } })
    } catch (error) {
      captureError(error, 'NewInspection.handleCreate')
    }
  }, [clientDetails, reportReason, installationDetails, extentAndLimitations, navigate])

  // ============================================================
  // FIELD HELPERS
  // ============================================================

  const renderError = (field: string) => {
    if (!errors[field]) return null
    return (
      <p className="flex items-center gap-1 text-xs text-certvoice-red mt-1" role="alert">
        <AlertTriangle className="w-3 h-3" />
        {errors[field]}
      </p>
    )
  }

  const inputClass = (field: string) =>
    `w-full bg-certvoice-bg border rounded-lg px-3 py-2.5 text-sm text-certvoice-text
     placeholder:text-certvoice-muted/50 outline-none transition-colors
     ${errors[field] ? 'border-certvoice-red' : 'border-certvoice-border focus:border-certvoice-accent'}`

  // ============================================================
  // RENDER: STEP INDICATOR
  // ============================================================

  const renderStepIndicator = () => (
    <div className="flex items-center justify-between mb-6">
      {STEPS.map((step, index) => {
        const StepIcon = step.icon
        const isActive = index === currentStep
        const isComplete = index < currentStep

        return (
          <button
            key={step.label}
            type="button"
            onClick={() => handleStepClick(index)}
            className={`flex flex-col items-center gap-1 transition-colors ${
              isActive
                ? 'text-certvoice-accent'
                : isComplete
                  ? 'text-certvoice-green cursor-pointer'
                  : 'text-certvoice-muted/50'
            }`}
            disabled={index > currentStep}
          >
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center border-2 transition-colors ${
                isActive
                  ? 'border-certvoice-accent bg-certvoice-accent/15'
                  : isComplete
                    ? 'border-certvoice-green bg-certvoice-green/15'
                    : 'border-certvoice-border bg-certvoice-surface-2'
              }`}
            >
              {isComplete ? (
                <Check className="w-3.5 h-3.5" />
              ) : (
                <StepIcon className="w-3.5 h-3.5" />
              )}
            </div>
            <span className="text-[10px] font-semibold uppercase tracking-wider">
              {step.label}
            </span>
          </button>
        )
      })}
    </div>
  )

  // ============================================================
  // RENDER: STEP 0 — Section A (Client Details)
  // ============================================================

  const renderSectionA = () => (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-certvoice-text">Section A — Client Details</h2>
        <p className="text-xs text-certvoice-muted mt-1">Person ordering the report</p>
      </div>

      <div>
        <label className="cv-data-label" htmlFor="clientName">Client Name *</label>
        <input
          id="clientName"
          type="text"
          value={clientDetails.clientName}
          onChange={(e) => setClientDetails((prev) => ({ ...prev, clientName: e.target.value }))}
          placeholder="e.g. Mr J Smith"
          className={inputClass('clientName')}
          aria-invalid={!!errors.clientName}
        />
        {renderError('clientName')}
      </div>

      <div>
        <label className="cv-data-label" htmlFor="clientAddress">Client Address *</label>
        <textarea
          id="clientAddress"
          value={clientDetails.clientAddress}
          onChange={(e) => setClientDetails((prev) => ({ ...prev, clientAddress: e.target.value }))}
          placeholder="Full postal address with postcode"
          rows={3}
          className={inputClass('clientAddress')}
          aria-invalid={!!errors.clientAddress}
        />
        {renderError('clientAddress')}
      </div>
    </div>
  )

  // ============================================================
  // RENDER: STEP 1 — Section B (Reason for Report)
  // ============================================================

  const renderSectionB = () => (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-certvoice-text">Section B — Reason for Report</h2>
        <p className="text-xs text-certvoice-muted mt-1">Why this inspection is being carried out</p>
      </div>

      <div>
        <label className="cv-data-label">Purpose of Inspection *</label>
        <div className="grid grid-cols-2 gap-2 mt-2">
          {REPORT_PURPOSES.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => setReportReason((prev) => ({ ...prev, purpose: p.value }))}
              className={`px-3 py-2.5 rounded-lg text-xs font-semibold border transition-colors text-left ${
                reportReason.purpose === p.value
                  ? 'bg-certvoice-accent/15 border-certvoice-accent text-certvoice-accent'
                  : 'bg-certvoice-surface-2 border-certvoice-border text-certvoice-muted hover:border-certvoice-muted'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        {renderError('purpose')}
      </div>

      <div>
        <label className="cv-data-label" htmlFor="inspectionDate">Date of Inspection *</label>
        <input
          id="inspectionDate"
          type="date"
          value={reportReason.inspectionDates[0] ?? ''}
          onChange={(e) =>
            setReportReason((prev) => ({
              ...prev,
              inspectionDates: [e.target.value],
            }))
          }
          className={inputClass('inspectionDate')}
          aria-invalid={!!errors.inspectionDate}
        />
        {renderError('inspectionDate')}
      </div>
    </div>
  )

  // ============================================================
  // RENDER: STEP 2 — Section C (Installation Details)
  // ============================================================

  const renderSectionC = () => (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-certvoice-text">Section C — Installation Details</h2>
        <p className="text-xs text-certvoice-muted mt-1">Details of the property being inspected</p>
      </div>

      <div>
        <label className="cv-data-label" htmlFor="installationAddress">Installation Address *</label>
        <textarea
          id="installationAddress"
          value={installationDetails.installationAddress}
          onChange={(e) =>
            setInstallationDetails((prev) => ({ ...prev, installationAddress: e.target.value }))
          }
          placeholder="Address of property being inspected"
          rows={3}
          className={inputClass('installationAddress')}
          aria-invalid={!!errors.installationAddress}
        />
        {renderError('installationAddress')}
        <button
          type="button"
          onClick={() =>
            setInstallationDetails((prev) => ({
              ...prev,
              installationAddress: clientDetails.clientAddress,
            }))
          }
          className="text-xs text-certvoice-accent hover:underline mt-1"
        >
          Same as client address
        </button>
      </div>

      <div>
        <label className="cv-data-label" htmlFor="occupier">Occupier</label>
        <input
          id="occupier"
          type="text"
          value={installationDetails.occupier}
          onChange={(e) =>
            setInstallationDetails((prev) => ({ ...prev, occupier: e.target.value }))
          }
          placeholder="Name of current occupier"
          className={inputClass('occupier')}
        />
      </div>

      <div>
        <label className="cv-data-label">Premises Type *</label>
        <div className="flex gap-2 mt-2">
          {PREMISES_TYPES.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() =>
                setInstallationDetails((prev) => ({ ...prev, premisesType: p.value }))
              }
              className={`flex-1 px-3 py-2.5 rounded-lg text-xs font-semibold border transition-colors ${
                installationDetails.premisesType === p.value
                  ? 'bg-certvoice-accent/15 border-certvoice-accent text-certvoice-accent'
                  : 'bg-certvoice-surface-2 border-certvoice-border text-certvoice-muted hover:border-certvoice-muted'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        {renderError('premisesType')}
      </div>

      {installationDetails.premisesType === 'OTHER' && (
        <div>
          <label className="cv-data-label" htmlFor="otherDescription">Description *</label>
          <input
            id="otherDescription"
            type="text"
            value={installationDetails.otherDescription ?? ''}
            onChange={(e) =>
              setInstallationDetails((prev) => ({ ...prev, otherDescription: e.target.value }))
            }
            placeholder="e.g. Church hall, School"
            className={inputClass('otherDescription')}
            aria-invalid={!!errors.otherDescription}
          />
          {renderError('otherDescription')}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="cv-data-label" htmlFor="wiringAge">Est. Wiring Age</label>
          <div className="flex items-center gap-2">
            <input
              id="wiringAge"
              type="number"
              value={installationDetails.estimatedAgeOfWiring ?? ''}
              onChange={(e) =>
                setInstallationDetails((prev) => ({
                  ...prev,
                  estimatedAgeOfWiring: e.target.value ? Number(e.target.value) : null,
                }))
              }
              placeholder="20"
              className={inputClass('wiringAge')}
            />
            <span className="text-xs text-certvoice-muted shrink-0">years</span>
          </div>
        </div>
        <div>
          <label className="cv-data-label" htmlFor="lastInspection">Last Inspection</label>
          <input
            id="lastInspection"
            type="date"
            value={installationDetails.dateOfLastInspection ?? ''}
            onChange={(e) =>
              setInstallationDetails((prev) => ({
                ...prev,
                dateOfLastInspection: e.target.value || null,
              }))
            }
            className={inputClass('lastInspection')}
          />
        </div>
      </div>

      <div className="space-y-3">
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={installationDetails.evidenceOfAdditions}
            onChange={(e) =>
              setInstallationDetails((prev) => ({
                ...prev,
                evidenceOfAdditions: e.target.checked,
              }))
            }
            className="w-4 h-4 rounded border-certvoice-border"
          />
          <span className="text-sm text-certvoice-text">Evidence of additions/alterations</span>
        </label>

        {installationDetails.evidenceOfAdditions && (
          <div className="ml-7">
            <label className="cv-data-label" htmlFor="additionsAge">Additions Est. Age</label>
            <div className="flex items-center gap-2">
              <input
                id="additionsAge"
                type="number"
                value={installationDetails.additionsEstimatedAge ?? ''}
                onChange={(e) =>
                  setInstallationDetails((prev) => ({
                    ...prev,
                    additionsEstimatedAge: e.target.value ? Number(e.target.value) : null,
                  }))
                }
                placeholder="5"
                className={inputClass('additionsAge')}
              />
              <span className="text-xs text-certvoice-muted shrink-0">years</span>
            </div>
          </div>
        )}

        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={installationDetails.installationRecordsAvailable}
            onChange={(e) =>
              setInstallationDetails((prev) => ({
                ...prev,
                installationRecordsAvailable: e.target.checked,
              }))
            }
            className="w-4 h-4 rounded border-certvoice-border"
          />
          <span className="text-sm text-certvoice-text">Previous installation records available</span>
        </label>
      </div>
    </div>
  )

  // ============================================================
  // RENDER: STEP 3 — Section D (Extent & Limitations)
  // ============================================================

  const renderSectionD = () => (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-certvoice-text">Section D — Extent &amp; Limitations</h2>
        <p className="text-xs text-certvoice-muted mt-1">
          Critical for liability — defines scope of inspection
        </p>
      </div>

      <div>
        <label className="cv-data-label" htmlFor="extentCovered">Extent Covered *</label>
        <textarea
          id="extentCovered"
          value={extentAndLimitations.extentCovered}
          onChange={(e) =>
            setExtentAndLimitations((prev) => ({ ...prev, extentCovered: e.target.value }))
          }
          rows={3}
          className={inputClass('extentCovered')}
          aria-invalid={!!errors.extentCovered}
        />
        {renderError('extentCovered')}
      </div>

      <div>
        <label className="cv-data-label" htmlFor="agreedLimitations">Agreed Limitations *</label>
        <textarea
          id="agreedLimitations"
          value={extentAndLimitations.agreedLimitations}
          onChange={(e) =>
            setExtentAndLimitations((prev) => ({ ...prev, agreedLimitations: e.target.value }))
          }
          rows={4}
          className={inputClass('agreedLimitations')}
          aria-invalid={!!errors.agreedLimitations}
        />
        {renderError('agreedLimitations')}
      </div>

      <div>
        <label className="cv-data-label" htmlFor="agreedWith">Agreed With</label>
        <input
          id="agreedWith"
          type="text"
          value={extentAndLimitations.agreedWith}
          onChange={(e) =>
            setExtentAndLimitations((prev) => ({ ...prev, agreedWith: e.target.value }))
          }
          placeholder="Name of person who agreed limitations"
          className={inputClass('agreedWith')}
        />
      </div>

      <div>
        <label className="cv-data-label" htmlFor="operationalLimitations">Operational Limitations</label>
        <textarea
          id="operationalLimitations"
          value={extentAndLimitations.operationalLimitations}
          onChange={(e) =>
            setExtentAndLimitations((prev) => ({
              ...prev,
              operationalLimitations: e.target.value,
            }))
          }
          placeholder="e.g. Could not isolate main switch due to server room"
          rows={2}
          className={inputClass('operationalLimitations')}
        />
      </div>
    </div>
  )

  // ============================================================
  // RENDER: STEP 4 — Review
  // ============================================================

  const renderReview = () => {
    const purposeLabel =
      REPORT_PURPOSES.find((p) => p.value === reportReason.purpose)?.label ?? reportReason.purpose
    const premisesLabel =
      PREMISES_TYPES.find((p) => p.value === installationDetails.premisesType)?.label ??
      installationDetails.premisesType

    return (
      <div className="space-y-4">
        <div>
          <h2 className="text-base font-semibold text-certvoice-text">Review &amp; Create</h2>
          <p className="text-xs text-certvoice-muted mt-1">
            Check details before starting the inspection
          </p>
        </div>

        {/* Section A Summary */}
        <div className="cv-panel space-y-2">
          <div className="flex items-center justify-between">
            <span className="cv-section-title !mb-0">A: Client Details</span>
            <button
              type="button"
              onClick={() => setCurrentStep(0)}
              className="text-xs text-certvoice-accent hover:underline"
            >
              Edit
            </button>
          </div>
          <div className="grid grid-cols-1 gap-1">
            <div className="cv-data-field">
              <div className="cv-data-label">Client</div>
              <div className="cv-data-value">{clientDetails.clientName || '—'}</div>
            </div>
            <div className="cv-data-field">
              <div className="cv-data-label">Address</div>
              <div className="cv-data-value text-xs">{clientDetails.clientAddress || '—'}</div>
            </div>
          </div>
        </div>

        {/* Section B Summary */}
        <div className="cv-panel space-y-2">
          <div className="flex items-center justify-between">
            <span className="cv-section-title !mb-0">B: Reason</span>
            <button
              type="button"
              onClick={() => setCurrentStep(1)}
              className="text-xs text-certvoice-accent hover:underline"
            >
              Edit
            </button>
          </div>
          <div className="grid grid-cols-2 gap-1">
            <div className="cv-data-field">
              <div className="cv-data-label">Purpose</div>
              <div className="cv-data-value">{purposeLabel}</div>
            </div>
            <div className="cv-data-field">
              <div className="cv-data-label">Date</div>
              <div className="cv-data-value">{reportReason.inspectionDates[0] ?? '—'}</div>
            </div>
          </div>
        </div>

        {/* Section C Summary */}
        <div className="cv-panel space-y-2">
          <div className="flex items-center justify-between">
            <span className="cv-section-title !mb-0">C: Installation</span>
            <button
              type="button"
              onClick={() => setCurrentStep(2)}
              className="text-xs text-certvoice-accent hover:underline"
            >
              Edit
            </button>
          </div>
          <div className="grid grid-cols-2 gap-1">
            <div className="cv-data-field col-span-2">
              <div className="cv-data-label">Address</div>
              <div className="cv-data-value text-xs">
                {installationDetails.installationAddress || '—'}
              </div>
            </div>
            <div className="cv-data-field">
              <div className="cv-data-label">Premises</div>
              <div className="cv-data-value">{premisesLabel}</div>
            </div>
            <div className="cv-data-field">
              <div className="cv-data-label">Wiring Age</div>
              <div className="cv-data-value">
                {installationDetails.estimatedAgeOfWiring !== null
                  ? `~${installationDetails.estimatedAgeOfWiring} years`
                  : '—'}
              </div>
            </div>
          </div>
        </div>

        {/* Section D Summary */}
        <div className="cv-panel space-y-2">
          <div className="flex items-center justify-between">
            <span className="cv-section-title !mb-0">D: Extent</span>
            <button
              type="button"
              onClick={() => setCurrentStep(3)}
              className="text-xs text-certvoice-accent hover:underline"
            >
              Edit
            </button>
          </div>
          <div className="cv-data-field">
            <div className="cv-data-label">Agreed With</div>
            <div className="cv-data-value">{extentAndLimitations.agreedWith || '—'}</div>
          </div>
        </div>
      </div>
    )
  }

  // ============================================================
  // RENDER: MAIN
  // ============================================================

  const stepRenderers = [renderSectionA, renderSectionB, renderSectionC, renderSectionD, renderReview]
  const CurrentStepRenderer = stepRenderers[currentStep]

  return (
    <>
      <Helmet>
        <title>New Inspection | CertVoice</title>
        <meta name="description" content="Start a new EICR electrical inspection" />
      </Helmet>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Link
            to="/"
            className="w-8 h-8 rounded-lg border border-certvoice-border flex items-center justify-center
                       text-certvoice-muted hover:text-certvoice-text hover:border-certvoice-muted transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <h1 className="text-lg font-bold text-certvoice-text flex items-center gap-2">
              <Zap className="w-5 h-5 text-certvoice-accent" />
              New EICR Inspection
            </h1>
            <p className="text-xs text-certvoice-muted">
              Step {currentStep + 1} of {STEPS.length}
            </p>
          </div>
        </div>

        {/* Step Indicator */}
        {renderStepIndicator()}

        {/* Step Content */}
        <div className="cv-panel">
          {CurrentStepRenderer ? <CurrentStepRenderer /> : null}
        </div>

        {/* Navigation Buttons */}
        <div className="flex gap-3">
          {currentStep > 0 && (
            <button
              type="button"
              onClick={handleBack}
              className="cv-btn-secondary flex items-center justify-center gap-2 px-6"
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </button>
          )}

          {currentStep < STEPS.length - 1 ? (
            <button
              type="button"
              onClick={handleNext}
              className="cv-btn-primary flex-1 flex items-center justify-center gap-2"
            >
              Next
              <ArrowRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleCreate}
              className="cv-btn-primary flex-1 flex items-center justify-center gap-2"
            >
              <Zap className="w-4 h-4" />
              Start Inspection
            </button>
          )}
        </div>
      </div>
    </>
  )
}
