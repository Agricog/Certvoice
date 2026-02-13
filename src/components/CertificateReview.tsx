/**
 * CertVoice — CertificateReview Component
 *
 * Full certificate review before PDF generation.
 * Shows all EICR sections with validation warnings.
 * Allows navigation to edit any section.
 */

import { useMemo } from 'react'
import {
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  XCircle,
  ChevronRight,
  FileText,
  User,
  Calendar,
  MapPin,
  Shield,
  Plug,
  Clipboard,
  Eye,
  Cable,
} from 'lucide-react'
import type { EICRCertificate } from '../types/eicr'
import { captureError } from '../utils/errorTracking'
import { trackCertificateCompleted } from '../utils/analytics'

// ============================================================
// TYPES
// ============================================================

interface CertificateReviewProps {
  certificate: EICRCertificate
  onNavigateToSection: (section: string) => void
  onGeneratePDF: () => void
}

interface SectionStatus {
  isComplete: boolean
  hasWarnings: boolean
  hasErrors: boolean
  completedFields: number
  totalFields: number
  warnings: string[]
  errors: string[]
}

interface ValidationResult {
  isValid: boolean
  canGenerate: boolean
  sections: {
    A: SectionStatus
    B: SectionStatus
    C: SectionStatus
    D: SectionStatus
    E: SectionStatus
    F: SectionStatus
    G: SectionStatus
    I: SectionStatus
    J: SectionStatus
    K: SectionStatus
    circuits: SectionStatus
    schedule: SectionStatus
  }
  overallWarnings: string[]
  overallErrors: string[]
}

const DEFAULT_SECTION_STATUS: SectionStatus = {
  isComplete: false,
  hasWarnings: false,
  hasErrors: false,
  completedFields: 0,
  totalFields: 1,
  warnings: [],
  errors: [],
}

// ============================================================
// VALIDATION HELPERS
// ============================================================

