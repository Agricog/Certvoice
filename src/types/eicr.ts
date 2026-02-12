/**
 * CertVoice — EICR TypeScript Type Definitions
 *
 * Based on: IET BS 7671:2018+A2:2022 Appendix 6 Model Forms
 * Every interface maps directly to a section of the official EICR form.
 *
 * Naming convention:
 *   - Interfaces: PascalCase (e.g. CircuitDetail)
 *   - Fields: camelCase matching the form field (e.g. earthingType)
 *   - Enums/unions: UPPER_SNAKE for codes (e.g. 'TN_C_S'), lowercase for general
 */

// ============================================================
// SHARED ENUMS & CONSTANTS
// ============================================================

/** Classification codes per BS 7671 — determines overall assessment */
export type ClassificationCode = 'C1' | 'C2' | 'C3' | 'FI'

/** Inspection schedule outcome codes */
export type InspectionOutcome = 'PASS' | 'C1' | 'C2' | 'C3' | 'FI' | 'NV' | 'LIM' | 'NA'

/** Overall certificate assessment — auto-derived from observations */
export type OverallAssessment = 'SATISFACTORY' | 'UNSATISFACTORY'

/** Earthing arrangement types */
export type EarthingType = 'TN_C' | 'TN_S' | 'TN_C_S' | 'TT' | 'IT'

/** Supply type */
export type SupplyType = 'AC' | 'DC'

/** Conductor configuration */
export type ConductorConfig =
  | '1PH_2WIRE'
  | '2PH_3WIRE'
  | '3PH_3WIRE'
  | '3PH_4WIRE'

/** Premises type */
export type PremisesType = 'DOMESTIC' | 'COMMERCIAL' | 'INDUSTRIAL' | 'OTHER'

/** Reason for producing report */
export type ReportPurpose =
  | 'PERIODIC'
  | 'CHANGE_OF_OCCUPANCY'
  | 'MORTGAGE'
  | 'INSURANCE'
  | 'SAFETY_CONCERN'
  | 'OTHER'

/** Wiring type codes (Column 3) */
export type WiringTypeCode =
  | 'A'  // T&E (thermoplastic twin and earth)
  | 'B'  // PVC in metallic conduit
  | 'C'  // PVC in non-metallic conduit
  | 'D'  // PVC in metallic trunking
  | 'E'  // PVC in non-metallic trunking
  | 'F'  // PVC SWA (steel wire armoured)
  | 'G'  // XLPE SWA
  | 'H'  // MI (mineral insulated)
  | 'O'  // Other

/** Reference method codes (Column 4) — BS 7671 installation methods */
export type ReferenceMethod = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G'

/** OCPD (overcurrent protective device) type letter */
export type OCPDType = 'B' | 'C' | 'D'

/** RCD type */
export type RCDType = 'A' | 'AC' | 'B' | 'F' | 'S'

/** SPD (surge protective device) type */
export type SPDType = 'T1' | 'T2' | 'T3' | 'NA'

/** Conductor material */
export type ConductorMaterial = 'COPPER' | 'ALUMINIUM'

/** Bonding status for extraneous-conductive-parts */
export type BondingStatus = 'SATISFACTORY' | 'NA' | 'UNSATISFACTORY'

/** Circuit type — ring or radial */
export type CircuitType = 'RING' | 'RADIAL'

/** Certificate status in the app */
export type CertificateStatus =
  | 'DRAFT'
  | 'IN_PROGRESS'
  | 'REVIEW'
  | 'COMPLETE'
  | 'ISSUED'

/** Tick/cross/NA for simple confirmations */
export type TickStatus = 'TICK' | 'CROSS' | 'NA'

/** Test value that can be a number, '>200', 'LIM', or 'N/V' */
export type TestValue = number | '>200' | 'LIM' | 'N/V'

// ============================================================
// SECTION A: CLIENT DETAILS
// ============================================================

export interface ClientDetails {
  /** Client name — person ordering the report */
  clientName: string
  /** Client postal address with postcode */
  clientAddress: string
}

// ============================================================
// SECTION B: REASON FOR REPORT
// ============================================================

export interface ReportReason {
  /** Purpose of inspection */
  purpose: ReportPurpose
  /** Date(s) of inspection — can span multiple days. ISO format. */
  inspectionDates: string[]
}

// ============================================================
// SECTION C: INSTALLATION DETAILS
// ============================================================

