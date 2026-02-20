// src/pages/NiceicExport.tsx
// NICEIC Portal Export — Structured copy-paste view matching NOCS field order
// Supports EICR (Sections A-K) and EIC (Parts 1-6) certificate types
// Path 3 integration: zero ToS risk, no automation, just smart formatting

import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { Helmet } from 'react-helmet-async'
import {
  ArrowLeft,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Zap,
  Shield,
  AlertTriangle,
  FileText,
  Settings,
  ExternalLink,
} from 'lucide-react'
import { captureError } from '@utils/errorTracking'
import { trackEvent } from '@utils/analytics'
import { sanitizeText } from '@utils/sanitization'

import type {
  EICRCertificate,
  CircuitDetail,
  Observation,
  DistributionBoardHeader,
  InspectionItem,
  ClassificationCode,
} from '@/types/eicr'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CertType = 'eicr' | 'eic'

interface CopyState {
  [sectionId: string]: 'idle' | 'copied'
}

interface NiceicFields {
  registrationNumber: string
  certificateSerial: string
  contractorRef: string
}

// ---------------------------------------------------------------------------
// Constants — NICEIC NOCS section order
// ---------------------------------------------------------------------------

const EICR_SECTIONS = [
  { id: 'niceic', label: 'NICEIC Details', icon: Shield },
  { id: 'sectionA', label: 'Section A — Person Ordering Report', icon: FileText },
  { id: 'sectionB', label: 'Section B — Reason for Report', icon: FileText },
  { id: 'sectionC', label: 'Section C — Installation Details', icon: FileText },
  { id: 'sectionD', label: 'Section D — Extent & Limitations', icon: FileText },
  { id: 'sectionE', label: 'Section E — Summary of Condition', icon: AlertTriangle },
  { id: 'sectionF', label: 'Section F — Recommendations', icon: FileText },
  { id: 'sectionG', label: 'Section G — Declaration', icon: FileText },
  { id: 'sectionI', label: 'Section I — Supply Characteristics', icon: Zap },
  { id: 'sectionJ', label: 'Section J — Installation Particulars', icon: Settings },
  { id: 'sectionK', label: 'Section K — Observations', icon: AlertTriangle },
  { id: 'boards', label: 'Distribution Board Headers', icon: ClipboardList },
  { id: 'circuits', label: 'Schedule of Test Results', icon: ClipboardList },
  { id: 'inspection', label: 'Schedule of Inspections', icon: ClipboardList },
  { id: 'instruments', label: 'Test Instruments', icon: Settings },
] as const

const EIC_SECTIONS = [
  { id: 'niceic', label: 'NICEIC Details', icon: Shield },
  { id: 'part1', label: 'Part 1 — Contractor / Client / Installation', icon: FileText },
  { id: 'part2', label: 'Part 2 — Description & Extent', icon: FileText },
  { id: 'part3', label: 'Part 3 — Supply Characteristics', icon: Zap },
  { id: 'part4', label: 'Part 4 — Particulars at Origin', icon: Settings },
  { id: 'part5', label: 'Part 5 — Comments on Existing Installation', icon: FileText },
  { id: 'part6', label: 'Part 6 — Declaration (3 Signatories)', icon: FileText },
  { id: 'boards', label: 'Distribution Board Headers', icon: ClipboardList },
  { id: 'circuits', label: 'Schedule of Test Results', icon: ClipboardList },
  { id: 'inspection', label: 'Schedule of Inspections', icon: ClipboardList },
  { id: 'instruments', label: 'Test Instruments', icon: Settings },
] as const

// Earthing type display values
const EARTHING_LABELS: Record<string, string> = {
  TN_C: 'TN-C',
  TN_S: 'TN-S',
  TN_C_S: 'TN-C-S',
  TT: 'TT',
  IT: 'IT',
}

// Wiring type codes to descriptions
const WIRING_LABELS: Record<string, string> = {
  A: 'Thermoplastic (T&E)',
  B: 'PVC in metallic conduit',
  C: 'PVC in non-metallic conduit',
  D: 'PVC in metallic trunking',
  E: 'PVC in non-metallic trunking',
  F: 'PVC SWA',
  G: 'XLPE SWA',
  H: 'Mineral insulated',
  O: 'Other',
}