function validateCertificate(cert: EICRCertificate): ValidationResult {
  const overallWarnings: string[] = []
  const overallErrors: string[] = []

  // Section A: Client Details
  const sectionA: SectionStatus = {
    isComplete: false,
    hasWarnings: false,
    hasErrors: false,
    completedFields: 0,
    totalFields: 2,
    warnings: [],
    errors: [],
  }
  if (cert.clientDetails.clientName) sectionA.completedFields++
  if (cert.clientDetails.clientAddress) sectionA.completedFields++
  sectionA.isComplete = sectionA.completedFields === sectionA.totalFields
  if (!sectionA.isComplete) {
    sectionA.errors.push('Client details incomplete')
    sectionA.hasErrors = true
  }

  // Section B: Reason for Report
  const sectionB: SectionStatus = {
    isComplete: false,
    hasWarnings: false,
    hasErrors: false,
    completedFields: 0,
    totalFields: 2,
    warnings: [],
    errors: [],
  }
  if (cert.reportReason.purpose) sectionB.completedFields++
  if (cert.reportReason.inspectionDates.length > 0) sectionB.completedFields++
  sectionB.isComplete = sectionB.completedFields === sectionB.totalFields
  if (!sectionB.isComplete) {
    sectionB.errors.push('Report reason incomplete')
    sectionB.hasErrors = true
  }

  // Section C: Installation Details
  const sectionC: SectionStatus = {
    isComplete: false,
    hasWarnings: false,
    hasErrors: false,
    completedFields: 0,
    totalFields: 4,
    warnings: [],
    errors: [],
  }
  if (cert.installationDetails.installationAddress) sectionC.completedFields++
  if (cert.installationDetails.premisesType) sectionC.completedFields++
  if (cert.installationDetails.estimatedAgeOfWiring !== null) sectionC.completedFields++
  if (cert.installationDetails.occupier) sectionC.completedFields++
  sectionC.isComplete = sectionC.completedFields >= 3 // Allow occupier to be optional
  if (!cert.installationDetails.installationAddress) {
    sectionC.errors.push('Installation address required')
    sectionC.hasErrors = true
  }

  // Section D: Extent and Limitations
  const sectionD: SectionStatus = {
    isComplete: false,
    hasWarnings: false,
    hasErrors: false,
    completedFields: 0,
    totalFields: 3,
    warnings: [],
    errors: [],
  }
  if (cert.extentAndLimitations.extentCovered) sectionD.completedFields++
  if (cert.extentAndLimitations.agreedLimitations) sectionD.completedFields++
  if (cert.extentAndLimitations.agreedWith) sectionD.completedFields++
  sectionD.isComplete = sectionD.completedFields >= 2
  if (!cert.extentAndLimitations.extentCovered) {
    sectionD.warnings.push('Extent covered not specified')
    sectionD.hasWarnings = true
  }

  // Section E: Summary (auto-calculated)
  const sectionE: SectionStatus = {
    isComplete: true,
    hasWarnings: false,
    hasErrors: false,
    completedFields: 2,
    totalFields: 2,
    warnings: [],
    errors: [],
  }

  // Section F: Recommendations
  const sectionF: SectionStatus = {
    isComplete: false,
    hasWarnings: false,
    hasErrors: false,
    completedFields: 0,
    totalFields: 2,
    warnings: [],
    errors: [],
  }
  if (cert.recommendations.nextInspectionDate) sectionF.completedFields++
  if (cert.recommendations.reasonForInterval) sectionF.completedFields++
  sectionF.isComplete = sectionF.completedFields >= 1

  // Section G: Declaration
  const sectionG: SectionStatus = {
    isComplete: false,
    hasWarnings: false,
    hasErrors: false,
    completedFields: 0,
    totalFields: 5,
    warnings: [],
    errors: [],
  }
  if (cert.declaration.inspectorName) sectionG.completedFields++
  if (cert.declaration.companyName) sectionG.completedFields++
  if (cert.declaration.registrationNumber) sectionG.completedFields++
  if (cert.declaration.inspectorSignatureKey) sectionG.completedFields++
  if (cert.declaration.dateInspected) sectionG.completedFields++
  sectionG.isComplete = sectionG.completedFields >= 4
  if (!cert.declaration.inspectorSignatureKey) {
    sectionG.warnings.push('Inspector signature required')
    sectionG.hasWarnings = true
  }

  // Section I: Supply Characteristics
  const sectionI: SectionStatus = {
    isComplete: false,
    hasWarnings: false,
    hasErrors: false,
    completedFields: 0,
    totalFields: 6,
    warnings: [],
    errors: [],
  }
  if (cert.supplyCharacteristics.earthingType) sectionI.completedFields++
  if (cert.supplyCharacteristics.nominalVoltage) sectionI.completedFields++
  if (cert.supplyCharacteristics.ipf) sectionI.completedFields++
  if (cert.supplyCharacteristics.ze) sectionI.completedFields++
  if (cert.supplyCharacteristics.supplyDeviceRating) sectionI.completedFields++
  if (cert.supplyCharacteristics.conductorConfig) sectionI.completedFields++
  sectionI.isComplete = sectionI.completedFields >= 4
  if (!cert.supplyCharacteristics.earthingType) {
    sectionI.errors.push('Earthing type required')
    sectionI.hasErrors = true
  }
  if (cert.supplyCharacteristics.ze && cert.supplyCharacteristics.ze > 0.8) {
    sectionI.warnings.push(`Ze of ${cert.supplyCharacteristics.ze}Ω is high`)
    sectionI.hasWarnings = true
  }

  // Section J: Installation Particulars
  const sectionJ: SectionStatus = {
    isComplete: false,
    hasWarnings: false,
    hasErrors: false,
    completedFields: 0,
    totalFields: 6,
    warnings: [],
    errors: [],
  }
  if (cert.installationParticulars.mainSwitchLocation) sectionJ.completedFields++
  if (cert.installationParticulars.mainSwitchCurrentRating) sectionJ.completedFields++
  if (cert.installationParticulars.earthingConductorCsa) sectionJ.completedFields++
  if (cert.installationParticulars.earthingConductorVerified) sectionJ.completedFields++
  if (cert.installationParticulars.bondingConductorCsa) sectionJ.completedFields++
  if (cert.installationParticulars.bondingConductorVerified) sectionJ.completedFields++
  sectionJ.isComplete = sectionJ.completedFields >= 4

  // Section K: Observations
  const sectionK: SectionStatus = {
    isComplete: true, // Can have 0 observations
    hasWarnings: false,
    hasErrors: false,
    completedFields: cert.observations.length,
    totalFields: cert.observations.length || 1,
    warnings: [],
    errors: [],
  }
  const c1Count = cert.observations.filter((o) => o.classificationCode === 'C1').length
  const c2Count = cert.observations.filter((o) => o.classificationCode === 'C2').length
  const fiCount = cert.observations.filter((o) => o.classificationCode === 'FI').length
  if (c1Count > 0) {
    sectionK.errors.push(`${c1Count} C1 (Danger Present) observation(s)`)
    sectionK.hasErrors = true
    overallErrors.push(`C1 observations make certificate UNSATISFACTORY`)
  }
  if (c2Count > 0) {
    sectionK.warnings.push(`${c2Count} C2 (Potentially Dangerous) observation(s)`)
    sectionK.hasWarnings = true
    overallWarnings.push(`C2 observations make certificate UNSATISFACTORY`)
  }
  if (fiCount > 0) {
    sectionK.warnings.push(`${fiCount} FI (Further Investigation) observation(s)`)
    sectionK.hasWarnings = true
  }

  // Circuits
  const circuitsStatus: SectionStatus = {
    isComplete: cert.circuits.length > 0,
    hasWarnings: false,
    hasErrors: false,
    completedFields: cert.circuits.filter((c) => c.status !== 'INCOMPLETE').length,
    totalFields: cert.circuits.length || 1,
    warnings: [],
    errors: [],
  }
  if (cert.circuits.length === 0) {
    circuitsStatus.errors.push('No circuits recorded')
    circuitsStatus.hasErrors = true
  }
  const incompleteCircuits = cert.circuits.filter((c) => c.status === 'INCOMPLETE').length
  if (incompleteCircuits > 0) {
    circuitsStatus.warnings.push(`${incompleteCircuits} circuit(s) incomplete`)
    circuitsStatus.hasWarnings = true
  }

  // Inspection Schedule
  const scheduleStatus: SectionStatus = {
    isComplete: false,
    hasWarnings: false,
    hasErrors: false,
    completedFields: cert.inspectionSchedule.filter((i) => i.outcome !== null).length,
    totalFields: cert.inspectionSchedule.length || 1,
    warnings: [],
    errors: [],
  }
  scheduleStatus.isComplete = scheduleStatus.completedFields === scheduleStatus.totalFields
  if (cert.inspectionSchedule.length > 0 && scheduleStatus.completedFields < scheduleStatus.totalFields) {
    const remaining = scheduleStatus.totalFields - scheduleStatus.completedFields
    scheduleStatus.warnings.push(`${remaining} inspection item(s) not completed`)
    scheduleStatus.hasWarnings = true
  }

  // Determine if PDF can be generated
  const hasBlockingErrors = 
    sectionA.hasErrors || 
    sectionC.hasErrors || 
    sectionI.hasErrors ||
    circuitsStatus.hasErrors

  const isValid = !hasBlockingErrors
  const canGenerate = isValid && cert.circuits.length > 0

  return {
    isValid,
    canGenerate,
    sections: {
      A: sectionA,
      B: sectionB,
      C: sectionC,
      D: sectionD,
      E: sectionE,
      F: sectionF,
      G: sectionG,
      I: sectionI,
      J: sectionJ,
      K: sectionK,
      circuits: circuitsStatus,
      schedule: scheduleStatus,
    },
    overallWarnings,
    overallErrors,
  }
}

