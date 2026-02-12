import { useState, useMemo, useCallback } from 'react';
import {
  FileCheck,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronUp,
  Download,
  Send,
  Eye,
  AlertCircle,
  Clock,
  User,
  Building,
  Zap,
  Shield,
  ClipboardCheck,
  ListChecks,
  FileText,
  Loader2,
  ExternalLink,
} from 'lucide-react';
import { captureError } from '../utils/errorTracking';
import { trackCertificateEvent } from '../utils/analytics';
import type {
  EICRCertificate,
  Circuit,
  Observation,
  InspectionItem,
  DistributionBoard,
  ClassificationCode,
} from '../types/eicr';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ValidationWarning {
  section: string;
  field: string;
  message: string;
  severity: 'error' | 'warning';
}

interface SectionStatus {
  id: string;
  label: string;
  sectionRef: string;
  filled: number;
  total: number;
  warnings: ValidationWarning[];
}

interface CertificateReviewProps {
  certificate: EICRCertificate;
  circuits: Circuit[];
  observations: Observation[];
  inspectionItems: Record<string, InspectionItem>;
  distributionBoards: DistributionBoard[];
  onNavigateToSection: (sectionId: string) => void;
  onGeneratePDF: () => Promise<void>;
  onSendToClient?: () => Promise<void>;
  isGenerating?: boolean;
  isSending?: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function hasValue(val: unknown): boolean {
  if (val === null || val === undefined) return false;
  if (typeof val === 'string') return val.trim().length > 0;
  if (typeof val === 'number') return true;
  if (typeof val === 'boolean') return true;
  return false;
}

function getCodeBadgeClass(code: ClassificationCode): string {
  switch (code) {
    case 'C1': return 'cv-code-c1';
    case 'C2': return 'cv-code-c2';
    case 'C3': return 'cv-code-c3';
    case 'FI': return 'cv-code-fi';
    default: return '';
  }
}

function getCodeLabel(code: ClassificationCode): string {
  switch (code) {
    case 'C1': return 'C1 — Danger Present';
    case 'C2': return 'C2 — Potentially Dangerous';
    case 'C3': return 'C3 — Improvement Recommended';
    case 'FI': return 'FI — Further Investigation';
    default: return code;
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function CertificateReview({
  certificate,
  circuits,
  observations,
  inspectionItems,
  distributionBoards,
  onNavigateToSection,
  onGeneratePDF,
  onSendToClient,
  isGenerating = false,
  isSending = false,
}: CertificateReviewProps): JSX.Element {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [showAllWarnings, setShowAllWarnings] = useState<boolean>(false);

  const toggleSection = useCallback((id: string): void => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // ─── Compute Overall Assessment ──────────────────────────────────────────

  const overallAssessment = useMemo((): 'SATISFACTORY' | 'UNSATISFACTORY' | 'INCOMPLETE' => {
    if (observations.length === 0 && circuits.length === 0) return 'INCOMPLETE';

    const hasC1orC2 = observations.some(
      (o) => o.code === 'C1' || o.code === 'C2'
    );
    const hasFI = observations.some((o) => o.code === 'FI');

    if (hasC1orC2 || hasFI) return 'UNSATISFACTORY';
    return 'SATISFACTORY';
  }, [observations, circuits]);

  // ─── Compute Observation Summary ─────────────────────────────────────────

  const observationSummary = useMemo(() => {
    const counts: Record<ClassificationCode, number> = { C1: 0, C2: 0, C3: 0, FI: 0 };
    observations.forEach((o) => {
      if (o.code && counts[o.code] !== undefined) {
        counts[o.code]++;
      }
    });
    return counts;
  }, [observations]);

  // ─── Compute Section Statuses ────────────────────────────────────────────

  const sectionStatuses = useMemo((): SectionStatus[] => {
    const statuses: SectionStatus[] = [];

    // Section A: Client
    {
      const w: ValidationWarning[] = [];
      let f = 0;
      const t = 2;
      if (hasValue(certificate.clientName)) f++; else w.push({ section: 'A', field: 'Client Name', message: 'Client name is required', severity: 'error' });
      if (hasValue(certificate.clientAddress)) f++; else w.push({ section: 'A', field: 'Client Address', message: 'Client address is required', severity: 'error' });
      statuses.push({ id: 'client', label: 'Client Details', sectionRef: 'A', filled: f, total: t, warnings: w });
    }

    // Section B: Reason
    {
      const w: ValidationWarning[] = [];
      let f = 0;
      const t = 2;
      if (hasValue(certificate.purpose)) f++; else w.push({ section: 'B', field: 'Purpose', message: 'Inspection purpose is required', severity: 'error' });
      if (hasValue(certificate.inspectionDate)) f++; else w.push({ section: 'B', field: 'Date', message: 'Inspection date is required', severity: 'error' });
      statuses.push({ id: 'reason', label: 'Reason for Report', sectionRef: 'B', filled: f, total: t, warnings: w });
    }

    // Section C: Installation
    {
      const w: ValidationWarning[] = [];
      let f = 0;
      const t = 5;
      if (hasValue(certificate.installationAddress)) f++; else w.push({ section: 'C', field: 'Address', message: 'Installation address is required', severity: 'error' });
      if (hasValue(certificate.premisesType)) f++; else w.push({ section: 'C', field: 'Premises Type', message: 'Premises type is required', severity: 'error' });
      if (hasValue(certificate.estimatedAgeOfWiring)) f++;
      if (hasValue(certificate.evidenceOfAdditions)) f++;
      if (hasValue(certificate.dateOfLastInspection)) f++;
      statuses.push({ id: 'installation', label: 'Installation Details', sectionRef: 'C', filled: f, total: t, warnings: w });
    }

    // Section D: Extent & Limitations
    {
      const w: ValidationWarning[] = [];
      let f = 0;
      const t = 3;
      if (hasValue(certificate.extentCovered)) f++; else w.push({ section: 'D', field: 'Extent', message: 'Extent of inspection is required', severity: 'error' });
      if (hasValue(certificate.agreedLimitations)) f++; else w.push({ section: 'D', field: 'Limitations', message: 'Agreed limitations must be recorded', severity: 'warning' });
      if (hasValue(certificate.operationalLimitations)) f++;
      statuses.push({ id: 'extent', label: 'Extent & Limitations', sectionRef: 'D', filled: f, total: t, warnings: w });
    }

    // Section E: Summary (auto-calculated)
    {
      const w: ValidationWarning[] = [];
      const f = overallAssessment !== 'INCOMPLETE' ? 1 : 0;
      if (overallAssessment === 'INCOMPLETE') {
        w.push({ section: 'E', field: 'Assessment', message: 'No circuits or observations recorded yet', severity: 'error' });
      }
      statuses.push({ id: 'summary', label: 'Summary / Assessment', sectionRef: 'E', filled: f, total: 1, warnings: w });
    }

    // Section I: Supply
    {
      const w: ValidationWarning[] = [];
      let f = 0;
      const t = 6;
      const s = certificate.supply;
      if (s) {
        if (hasValue(s.earthingType)) f++; else w.push({ section: 'I', field: 'Earthing Type', message: 'Earthing type is required', severity: 'error' });
        if (hasValue(s.nominalVoltage)) f++;
        if (hasValue(s.nominalFrequency)) f++;
        if (hasValue(s.ze)) f++; else w.push({ section: 'I', field: 'Ze', message: 'Ze measurement is required', severity: 'warning' });
        if (hasValue(s.ipf)) f++; else w.push({ section: 'I', field: 'Ipf', message: 'PFC is required', severity: 'warning' });
        if (hasValue(s.supplyFuseRating)) f++;
      } else {
        w.push({ section: 'I', field: 'Supply', message: 'Supply characteristics not recorded', severity: 'error' });
      }
      statuses.push({ id: 'supply', label: 'Supply Characteristics', sectionRef: 'I', filled: f, total: t, warnings: w });
    }

    // Section J: Particulars
    {
      const w: ValidationWarning[] = [];
      let f = 0;
      const t = 5;
      const p = certificate.particulars;
      if (p) {
        if (hasValue(p.mainSwitchLocation)) f++;
        if (hasValue(p.mainSwitchRating)) f++; else w.push({ section: 'J', field: 'Main Switch', message: 'Main switch rating is required', severity: 'warning' });
        if (hasValue(p.meansOfEarthing)) f++;
        if (hasValue(p.earthingConductorCsa)) f++;
        if (hasValue(p.bondingConductorCsa)) f++;
      } else {
        w.push({ section: 'J', field: 'Particulars', message: 'Installation particulars not recorded', severity: 'error' });
      }
      statuses.push({ id: 'particulars', label: 'Installation Particulars', sectionRef: 'J', filled: f, total: t, warnings: w });
    }

    // Section K: Observations
    {
      const w: ValidationWarning[] = [];
      const f = observations.length;
      const t = Math.max(observations.length, 1);
      observations.forEach((obs, i) => {
        if (!hasValue(obs.text)) {
          w.push({ section: 'K', field: `Obs #${i + 1}`, message: 'Observation text is empty', severity: 'error' });
        }
        if (!obs.code) {
          w.push({ section: 'K', field: `Obs #${i + 1}`, message: 'Classification code missing', severity: 'error' });
        }
      });
      statuses.push({ id: 'observations', label: 'Observations', sectionRef: 'K', filled: f, total: t, warnings: w });
    }

    // Inspection Schedule
    {
      const w: ValidationWarning[] = [];
      const totalExpected = 70;
      const completed = Object.values(inspectionItems).filter((item) => item.outcome).length;
      if (completed < totalExpected * 0.5) {
        w.push({ section: 'Sched.', field: 'Completion', message: `Only ${completed} of ~${totalExpected} items completed`, severity: 'warning' });
      }
      statuses.push({ id: 'schedule', label: 'Inspection Schedule', sectionRef: 'Sched.', filled: completed, total: totalExpected, warnings: w });
    }

    // Test Results
    {
      const w: ValidationWarning[] = [];
      const f = circuits.length;
      const t = Math.max(circuits.length, 1);
      if (circuits.length === 0) {
        w.push({ section: 'Tests', field: 'Circuits', message: 'No circuit test results recorded', severity: 'error' });
      }
      circuits.forEach((c, i) => {
        if (!hasValue(c.zs) && !hasValue(c.r1r2)) {
          w.push({ section: 'Tests', field: `Circuit ${c.circuitNumber ?? i + 1}`, message: 'No test readings recorded', severity: 'warning' });
        }
      });
      statuses.push({ id: 'circuits', label: 'Test Results', sectionRef: 'Tests', filled: f, total: t, warnings: w });
    }

    return statuses;
  }, [certificate, circuits, observations, inspectionItems, overallAssessment]);

  // ─── Aggregate Warnings ──────────────────────────────────────────────────

  const allWarnings = useMemo((): ValidationWarning[] => {
    return sectionStatuses.flatMap((s) => s.warnings);
  }, [sectionStatuses]);

  const errorCount = useMemo(
    () => allWarnings.filter((w) => w.severity === 'error').length,
    [allWarnings]
  );

  const warningCount = useMemo(
    () => allWarnings.filter((w) => w.severity === 'warning').length,
    [allWarnings]
  );

  const canGenerate = errorCount === 0;

  // ─── Overall Completion ──────────────────────────────────────────────────

  const overallCompletion = useMemo(() => {
    const totalFilled = sectionStatuses.reduce((acc, s) => acc + s.filled, 0);
    const totalRequired = sectionStatuses.reduce((acc, s) => acc + s.total, 0);
    return totalRequired > 0 ? Math.round((totalFilled / totalRequired) * 100) : 0;
  }, [sectionStatuses]);

  // ─── PDF Handler ─────────────────────────────────────────────────────────

  const handleGeneratePDF = useCallback(async (): Promise<void> => {
    if (!canGenerate || isGenerating) return;
    try {
      trackCertificateEvent('pdf_generate_start', certificate.id ?? 'draft');
      await onGeneratePDF();
      trackCertificateEvent('pdf_generate_success', certificate.id ?? 'draft');
    } catch (err) {
      captureError(err, 'CertificateReview.handleGeneratePDF');
      trackCertificateEvent('pdf_generate_error', certificate.id ?? 'draft');
    }
  }, [canGenerate, isGenerating, onGeneratePDF, certificate.id]);

  const handleSendToClient = useCallback(async (): Promise<void> => {
    if (!canGenerate || isSending || !onSendToClient) return;
    try {
      trackCertificateEvent('pdf_send_start', certificate.id ?? 'draft');
      await onSendToClient();
      trackCertificateEvent('pdf_send_success', certificate.id ?? 'draft');
    } catch (err) {
      captureError(err, 'CertificateReview.handleSendToClient');
    }
  }, [canGenerate, isSending, onSendToClient, certificate.id]);

  // ─── Section Icon ────────────────────────────────────────────────────────

  const getSectionIcon = (id: string): JSX.Element => {
    const iconMap: Record<string, JSX.Element> = {
      client: <User className="w-4 h-4" />,
      reason: <FileText className="w-4 h-4" />,
      installation: <Building className="w-4 h-4" />,
      extent: <ListChecks className="w-4 h-4" />,
      summary: <FileCheck className="w-4 h-4" />,
      supply: <Zap className="w-4 h-4" />,
      particulars: <Shield className="w-4 h-4" />,
      observations: <AlertTriangle className="w-4 h-4" />,
      schedule: <ClipboardCheck className="w-4 h-4" />,
      circuits: <Zap className="w-4 h-4" />,
    };
    return iconMap[id] ?? <FileText className="w-4 h-4" />;
  };

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* ─── Overall Assessment Banner ──────────────────────────────────── */}
      <div
        className={`cv-panel p-5 border-l-4 ${
          overallAssessment === 'SATISFACTORY'
            ? 'border-l-cv-green'
            : overallAssessment === 'UNSATISFACTORY'
            ? 'border-l-cv-red'
            : 'border-l-cv-amber'
        }`}
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-base font-bold text-cv-text flex items-center gap-2">
              <FileCheck className="w-5 h-5 text-cv-accent" />
              Certificate Review
            </h2>
            <p className="text-xs text-cv-text-muted mt-1">
              Review all sections before generating the BS 7671-compliant PDF
            </p>
          </div>
          <div className="text-right">
            <span className="text-2xl font-bold font-mono text-cv-text">
              {overallCompletion}%
            </span>
            <p className="text-[10px] text-cv-text-muted uppercase tracking-wider">
              Complete
            </p>
          </div>
        </div>

        {/* Overall Assessment */}
        <div className="mt-4 flex items-center gap-3">
          <div
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-bold ${
              overallAssessment === 'SATISFACTORY'
                ? 'bg-cv-green/15 text-cv-green'
                : overallAssessment === 'UNSATISFACTORY'
                ? 'bg-cv-red/15 text-cv-red'
                : 'bg-cv-amber/15 text-cv-amber'
            }`}
          >
            {overallAssessment === 'SATISFACTORY' ? (
              <CheckCircle2 className="w-5 h-5" />
            ) : overallAssessment === 'UNSATISFACTORY' ? (
              <XCircle className="w-5 h-5" />
            ) : (
              <Clock className="w-5 h-5" />
            )}
            {overallAssessment}
          </div>
        </div>

        {/* Observation code summary */}
        {observations.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3">
            {(Object.entries(observationSummary) as [ClassificationCode, number][])
              .filter(([, count]) => count > 0)
              .map(([code, count]) => (
                <span key={code} className={`${getCodeBadgeClass(code)} px-2.5 py-1 rounded text-xs font-bold`}>
                  {code}: {count}
                </span>
              ))}
            <span className="text-xs text-cv-text-muted self-center ml-1">
              {observations.length} total observation{observations.length !== 1 ? 's' : ''}
            </span>
          </div>
        )}

        {/* Progress bar */}
        <div className="w-full bg-cv-border rounded-full h-2 mt-4">
          <div
            className={`h-2 rounded-full transition-all duration-500 ${
              overallCompletion === 100
                ? 'bg-cv-green'
                : overallCompletion > 60
                ? 'bg-cv-accent'
                : 'bg-cv-amber'
            }`}
            style={{ width: `${overallCompletion}%` }}
          />
        </div>
      </div>

      {/* ─── Warnings Summary ───────────────────────────────────────────── */}
      {allWarnings.length > 0 && (
        <div className="cv-panel p-4">
          <button
            type="button"
            onClick={() => setShowAllWarnings(!showAllWarnings)}
            className="w-full flex items-center justify-between"
            aria-expanded={showAllWarnings}
          >
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-cv-amber" />
              <span className="text-sm font-semibold text-cv-text">
                {errorCount > 0 && (
                  <span className="text-cv-red mr-2">{errorCount} error{errorCount !== 1 ? 's' : ''}</span>
                )}
                {warningCount > 0 && (
                  <span className="text-cv-amber">{warningCount} warning{warningCount !== 1 ? 's' : ''}</span>
                )}
              </span>
            </div>
            {showAllWarnings ? (
              <ChevronUp className="w-4 h-4 text-cv-text-muted" />
            ) : (
              <ChevronDown className="w-4 h-4 text-cv-text-muted" />
            )}
          </button>

          {showAllWarnings && (
            <div className="mt-3 space-y-1.5">
              {allWarnings.map((w, i) => (
                <div
                  key={`${w.section}-${w.field}-${i}`}
                  className={`flex items-start gap-2 px-3 py-2 rounded-lg text-xs ${
                    w.severity === 'error'
                      ? 'bg-cv-red/10 text-cv-red'
                      : 'bg-cv-amber/10 text-cv-amber'
                  }`}
                >
                  {w.severity === 'error' ? (
                    <XCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                  ) : (
                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                  )}
                  <div>
                    <span className="font-bold">Section {w.section}</span>
                    <span className="mx-1">·</span>
                    <span>{w.message}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ─── Section-by-Section Review ──────────────────────────────────── */}
      <div className="space-y-2">
        {sectionStatuses.map((status) => {
          const isExpanded = expandedSections.has(status.id);
          const isComplete = status.filled >= status.total && status.warnings.length === 0;
          const hasErrors = status.warnings.some((w) => w.severity === 'error');
          const pct = status.total > 0 ? Math.round((status.filled / status.total) * 100) : 0;

          return (
            <div key={status.id} className="cv-panel overflow-hidden">
              <button
                type="button"
                onClick={() => toggleSection(status.id)}
                className="w-full flex items-center justify-between p-4 text-left hover:bg-cv-surface-2/30 transition-colors"
                aria-expanded={isExpanded}
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div
                    className={`p-1.5 rounded-lg ${
                      isComplete
                        ? 'bg-cv-green/15 text-cv-green'
                        : hasErrors
                        ? 'bg-cv-red/15 text-cv-red'
                        : 'bg-cv-accent/15 text-cv-accent'
                    }`}
                  >
                    {getSectionIcon(status.id)}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono font-bold text-cv-text-muted">
                        {status.sectionRef}
                      </span>
                      <h3 className="text-sm font-semibold text-cv-text truncate">
                        {status.label}
                      </h3>
                    </div>
                    {/* Mini progress bar */}
                    <div className="w-24 bg-cv-border rounded-full h-1 mt-1.5">
                      <div
                        className={`h-1 rounded-full transition-all ${
                          isComplete ? 'bg-cv-green' : hasErrors ? 'bg-cv-red' : 'bg-cv-accent'
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0 ml-3">
                  {status.warnings.length > 0 && (
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                        hasErrors ? 'bg-cv-red/15 text-cv-red' : 'bg-cv-amber/15 text-cv-amber'
                      }`}
                    >
                      {status.warnings.length}
                    </span>
                  )}
                  <span className="text-xs font-mono text-cv-text-muted">
                    {status.filled}/{status.total}
                  </span>
                  {isComplete ? (
                    <CheckCircle2 className="w-4 h-4 text-cv-green" />
                  ) : isExpanded ? (
                    <ChevronUp className="w-4 h-4 text-cv-text-muted" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-cv-text-muted" />
                  )}
                </div>
              </button>

              {isExpanded && (
                <div className="px-4 pb-4 border-t border-cv-border/50">
                  {/* Section-specific detail */}
                  {status.id === 'client' && (
                    <div className="pt-3 space-y-2">
                      <DataRow label="Client Name" value={certificate.clientName} />
                      <DataRow label="Client Address" value={certificate.clientAddress} />
                    </div>
                  )}

                  {status.id === 'reason' && (
                    <div className="pt-3 space-y-2">
                      <DataRow label="Purpose" value={certificate.purpose} />
                      <DataRow label="Inspection Date" value={certificate.inspectionDate} />
                    </div>
                  )}

                  {status.id === 'installation' && (
                    <div className="pt-3 space-y-2">
                      <DataRow label="Address" value={certificate.installationAddress} />
                      <DataRow label="Premises Type" value={certificate.premisesType} />
                      <DataRow label="Wiring Age (est.)" value={certificate.estimatedAgeOfWiring ? `${certificate.estimatedAgeOfWiring} years` : undefined} />
                      <DataRow label="Additions" value={certificate.evidenceOfAdditions !== undefined ? (certificate.evidenceOfAdditions ? 'Yes' : 'No') : undefined} />
                    </div>
                  )}

                  {status.id === 'extent' && (
                    <div className="pt-3 space-y-2">
                      <DataRow label="Extent" value={certificate.extentCovered} long />
                      <DataRow label="Limitations" value={certificate.agreedLimitations} long />
                      <DataRow label="Operational" value={certificate.operationalLimitations} long />
                    </div>
                  )}

                  {status.id === 'summary' && (
                    <div className="pt-3 space-y-2">
                      <DataRow
                        label="Overall Assessment"
                        value={overallAssessment}
                        valueClassName={
                          overallAssessment === 'SATISFACTORY'
                            ? 'text-cv-green font-bold'
                            : overallAssessment === 'UNSATISFACTORY'
                            ? 'text-cv-red font-bold'
                            : 'text-cv-amber font-bold'
                        }
                      />
                      <DataRow label="General Condition" value={certificate.generalCondition} long />
                    </div>
                  )}

                  {status.id === 'supply' && certificate.supply && (
                    <div className="pt-3 grid grid-cols-2 gap-2">
                      <DataRow label="Earthing" value={certificate.supply.earthingType} />
                      <DataRow label="Config" value={certificate.supply.conductorConfig} />
                      <DataRow label="Voltage" value={certificate.supply.nominalVoltage ? `${certificate.supply.nominalVoltage}V` : undefined} />
                      <DataRow label="Frequency" value={certificate.supply.nominalFrequency ? `${certificate.supply.nominalFrequency}Hz` : undefined} />
                      <DataRow label="Ze" value={certificate.supply.ze ? `${certificate.supply.ze}Ω` : undefined} />
                      <DataRow label="Ipf" value={certificate.supply.ipf ? `${certificate.supply.ipf}kA` : undefined} />
                    </div>
                  )}

                  {status.id === 'particulars' && certificate.particulars && (
                    <div className="pt-3 grid grid-cols-2 gap-2">
                      <DataRow label="Location" value={certificate.particulars.mainSwitchLocation} />
                      <DataRow label="Rating" value={certificate.particulars.mainSwitchRating ? `${certificate.particulars.mainSwitchRating}A` : undefined} />
                      <DataRow label="Earth Cond." value={certificate.particulars.earthingConductorCsa ? `${certificate.particulars.earthingConductorCsa}mm²` : undefined} />
                      <DataRow label="Bonding" value={certificate.particulars.bondingConductorCsa ? `${certificate.particulars.bondingConductorCsa}mm²` : undefined} />
                    </div>
                  )}

                  {status.id === 'observations' && (
                    <div className="pt-3 space-y-2">
                      {observations.length === 0 ? (
                        <p className="text-xs text-cv-text-muted">No observations recorded.</p>
                      ) : (
                        observations.map((obs, i) => (
                          <div
                            key={obs.id ?? i}
                            className="flex items-start gap-2 p-2.5 bg-cv-bg rounded-lg border border-cv-border"
                          >
                            {obs.code && (
                              <span className={`${getCodeBadgeClass(obs.code)} px-2 py-0.5 rounded text-[10px] font-bold flex-shrink-0`}>
                                {obs.code}
                              </span>
                            )}
                            <div className="min-w-0 flex-1">
                              <p className="text-xs text-cv-text leading-relaxed truncate">
                                {obs.text || 'No description'}
                              </p>
                              {obs.location && (
                                <p className="text-[10px] text-cv-text-muted mt-0.5">{obs.location}</p>
                              )}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}

                  {status.id === 'schedule' && (
                    <div className="pt-3">
                      <p className="text-xs text-cv-text-muted">
                        {status.filled} of ~{status.total} items completed.
                      </p>
                    </div>
                  )}

                  {status.id === 'circuits' && (
                    <div className="pt-3 space-y-2">
                      {circuits.length === 0 ? (
                        <p className="text-xs text-cv-text-muted">No circuits recorded.</p>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="border-b border-cv-border">
                                <th className="text-left py-1.5 px-2 text-[10px] text-cv-text-muted uppercase font-semibold">Cct</th>
                                <th className="text-left py-1.5 px-2 text-[10px] text-cv-text-muted uppercase font-semibold">Description</th>
                                <th className="text-left py-1.5 px-2 text-[10px] text-cv-text-muted uppercase font-semibold">Zs</th>
                                <th className="text-left py-1.5 px-2 text-[10px] text-cv-text-muted uppercase font-semibold">IR</th>
                                <th className="text-left py-1.5 px-2 text-[10px] text-cv-text-muted uppercase font-semibold">Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {circuits.map((c, i) => (
                                <tr key={c.id ?? i} className="border-b border-cv-border/50">
                                  <td className="py-1.5 px-2 font-mono">{c.circuitNumber ?? i + 1}</td>
                                  <td className="py-1.5 px-2 truncate max-w-[120px]">{c.description ?? '—'}</td>
                                  <td className="py-1.5 px-2 font-mono">{c.zs ?? '—'}</td>
                                  <td className="py-1.5 px-2 font-mono">{c.irLiveEarth ?? '—'}</td>
                                  <td className="py-1.5 px-2">
                                    <span className={`inline-block w-2 h-2 rounded-full ${c.status === 'pass' ? 'bg-cv-green' : c.status === 'fail' ? 'bg-cv-red' : 'bg-cv-text-muted'}`} />
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Edit section link */}
                  <button
                    type="button"
                    onClick={() => onNavigateToSection(status.id)}
                    className="mt-3 flex items-center gap-1.5 text-xs text-cv-accent hover:text-cv-accent/80 font-semibold transition-colors"
                  >
                    <ExternalLink className="w-3 h-3" />
                    Edit Section {status.sectionRef}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ─── Actions ────────────────────────────────────────────────────── */}
      <div className="cv-panel p-4 space-y-3">
        {/* Generate PDF */}
        <button
          type="button"
          onClick={handleGeneratePDF}
          disabled={!canGenerate || isGenerating}
          className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-sm font-bold transition-all ${
            canGenerate && !isGenerating
              ? 'cv-btn-primary'
              : 'bg-cv-surface-2 border border-cv-border text-cv-text-muted cursor-not-allowed'
          }`}
        >
          {isGenerating ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Generating PDF...
            </>
          ) : (
            <>
              <Download className="w-4 h-4" />
              Generate BS 7671 PDF
            </>
          )}
        </button>

        {!canGenerate && (
          <p className="text-xs text-cv-red text-center flex items-center justify-center gap-1">
            <AlertCircle className="w-3 h-3" />
            Fix {errorCount} error{errorCount !== 1 ? 's' : ''} before generating
          </p>
        )}

        {/* Send to Client */}
        {onSendToClient && (
          <button
            type="button"
            onClick={handleSendToClient}
            disabled={!canGenerate || isSending}
            className={`w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-sm font-bold transition-all ${
              canGenerate && !isSending
                ? 'cv-btn-secondary'
                : 'bg-cv-surface-2 border border-cv-border text-cv-text-muted cursor-not-allowed'
            }`}
          >
            {isSending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <Send className="w-4 h-4" />
                Send to Client
              </>
            )}
          </button>
        )}

        {/* Compliance note */}
        <p className="text-[10px] text-cv-text-muted text-center leading-relaxed">
          PDF output based on the model shown in Appendix 6 of BS 7671:2018+A2:2022.
          <br />
          Page X of Y numbering · Report number on every page · No IET logo.
        </p>
      </div>
    </div>
  );
}

// ─── Data Row Sub-Component ──────────────────────────────────────────────────

interface DataRowProps {
  label: string;
  value: string | number | undefined | null;
  long?: boolean;
  valueClassName?: string;
}

function DataRow({ label, value, long = false, valueClassName = '' }: DataRowProps): JSX.Element {
  const displayValue = hasValue(value) ? String(value) : '—';
  const isMissing = !hasValue(value);

  return (
    <div className={long ? 'col-span-2' : ''}>
      <div className="flex items-start justify-between gap-2 py-1.5">
        <span className="text-[10px] text-cv-text-muted uppercase tracking-wider font-semibold flex-shrink-0">
          {label}
        </span>
        <span
          className={`text-xs text-right ${
            isMissing
              ? 'text-cv-text-muted italic'
              : valueClassName || 'text-cv-text font-mono'
          }`}
        >
          {long && !isMissing ? (
            <span className="line-clamp-2">{displayValue}</span>
          ) : (
            displayValue
          )}
        </span>
      </div>
    </div>
  );
}