export interface InstallationDetails {
  /** Address of property being inspected (may differ from client) */
  installationAddress: string
  /** Name of current occupier */
  occupier: string
  /** Type of premises */
  premisesType: PremisesType
  /** Description if premisesType is 'OTHER' */
  otherDescription?: string
  /** Estimated age of electrical wiring in years */
  estimatedAgeOfWiring: number | null
  /** Evidence of additions/alterations to the installation */
  evidenceOfAdditions: boolean
  /** Estimated age of additions in years */
  additionsEstimatedAge?: number | null
  /** Previous installation records available */
  installationRecordsAvailable: boolean
  /** Date of last inspection — ISO format or null if N/A */
  dateOfLastInspection: string | null
}

// ============================================================
// SECTION D: EXTENT AND LIMITATIONS
// ============================================================

export interface ExtentAndLimitations {
  /** Extent of installation covered by this report */
  extentCovered: string
  /** Agreed limitations — CRITICAL for liability */
  agreedLimitations: string
  /** Person who agreed the limitations */
  agreedWith: string
  /** Operational limitations encountered during inspection */
  operationalLimitations: string
}

// ============================================================
// SECTION E: SUMMARY OF CONDITION
// ============================================================

export interface SummaryOfCondition {
  /** General condition description — free text */
  generalCondition: string
  /** Overall assessment — auto-calculated from observations */
  overallAssessment: OverallAssessment
}

// ============================================================
// SECTION F: RECOMMENDATIONS
// ============================================================

export interface Recommendations {
  /** Recommended date for next inspection — ISO format */
  nextInspectionDate: string
  /** Reason for recommended interval */
  reasonForInterval: string
  /** Remedial urgency text — auto-generated from C1/C2 observations */
  remedialUrgency: string
}

// ============================================================
// SECTION G: DECLARATION
// ============================================================

export interface Declaration {
  /** Inspector full name (in capitals on form) */
  inspectorName: string
  /** Inspector digital signature — R2 storage key */
  inspectorSignatureKey: string | null
  /** Company trading name */
  companyName: string
  /** Inspector's position / job title */
  position: string
  /** Company full address */
  companyAddress: string
  /** Date inspection completed — ISO format */
  dateInspected: string
  /** Qualified Supervisor name */
  qsName: string
  /** QS digital signature — R2 storage key */
  qsSignatureKey: string | null
  /** Date report authorised by QS — ISO format */
  qsDate: string
  /** NICEIC / NAPIT / ELECSA registration number */
  registrationNumber: string
}

// ============================================================
// SECTION I: SUPPLY CHARACTERISTICS & EARTHING
// ============================================================

export interface SupplyCharacteristics {
  // --- Earthing Arrangements ---
  /** Earthing system type */
  earthingType: EarthingType | null
  // --- Live Conductors ---
  /** AC or DC supply */
  supplyType: SupplyType
  /** Conductor configuration */
  conductorConfig: ConductorConfig
  /** Supply polarity confirmed by test */
  supplyPolarityConfirmed: boolean
  /** Other sources of supply present */
  otherSourcesPresent: boolean
  /** Description of other sources (e.g. Solar PV) */
  otherSourcesDescription?: string
  // --- Supply Parameters ---
  /** Nominal voltage in volts (domestic 230V, 3-phase 400V) */
  nominalVoltage: number | null
  /** Nominal frequency in Hz (always 50 in UK) */
  nominalFrequency: number
  /** Prospective fault current in kA */
  ipf: number | null
  /** External earth fault loop impedance in ohms */
  ze: number | null
  // --- Supply Protective Device ---
  /** BS (EN) standard number of supply fuse */
  supplyDeviceBsEn: string
  /** Supply device type description */
  supplyDeviceType: string
  /** Supply device rated current in amps */
  supplyDeviceRating: number | null
}

// ============================================================
// SECTION J: INSTALLATION PARTICULARS
// ============================================================

export interface InstallationParticulars {
  // --- Means of Earthing ---
  /** Earth provided by distributor (DNO) */
  distributorFacility: boolean
  /** Installation earth electrode present (TT systems) */
  installationElectrode: boolean

  // --- Earth Electrode Details (if applicable) ---
  /** Electrode type (rod, tape, plate, etc.) */
  electrodeType?: string
  /** Physical location of electrode */
  electrodeLocation?: string
  /** Electrode resistance in ohms */
  electrodeResistance?: number | null

