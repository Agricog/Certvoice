// ============================================================
// src/pages/NewInspection.tsx
// CertVoice - Start New EICR Inspection (Sections A-D)
// Phase 3: Certificate Assembly - Item #28
// ============================================================
// Purpose: Capture job setup data for new EICR certificates
// - Section A: Person Ordering Report (client details)
// - Section B: Reason for Producing Report
// - Section C: Installation Details
// - Section D: Extent and Limitations
// ============================================================

import { useState, useCallback, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Helmet } from 'react-helmet-async'
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Calendar,
  Check,
  ChevronDown,
  ClipboardList,
  FileText,
  Home,
  Info,
  MapPin,
  Save,
  User,
  AlertTriangle,
  Zap,
} from 'lucide-react'
import { validateInput, type ValidationResult } from '../utils/validation'
import { sanitizeText, sanitizeFormData } from '../utils/sanitization'
import { captureError } from '../utils/errorTracking'
import { trackNewInspection } from '../utils/analytics'
import type {
  EICRCertificate,
  SectionA,
  SectionB,
  SectionC,
  SectionD,
  ReportPurpose,
  PremisesType,
} from '../types/eicr'

// ============================================================
// TYPES
// ============================================================

interface FormErrors {
  [key: string]: string
}

interface StepConfig {
  id: string
  title: string
  subtitle: string
  icon: React.ReactNode
}

type FormStep = 'A' | 'B' | 'C' | 'D' | 'review'

// ============================================================
// CONSTANTS
// ============================================================

const REPORT_PURPOSES: { value: ReportPurpose; label: string; description: string }[] = [
  { value: 'periodic', label: 'Periodic Inspection', description: 'Scheduled inspection (landlord requirement, commercial)' },
  { value: 'change_of_occupancy', label: 'Change of Occupancy', description: 'New tenant moving in' },
  { value: 'mortgage', label: 'Mortgage/Sale', description: 'Required for property sale or remortgage' },
  { value: 'insurance', label: 'Insurance', description: 'Required by insurance company' },
  { value: 'safety_concern', label: 'Safety Concern', description: 'Following incident or suspected fault' },
  { value: 'other', label: 'Other', description: 'Specify reason in notes' },
]

const PREMISES_TYPES: { value: PremisesType; label: string }[] = [
  { value: 'domestic', label: 'Domestic' },
  { value: 'commercial', label: 'Commercial' },
  { value: 'industrial', label: 'Industrial' },
  { value: 'other', label: 'Other' },
]

const STEPS: StepConfig[] = [
  { id: 'A', title: 'Client Details', subtitle: 'Section A: Person Ordering Report', icon: <User className="w-5 h-5" /> },
  { id: 'B', title: 'Report Reason', subtitle: 'Section B: Purpose of Inspection', icon: <ClipboardList className="w-5 h-5" /> },
  { id: 'C', title: 'Installation', subtitle: 'Section C: Property Details', icon: <Building2 className="w-5 h-5" /> },
  { id: 'D', title: 'Extent & Limits', subtitle: 'Section D: Scope of Inspection', icon: <FileText className="w-5 h-5" /> },
  { id: 'review', title: 'Review', subtitle: 'Confirm Details', icon: <Check className="w-5 h-5" /> },
]

const DEFAULT_EXTENT_COVERED = `100% of the electrical installation within the agreed limitations. This includes all accessible parts of the fixed electrical installation from the origin to all outlets and fixed current-using equipment.`

const DEFAULT_AGREED_LIMITATIONS = `• Inspection limited to visual examination and testing of accessible parts only
• Concealed cables and connections not inspected unless visible at accessories
• Equipment and appliances not included unless specifically agreed
• Testing did not include installed equipment loads
• Single-phase circuits only (unless stated otherwise)
• Roof spaces, cellars, and outbuildings not inspected unless accessible`

const DEFAULT_OPERATIONAL_LIMITATIONS = `• Live testing where safe and necessary
• Sampling applied to similar circuits where appropriate (details in remarks)
• Some circuits could not be isolated for testing without disruption`

// ============================================================
// HELPER FUNCTIONS
// ============================================================

function getTodayISO(): string {
  return new Date().toISOString().split('T')[0]
}

function formatDateForDisplay(isoDate: string): string {
  if (!isoDate) return ''
  try {
    const date = new Date(isoDate)
    return date.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
  } catch {
    return isoDate
  }
}

// ============================================================
// COMPONENT
// ============================================================

