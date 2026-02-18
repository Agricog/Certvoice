/**
 * Minor Electrical Installation Works Certificate (MEIWC)
 * Per BS 7671 Model Form 3
 *
 * Reuses shared types from eicr.ts where applicable.
 * MW-specific data stored in certificates.type_data JSONB column.
 */

import type {
  ClientDetails,
  EarthingType,
  CertificateStatus,
  TestInstruments,
} from './eicr';

// ── Certificate Type Discriminator ──────────────────────────────
// Shared across all certificate types. Add to certificates table.
export type CertificateType = 'EICR' | 'MINOR_WORKS' | 'EIC';

// ── Part 1: Description of Minor Works ──────────────────────────
export interface MinorWorksDescription {
  descriptionOfWork: string;       // Free text: "Installation of 2No. double sockets in kitchen"
  dateOfCompletion: string;        // ISO date string
  commentsOnExisting: string;      // Comments on existing installation at time of work
}

// ── Part 2: Installation Details (MW-specific) ──────────────────
export interface MinorWorksInstallation {
  earthingType: EarthingType | '';
  methodOfFaultProtection: string; // Usually "ADS" (Automatic Disconnection of Supply)
  existingProtectiveDevice: {
    type: string;                  // e.g. "BS 88-2" / "BS EN 60898" / "BS 3036"
    rating: string;                // e.g. "63A" — the device protecting the origin
  };
}

// ── Part 3: Circuit Details ─────────────────────────────────────
export interface MinorWorksCircuit {
  circuitDescription: string;      // e.g. "Kitchen sockets"
  dbReference: string;             // Distribution board ref, e.g. "DB1"
  circuitDesignation: string;      // Circuit number/ref in the DB
  protectiveDevice: {
    bs: string;                    // BS standard, e.g. "BS EN 60898"
    type: string;                  // e.g. "B" / "C" / "D" (MCB) or "Type A" / "Type AC" (RCBO)
    rating: string;                // e.g. "32" (amps)
  };
  wiringSystem: {
    cableType: string;             // e.g. "T+E" / "SWA" / "MICC"
    csa: string;                   // Cross-sectional area, e.g. "2.5mm²"
    referenceMethod: string;       // Installation method ref, e.g. "C" (clipped direct)
  };
}

// ── Part 4: Test Results ────────────────────────────────────────
export interface MinorWorksTestResults {
  earthContinuity: {
    r1PlusR2: string;              // Ω — earth fault loop path
    r2: string;                    // Ω — cpc only (if measured separately)
  };
  insulationResistance: {
    liveToEarth: string;           // MΩ
    liveToNeutral: string;         // MΩ (if applicable)
  };
  earthFaultLoopImpedance: {
    zs: string;                    // Ω — measured at furthest point
    zsValid: boolean | null;       // Auto-calculated: Zs ≤ max Zs for device
  };
  polarity: 'satisfactory' | 'unsatisfactory' | '';
  rcd: {
    present: boolean;
    ratedResidualCurrent: string;  // mA, e.g. "30"
    operatingTime: string;         // ms, e.g. "18"
  };
  functionalTesting: 'satisfactory' | 'unsatisfactory' | '';
}

// ── Part 5: Declaration ─────────────────────────────────────────
export interface MinorWorksDeclaration {
  contractorName: string;          // Company/trading name
  contractorAddress: string;
  contractorTelephone: string;
  contractorEmail: string;
  installerName: string;           // Person who did the work
  installerSignature: string;      // Base64 or R2 URL
  installerDate: string;           // ISO date
  schemeProvider: string;          // e.g. "NAPIT" / "NICEIC" / "ELECSA"
  schemeMembershipNumber: string;  // Registration number
}

// ── Part 6: Next Inspection ─────────────────────────────────────
export interface MinorWorksNextInspection {
  recommendedDate: string;         // ISO date
  reason: string;                  // e.g. "Change of occupancy" / "10 years (domestic)"
}

// ── Scheme Notification (baked in from day one) ─────────────────
export interface SchemeNotificationData {
  /** Part P building regulation notification required? */
  partPRequired: boolean;
  /** Has notification been submitted to scheme? */
  notificationSubmitted: boolean;
  /** Submission date (if submitted) */
  notificationDate: string;
  /** Scheme reference number (returned by portal) */
  schemeReference: string;
  /** Pre-formatted fields matching NAPIT/NICEIC portal structure */
  portalFields: Record<string, string>;
}

// ── Complete Minor Works Certificate ────────────────────────────
export interface MinorWorksCertificate {
  /** Discriminator — always 'MINOR_WORKS' */
  certificateType: 'MINOR_WORKS';

  /** Shared fields (stored in certificates table columns) */
  id: string;
  engineerId: string;
  status: CertificateStatus;
  createdAt: string;
  updatedAt: string;

  /** Client & address (shared with EICR) */
  clientDetails: ClientDetails;

  /** MW-specific sections (stored in type_data JSONB) */
  description: MinorWorksDescription;
  installation: MinorWorksInstallation;
  circuit: MinorWorksCircuit;
  testResults: MinorWorksTestResults;
  testInstruments: TestInstruments;
  declaration: MinorWorksDeclaration;
  nextInspection: MinorWorksNextInspection;
  schemeNotification: SchemeNotificationData;
}

// ── Empty defaults (for new certificate creation) ───────────────

export const EMPTY_MW_DESCRIPTION: MinorWorksDescription = {
  descriptionOfWork: '',
  dateOfCompletion: '',
  commentsOnExisting: '',
};

export const EMPTY_MW_INSTALLATION: MinorWorksInstallation = {
  earthingType: '',
  methodOfFaultProtection: 'ADS',
  existingProtectiveDevice: { type: '', rating: '' },
};

export const EMPTY_MW_CIRCUIT: MinorWorksCircuit = {
  circuitDescription: '',
  dbReference: '',
  circuitDesignation: '',
  protectiveDevice: { bs: '', type: '', rating: '' },
  wiringSystem: { cableType: '', csa: '', referenceMethod: '' },
};

export const EMPTY_MW_TEST_RESULTS: MinorWorksTestResults = {
  earthContinuity: { r1PlusR2: '', r2: '' },
  insulationResistance: { liveToEarth: '', liveToNeutral: '' },
  earthFaultLoopImpedance: { zs: '', zsValid: null },
  polarity: '',
  rcd: { present: false, ratedResidualCurrent: '', operatingTime: '' },
  functionalTesting: '',
};

export const EMPTY_MW_DECLARATION: MinorWorksDeclaration = {
  contractorName: '',
  contractorAddress: '',
  contractorTelephone: '',
  contractorEmail: '',
  installerName: '',
  installerSignature: '',
  installerDate: '',
  schemeProvider: '',
  schemeMembershipNumber: '',
};

export const EMPTY_MW_NEXT_INSPECTION: MinorWorksNextInspection = {
  recommendedDate: '',
  reason: '',
};

export const EMPTY_SCHEME_NOTIFICATION: SchemeNotificationData = {
  partPRequired: true,  // Minor Works almost always requires Part P
  notificationSubmitted: false,
  notificationDate: '',
  schemeReference: '',
  portalFields: {},
};