// Classification code labels
const CODE_LABELS: Record<ClassificationCode, string> = {
  C1: 'C1 — Danger Present',
  C2: 'C2 — Potentially Dangerous',
  C3: 'C3 — Improvement Recommended',
  FI: 'FI — Further Investigation',
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format a field as "Label: Value" for copy. Skips empty values. */
function field(label: string, value: string | number | boolean | undefined | null): string {
  if (value === undefined || value === null || value === '') return ''
  if (typeof value === 'boolean') return `${label}: ${value ? 'Yes' : 'No'}`
  return `${label}: ${value}`
}

/** Join non-empty field strings with newlines */
function joinFields(...fields: string[]): string {
  return fields.filter(Boolean).join('\n')
}

/** Format date for display */
function fmtDate(date: string | undefined | null): string {
  if (!date) return ''
  try {
    return new Date(date).toLocaleDateString('en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })
  } catch {
    return date
  }
}

/** Tick/cross display */
function tick(val: string | boolean | undefined | null): string {
  if (val === true || val === 'TICK' || val === 'SATISFACTORY') return 'Yes / Tick'
  if (val === false || val === 'CROSS' || val === 'UNSATISFACTORY') return 'No / Cross'
  if (val === 'NA') return 'N/A'
  return String(val || '')
}

// ---------------------------------------------------------------------------
// Section text formatters — EICR
// ---------------------------------------------------------------------------

function formatNiceicDetails(nf: NiceicFields): string {
  return joinFields(
    field('NICEIC Registration Number', nf.registrationNumber),
    field('Certificate Serial Number', nf.certificateSerial),
    field("Contractor's Reference", nf.contractorRef)
  )
}

function formatSectionA(cert: EICRCertificate): string {
  return joinFields(
    '--- SECTION A: Person Ordering the Report ---',
    field('Client Name', cert.clientName),
    field('Client Address', cert.clientAddress)
  )
}

function formatSectionB(cert: EICRCertificate): string {
  return joinFields(
    '--- SECTION B: Reason for Producing Report ---',
    field('Purpose', cert.purpose),
    field('Date(s) of Inspection', fmtDate(cert.inspectionDate))
  )
}

function formatSectionC(cert: EICRCertificate): string {
  return joinFields(
    '--- SECTION C: Installation Details ---',
    field('Installation Address', cert.installationAddress),
    field('Occupier', cert.occupier),
    field('Description of Premises', cert.premisesType),
    field('Estimated Age of Wiring (years)', cert.estimatedAgeOfWiring),
    field('Evidence of Additions/Alterations', cert.evidenceOfAdditions),
    field('Additions Estimated Age (years)', cert.additionsEstimatedAge),
    field('Installation Records Available', cert.installationRecordsAvailable),
    field('Date of Last Inspection', fmtDate(cert.dateOfLastInspection))
  )
}

function formatSectionD(cert: EICRCertificate): string {
  return joinFields(
    '--- SECTION D: Extent and Limitations ---',
    field('Extent Covered', cert.extentCovered),
    field('Agreed Limitations', cert.agreedLimitations),
    field('Agreed With', cert.agreedWith),
    field('Operational Limitations', cert.operationalLimitations)
  )
}

function formatSectionE(cert: EICRCertificate): string {
  return joinFields(
    '--- SECTION E: Summary of Condition ---',
    field('General Condition', cert.generalCondition),
    field('Overall Assessment', cert.overallAssessment)
  )
}

function formatSectionF(cert: EICRCertificate): string {
  return joinFields(
    '--- SECTION F: Recommendations ---',
    field('Recommended Next Inspection', fmtDate(cert.nextInspectionDate)),
    field('Reason for Interval', cert.reasonForInterval),
    field('Remedial Urgency', cert.remedialUrgency)
  )
}

function formatSectionG(cert: EICRCertificate): string {
  const d = cert.declaration
  if (!d) return ''
  return joinFields(
    '--- SECTION G: Declaration ---',
    field('Inspector Name', d.inspectorName),
    field('Company Name', d.companyName),
    field('Position', d.position),
    field('Company Address', d.companyAddress),
    field('Date Inspected', fmtDate(d.inspectionDate)),
    field('Registration Number', d.registrationNumber),
    '',
    field('QS (Authoriser) Name', d.qsName),
    field('QS Date', fmtDate(d.qsDate))
  )
}

function formatSectionI(cert: EICRCertificate): string {
  const s = cert.supplyCharacteristics
  if (!s) return ''
  return joinFields(
    '--- SECTION I: Supply Characteristics ---',
    field('Earthing Type', EARTHING_LABELS[s.earthingType] || s.earthingType),
    field('Supply', s.acDc),
    field('Conductor Configuration', s.conductorConfig),
    field('Supply Polarity Confirmed', tick(s.supplyPolarityConfirmed)),
    field('Other Sources of Supply', s.otherSourcesOfSupply),
    '',
    field('Nominal Voltage (V)', s.nominalVoltage),
    field('Nominal Frequency (Hz)', s.nominalFrequency),
    field('Prospective Fault Current Ipf (kA)', s.prospectiveFaultCurrent),
    field('External Earth Fault Loop Ze (ohms)', s.externalEarthFaultLoop),
    '',
    field('Supply Protective Device BS(EN)', s.supplyProtectiveDeviceBsEn),
    field('Supply Protective Device Type', s.supplyProtectiveDeviceType),
    field('Supply Protective Device Rating (A)', s.supplyProtectiveDeviceRating)
  )
}

function formatSectionJ(cert: EICRCertificate): string {
  const p = cert.installationParticulars
  if (!p) return ''
  return joinFields(
    '--- SECTION J: Installation Particulars ---',
    field("Means of Earthing — Distributor's Facility", tick(p.meansOfEarthing)),
    field('Installation Earth Electrode', tick(p.installationEarthElectrode)),
    field('Electrode Type', p.electrodeType),
    field('Electrode Location', p.electrodeLocation),
    field('Electrode Resistance (ohms)', p.electrodeResistance),
    '',
    field('Main Switch Location', p.mainSwitchLocation),
    field('Main Switch BS(EN)', p.mainSwitchBsEn),
    field('Number of Poles', p.mainSwitchPoles),
    field('Current Rating (A)', p.mainSwitchCurrentRating),
    field('Fuse/Device Rating (A)', p.mainSwitchFuseRating),
    field('Voltage Rating (V)', p.mainSwitchVoltageRating),
    field('RCD Type (if applicable)', p.mainSwitchRcdType),
    field('Rated Residual Current (mA)', p.mainSwitchRcdRating),
    field('Rated Time Delay (ms)', p.mainSwitchRcdTimeDelay),
    field('Measured Operating Time (ms)', p.mainSwitchRcdOperatingTime),
    '',
    field('Earthing Conductor Material', p.earthingConductorMaterial),
    field('Earthing Conductor CSA (mm2)', p.earthingConductorCsa),
    field('Earthing Conductor Verified', tick(p.earthingConductorVerified)),
    '',
    field('Main Bonding Conductor Material', p.bondingConductorMaterial),
    field('Main Bonding Conductor CSA (mm2)', p.bondingConductorCsa),
    field('Main Bonding Connection Verified', tick(p.bondingConductorVerified)),
    '',
    field('Bonded to Water', tick(p.bondingWater)),
    field('Bonded to Gas', tick(p.bondingGas)),
    field('Bonded to Oil', tick(p.bondingOil)),
    field('Bonded to Structural Steel', tick(p.bondingStructuralSteel)),
    field('Bonded to Lightning Protection', tick(p.bondingLightningProtection)),
    field('Bonded to Other', p.bondingOther)
  )
}

function formatSectionK(observations: Observation[]): string {
  if (!observations.length) return '--- SECTION K: Observations ---\nNo observations recorded.'
  const lines = observations.map((obs, i) => {
    const num = obs.itemNumber || i + 1
    return joinFields(
      `Observation ${num}:`,
      field('  Classification', CODE_LABELS[obs.classificationCode] || obs.classificationCode),
      field('  Location', obs.location),
      field('  DB Reference', obs.dbReference),
      field('  Circuit Reference', obs.circuitReference),
      field('  Description', obs.observationText),
      field('  Regulation', obs.regulationRef),
      field('  Remedial Action', obs.remedialAction)
    )
  })
  return '--- SECTION K: Observations ---\n' + lines.join('\n\n')
}

function formatBoards(boards: DistributionBoardHeader[]): string {
  if (!boards.length) return 'No distribution boards recorded.'
  const lines = boards.map((b) =>
    joinFields(
      `Board: ${b.dbReference || 'Unknown'}`,
      field('  Location', b.dbLocation),
      field('  Supplied From', b.suppliedFrom),
      field('  OCPD BS(EN)', b.distOcpdBsEn),
      field('  OCPD Type', b.distOcpdType),
      field('  OCPD Rating (A)', b.distOcpdRating),
      field('  Phases', b.numberOfPhases),
      field('  SPD Type', b.spdType),
      field('  SPD Status Confirmed', tick(b.spdStatusConfirmed)),
      field('  Polarity Confirmed', tick(b.polarityConfirmed)),
      field('  Phase Sequence Confirmed', tick(b.phaseSequence)),
      field('  Zs at DB (ohms)', b.zsAtDb),
      field('  Ipf at DB (kA)', b.ipfAtDb)
    )
  )
  return '--- Distribution Board Headers ---\n' + lines.join('\n\n')
}

function formatCircuit(c: CircuitDetail, idx: number): string {
  return joinFields(
    `Circuit ${c.circuitNumber || idx + 1}: ${c.circuitDescription || ''}`,
    field('  Board', c.boardReference),
    field('  Wiring Type', WIRING_LABELS[c.wiringType] || c.wiringType),
    field('  Ref Method', c.referenceMethod),
    field('  Points', c.numberOfPoints),
    field('  Live CSA (mm2)', c.liveConductorCsa),
    field('  CPC CSA (mm2)', c.cpcCsa),
    field('  Max Disc. Time (s)', c.maxDisconnectTime),
    field('  OCPD BS(EN)', c.ocpdBsEn),
    field('  OCPD Type', c.ocpdType),
    field('  OCPD Rating (A)', c.ocpdRating),
    field('  Max Permitted Zs (ohms)', c.maxPermittedZs),
    field('  Breaking Capacity (kA)', c.breakingCapacity),
    field('  RCD BS(EN)', c.rcdBsEn),
    field('  RCD Type', c.rcdType),
    field('  RCD Rating', c.rcdRating),
    '',
    field('  r1 (ohms)', c.r1),
    field('  rn (ohms)', c.rn),
    field('  r2 (ohms)', c.r2),
    field('  R1+R2 (ohms)', c.r1r2),
    field('  Test Voltage (V)', c.testVoltage),
    field('  IR L-L (Mohms)', c.irLiveLive),
    field('  IR L-E (Mohms)', c.irLiveEarth),
    field('  Zs (ohms)', c.zs),
    field('  Polarity', tick(c.polarity)),
    field('  RCD Time (ms)', c.rcdTime),
    field('  RCD Test Button', tick(c.rcdTestButton)),
    field('  AFDD Test Button', tick(c.afddTestButton)),
    field('  Remarks', c.remarks)
  )
}

function formatCircuits(circuits: CircuitDetail[]): string {
  if (!circuits.length) return 'No circuits recorded.'
  return (
    '--- Schedule of Test Results ---\n' +
    circuits.map((c, i) => formatCircuit(c, i)).join('\n\n')
  )
}

function formatInspection(items: InspectionItem[]): string {
  if (!items.length) return 'No inspection items recorded.'
  const nonNa = items.filter((it) => it.outcome && it.outcome !== 'NA')
  if (!nonNa.length) return 'All inspection items: N/A or not recorded.'
  const lines = nonNa.map(
    (it) => `${it.section}.${it.itemNumber} ${it.description}: ${it.outcome}`
  )
  return '--- Schedule of Inspections ---\n' + lines.join('\n')
}

function formatInstruments(cert: EICRCertificate): string {
  const t = cert.testInstruments
  if (!t) return ''
  return joinFields(
    '--- Test Instruments ---',
    field('Multifunction Instrument', t.multifunctionInstrument),
    field('Insulation Resistance', t.insulationResistance),
    field('Continuity', t.continuity),
    field('Earth Electrode Resistance', t.earthElectrodeResistance),
    field('Earth Fault Loop Impedance', t.earthFaultLoopImpedance),
    field('RCD Tester', t.rcdTester)
  )
}

// ---------------------------------------------------------------------------
// Section text formatters — EIC
// ---------------------------------------------------------------------------

function formatEicPart1(cert: EICRCertificate): string {
  const d = cert.declaration
  return joinFields(
    '--- PART 1: Contractor / Client / Installation ---',
    field('Contractor Name', d?.companyName),
    field('Contractor Address', d?.companyAddress),
    field('Registration Number', d?.registrationNumber),
    '',
    field('Client Name', cert.clientName),
    field('Client Address', cert.clientAddress),
    '',
    field('Installation Address', cert.installationAddress),
    field('Occupier', cert.occupier),
    field('Description of Premises', cert.premisesType)
  )
}

function formatEicPart2(cert: EICRCertificate): string {
  return joinFields(
    '--- PART 2: Description and Extent of Work ---',
    field('Description of Installation', cert.extentCovered),
    field('Extent Covered', cert.extentCovered),
    field('Agreed Limitations', cert.agreedLimitations),
    field('Operational Limitations', cert.operationalLimitations)
  )
}

function formatEicPart5(cert: EICRCertificate): string {
  return joinFields(
    '--- PART 5: Comments on Existing Installation ---',
    field('General Condition', cert.generalCondition)
  )
}

function formatEicPart6(cert: EICRCertificate): string {
  const d = cert.declaration
  // EIC has typeData with design/construction/inspection signatories
  const td = (cert as Record<string, unknown>).typeData as Record<string, unknown> | undefined
  return joinFields(
    '--- PART 6: Declaration ---',
    'Design:',
    field('  Designer Name', td?.designerName as string),
    field('  Designer Position', td?.designerPosition as string),
    field('  Design Date', fmtDate(td?.designDate as string)),
    '',
    'Construction:',
    field('  Constructor Name', td?.constructorName as string),
    field('  Constructor Position', td?.constructorPosition as string),
    field('  Construction Date', fmtDate(td?.constructionDate as string)),
    '',
    'Inspection & Testing:',
    field('  Inspector Name', d?.inspectorName),
    field('  Inspector Position', d?.position),
    field('  Inspection Date', fmtDate(d?.inspectionDate)),
    '',
    field('Company Name', d?.companyName),
    field('Company Address', d?.companyAddress),
    field('Registration Number', d?.registrationNumber)
  )
}

// ---------------------------------------------------------------------------
// Component: CopyButton
// ---------------------------------------------------------------------------

function CopyButton({
  text,
  sectionId,
  copyState,
  onCopy,
  compact = false,
}: {
  text: string
  sectionId: string
  copyState: CopyState
  onCopy: (sectionId: string, text: string) => void
  compact?: boolean
}) {
  const isCopied = copyState[sectionId] === 'copied'

  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        onCopy(sectionId, text)
      }}
      className={`
        flex items-center gap-1.5 rounded-lg font-semibold transition-all duration-200
        ${compact ? 'px-2.5 py-1.5 text-xs' : 'px-3.5 py-2 text-sm'}
        ${
          isCopied
            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
            : 'bg-blue-500/15 text-blue-400 border border-blue-500/25 hover:bg-blue-500/25 hover:border-blue-500/40 active:scale-95'
        }
      `}
      aria-label={isCopied ? 'Copied' : `Copy ${sectionId}`}
    >
      {isCopied ? (
        <>
          <Check className="w-3.5 h-3.5" />
          {!compact && 'Copied'}
        </>
      ) : (
        <>
          <Copy className="w-3.5 h-3.5" />
          {!compact && 'Copy'}
        </>
      )}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Component: ExportSection (collapsible)
// ---------------------------------------------------------------------------

function ExportSection({
  id,
  label,
  icon: Icon,
  text,
  copyState,
  onCopy,
  defaultOpen = false,
  children,
}: {
  id: string
  label: string
  icon: React.ElementType
  text: string
  copyState: CopyState
  onCopy: (sectionId: string, text: string) => void
  defaultOpen?: boolean
  children?: React.ReactNode
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen)
  const isCopied = copyState[id] === 'copied'

  return (
    <div
      className={`
        rounded-xl border transition-colors duration-200
        ${isCopied ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-[#2A2F3A] bg-[#151920]'}
      `}
    >
      {/* Header — always visible */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center gap-3 px-4 py-3.5 text-left"
        aria-expanded={isOpen}
      >
        <div
          className={`
            w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0
            ${isCopied ? 'bg-emerald-500/15 text-emerald-400' : 'bg-blue-500/10 text-blue-400'}
          `}
        >
          {isCopied ? <Check className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
        </div>

        <span className="flex-1 text-sm font-semibold text-[#E8ECF1] leading-tight">
          {label}
        </span>

        <CopyButton
          text={text}
          sectionId={id}
          copyState={copyState}
          onCopy={onCopy}
          compact
        />

        {isOpen ? (
          <ChevronUp className="w-4 h-4 text-[#7A8494] flex-shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 text-[#7A8494] flex-shrink-0" />
        )}
      </button>

      {/* Content — collapsible */}
      {isOpen && (
        <div className="px-4 pb-4 border-t border-[#2A2F3A]/50">
          <div className="mt-3">
            {children || (
              <pre className="text-xs text-[#B0B8C8] font-mono whitespace-pre-wrap leading-relaxed bg-[#0C0F14] rounded-lg p-3 border border-[#2A2F3A]/50 select-all">
                {text || 'No data recorded for this section.'}
              </pre>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Component: NiceicFieldInputs — NICEIC-specific fields (editable)
// ---------------------------------------------------------------------------

function NiceicFieldInputs({
  values,
  onChange,
}: {
  values: NiceicFields
  onChange: (field: keyof NiceicFields, value: string) => void
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <div>
        <label className="block text-xs font-semibold text-[#7A8494] uppercase tracking-wider mb-1.5">
          NICEIC Reg No.
        </label>
        <input
          type="text"
          value={values.registrationNumber}
          onChange={(e) => onChange('registrationNumber', e.target.value)}
          placeholder="e.g. 12345"
          className="w-full px-3 py-2.5 rounded-lg bg-[#0C0F14] border border-[#2A2F3A] text-[#E8ECF1] text-sm font-mono placeholder:text-[#4A5568] focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20"
          maxLength={10}
          inputMode="numeric"
        />
      </div>
      <div>
        <label className="block text-xs font-semibold text-[#7A8494] uppercase tracking-wider mb-1.5">
          Cert Serial No.
        </label>
        <input
          type="text"
          value={values.certificateSerial}
          onChange={(e) => onChange('certificateSerial', e.target.value)}
          placeholder="e.g. 1234567"
          className="w-full px-3 py-2.5 rounded-lg bg-[#0C0F14] border border-[#2A2F3A] text-[#E8ECF1] text-sm font-mono placeholder:text-[#4A5568] focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20"
          maxLength={10}
        />
      </div>
      <div>
        <label className="block text-xs font-semibold text-[#7A8494] uppercase tracking-wider mb-1.5">
          Contractor Ref
        </label>
        <input
          type="text"
          value={values.contractorRef}
          onChange={(e) => onChange('contractorRef', e.target.value)}
          placeholder="e.g. JOB-2026-042"
          className="w-full px-3 py-2.5 rounded-lg bg-[#0C0F14] border border-[#2A2F3A] text-[#E8ECF1] text-sm font-mono placeholder:text-[#4A5568] focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20"
          maxLength={30}
        />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function NiceicExport() {
  const { certType, id } = useParams<{ certType: string; id: string }>()
  const navigate = useNavigate()

  const type: CertType = certType === 'eic' ? 'eic' : 'eicr'
  const sections = type === 'eic' ? EIC_SECTIONS : EICR_SECTIONS

  // Certificate data — loaded from IndexedDB or API
  const [cert, setCert] = useState<EICRCertificate | null>(null)
  const [circuits, setCircuits] = useState<CircuitDetail[]>([])
  const [observations, setObservations] = useState<Observation[]>([])
  const [boards, setBoards] = useState<DistributionBoardHeader[]>([])
  const [inspectionItems, setInspectionItems] = useState<InspectionItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // NICEIC-specific editable fields
  const [niceicFields, setNiceicFields] = useState<NiceicFields>({
    registrationNumber: '',
    certificateSerial: '',
    contractorRef: '',
  })

  // Copy state per section
  const [copyState, setCopyState] = useState<CopyState>({})

  // Progress tracking
  const copiedCount = Object.values(copyState).filter((s) => s === 'copied').length
  const totalSections = sections.length
  const progressPercent = Math.round((copiedCount / totalSections) * 100)

  // -----------------------------------------------------------------------
  // Load certificate data
  // -----------------------------------------------------------------------

  useEffect(() => {
    async function loadCertificate() {
      if (!id) {
        setError('No certificate ID provided.')
        setLoading(false)
        return
      }

      try {
        // Try loading from IndexedDB first (offline-first pattern)
        const { getCertificateById } = await import('@/services/offlineStore')
        const stored = await getCertificateById(id)

        if (stored) {
          setCert(stored.certificate as EICRCertificate)
          setCircuits(stored.circuits || [])
          setObservations(stored.observations || [])
          setBoards(stored.distributionBoards || [])
          setInspectionItems(stored.inspectionItems || [])

          // Pre-fill NICEIC reg number from declaration if available
          if (stored.certificate?.declaration?.registrationNumber) {
            setNiceicFields((prev) => ({
              ...prev,
              registrationNumber: stored.certificate.declaration.registrationNumber,
            }))
          }
          // Pre-fill contractor ref from report number
          if (stored.certificate?.reportNumber) {
            setNiceicFields((prev) => ({
              ...prev,
              contractorRef: stored.certificate.reportNumber,
            }))
          }
        } else {
          setError('Certificate not found. It may not be saved locally.')
        }
      } catch (err) {
        captureError(err, 'NiceicExport.loadCertificate')
        setError('Failed to load certificate data.')
      } finally {
        setLoading(false)
      }
    }

    loadCertificate()
  }, [id])

  // -----------------------------------------------------------------------
  // Copy handler
  // -----------------------------------------------------------------------

  const handleCopy = useCallback(
    async (sectionId: string, text: string) => {
      try {
        const sanitized = sanitizeText(text)
        await navigator.clipboard.writeText(sanitized)

        setCopyState((prev) => ({ ...prev, [sectionId]: 'copied' }))

        // Reset after 3 seconds
        setTimeout(() => {
          setCopyState((prev) => ({ ...prev, [sectionId]: 'idle' }))
        }, 3000)

        trackEvent('niceic_export_copy', {
          section: sectionId,
          cert_type: type,
        })
      } catch (err) {
        // Fallback: select text for manual copy
        captureError(err, 'NiceicExport.handleCopy')
      }
    },
    [type]
  )

  // -----------------------------------------------------------------------
  // Copy All
  // -----------------------------------------------------------------------

  const handleCopyAll = useCallback(() => {
    if (!cert) return

    const allText = getSectionTexts()
      .map(({ text }) => text)
      .filter(Boolean)
      .join('\n\n')

    handleCopy('all', allText)

    // Mark all sections as copied
    const allCopied: CopyState = {}
    sections.forEach((s) => {
      allCopied[s.id] = 'copied'
    })
    setCopyState(allCopied)

    setTimeout(() => {
      setCopyState({})
    }, 3000)

    trackEvent('niceic_export_copy_all', { cert_type: type })
  }, [cert, type, sections, handleCopy])

  // -----------------------------------------------------------------------
  // Generate section text map
  // -----------------------------------------------------------------------

  function getSectionTexts(): Array<{ id: string; text: string }> {
    if (!cert) return []

    if (type === 'eicr') {
      return [
        { id: 'niceic', text: formatNiceicDetails(niceicFields) },
        { id: 'sectionA', text: formatSectionA(cert) },
        { id: 'sectionB', text: formatSectionB(cert) },
        { id: 'sectionC', text: formatSectionC(cert) },
        { id: 'sectionD', text: formatSectionD(cert) },
        { id: 'sectionE', text: formatSectionE(cert) },
        { id: 'sectionF', text: formatSectionF(cert) },
        { id: 'sectionG', text: formatSectionG(cert) },
        { id: 'sectionI', text: formatSectionI(cert) },
        { id: 'sectionJ', text: formatSectionJ(cert) },
        { id: 'sectionK', text: formatSectionK(observations) },
        { id: 'boards', text: formatBoards(boards) },
        { id: 'circuits', text: formatCircuits(circuits) },
        { id: 'inspection', text: formatInspection(inspectionItems) },
        { id: 'instruments', text: formatInstruments(cert) },
      ]
    }

    // EIC sections
    return [
      { id: 'niceic', text: formatNiceicDetails(niceicFields) },
      { id: 'part1', text: formatEicPart1(cert) },
      { id: 'part2', text: formatEicPart2(cert) },
      { id: 'part3', text: formatSectionI(cert) },
      { id: 'part4', text: formatSectionJ(cert) },
      { id: 'part5', text: formatEicPart5(cert) },
      { id: 'part6', text: formatEicPart6(cert) },
      { id: 'boards', text: formatBoards(boards) },
      { id: 'circuits', text: formatCircuits(circuits) },
      { id: 'inspection', text: formatInspection(inspectionItems) },
      { id: 'instruments', text: formatInstruments(cert) },
    ]
  }

  const sectionTexts = getSectionTexts()

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0C0F14] flex items-center justify-center">
        <div className="text-[#7A8494] text-sm">Loading certificate...</div>
      </div>
    )
  }

  if (error || !cert) {
    return (
      <div className="min-h-screen bg-[#0C0F14] flex flex-col items-center justify-center gap-4 px-6">
        <AlertTriangle className="w-10 h-10 text-amber-400" />
        <p className="text-[#E8ECF1] text-center">{error || 'Certificate not found.'}</p>
        <button
          onClick={() => navigate(-1)}
          className="text-blue-400 hover:text-blue-300 text-sm font-medium"
        >
          Go back
        </button>
      </div>
    )
  }

  const certLabel = type === 'eicr' ? 'EICR' : 'EIC'

  return (
    <>
      <Helmet>
        <title>NICEIC Export — {certLabel} | CertVoice</title>
      </Helmet>

      <div className="min-h-screen bg-[#0C0F14]">
        {/* ---- Sticky header ---- */}
        <div className="sticky top-0 z-30 bg-[#151920]/95 backdrop-blur-sm border-b border-[#2A2F3A]">
          <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
            <button
              onClick={() => navigate(-1)}
              className="w-9 h-9 rounded-lg bg-[#1C2029] border border-[#2A2F3A] flex items-center justify-center text-[#7A8494] hover:text-[#E8ECF1] transition-colors"
              aria-label="Go back"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>

            <div className="flex-1 min-w-0">
              <h1 className="text-sm font-bold text-[#E8ECF1] truncate">
                NICEIC Portal Export — {certLabel}
              </h1>
              <p className="text-xs text-[#7A8494] truncate">
                {cert.installationAddress || cert.clientName || 'Certificate'}
              </p>
            </div>

            <button
              onClick={handleCopyAll}
              className={`
                flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition-all
                ${
                  copyState.all === 'copied'
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                    : 'bg-blue-500 text-white hover:bg-blue-600 active:scale-95'
                }
              `}
            >
              {copyState.all === 'copied' ? (
                <>
                  <Check className="w-3.5 h-3.5" /> All Copied
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" /> Copy All
                </>
              )}
            </button>
          </div>

          {/* Progress bar */}
          <div className="h-0.5 bg-[#1C2029]">
            <div
              className="h-full bg-emerald-500 transition-all duration-500"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        {/* ---- Content ---- */}
        <div className="max-w-2xl mx-auto px-4 py-5 space-y-3">
          {/* Info banner */}
          <div className="rounded-xl bg-blue-500/8 border border-blue-500/20 px-4 py-3">
            <div className="flex items-start gap-2.5">
              <ExternalLink className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-xs text-blue-300 font-semibold leading-tight">
                  Open NICEIC NOCS in another tab, then copy each section here and paste into the
                  portal fields.
                </p>
                <a
                  href="https://nocs.niceic.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-400 hover:text-blue-300 underline underline-offset-2 mt-1 inline-block"
                >
                  Open nocs.niceic.com
                </a>
              </div>
            </div>
          </div>

          {/* Progress summary */}
          {copiedCount > 0 && (
            <div className="text-xs text-[#7A8494] text-center py-1">
              {copiedCount} of {totalSections} sections copied ({progressPercent}%)
            </div>
          )}

          {/* Sections */}
          {sections.map((section) => {
            const sectionText =
              sectionTexts.find((st) => st.id === section.id)?.text || ''

            // NICEIC details section has custom children (editable inputs)
            if (section.id === 'niceic') {
              return (
                <ExportSection
                  key={section.id}
                  id={section.id}
                  label={section.label}
                  icon={section.icon}
                  text={formatNiceicDetails(niceicFields)}
                  copyState={copyState}
                  onCopy={handleCopy}
                  defaultOpen
                >
                  <NiceicFieldInputs
                    values={niceicFields}
                    onChange={(f, v) =>
                      setNiceicFields((prev) => ({ ...prev, [f]: v }))
                    }
                  />
                  {formatNiceicDetails(niceicFields) && (
                    <pre className="text-xs text-[#B0B8C8] font-mono whitespace-pre-wrap leading-relaxed bg-[#0C0F14] rounded-lg p-3 border border-[#2A2F3A]/50 mt-3 select-all">
                      {formatNiceicDetails(niceicFields)}
                    </pre>
                  )}
                </ExportSection>
              )
            }

            return (
              <ExportSection
                key={section.id}
                id={section.id}
                label={section.label}
                icon={section.icon}
                text={sectionText}
                copyState={copyState}
                onCopy={handleCopy}
              />
            )
          })}

          {/* Footer */}
          <div className="pt-6 pb-10 text-center space-y-3">
            <p className="text-xs text-[#4A5568]">
              Data formatted for NICEIC NOCS portal (nocs.niceic.com). Fields follow BS
              7671:2018+A2:2022 Appendix 6 section order.
            </p>
            <Link
              to={`/capture/${type === 'eic' ? 'eic/' : ''}${id}`}
              className="text-xs text-blue-400 hover:text-blue-300 underline underline-offset-2"
            >
              Back to certificate
            </Link>
          </div>
        </div>
      </div>
    </>
  )
}