  // --- Main Switch ---
  /** Physical location of main switch */
  mainSwitchLocation: string
  /** Main switch BS (EN) standard */
  mainSwitchBsEn: string
  /** Number of poles (1, 2, 3, or 4) */
  mainSwitchPoles: number | null
  /** Current rating in amps */
  mainSwitchCurrentRating: number | null
  /** Fuse/device rating in amps (may differ from current rating) */
  mainSwitchDeviceRating: number | null
  /** Voltage rating in volts */
  mainSwitchVoltageRating: number | null
  /** RCD type (if main switch incorporates RCD) */
  mainSwitchRcdType?: RCDType | null
  /** Rated residual current IΔn in mA */
  mainSwitchRcdRating?: number | null
  /** Rated time delay in ms (for selective RCDs) */
  mainSwitchRcdTimeDelay?: number | null
  /** Measured RCD operating time in ms */
  mainSwitchRcdMeasuredTime?: number | null

  // --- Earthing Conductor ---
  /** Earthing conductor material */
  earthingConductorMaterial: ConductorMaterial
  /** Earthing conductor cross-sectional area in mm² */
  earthingConductorCsa: number | null
  /** Earthing conductor connection verified by test */
  earthingConductorVerified: boolean

  // --- Main Protective Bonding ---
  /** Bonding conductor material */
  bondingConductorMaterial: ConductorMaterial
  /** Bonding conductor cross-sectional area in mm² */
  bondingConductorCsa: number | null
  /** Bonding conductor connection verified by test */
  bondingConductorVerified: boolean

  // --- Bonding of Extraneous-Conductive-Parts ---
  /** Bonding to water pipes */
  bondingWater: BondingStatus
  /** Bonding to gas pipes */
  bondingGas: BondingStatus
  /** Bonding to oil pipes */
  bondingOil: BondingStatus
  /** Bonding to structural steel */
  bondingSteel: BondingStatus
  /** Bonding to lightning protection */
  bondingLightning: BondingStatus
  /** Bonding to other (specify) */
  bondingOther: BondingStatus
  /** Description of other bonded parts */
  bondingOtherDescription?: string
}

// ============================================================
// SECTION K: OBSERVATIONS AND RECOMMENDATIONS
// ============================================================

export interface Observation {
  /** Unique ID (app-generated UUID) */
  id: string
  /** Auto-incrementing item number within report */
  itemNumber: number
  /** Full observation text — the core voice capture output */
  observationText: string
  /** Classification code */
  classificationCode: ClassificationCode
  /** Distribution board reference */
  dbReference: string
  /** Circuit reference (if applicable) */
  circuitReference: string
  /** Physical location */
  location: string
  /** BS 7671 regulation reference — AI auto-suggests */
  regulationReference: string
  /** Photo evidence R2 storage keys */
  photoKeys: string[]
  /** Remedial action description */
  remedialAction: string
}

// ============================================================
// DISTRIBUTION BOARD HEADER (one per board)
// ============================================================

export interface DistributionBoardHeader {
  /** Unique ID (app-generated UUID) */
  id: string
  /** Board identifier (e.g. 'DB1', 'Main CU') */
  dbReference: string
  /** Physical location of board */
  dbLocation: string
  /** Upstream supply source */
  suppliedFrom: string
  /** Distribution OCPD BS (EN) standard */
  distOcpdBsEn: string
  /** Distribution OCPD type (B, C, D) */
  distOcpdType: string
  /** Distribution OCPD rating in amps */
  distOcpdRating: number | null
  /** Number of phases (1 or 3) */
  numberOfPhases: 1 | 3
  /** Surge protective device type */
  spdType: SPDType
  /** SPD status confirmed */
  spdStatusConfirmed: boolean
  /** Polarity confirmed by test */
  polarityConfirmed: boolean
  /** Phase sequence confirmed (3-phase only) */
  phaseSequenceConfirmed: boolean | null
  /** Zs at distribution board in ohms */
  zsAtDb: number | null
  /** Prospective fault current at DB in kA */
  ipfAtDb: number | null
}

// ============================================================
// TEST INSTRUMENT DETAILS (one per schedule)
// ============================================================

