/**
 * CertVoice — EIC (Electrical Installation Certificate) Type Definitions
 *
 * Based on: IET BS 7671:2018+A2:2022 Appendix 6 — Model Form 1
 *
 * Key differences from EICR:
 *   - Certifies NEW work complies with BS 7671 (not condition of existing)
 *   - Three signatories: Designer, Constructor, Inspector
 *   - Design section with demand assessment and departures
 *   - No C1/C2/C3/FI classification codes
 *   - Part P notification required for notifiable work
 *   - No overall SATISFACTORY/UNSATISFACTORY — either complies or cert not issued
 *
 * Shared types imported from eicr.ts:
 *   - SupplyCharacteristics, InstallationParticulars (Sections I & J — identical)
 *   - DistributionBoardHeader, CircuitDetail (circuit schedule — identical)
 *   - TestInstruments (Section H — identical)
 *   - InspectionItem (BS 7671 schedule of inspections — identical)
 *   - All enums: EarthingType, ConductorConfig, etc.
 *
 * @module types/eic
 */

import type {
  CertificateStatus,
  SupplyCharacteristics,
  InstallationParticulars,
  DistributionBoardHeader,
  CircuitDetail,
  TestInstruments,
  InspectionItem,
  InspectionOutcome,
  PremisesType,
} from './eicr'

// Re-export shared types so EIC consumers only need one import
export type {
  CertificateStatus,
  SupplyCharacteristics,
  InstallationParticulars,
  DistributionBoardHeader,
  CircuitDetail,
  TestInstruments,
  InspectionItem,
  InspectionOutcome,
  PremisesType,
}

// ============================================================
// EIC-SPECIFIC ENUMS
// ============================================================

/** Competent person scheme bodies — for Part P notification */
export type SchemeBody =
  | 'NICEIC'
  | 'NAPIT'
  | 'ELECSA'
  | 'STROMA'
  | 'CERTSURE'
  | 'OTHER'

/** Work extent — what the EIC covers */
export type WorkExtent =
  | 'NEW_INSTALLATION'
  | 'ADDITION'
  | 'ALTERATION'
  | 'NEW_AND_ADDITION'
  | 'OTHER'

// ============================================================
// SECTION A: CLIENT DETAILS
// ============================================================

export interface EICClientDetails {
  /** Client name — person who ordered the work */
  clientName: string
  /** Client postal address with postcode */
  clientAddress: string
}

// ============================================================
// SECTION B: INSTALLATION DETAILS
// ============================================================

export interface EICInstallationDetails {
  /** Address of installation (may differ from client) */
  installationAddress: string
  /** Name of current occupier */
  occupier: string
  /** Type of premises */
  premisesType: PremisesType
  /** Description if premisesType is 'OTHER' */
  otherDescription?: string
}

// ============================================================
// SECTION C: EXTENT OF WORK
// ============================================================

export interface ExtentOfWork {
  /** What kind of work this EIC covers */
  workExtent: WorkExtent
  /** Description if workExtent is 'OTHER' */
  otherDescription?: string
  /** Detailed description of the work carried out */
  descriptionOfWork: string
  /** Date work commenced — ISO format */
  dateCommenced: string
  /** Date work completed — ISO format */
  dateCompleted: string
}

// ============================================================
// SECTION D: DESIGN
// ============================================================

export interface DesignDetails {
  /** Maximum demand in amps (single phase) or kVA (three phase) */
  maxDemand: number | null
  /** Unit for max demand */
  maxDemandUnit: 'AMPS' | 'KVA'
  /** Number of phases designed for */
  numberOfPhases: 1 | 3
  /** Overcurrent protective device characteristics appropriate */
  ocpdCharacteristicsAppropriate: boolean
  /** Circuits adequately sized for intended load */
  circuitsAdequatelySized: boolean
  /** Earth fault loop impedance values permit disconnection in required time */
  disconnectionTimesAchievable: boolean
  /** Surge protection assessment carried out per Chapter 44 */
  spdAssessmentDone: boolean
  /** SPD required based on risk assessment */
  spdRequired: boolean
  /** SPD fitted */
  spdFitted: boolean
  /** Details of any energy efficiency measures considered (Reg 132.19) */
  energyEfficiencyDetails: string
  /** Any comments on the design */
  designComments: string
}

// ============================================================
// SECTION E: DEPARTURES FROM BS 7671
// ============================================================

export interface Departure {
  /** Unique ID (app-generated UUID) */
  id: string
  /** Sequential item number */
  itemNumber: number
  /** BS 7671 regulation departed from */
  regulationReference: string
  /** Description of the departure */
  description: string
  /** Justification — why the departure is acceptable */
  justification: string
  /** Who agreed the departure (designer, client, etc.) */
  agreedBy: string
}

// ============================================================
// SECTION F: DECLARATION — THREE SIGNATORIES
// ============================================================

/**
 * EIC requires three separate declarations:
 *   1. Designer — designed to BS 7671
 *   2. Constructor — constructed to BS 7671 and the design
 *   3. Inspector — inspected and tested, complies
 *
 * On most domestic jobs all three are the same person.
 * On commercial work they may be different people.
 */