// ============================================================
// COMPONENT
// ============================================================

export default function CertificateReview({
  certificate,
  onNavigateToSection,
  onGeneratePDF,
}: CertificateReviewProps) {
  const validation = useMemo(() => validateCertificate(certificate), [certificate])

  // Calculate overall assessment
  const hasC1orC2 = certificate.observations.some(
    (o) => o.classificationCode === 'C1' || o.classificationCode === 'C2'
  )
  const hasFI = certificate.observations.some((o) => o.classificationCode === 'FI')
  const overallAssessment = hasC1orC2 || hasFI ? 'UNSATISFACTORY' : 'SATISFACTORY'

  // Handle PDF generation
  const handleGeneratePDF = () => {
    try {
      trackCertificateCompleted(
        certificate.circuits.length,
        certificate.observations.length,
        0 // Duration would be calculated from createdAt
      )
      onGeneratePDF()
    } catch (error) {
      captureError(error, 'CertificateReview.handleGeneratePDF')
    }
  }

  // ─── Render Section Card ────────────────────────────────────────────────
  const renderSectionCard = (
    sectionKey: string,
    title: string,
    subtitle: string,
    icon: React.ReactNode,
    status: SectionStatus
  ) => {
    const getStatusIcon = () => {
      if (status.hasErrors) {
        return <XCircle className="w-5 h-5 text-red-400" />
      }
      if (status.hasWarnings) {
        return <AlertTriangle className="w-5 h-5 text-amber-400" />
      }
      if (status.isComplete) {
        return <CheckCircle2 className="w-5 h-5 text-emerald-400" />
      }
      return <AlertCircle className="w-5 h-5 text-certvoice-muted" />
    }

    const getStatusColor = () => {
      if (status.hasErrors) return 'border-red-500/50'
      if (status.hasWarnings) return 'border-amber-500/50'
      if (status.isComplete) return 'border-emerald-500/50'
      return 'border-certvoice-border'
    }

    return (
      <button
        type="button"
        onClick={() => onNavigateToSection(sectionKey)}
        className={`w-full cv-panel !p-3 border ${getStatusColor()} hover:bg-certvoice-surface-2/50 transition-colors text-left`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-certvoice-accent">{icon}</span>
            <div>
              <div className="text-sm font-semibold text-certvoice-text">{title}</div>
              <div className="text-xs text-certvoice-muted">{subtitle}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-certvoice-muted">
              {status.completedFields}/{status.totalFields}
            </span>
            {getStatusIcon()}
            <ChevronRight className="w-4 h-4 text-certvoice-muted" />
          </div>
        </div>

        {/* Warnings/Errors */}
        {(status.warnings.length > 0 || status.errors.length > 0) && (
          <div className="mt-2 space-y-1">
            {status.errors.map((err, i) => (
              <div key={i} className="flex items-center gap-2 text-xs text-red-400">
                <XCircle className="w-3 h-3" />
                {err}
              </div>
            ))}
            {status.warnings.map((warn, i) => (
              <div key={i} className="flex items-center gap-2 text-xs text-amber-400">
                <AlertTriangle className="w-3 h-3" />
                {warn}
              </div>
            ))}
          </div>
        )}
      </button>
    )
  }

  // ─── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="cv-panel">
        <div className="flex items-center gap-3 mb-3">
          <Eye className="w-5 h-5 text-certvoice-accent" />
          <div>
            <h2 className="text-lg font-bold text-certvoice-text">Certificate Review</h2>
            <p className="text-xs text-certvoice-muted">
              Report #{certificate.reportNumber}
            </p>
          </div>
        </div>

        {/* Overall Assessment */}
        <div
          className={`p-4 rounded-lg border ${
            overallAssessment === 'SATISFACTORY'
              ? 'bg-emerald-500/10 border-emerald-500/50'
              : 'bg-red-500/10 border-red-500/50'
          }`}
        >
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs text-certvoice-muted uppercase tracking-wider">
                Overall Assessment
              </div>
              <div
                className={`text-xl font-bold ${
                  overallAssessment === 'SATISFACTORY' ? 'text-emerald-400' : 'text-red-400'
                }`}
              >
                {overallAssessment}
              </div>
            </div>
            {overallAssessment === 'SATISFACTORY' ? (
              <CheckCircle2 className="w-10 h-10 text-emerald-400" />
            ) : (
              <AlertCircle className="w-10 h-10 text-red-400" />
            )}
          </div>
        </div>

        {/* Overall Warnings/Errors */}
        {(validation.overallErrors.length > 0 || validation.overallWarnings.length > 0) && (
          <div className="mt-3 space-y-1">
            {validation.overallErrors.map((err, i) => (
              <div key={i} className="flex items-center gap-2 text-sm text-red-400">
                <XCircle className="w-4 h-4" />
                {err}
              </div>
            ))}
            {validation.overallWarnings.map((warn, i) => (
              <div key={i} className="flex items-center gap-2 text-sm text-amber-400">
                <AlertTriangle className="w-4 h-4" />
                {warn}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-3 gap-2">
        <div className="cv-panel !p-3 text-center">
          <div className="text-2xl font-bold text-certvoice-accent">
            {certificate.circuits.length}
          </div>
          <div className="text-[10px] text-certvoice-muted uppercase">Circuits</div>
        </div>
        <div className="cv-panel !p-3 text-center">
          <div className="text-2xl font-bold text-amber-400">
            {certificate.observations.length}
          </div>
          <div className="text-[10px] text-certvoice-muted uppercase">Observations</div>
        </div>
        <div className="cv-panel !p-3 text-center">
          <div className="text-2xl font-bold text-certvoice-text">
            {certificate.distributionBoards.length}
          </div>
          <div className="text-[10px] text-certvoice-muted uppercase">Boards</div>
        </div>
      </div>

      {/* Job Setup Sections (A-D) */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-certvoice-muted uppercase tracking-wider px-1">
          Job Setup
        </h3>
        {renderSectionCard(
          'A',
          'Section A — Client Details',
          certificate.clientDetails.clientName || 'Not entered',
          <User className="w-4 h-4" />,
          validation.sections['A']
        )}
        {renderSectionCard(
          'B',
          'Section B — Reason for Report',
          certificate.reportReason.purpose || 'Not selected',
          <Calendar className="w-4 h-4" />,
          validation.sections['B']
        )}
        {renderSectionCard(
          'C',
          'Section C — Installation Details',
          certificate.installationDetails.installationAddress || 'Not entered',
          <MapPin className="w-4 h-4" />,
          validation.sections['C']
        )}
        {renderSectionCard(
          'D',
          'Section D — Extent & Limitations',
          certificate.extentAndLimitations.agreedWith || 'Not specified',
          <FileText className="w-4 h-4" />,
          validation.sections['D']
        )}
      </div>

      {/* Supply & Installation (I-J) */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-certvoice-muted uppercase tracking-wider px-1">
          Supply & Installation
        </h3>
        {renderSectionCard(
          'I',
          'Section I — Supply Characteristics',
          certificate.supplyCharacteristics.earthingType?.replace('_', '-') || 'Not entered',
          <Shield className="w-4 h-4" />,
          validation.sections['I']
        )}
        {renderSectionCard(
          'J',
          'Section J — Installation Particulars',
          certificate.installationParticulars.mainSwitchLocation || 'Not entered',
          <Plug className="w-4 h-4" />,
          validation.sections['J']
        )}
      </div>

      {/* Inspection Data */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-certvoice-muted uppercase tracking-wider px-1">
          Inspection Data
        </h3>
        {renderSectionCard(
          'circuits',
          'Circuit Test Results',
          `${certificate.circuits.length} circuit(s) recorded`,
          <Cable className="w-4 h-4" />,
          validation.sections['circuits']
        )}
        {renderSectionCard(
          'K',
          'Section K — Observations',
          `${certificate.observations.length} observation(s)`,
          <AlertTriangle className="w-4 h-4" />,
          validation.sections['K']
        )}
        {renderSectionCard(
          'schedule',
          'Schedule of Inspections',
          `${validation.sections['schedule'].completedFields}/${validation.sections['schedule'].totalFields} items`,
          <Clipboard className="w-4 h-4" />,
          validation.sections['schedule']
        )}
      </div>

      {/* Declaration & Completion */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-certvoice-muted uppercase tracking-wider px-1">
          Declaration
        </h3>
        {renderSectionCard(
          'G',
          'Section G — Declaration',
          certificate.declaration.inspectorName || 'Not signed',
          <FileText className="w-4 h-4" />,
          validation.sections['G']
        )}
      </div>

      {/* Observations Summary */}
      {certificate.observations.length > 0 && (
        <div className="cv-panel">
          <h3 className="cv-section-title">Observations Summary</h3>
          <div className="space-y-2">
            {certificate.observations.map((obs) => (
              <div
                key={obs.id}
                className={`p-3 rounded-lg border ${
                  obs.classificationCode === 'C1'
                    ? 'bg-red-500/10 border-red-500/50'
                    : obs.classificationCode === 'C2'
                      ? 'bg-orange-500/10 border-orange-500/50'
                      : obs.classificationCode === 'C3'
                        ? 'bg-amber-500/10 border-amber-500/50'
                        : 'bg-purple-500/10 border-purple-500/50'
                }`}
              >
                <div className="flex items-start gap-2">
                  <span
                    className={`px-2 py-0.5 rounded text-xs font-bold ${
                      obs.classificationCode === 'C1'
                        ? 'bg-red-500/20 text-red-400'
                        : obs.classificationCode === 'C2'
                          ? 'bg-orange-500/20 text-orange-400'
                          : obs.classificationCode === 'C3'
                            ? 'bg-amber-500/20 text-amber-400'
                            : 'bg-purple-500/20 text-purple-400'
                    }`}
                  >
                    {obs.classificationCode}
                  </span>
                  <div className="flex-1">
                    <p className="text-sm text-certvoice-text">{obs.observationText}</p>
                    <div className="flex items-center gap-3 mt-1 text-xs text-certvoice-muted">
                      {obs.location && <span>📍 {obs.location}</span>}
                      {obs.regulationReference && <span>📖 {obs.regulationReference}</span>}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Generate PDF Button */}
      <div className="cv-panel">
        <button
          type="button"
          onClick={handleGeneratePDF}
          disabled={!validation.canGenerate}
          className={`w-full py-4 rounded-lg font-semibold text-white transition-all ${
            validation.canGenerate
              ? 'bg-gradient-to-r from-certvoice-accent to-emerald-500 hover:shadow-lg hover:shadow-certvoice-accent/25'
              : 'bg-certvoice-surface-2 text-certvoice-muted cursor-not-allowed'
          }`}
        >
          {validation.canGenerate ? (
            <span className="flex items-center justify-center gap-2">
              <FileText className="w-5 h-5" />
              Generate BS 7671 PDF
            </span>
          ) : (
            <span className="flex items-center justify-center gap-2">
              <AlertCircle className="w-5 h-5" />
              Complete Required Sections
            </span>
          )}
        </button>

        {!validation.canGenerate && (
          <p className="text-xs text-certvoice-muted text-center mt-2">
            Complete all required sections (marked with errors) before generating PDF
          </p>
        )}
      </div>
    </div>
  )
}