export interface TestInstruments {
  /** Multifunction instrument make, model, serial */
  multifunctionInstrument: string
  /** Insulation resistance instrument (if separate) */
  insulationResistance: string
  /** Continuity instrument (if separate) */
  continuity: string
  /** Earth electrode resistance instrument (if separate) */
  earthElectrodeResistance: string
  /** Earth fault loop impedance instrument (if separate) */
  earthFaultLoopImpedance: string
  /** RCD tester (if separate) */
  rcdTester: string
}

// ============================================================
// CIRCUIT DETAIL — COLUMNS 1-31
// The core voice capture data per circuit
// ============================================================

export interface CircuitDetail {
  /** Unique ID (app-generated UUID) */
  id: string
  /** Parent distribution board ID */
  dbId: string

  // --- Circuit Details (Columns 1-16) ---

  /** Col 1: Circuit number/designation. Can include phase: L1, L2, L3, TP */
  circuitNumber: string
  /** Col 2: Circuit description (e.g. 'Kitchen ring final', 'Landing lights') */
  circuitDescription: string
  /** Col 3: Type of wiring code */
  wiringType: WiringTypeCode | null
  /** Col 4: Reference method */
  referenceMethod: ReferenceMethod | null
  /** Col 5: Number of points/outlets served */
  numberOfPoints: number | null
  /** Col 6: Live conductor cross-sectional area in mm² */
  liveConductorCsa: number | null
  /** Col 7: CPC cross-sectional area in mm² */
  cpcCsa: number | null
  /** Col 8: Max disconnection time in seconds (auto from BS 7671) */
  maxDisconnectTime: number | null
  /** Col 9: OCPD BS (EN) standard number */
  ocpdBsEn: string
  /** Col 10: OCPD type letter */
  ocpdType: OCPDType | null
  /** Col 11: OCPD rating in amps */
  ocpdRating: number | null
  /** Col 12: Max permitted Zs in ohms (auto-calculated from BS 7671 tables) */
  maxPermittedZs: number | null
  /** Col 13: Breaking capacity in kA */
  breakingCapacity: number | null
  /** Col 14: RCD BS (EN) standard number */
  rcdBsEn: string
  /** Col 15: RCD type */
  rcdType: RCDType | null
  /** Col 16: RCD IΔn rated residual current in mA */
  rcdRating: number | null

  // --- Test Results (Columns 17-31) ---

  // Continuity (17-22)
  /** Col 17: r1 — line conductor end-to-end (ring finals) in ohms */
  r1: TestValue | null
  /** Col 18: rn — neutral conductor end-to-end (ring finals) in ohms */
  rn: TestValue | null
  /** Col 19: r2 — CPC end-to-end (ring finals) in ohms */
  r2: TestValue | null
  /** Col 20: R1+R2 — line + CPC resistance in ohms */
  r1r2: TestValue | null
  /** Col 21: R1+R2 or R2 — for radials same as col 20, for rings = r2 */
  r1r2OrR2: TestValue | null
  /** Col 22: R2 — CPC resistance in ohms */
  r2Standalone: TestValue | null

  // Insulation Resistance (23-25)
  /** Col 23: Test voltage in volts (250V or 500V) */
  irTestVoltage: number | null
  /** Col 24: Insulation resistance live-live (L-N) in MΩ */
  irLiveLive: TestValue | null
  /** Col 25: Insulation resistance live-earth (L-E) in MΩ */
  irLiveEarth: TestValue | null

  // Earth Fault Loop Impedance (26)
  /** Col 26: Zs measured in ohms — KEY VALIDATION against col 12 */
  zs: number | null

  // Polarity (27)
  /** Col 27: Polarity correct */
  polarity: TickStatus

  // RCD Tests (28-30)
  /** Col 28: RCD disconnection time in ms (tested at IΔn) */
  rcdDisconnectionTime: number | null
  /** Col 29: RCD test button operation confirmed */
  rcdTestButton: TickStatus
  /** Col 30: AFDD test button operation (if fitted) */
  afddTestButton: TickStatus

  // Remarks (31)
  /** Col 31: Remarks — reasons for LIM, vulnerable equipment warnings, etc. */
  remarks: string

  // --- App Metadata ---
  /** Circuit type (ring or radial) — inferred from test data */
  circuitType: CircuitType | null
  /** Circuit status — satisfactory or has issues */
  status: 'SATISFACTORY' | 'UNSATISFACTORY' | 'INCOMPLETE'
  /** Validation warnings generated by app */
  validationWarnings: string[]
}