export interface DesignerDeclaration {
  /** Designer full name */
  name: string
  /** Company / trading name */
  companyName: string
  /** Company address */
  companyAddress: string
  /** Position / job title */
  position: string
  /** Scheme body membership */
  schemeBody: SchemeBody | null
  /** Registration / membership number */
  registrationNumber: string
  /** Date signed — ISO format */
  dateSigned: string
  /** Digital signature R2 storage key */
  signatureKey: string | null
}

export interface ConstructorDeclaration {
  /** Constructor full name */
  name: string
  /** Company / trading name */
  companyName: string
  /** Company address */
  companyAddress: string
  /** Position / job title */
  position: string
  /** Scheme body membership */
  schemeBody: SchemeBody | null
  /** Registration / membership number */
  registrationNumber: string
  /** Date signed — ISO format */
  dateSigned: string
  /** Digital signature R2 storage key */
  signatureKey: string | null
}

export interface InspectorDeclaration {
  /** Inspector full name */
  name: string
  /** Company / trading name */
  companyName: string
  /** Company address */
  companyAddress: string
  /** Position / job title */
  position: string
  /** Scheme body membership */
  schemeBody: SchemeBody | null
  /** Registration / membership number */
  registrationNumber: string
  /** Date of inspection — ISO format */
  dateInspected: string
  /** Date signed — ISO format */
  dateSigned: string
  /** Digital signature R2 storage key */
  signatureKey: string | null
  /** Qualified Supervisor name (if different from inspector) */
  qsName: string
  /** QS signature R2 key */
  qsSignatureKey: string | null
  /** QS date signed — ISO format */
  qsDateSigned: string
}

export interface EICDeclarations {
  designer: DesignerDeclaration
  constructor: ConstructorDeclaration
  inspector: InspectorDeclaration
  /** All three roles filled by the same person (auto-copies fields) */
  samePersonAllRoles: boolean
}

// ============================================================
// SECTION G: PART P NOTIFICATION
// ============================================================

export interface PartPNotification {
  /** Is this work notifiable under Part P of the Building Regulations? */
  isNotifiable: boolean
  /** Notification submitted to building control */
  notificationSubmitted: boolean
  /** Notification reference / certificate number */
  notificationReference: string
  /** Date notification submitted — ISO format */
  dateSubmitted: string
  /** Scheme body used for notification */
  schemeBody: SchemeBody | null
  /** Building control body name (if not via scheme) */
  buildingControlBody: string
  /** Notes on notification (e.g. exempt work, reason not notifiable) */
  notes: string
}

// ============================================================
// SECTION H: COMMENTS ON EXISTING INSTALLATION
// ============================================================

export interface ExistingInstallationComments {
  /** General condition of existing installation where new work connects */
  generalCondition: string
  /** Any defects observed in existing installation */
  defectsObserved: string
  /** Recommendations for existing installation */
  recommendations: string
}

// ============================================================
// COMPLETE EIC CERTIFICATE
// ============================================================

export interface EICCertificate {
  /** Unique certificate ID (UUID) */
  id: string
  /** Sequential report number */
  reportNumber: string
  /** Certificate type identifier */
  certificateType: 'EIC'
  /** Certificate status in the app workflow */
  status: CertificateStatus
  /** Engineer/user ID (Clerk user ID) */
  engineerId: string

  // --- Certificate Sections ---
  /** Section A: Client details */
  clientDetails: EICClientDetails
  /** Section B: Installation details */
  installationDetails: EICInstallationDetails
  /** Section C: Extent and description of work */
  extentOfWork: ExtentOfWork
  /** Section D: Design details */
  design: DesignDetails
  /** Section E: Departures from BS 7671 */
  departures: Departure[]
  /** Section F: Three declarations */
  declarations: EICDeclarations
  /** Section G: Part P Building Regulations notification */
  partPNotification: PartPNotification
  /** Section H: Comments on existing installation */
  existingInstallation: ExistingInstallationComments

  // --- Shared sections (identical to EICR) ---
  /** Section I: Supply characteristics and earthing */
  supplyCharacteristics: SupplyCharacteristics
  /** Section J: Installation particulars */
  installationParticulars: InstallationParticulars

  // --- Schedules (identical to EICR) ---
  /** Distribution board headers */
  distributionBoards: DistributionBoardHeader[]
  /** Test instrument details */
  testInstruments: TestInstruments
  /** Circuit details and test results */
  circuits: CircuitDetail[]
  /** Inspection schedule items */
  inspectionSchedule: InspectionItem[]

  // --- App Metadata ---
  /** Timestamp created — ISO format */
  createdAt: string
  /** Timestamp last modified — ISO format */
  updatedAt: string
  /** Generated PDF R2 storage key */
  pdfKey: string | null
  /** Offline sync status */
  syncStatus: 'SYNCED' | 'PENDING' | 'CONFLICT'
}