export default function NewInspection() {
  const navigate = useNavigate()

  // --------------------------------------------------------
  // STATE
  // --------------------------------------------------------

  const [currentStep, setCurrentStep] = useState<FormStep>('A')
  const [errors, setErrors] = useState<FormErrors>({})
  const [isSaving, setIsSaving] = useState(false)
  const [showLimitationsEditor, setShowLimitationsEditor] = useState(false)

  // Section A: Client Details
  const [sectionA, setSectionA] = useState<SectionA>({
    clientName: '',
    clientAddress: '',
    clientPostcode: '',
    clientPhone: '',
    clientEmail: '',
  })

  // Section B: Reason for Report
  const [sectionB, setSectionB] = useState<SectionB>({
    purpose: 'periodic',
    otherPurpose: '',
    inspectionDate: getTodayISO(),
    inspectionEndDate: '',
  })

  // Section C: Installation Details
  const [sectionC, setSectionC] = useState<SectionC>({
    installationAddress: '',
    installationPostcode: '',
    occupierName: '',
    occupierPhone: '',
    premisesType: 'domestic',
    otherPremisesDescription: '',
    estimatedAgeOfWiring: undefined,
    evidenceOfAdditions: false,
    additionsEstimatedAge: undefined,
    installationRecordsAvailable: false,
    previousInspectionDate: '',
  })

  // Section D: Extent and Limitations
  const [sectionD, setSectionD] = useState<SectionD>({
    extentCovered: DEFAULT_EXTENT_COVERED,
    agreedLimitations: DEFAULT_AGREED_LIMITATIONS,
    agreedWith: '',
    operationalLimitations: DEFAULT_OPERATIONAL_LIMITATIONS,
  })

  // Copy client address to installation address
  const [useClientAddress, setUseClientAddress] = useState(true)

  // --------------------------------------------------------
  // EFFECTS
  // --------------------------------------------------------

  // Sync installation address with client address if checkbox is checked
  useEffect(() => {
    if (useClientAddress) {
      setSectionC((prev) => ({
        ...prev,
        installationAddress: sectionA.clientAddress,
        installationPostcode: sectionA.clientPostcode,
      }))
    }
  }, [useClientAddress, sectionA.clientAddress, sectionA.clientPostcode])

  // --------------------------------------------------------
  // VALIDATION
  // --------------------------------------------------------

  const validateSectionA = useCallback((): boolean => {
    const newErrors: FormErrors = {}

    // Client name - required
    if (!sectionA.clientName.trim()) {
      newErrors.clientName = 'Client name is required'
    } else {
      const nameResult = validateInput(sectionA.clientName, 'text', 100)
      if (!nameResult.isValid) {
        newErrors.clientName = Object.values(nameResult.errors)[0] || 'Invalid name'
      }
    }

    // Client address - required
    if (!sectionA.clientAddress.trim()) {
      newErrors.clientAddress = 'Client address is required'
    }

    // Postcode - optional but validate format if provided
    if (sectionA.clientPostcode) {
      const postcodeResult = validateInput(sectionA.clientPostcode, 'postcode')
      if (!postcodeResult.isValid) {
        newErrors.clientPostcode = 'Invalid UK postcode format'
      }
    }

    // Email - optional but validate format if provided
    if (sectionA.clientEmail) {
      const emailResult = validateInput(sectionA.clientEmail, 'email')
      if (!emailResult.isValid) {
        newErrors.clientEmail = 'Invalid email format'
      }
    }

    // Phone - optional but validate if provided
    if (sectionA.clientPhone) {
      const phoneResult = validateInput(sectionA.clientPhone, 'phone')
      if (!phoneResult.isValid) {
        newErrors.clientPhone = 'Invalid phone number'
      }
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }, [sectionA])

  const validateSectionB = useCallback((): boolean => {
    const newErrors: FormErrors = {}

    // Inspection date - required
    if (!sectionB.inspectionDate) {
      newErrors.inspectionDate = 'Inspection date is required'
    }

    // If purpose is "other", require description
    if (sectionB.purpose === 'other' && !sectionB.otherPurpose?.trim()) {
      newErrors.otherPurpose = 'Please specify the reason for inspection'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }, [sectionB])

  const validateSectionC = useCallback((): boolean => {
    const newErrors: FormErrors = {}

    // Installation address - required
    if (!sectionC.installationAddress.trim()) {
      newErrors.installationAddress = 'Installation address is required'
    }

    // Postcode - optional but validate if provided
    if (sectionC.installationPostcode) {
      const postcodeResult = validateInput(sectionC.installationPostcode, 'postcode')
      if (!postcodeResult.isValid) {
        newErrors.installationPostcode = 'Invalid UK postcode format'
      }
    }

    // If "other" premises type, require description
    if (sectionC.premisesType === 'other' && !sectionC.otherPremisesDescription?.trim()) {
      newErrors.otherPremisesDescription = 'Please describe the premises type'
    }

    // If evidence of additions, should have estimated age
    if (sectionC.evidenceOfAdditions && !sectionC.additionsEstimatedAge) {
      newErrors.additionsEstimatedAge = 'Please estimate age of additions'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }, [sectionC])

  const validateSectionD = useCallback((): boolean => {
    const newErrors: FormErrors = {}

    // Extent covered - required
    if (!sectionD.extentCovered.trim()) {
      newErrors.extentCovered = 'Extent of inspection is required'
    }

    // Agreed with - required
    if (!sectionD.agreedWith.trim()) {
      newErrors.agreedWith = 'Name of person who agreed limitations is required'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }, [sectionD])

  const validateCurrentStep = useCallback((): boolean => {
    switch (currentStep) {
      case 'A':
        return validateSectionA()
      case 'B':
        return validateSectionB()
      case 'C':
        return validateSectionC()
      case 'D':
        return validateSectionD()
      case 'review':
        return true
      default:
        return false
    }
  }, [currentStep, validateSectionA, validateSectionB, validateSectionC, validateSectionD])

  // --------------------------------------------------------
  // NAVIGATION
  // --------------------------------------------------------

  const currentStepIndex = useMemo(() => {
    return STEPS.findIndex((s) => s.id === currentStep)
  }, [currentStep])

  const canGoBack = currentStepIndex > 0
  const canGoForward = currentStepIndex < STEPS.length - 1
  const isLastStep = currentStep === 'review'

  const goToNextStep = useCallback(() => {
    if (!validateCurrentStep()) return

    const nextIndex = currentStepIndex + 1
    if (nextIndex < STEPS.length) {
      setCurrentStep(STEPS[nextIndex].id as FormStep)
      setErrors({})
    }
  }, [currentStepIndex, validateCurrentStep])

  const goToPreviousStep = useCallback(() => {
    const prevIndex = currentStepIndex - 1
    if (prevIndex >= 0) {
      setCurrentStep(STEPS[prevIndex].id as FormStep)
      setErrors({})
    }
  }, [currentStepIndex])

  const goToStep = useCallback((stepId: FormStep) => {
    // Only allow going to previous steps or current step
    const targetIndex = STEPS.findIndex((s) => s.id === stepId)
    if (targetIndex <= currentStepIndex) {
      setCurrentStep(stepId)
      setErrors({})
    }
  }, [currentStepIndex])

  // --------------------------------------------------------
  // FORM SUBMISSION
  // --------------------------------------------------------

  const handleCreateInspection = useCallback(async () => {
    // Validate all sections
    const validA = validateSectionA()
    const validB = validateSectionB()
    const validC = validateSectionC()
    const validD = validateSectionD()

    if (!validA || !validB || !validC || !validD) {
      // Find first section with errors
      if (!validA) setCurrentStep('A')
      else if (!validB) setCurrentStep('B')
      else if (!validC) setCurrentStep('C')
      else if (!validD) setCurrentStep('D')
      return
    }

    setIsSaving(true)

    try {
      // Sanitize all form data
      const sanitizedA = sanitizeFormData(sectionA)
      const sanitizedB = sanitizeFormData(sectionB)
      const sanitizedC = sanitizeFormData(sectionC)
      const sanitizedD = sanitizeFormData(sectionD)

      // Create certificate object (will be saved to state/backend)
      const certificate: Partial<EICRCertificate> = {
        id: crypto.randomUUID(),
        reportNumber: `EICR-${Date.now()}`,
        status: 'draft',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        sectionA: sanitizedA as SectionA,
        sectionB: sanitizedB as SectionB,
        sectionC: sanitizedC as SectionC,
        sectionD: sanitizedD as SectionD,
        circuits: [],
        observations: [],
        inspectionSchedule: [],
        distributionBoards: [],
      }

      // Track analytics
      trackNewInspection({
        premisesType: sectionC.premisesType,
        purpose: sectionB.purpose,
      })

      // TODO: Save to backend/state management
      // For now, store in sessionStorage and navigate to capture page
      sessionStorage.setItem('certvoice_draft_certificate', JSON.stringify(certificate))

      // Navigate to inspection capture page
      navigate(`/inspection/${certificate.id}/capture`)
    } catch (error) {
      captureError(error, 'NewInspection.handleCreateInspection')
      setErrors({ submit: 'Failed to create inspection. Please try again.' })
    } finally {
      setIsSaving(false)
    }
  }, [sectionA, sectionB, sectionC, sectionD, validateSectionA, validateSectionB, validateSectionC, validateSectionD, navigate])

  // --------------------------------------------------------
  // INPUT HANDLERS
  // --------------------------------------------------------

  const handleInputChange = useCallback(
    <T extends SectionA | SectionB | SectionC | SectionD>(
      setter: React.Dispatch<React.SetStateAction<T>>,
      field: keyof T,
      value: string | number | boolean | undefined
    ) => {
      setter((prev) => ({ ...prev, [field]: value }))
      // Clear error for this field
      if (errors[field as string]) {
        setErrors((prev) => {
          const next = { ...prev }
          delete next[field as string]
          return next
        })
      }
    },
    [errors]
  )

  // --------------------------------------------------------
  // RENDER HELPERS
  // --------------------------------------------------------

  const renderStepIndicator = () => (
    <div className="flex items-center justify-between mb-8">
      {STEPS.map((step, index) => {
        const isActive = step.id === currentStep
        const isCompleted = index < currentStepIndex
        const isClickable = index <= currentStepIndex

        return (
          <button
            key={step.id}
            type="button"
            onClick={() => isClickable && goToStep(step.id as FormStep)}
            disabled={!isClickable}
            className={`
              flex items-center gap-2 px-3 py-2 rounded-lg transition-all
              ${isActive ? 'bg-accent/20 text-accent' : ''}
              ${isCompleted ? 'text-green-500' : ''}
              ${!isActive && !isCompleted ? 'text-text-muted' : ''}
              ${isClickable ? 'cursor-pointer hover:bg-surface-2' : 'cursor-not-allowed opacity-50'}
            `}
          >
            <div
              className={`
                w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold
                ${isActive ? 'bg-accent text-white' : ''}
                ${isCompleted ? 'bg-green-500 text-white' : ''}
                ${!isActive && !isCompleted ? 'bg-surface-2 text-text-muted' : ''}
              `}
            >
              {isCompleted ? <Check className="w-4 h-4" /> : index + 1}
            </div>
            <span className="hidden md:inline text-sm font-medium">{step.title}</span>
          </button>
        )
      })}
    </div>
  )

  const renderSectionA = () => (
    <div className="space-y-6">
      <div className="cv-section-title flex items-center gap-2">
        <User className="w-5 h-5 text-accent" />
        Section A: Person Ordering the Report
      </div>

      {/* Client Name */}
      <div className="space-y-2">
        <label htmlFor="clientName" className="block text-sm font-medium text-text">
          Client Name <span className="text-red-500">*</span>
        </label>
        <input
          id="clientName"
          type="text"
          value={sectionA.clientName}
          onChange={(e) => handleInputChange(setSectionA, 'clientName', e.target.value)}
          placeholder="e.g. Mr J Smith or ABC Lettings Ltd"
          className={`cv-input w-full ${errors.clientName ? 'border-red-500' : ''}`}
          aria-invalid={!!errors.clientName}
          aria-describedby={errors.clientName ? 'clientName-error' : undefined}
        />
        {errors.clientName && (
          <p id="clientName-error" className="text-red-500 text-sm flex items-center gap-1">
            <AlertTriangle className="w-4 h-4" />
            {errors.clientName}
          </p>
        )}
      </div>

      {/* Client Address */}
      <div className="space-y-2">
        <label htmlFor="clientAddress" className="block text-sm font-medium text-text">
          Client Address <span className="text-red-500">*</span>
        </label>
        <textarea
          id="clientAddress"
          value={sectionA.clientAddress}
          onChange={(e) => handleInputChange(setSectionA, 'clientAddress', e.target.value)}
          placeholder="Full postal address"
          rows={3}
          className={`cv-input w-full resize-none ${errors.clientAddress ? 'border-red-500' : ''}`}
          aria-invalid={!!errors.clientAddress}
        />
        {errors.clientAddress && (
          <p className="text-red-500 text-sm flex items-center gap-1">
            <AlertTriangle className="w-4 h-4" />
            {errors.clientAddress}
          </p>
        )}
      </div>

      {/* Client Postcode */}
      <div className="space-y-2">
        <label htmlFor="clientPostcode" className="block text-sm font-medium text-text">
          Postcode
        </label>
        <input
          id="clientPostcode"
          type="text"
          value={sectionA.clientPostcode || ''}
          onChange={(e) => handleInputChange(setSectionA, 'clientPostcode', e.target.value.toUpperCase())}
          placeholder="e.g. TR1 3BQ"
          className={`cv-input w-full max-w-[200px] uppercase ${errors.clientPostcode ? 'border-red-500' : ''}`}
        />
        {errors.clientPostcode && (
          <p className="text-red-500 text-sm flex items-center gap-1">
            <AlertTriangle className="w-4 h-4" />
            {errors.clientPostcode}
          </p>
        )}
      </div>

      {/* Contact Details Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <label htmlFor="clientPhone" className="block text-sm font-medium text-text">
            Phone Number
          </label>
          <input
            id="clientPhone"
            type="tel"
            value={sectionA.clientPhone || ''}
            onChange={(e) => handleInputChange(setSectionA, 'clientPhone', e.target.value)}
            placeholder="e.g. 07700 900123"
            className={`cv-input w-full ${errors.clientPhone ? 'border-red-500' : ''}`}
          />
          {errors.clientPhone && (
            <p className="text-red-500 text-sm">{errors.clientPhone}</p>
          )}
        </div>

        <div className="space-y-2">
          <label htmlFor="clientEmail" className="block text-sm font-medium text-text">
            Email Address
          </label>
          <input
            id="clientEmail"
            type="email"
            value={sectionA.clientEmail || ''}
            onChange={(e) => handleInputChange(setSectionA, 'clientEmail', e.target.value)}
            placeholder="e.g. client@example.com"
            className={`cv-input w-full ${errors.clientEmail ? 'border-red-500' : ''}`}
          />
          {errors.clientEmail && (
            <p className="text-red-500 text-sm">{errors.clientEmail}</p>
          )}
        </div>
      </div>
    </div>
  )

  const renderSectionB = () => (
    <div className="space-y-6">
      <div className="cv-section-title flex items-center gap-2">
        <ClipboardList className="w-5 h-5 text-accent" />
        Section B: Reason for Producing Report
      </div>

      {/* Purpose Selection */}
      <div className="space-y-3">
        <label className="block text-sm font-medium text-text">
          Purpose of Inspection <span className="text-red-500">*</span>
        </label>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {REPORT_PURPOSES.map((purpose) => (
            <button
              key={purpose.value}
              type="button"
              onClick={() => handleInputChange(setSectionB, 'purpose', purpose.value)}
              className={`
                p-4 rounded-lg border-2 text-left transition-all
                ${sectionB.purpose === purpose.value
                  ? 'border-accent bg-accent/10'
                  : 'border-border bg-surface hover:border-accent/50'}
              `}
            >
              <div className="font-medium text-text">{purpose.label}</div>
              <div className="text-sm text-text-muted mt-1">{purpose.description}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Other Purpose Description */}
      {sectionB.purpose === 'other' && (
        <div className="space-y-2">
          <label htmlFor="otherPurpose" className="block text-sm font-medium text-text">
            Specify Reason <span className="text-red-500">*</span>
          </label>
          <input
            id="otherPurpose"
            type="text"
            value={sectionB.otherPurpose || ''}
            onChange={(e) => handleInputChange(setSectionB, 'otherPurpose', e.target.value)}
            placeholder="Enter reason for inspection"
            className={`cv-input w-full ${errors.otherPurpose ? 'border-red-500' : ''}`}
          />
          {errors.otherPurpose && (
            <p className="text-red-500 text-sm flex items-center gap-1">
              <AlertTriangle className="w-4 h-4" />
              {errors.otherPurpose}
            </p>
          )}
        </div>
      )}

      {/* Inspection Date(s) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <label htmlFor="inspectionDate" className="block text-sm font-medium text-text">
            Inspection Date <span className="text-red-500">*</span>
          </label>
          <div className="relative">
            <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-text-muted" />
            <input
              id="inspectionDate"
              type="date"
              value={sectionB.inspectionDate}
              onChange={(e) => handleInputChange(setSectionB, 'inspectionDate', e.target.value)}
              className={`cv-input w-full pl-10 ${errors.inspectionDate ? 'border-red-500' : ''}`}
            />
          </div>
          {errors.inspectionDate && (
            <p className="text-red-500 text-sm">{errors.inspectionDate}</p>
          )}
        </div>

        <div className="space-y-2">
          <label htmlFor="inspectionEndDate" className="block text-sm font-medium text-text">
            End Date (if multi-day)
          </label>
          <div className="relative">
            <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-text-muted" />
            <input
              id="inspectionEndDate"
              type="date"
              value={sectionB.inspectionEndDate || ''}
              onChange={(e) => handleInputChange(setSectionB, 'inspectionEndDate', e.target.value)}
              min={sectionB.inspectionDate}
              className="cv-input w-full pl-10"
            />
          </div>
          <p className="text-xs text-text-muted">Leave blank for single-day inspections</p>
        </div>
      </div>
    </div>
  )

  const renderSectionC = () => (
    <div className="space-y-6">
      <div className="cv-section-title flex items-center gap-2">
        <Building2 className="w-5 h-5 text-accent" />
        Section C: Installation Details
      </div>

      {/* Use Client Address Toggle */}
      <label className="flex items-center gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={useClientAddress}
          onChange={(e) => setUseClientAddress(e.target.checked)}
          className="w-5 h-5 rounded border-border text-accent focus:ring-accent"
        />
        <span className="text-sm text-text">Installation address same as client address</span>
      </label>

      {/* Installation Address */}
      {!useClientAddress && (
        <>
          <div className="space-y-2">
            <label htmlFor="installationAddress" className="block text-sm font-medium text-text">
              Installation Address <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <MapPin className="absolute left-3 top-3 w-5 h-5 text-text-muted" />
              <textarea
                id="installationAddress"
                value={sectionC.installationAddress}
                onChange={(e) => handleInputChange(setSectionC, 'installationAddress', e.target.value)}
                placeholder="Address of property being inspected"
                rows={3}
                className={`cv-input w-full pl-10 resize-none ${errors.installationAddress ? 'border-red-500' : ''}`}
              />
            </div>
            {errors.installationAddress && (
              <p className="text-red-500 text-sm">{errors.installationAddress}</p>
            )}
          </div>

          <div className="space-y-2">
            <label htmlFor="installationPostcode" className="block text-sm font-medium text-text">
              Postcode
            </label>
            <input
              id="installationPostcode"
              type="text"
              value={sectionC.installationPostcode || ''}
              onChange={(e) => handleInputChange(setSectionC, 'installationPostcode', e.target.value.toUpperCase())}
              placeholder="e.g. TR1 3BQ"
              className={`cv-input w-full max-w-[200px] uppercase ${errors.installationPostcode ? 'border-red-500' : ''}`}
            />
          </div>
        </>
      )}

      {/* Occupier Details */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <label htmlFor="occupierName" className="block text-sm font-medium text-text">
            Occupier Name
          </label>
          <input
            id="occupierName"
            type="text"
            value={sectionC.occupierName || ''}
            onChange={(e) => handleInputChange(setSectionC, 'occupierName', e.target.value)}
            placeholder="e.g. Mrs Johnson"
            className="cv-input w-full"
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="occupierPhone" className="block text-sm font-medium text-text">
            Occupier Phone
          </label>
          <input
            id="occupierPhone"
            type="tel"
            value={sectionC.occupierPhone || ''}
            onChange={(e) => handleInputChange(setSectionC, 'occupierPhone', e.target.value)}
            placeholder="e.g. 07700 900456"
            className="cv-input w-full"
          />
        </div>
      </div>

      {/* Premises Type */}
      <div className="space-y-3">
        <label className="block text-sm font-medium text-text">
          Premises Description <span className="text-red-500">*</span>
        </label>
        <div className="flex flex-wrap gap-3">
          {PREMISES_TYPES.map((type) => (
            <button
              key={type.value}
              type="button"
              onClick={() => handleInputChange(setSectionC, 'premisesType', type.value)}
              className={`
                px-4 py-2 rounded-lg border-2 font-medium transition-all
                ${sectionC.premisesType === type.value
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-border bg-surface text-text hover:border-accent/50'}
              `}
            >
              {type.label}
            </button>
          ))}
        </div>
      </div>

      {/* Other Premises Description */}
      {sectionC.premisesType === 'other' && (
        <div className="space-y-2">
          <label htmlFor="otherPremisesDescription" className="block text-sm font-medium text-text">
            Describe Premises <span className="text-red-500">*</span>
          </label>
          <input
            id="otherPremisesDescription"
            type="text"
            value={sectionC.otherPremisesDescription || ''}
            onChange={(e) => handleInputChange(setSectionC, 'otherPremisesDescription', e.target.value)}
            placeholder="e.g. Church hall, Sports pavilion"
            className={`cv-input w-full ${errors.otherPremisesDescription ? 'border-red-500' : ''}`}
          />
          {errors.otherPremisesDescription && (
            <p className="text-red-500 text-sm">{errors.otherPremisesDescription}</p>
          )}
        </div>
      )}

      {/* Wiring Age */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <label htmlFor="estimatedAgeOfWiring" className="block text-sm font-medium text-text">
            Estimated Age of Wiring (years)
          </label>
          <input
            id="estimatedAgeOfWiring"
            type="number"
            min="0"
            max="100"
            value={sectionC.estimatedAgeOfWiring || ''}
            onChange={(e) => handleInputChange(setSectionC, 'estimatedAgeOfWiring', e.target.value ? parseInt(e.target.value, 10) : undefined)}
            placeholder="e.g. 20"
            className="cv-input w-full"
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="previousInspectionDate" className="block text-sm font-medium text-text">
            Date of Last Inspection
          </label>
          <input
            id="previousInspectionDate"
            type="date"
            value={sectionC.previousInspectionDate || ''}
            onChange={(e) => handleInputChange(setSectionC, 'previousInspectionDate', e.target.value)}
            max={getTodayISO()}
            className="cv-input w-full"
          />
        </div>
      </div>

      {/* Evidence of Additions */}
      <div className="space-y-4">
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={sectionC.evidenceOfAdditions}
            onChange={(e) => handleInputChange(setSectionC, 'evidenceOfAdditions', e.target.checked)}
            className="w-5 h-5 rounded border-border text-accent focus:ring-accent"
          />
          <span className="text-sm text-text">Evidence of additions or alterations</span>
        </label>

        {sectionC.evidenceOfAdditions && (
          <div className="space-y-2 ml-8">
            <label htmlFor="additionsEstimatedAge" className="block text-sm font-medium text-text">
              Estimated Age of Additions (years) <span className="text-red-500">*</span>
            </label>
            <input
              id="additionsEstimatedAge"
              type="number"
              min="0"
              max="100"
              value={sectionC.additionsEstimatedAge || ''}
              onChange={(e) => handleInputChange(setSectionC, 'additionsEstimatedAge', e.target.value ? parseInt(e.target.value, 10) : undefined)}
              placeholder="e.g. 5"
              className={`cv-input w-full max-w-[200px] ${errors.additionsEstimatedAge ? 'border-red-500' : ''}`}
            />
            {errors.additionsEstimatedAge && (
              <p className="text-red-500 text-sm">{errors.additionsEstimatedAge}</p>
            )}
          </div>
        )}
      </div>

      {/* Installation Records Available */}
      <label className="flex items-center gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={sectionC.installationRecordsAvailable}
          onChange={(e) => handleInputChange(setSectionC, 'installationRecordsAvailable', e.target.checked)}
          className="w-5 h-5 rounded border-border text-accent focus:ring-accent"
        />
        <span className="text-sm text-text">Previous installation records available</span>
      </label>
    </div>
  )

  const renderSectionD = () => (
    <div className="space-y-6">
      <div className="cv-section-title flex items-center gap-2">
        <FileText className="w-5 h-5 text-accent" />
        Section D: Extent and Limitations
      </div>

      <div className="cv-panel bg-amber-500/10 border-amber-500/30">
        <div className="flex items-start gap-3">
          <Info className="w-5 h-5 text-amber-500 mt-0.5 flex-shrink-0" />
          <div className="text-sm text-text">
            <strong>Important:</strong> This section defines the scope of your inspection and any limitations.
            These clauses are critical for liability protection. Standard templates are provided below.
          </div>
        </div>
      </div>

      {/* Extent Covered */}
      <div className="space-y-2">
        <label htmlFor="extentCovered" className="block text-sm font-medium text-text">
          Extent of Installation Covered <span className="text-red-500">*</span>
        </label>
        <textarea
          id="extentCovered"
          value={sectionD.extentCovered}
          onChange={(e) => handleInputChange(setSectionD, 'extentCovered', e.target.value)}
          rows={4}
          className={`cv-input w-full resize-none font-mono text-sm ${errors.extentCovered ? 'border-red-500' : ''}`}
        />
        {errors.extentCovered && (
          <p className="text-red-500 text-sm">{errors.extentCovered}</p>
        )}
      </div>

      {/* Agreed Limitations */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label htmlFor="agreedLimitations" className="block text-sm font-medium text-text">
            Agreed Limitations
          </label>
          <button
            type="button"
            onClick={() => setShowLimitationsEditor(!showLimitationsEditor)}
            className="text-sm text-accent hover:underline flex items-center gap-1"
          >
            <ChevronDown className={`w-4 h-4 transition-transform ${showLimitationsEditor ? 'rotate-180' : ''}`} />
            {showLimitationsEditor ? 'Hide' : 'Edit'}
          </button>
        </div>
        {showLimitationsEditor && (
          <textarea
            id="agreedLimitations"
            value={sectionD.agreedLimitations}
            onChange={(e) => handleInputChange(setSectionD, 'agreedLimitations', e.target.value)}
            rows={8}
            className="cv-input w-full resize-none font-mono text-sm"
          />
        )}
        {!showLimitationsEditor && (
          <div className="cv-panel bg-surface-2 text-sm text-text-muted font-mono whitespace-pre-wrap">
            {sectionD.agreedLimitations.slice(0, 200)}...
          </div>
        )}
      </div>

      {/* Agreed With */}
      <div className="space-y-2">
        <label htmlFor="agreedWith" className="block text-sm font-medium text-text">
          Limitations Agreed With <span className="text-red-500">*</span>
        </label>
        <input
          id="agreedWith"
          type="text"
          value={sectionD.agreedWith}
          onChange={(e) => handleInputChange(setSectionD, 'agreedWith', e.target.value)}
          placeholder="e.g. Mr Smith (site contact)"
          className={`cv-input w-full ${errors.agreedWith ? 'border-red-500' : ''}`}
        />
        {errors.agreedWith && (
          <p className="text-red-500 text-sm flex items-center gap-1">
            <AlertTriangle className="w-4 h-4" />
            {errors.agreedWith}
          </p>
        )}
      </div>

      {/* Operational Limitations */}
      <div className="space-y-2">
        <label htmlFor="operationalLimitations" className="block text-sm font-medium text-text">
          Operational Limitations
        </label>
        <textarea
          id="operationalLimitations"
          value={sectionD.operationalLimitations || ''}
          onChange={(e) => handleInputChange(setSectionD, 'operationalLimitations', e.target.value)}
          rows={4}
          placeholder="Any operational constraints during inspection..."
          className="cv-input w-full resize-none font-mono text-sm"
        />
        <p className="text-xs text-text-muted">
          Record anything that couldn't be tested and why (e.g. server room couldn't be isolated)
        </p>
      </div>
    </div>
  )

  const renderReview = () => (
    <div className="space-y-6">
      <div className="cv-section-title flex items-center gap-2">
        <Check className="w-5 h-5 text-green-500" />
        Review Before Starting Inspection
      </div>

      {/* Section A Summary */}
      <div className="cv-panel">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-text flex items-center gap-2">
            <User className="w-4 h-4 text-accent" />
            Section A: Client
          </h3>
          <button
            type="button"
            onClick={() => goToStep('A')}
            className="text-sm text-accent hover:underline"
          >
            Edit
          </button>
        </div>
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <dt className="text-text-muted">Name:</dt>
          <dd className="text-text">{sectionA.clientName}</dd>
          <dt className="text-text-muted">Address:</dt>
          <dd className="text-text">{sectionA.clientAddress}</dd>
          {sectionA.clientEmail && (
            <>
              <dt className="text-text-muted">Email:</dt>
              <dd className="text-text">{sectionA.clientEmail}</dd>
            </>
          )}
        </dl>
      </div>

      {/* Section B Summary */}
      <div className="cv-panel">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-text flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-accent" />
            Section B: Purpose
          </h3>
          <button
            type="button"
            onClick={() => goToStep('B')}
            className="text-sm text-accent hover:underline"
          >
            Edit
          </button>
        </div>
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <dt className="text-text-muted">Purpose:</dt>
          <dd className="text-text">
            {REPORT_PURPOSES.find((p) => p.value === sectionB.purpose)?.label}
            {sectionB.purpose === 'other' && `: ${sectionB.otherPurpose}`}
          </dd>
          <dt className="text-text-muted">Date:</dt>
          <dd className="text-text">
            {formatDateForDisplay(sectionB.inspectionDate)}
            {sectionB.inspectionEndDate && ` - ${formatDateForDisplay(sectionB.inspectionEndDate)}`}
          </dd>
        </dl>
      </div>

      {/* Section C Summary */}
      <div className="cv-panel">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-text flex items-center gap-2">
            <Building2 className="w-4 h-4 text-accent" />
            Section C: Installation
          </h3>
          <button
            type="button"
            onClick={() => goToStep('C')}
            className="text-sm text-accent hover:underline"
          >
            Edit
          </button>
        </div>
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <dt className="text-text-muted">Address:</dt>
          <dd className="text-text">{sectionC.installationAddress}</dd>
          <dt className="text-text-muted">Premises:</dt>
          <dd className="text-text capitalize">
            {sectionC.premisesType === 'other' ? sectionC.otherPremisesDescription : sectionC.premisesType}
          </dd>
          {sectionC.occupierName && (
            <>
              <dt className="text-text-muted">Occupier:</dt>
              <dd className="text-text">{sectionC.occupierName}</dd>
            </>
          )}
          {sectionC.estimatedAgeOfWiring && (
            <>
              <dt className="text-text-muted">Wiring Age:</dt>
              <dd className="text-text">~{sectionC.estimatedAgeOfWiring} years</dd>
            </>
          )}
        </dl>
      </div>

      {/* Section D Summary */}
      <div className="cv-panel">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-text flex items-center gap-2">
            <FileText className="w-4 h-4 text-accent" />
            Section D: Extent & Limitations
          </h3>
          <button
            type="button"
            onClick={() => goToStep('D')}
            className="text-sm text-accent hover:underline"
          >
            Edit
          </button>
        </div>
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <dt className="text-text-muted">Agreed with:</dt>
          <dd className="text-text">{sectionD.agreedWith}</dd>
        </dl>
        <p className="text-xs text-text-muted mt-3">
          Standard limitation clauses applied. Click Edit to review.
        </p>
      </div>

      {/* Ready to Start */}
      <div className="cv-panel bg-green-500/10 border-green-500/30">
        <div className="flex items-start gap-3">
          <Zap className="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0" />
          <div>
            <h4 className="font-semibold text-text">Ready to Start Inspection</h4>
            <p className="text-sm text-text-muted mt-1">
              Click "Start Inspection" to begin capturing test results, observations, and completing the inspection checklist.
            </p>
          </div>
        </div>
      </div>

      {errors.submit && (
        <div className="cv-panel bg-red-500/10 border-red-500/30">
          <p className="text-red-500 text-sm flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            {errors.submit}
          </p>
        </div>
      )}
    </div>
  )

  const renderCurrentStep = () => {
    switch (currentStep) {
      case 'A':
        return renderSectionA()
      case 'B':
        return renderSectionB()
      case 'C':
        return renderSectionC()
      case 'D':
        return renderSectionD()
      case 'review':
        return renderReview()
      default:
        return null
    }
  }

  // --------------------------------------------------------
  // MAIN RENDER
  // --------------------------------------------------------

  return (
    <>
      <Helmet>
        <title>New EICR Inspection | CertVoice</title>
        <meta name="description" content="Start a new EICR electrical inspection report" />
      </Helmet>

      <div className="min-h-screen bg-bg pb-24">
        {/* Header */}
        <header className="bg-surface border-b border-border sticky top-0 z-40">
          <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => navigate('/')}
                className="p-2 rounded-lg hover:bg-surface-2 text-text-muted"
                aria-label="Go back"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div>
                <h1 className="font-semibold text-text">New EICR Inspection</h1>
                <p className="text-sm text-text-muted">BS 7671:2018+A2:2022</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                // Save draft
                sessionStorage.setItem('certvoice_draft_newinspection', JSON.stringify({
                  sectionA,
                  sectionB,
                  sectionC,
                  sectionD,
                  currentStep,
                }))
              }}
              className="cv-btn-secondary flex items-center gap-2"
            >
              <Save className="w-4 h-4" />
              <span className="hidden sm:inline">Save Draft</span>
            </button>
          </div>
        </header>

        {/* Main Content */}
        <main className="max-w-4xl mx-auto px-4 py-6">
          {/* Step Indicator */}
          {renderStepIndicator()}

          {/* Current Step Content */}
          <div className="cv-panel">
            {renderCurrentStep()}
          </div>
        </main>

        {/* Navigation Footer */}
        <footer className="fixed bottom-0 left-0 right-0 bg-surface border-t border-border">
          <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
            <button
              type="button"
              onClick={goToPreviousStep}
              disabled={!canGoBack}
              className="cv-btn-secondary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </button>

            <div className="text-sm text-text-muted">
              Step {currentStepIndex + 1} of {STEPS.length}
            </div>

            {isLastStep ? (
              <button
                type="button"
                onClick={handleCreateInspection}
                disabled={isSaving}
                className="cv-btn-primary flex items-center gap-2 disabled:opacity-50"
              >
                {isSaving ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Zap className="w-4 h-4" />
                    Start Inspection
                  </>
                )}
              </button>
            ) : (
              <button
                type="button"
                onClick={goToNextStep}
                className="cv-btn-primary flex items-center gap-2"
              >
                Continue
                <ArrowRight className="w-4 h-4" />
              </button>
            )}
          </div>
        </footer>
      </div>
    </>
  )
}