// ============================================================
// INSPECTION SCHEDULE ITEM
// 70+ items — visual checklist with tap outcomes
// ============================================================

export interface InspectionItem {
  /** Unique ID (app-generated) */
  id: string
  /** Item reference number (e.g. '1.1', '4.13', '5.12b') */
  itemRef: string
  /** Section number (1-8) */
  section: number
  /** Section title (e.g. 'INTAKE EQUIPMENT', 'CONSUMER UNIT') */
  sectionTitle: string
  /** Item description — regulation text */
  description: string
  /** Regulation reference (e.g. '542.1.2.1/.2') */
  regulationRef: string
  /** Outcome — tap selection */
  outcome: InspectionOutcome | null
  /** Additional voice notes for non-pass items */
  notes: string
}

// ============================================================
// COMPLETE EICR CERTIFICATE
// Combines all sections into one document
// ============================================================

export interface EICRCertificate {
  /** Unique certificate ID (UUID) */
  id: string
  /** Sequential report number (displayed on every page) */
  reportNumber: string
  /** Certificate status in the app workflow */
  status: CertificateStatus
  /** Engineer/inspector ID (Clerk user ID) */
  engineerId: string

  // --- Certificate Sections ---
  /** Section A: Client details */
  clientDetails: ClientDetails
  /** Section B: Reason for report */
  reportReason: ReportReason
  /** Section C: Installation details */
  installationDetails: InstallationDetails
  /** Section D: Extent and limitations */
  extentAndLimitations: ExtentAndLimitations
  /** Section E: Summary of condition (auto-calculated) */
  summaryOfCondition: SummaryOfCondition
  /** Section F: Recommendations */
  recommendations: Recommendations
  /** Section G: Declaration and signatures */
  declaration: Declaration
  /** Section I: Supply characteristics and earthing */
  supplyCharacteristics: SupplyCharacteristics
  /** Section J: Installation particulars */
  installationParticulars: InstallationParticulars
  /** Section K: Observations (0 or more per report) */
  observations: Observation[]

  // --- Schedules ---
  /** Distribution board headers (1 or more per report) */
  distributionBoards: DistributionBoardHeader[]
  /** Test instrument details */
  testInstruments: TestInstruments
  /** Circuit details and test results (per circuit, per board) */
  circuits: CircuitDetail[]
  /** Inspection schedule items (70+ checklist items) */
  inspectionSchedule: InspectionItem[]

  // --- App Metadata ---
  /** Timestamp created — ISO format */
  createdAt: string
  /** Timestamp last modified — ISO format */
  updatedAt: string
  /** Generated PDF R2 storage key (null until generated) */
  pdfKey: string | null
  /** Offline sync status */
  syncStatus: 'SYNCED' | 'PENDING' | 'CONFLICT'
}

// ============================================================
// ENGINEER PROFILE
// Pre-fill data stored in settings
// ============================================================

export interface EngineerProfile {
  /** Clerk user ID */
  userId: string
  /** Full name */
  fullName: string
  /** Company trading name */
  companyName: string
  /** Company full address */
  companyAddress: string
  /** Position / job title */
  position: string
  /** NICEIC / NAPIT / ELECSA registration number */
  registrationNumber: string
  /** Scheme body name */
  schemeBody: string
  /** Digital signature R2 key */
  signatureKey: string | null
  /** Default test instruments (pre-filled per schedule) */
  testInstruments: TestInstruments
  /** Company logo R2 key (for PDF branding) */
  companyLogoKey: string | null
  /** Phone number */
  phone: string
  /** Email */
  email: string
}

// ============================================================
// JOB / INSPECTION RECORD
// Links a certificate to a property and client
// ============================================================

export interface Job {
  /** Unique job ID (UUID) */
  id: string
  /** Engineer ID */
  engineerId: string
  /** Certificate ID (linked after creation) */
  certificateId: string | null
  /** Client name */
  clientName: string
  /** Property address */
  propertyAddress: string
  /** Property postcode */
  postcode: string
  /** Job date — ISO format */
  jobDate: string
  /** Job status */
  status: 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETE' | 'CANCELLED'
  /** Notes */
  notes: string
  /** Created timestamp */
  createdAt: string
  /** Updated timestamp */
  updatedAt: string
}
