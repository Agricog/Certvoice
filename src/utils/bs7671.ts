/**
 * CertVoice — BS 7671 Lookup Tables
 *
 * Based on: IET BS 7671:2018+A2:2022
 * Tables 41.2, 41.3, 41.4, and related references.
 *
 * These tables power:
 *   - Max permitted Zs auto-calculation (Column 12)
 *   - Disconnect time validation
 *   - AI extraction validation
 *   - Classification code suggestions
 *   - Inspection interval recommendations
 */

import type { EarthingType, OCPDType, PremisesType } from '../types/eicr'

// ============================================================
// MAX Zs TABLES (Tables 41.2, 41.3, 41.4)
// ============================================================

/**
 * Maximum earth fault loop impedance (Zs) values in ohms.
 * Lookup by: earthing type → OCPD type → rating in amps.
 *
 * These are the 0.8 corrected values (measured at ambient temperature).
 * BS 7671 Table 41.2 (0.4s), 41.3 (5s), 41.4 (TT systems).
 *
 * Key: `${earthingType}_${ocpdType}${rating}`
 * Value: Max Zs in ohms
 */

/** Table 41.2/41.3 — TN systems (TN-C, TN-S, TN-C-S) — 0.4s disconnect */
const MAX_ZS_TN_04S: Record<string, number> = {
  // Type B MCBs — 0.4s (final circuits)
  'B6': 7.28,
  'B10': 4.37,
  'B16': 2.73,
  'B20': 2.19,
  'B25': 1.75,
  'B32': 1.37,
  'B40': 1.09,
  'B50': 0.87,
  'B63': 0.69,

  // Type C MCBs — 0.4s (final circuits)
  'C6': 3.64,
  'C10': 2.19,
  'C16': 1.37,
  'C20': 1.09,
  'C25': 0.87,
  'C32': 0.68,
  'C40': 0.55,
  'C50': 0.44,
  'C63': 0.35,

  // Type D MCBs — 0.4s (final circuits)
  'D6': 1.82,
  'D10': 1.09,
  'D16': 0.68,
  'D20': 0.55,
  'D25': 0.44,
  'D32': 0.34,
  'D40': 0.27,
  'D50': 0.22,
  'D63': 0.17,
}

/** Table 41.3 — TN systems — 5s disconnect (distribution circuits) */
const MAX_ZS_TN_5S: Record<string, number> = {
  // Type B MCBs — 5s (distribution circuits)
  'B6': 14.57,
  'B10': 8.74,
  'B16': 5.47,
  'B20': 4.37,
  'B25': 3.50,
  'B32': 2.73,
  'B40': 2.19,
  'B50': 1.75,
  'B63': 1.39,

  // Type C MCBs — 5s
  'C6': 7.28,
  'C10': 4.37,
  'C16': 2.73,
  'C20': 2.19,
  'C25': 1.75,
  'C32': 1.37,
  'C40': 1.09,
  'C50': 0.87,
  'C63': 0.69,

  // Type D MCBs — 5s
  'D6': 3.64,
  'D10': 2.19,
  'D16': 1.37,
  'D20': 1.09,
  'D25': 0.87,
  'D32': 0.68,
  'D40': 0.55,
  'D50': 0.44,
  'D63': 0.35,
}

/** Table 41.4 — TT systems — Zs limited by RCD (not OCPD) */
const MAX_ZS_TT: Record<number, number> = {
  // RCD rated residual current (mA) → max Zs (ohms)
  // Formula: Zs × IΔn ≤ 50V → Zs ≤ 50 / (IΔn in amps)
  10: 5000,   // Unlikely but included
  30: 1667,
  100: 500,
  300: 167,
  500: 100,
}

// ============================================================
// MAX Zs LOOKUP FUNCTION
// ============================================================

/**
 * Look up the maximum permitted Zs for a circuit.
 *
 * @param earthingType - Installation earthing arrangement
 * @param ocpdType - MCB type letter (B, C, D)
 * @param ocpdRating - MCB rating in amps
 * @param isDistributionCircuit - True for distribution circuits (5s), false for final (0.4s)
 * @param rcdRatingMa - RCD rating in mA (required for TT systems)
 * @returns Max permitted Zs in ohms, or null if lookup fails
 */
export function getMaxPermittedZs(
  earthingType: EarthingType | null,
  ocpdType: OCPDType | null,
  ocpdRating: number | null,
  isDistributionCircuit: boolean = false,
  rcdRatingMa?: number | null
): number | null {
  if (!earthingType || !ocpdType || !ocpdRating) {
    return null
  }

  // TT systems — Zs limited by RCD, not OCPD
  if (earthingType === 'TT') {
    if (!rcdRatingMa) return null
    const ttZs = MAX_ZS_TT[rcdRatingMa]
    return ttZs ?? null
  }

  // TN systems — lookup from OCPD tables
  const key = `${ocpdType}${ocpdRating}`
  const table = isDistributionCircuit ? MAX_ZS_TN_5S : MAX_ZS_TN_04S
  const maxZs = table[key]

  return maxZs ?? null
}

// ============================================================
// DISCONNECT TIME LOOKUP
// ============================================================

/**
 * Get the maximum disconnection time for a circuit.
 *
 * @param isDistributionCircuit - True for distribution circuits
 * @param isSpecialLocation - True for bathrooms, swimming pools, etc.
 * @returns Max disconnect time in seconds
 */
export function getMaxDisconnectTime(
  isDistributionCircuit: boolean,
  isSpecialLocation: boolean = false
): number {
  if (isSpecialLocation) return 0.2
  if (isDistributionCircuit) return 5.0
  return 0.4
}

// ============================================================
// INSPECTION INTERVAL RECOMMENDATIONS
// ============================================================

/** Recommended inspection intervals per GN3 Table 3.2 */
const INSPECTION_INTERVALS: Record<string, { years: number; reference: string }> = {
  DOMESTIC: {
    years: 10,
    reference: 'Domestic premises per IET GN3 Table 3.2 (change of occupancy: before new occupant)',
  },
  COMMERCIAL: {
    years: 5,
    reference: 'Commercial premises per IET GN3 Table 3.2',
  },
  INDUSTRIAL: {
    years: 3,
    reference: 'Industrial premises per IET GN3 Table 3.2',
  },
  OTHER: {
    years: 5,
    reference: 'Per IET GN3 Table 3.2 — confirm with specific premises type',
  },
}

/**
 * Get recommended next inspection interval.
 *
 * @param premisesType - Type of premises
 * @returns Interval in years and the regulatory reference
 */
export function getInspectionInterval(
  premisesType: PremisesType
): { years: number; reference: string } {
  return INSPECTION_INTERVALS[premisesType] ?? INSPECTION_INTERVALS.OTHER
}

/**
 * Calculate next inspection date from current date.
 *
 * @param premisesType - Type of premises
 * @param fromDate - Date to calculate from (default: today)
 * @returns ISO date string for next inspection
 */
export function getNextInspectionDate(
  premisesType: PremisesType,
  fromDate: Date = new Date()
): string {
  const interval = getInspectionInterval(premisesType)
  const nextDate = new Date(fromDate)
  nextDate.setFullYear(nextDate.getFullYear() + interval.years)
  return nextDate.toISOString().split('T')[0] ?? ''
}

// ============================================================
// WIRING TYPE DESCRIPTIONS
// ============================================================

/** Human-readable wiring type descriptions for Column 3 */
export const WIRING_TYPE_DESCRIPTIONS: Record<string, string> = {
  'A': 'Thermoplastic twin and earth (T&E)',
  'B': 'PVC in metallic conduit',
  'C': 'PVC in non-metallic conduit',
  'D': 'PVC in metallic trunking',
  'E': 'PVC in non-metallic trunking',
  'F': 'PVC steel wire armoured (SWA)',
  'G': 'XLPE steel wire armoured (SWA)',
  'H': 'Mineral insulated (MI)',
  'O': 'Other',
}

// ============================================================
// REFERENCE METHOD DESCRIPTIONS
// ============================================================

/** Human-readable reference method descriptions for Column 4 */
export const REFERENCE_METHOD_DESCRIPTIONS: Record<string, string> = {
  'A': 'Enclosed in conduit in thermally insulating wall',
  'B': 'Enclosed in conduit on wall or in trunking',
  'C': 'Clipped direct',
  'D': 'In free air',
  'E': 'In free air (multi-core)',
  'F': 'SWA clipped direct',
  'G': 'Spaced from surface',
}

// ============================================================
// CLASSIFICATION CODE DEFINITIONS
// ============================================================

/** Full classification code definitions for PDF output and UI */
export const CLASSIFICATION_DEFINITIONS: Record<string, {
  meaning: string
  definition: string
  action: string
  makesUnsatisfactory: boolean
}> = {
  'C1': {
    meaning: 'Danger Present',
    definition: 'Risk of injury exists NOW',
    action: 'Immediate remedial action required. Make safe on discovery if possible.',
    makesUnsatisfactory: true,
  },
  'C2': {
    meaning: 'Potentially Dangerous',
    definition: 'Risk of injury could occur',
    action: 'Urgent remedial action required.',
    makesUnsatisfactory: true,
  },
  'C3': {
    meaning: 'Improvement Recommended',
    definition: 'Does not meet current regulations but is not dangerous',
    action: 'Should be given due consideration.',
    makesUnsatisfactory: false,
  },
  'FI': {
    meaning: 'Further Investigation',
    definition: 'Cannot fully identify — may reveal C1 or C2',
    action: 'Investigate without delay.',
    makesUnsatisfactory: true,
  },
}

// ============================================================
// COMMON REGULATION REFERENCES
// ============================================================

/** Frequently referenced regulations for AI auto-suggest */
export const COMMON_REGULATIONS: Record<string, string> = {
  // Earthing and bonding
  '411.3.1.1': 'Automatic disconnection of supply — TN systems',
  '411.3.1.2': 'Automatic disconnection of supply — TT systems',
  '411.4.204': 'RCD protection for fault protection',
  '411.3.3': 'Additional protection by RCD ≤30mA',
  '411.3.4': 'Additional protection for luminaires in domestic premises',
  '415.1': 'Additional protection',
  '514.13.1': 'Earthing/bonding labels',
  '522.6.202': 'Cables in prescribed zones',
  '522.6.203': 'Cables in walls/partitions — RCD protection',
  '522.6.204': 'Cables with earthed armour/sheath',
  '522.8.5': 'Cable support',
  '526.1': 'Conductor connections — tight and secure',
  '527': 'Fire barriers and sealing',
  '531.2': 'RCD selection',
  '542.1.2.1': 'Earthing — distributor facility',
  '543.1.1': 'Earthing conductor sizing',
  '544.1': 'Main protective bonding conductor sizing',
  // Consumer unit
  '421.1.201': 'Consumer unit enclosure fire rating',
  '462.1.201': 'Main linked switch',
  '514.8.1': 'Circuit identification',
  '514.9.1': 'Circuit charts/schedules',
  '514.12.2': 'RCD test notice',
  '514.15': 'Alternative supply warning notice',
  // Bathrooms
  '701.411.3.3': 'Bathroom additional protection — 30mA RCD',
  '701.414.4.5': 'Bathroom SELV/PELV requirements',
  '701.415.2': 'Bathroom supplementary bonding',
  '701.512.2': 'Bathroom IP rating for zones',
  '701.512.3': 'Bathroom accessories and shaver units',
  // General
  '132.12': 'Working space and accessibility',
  '134.1.1': 'Security of fixing',
  '416.1': 'Insulation of live parts',
  '416.2': 'Enclosure IP rating',
  '433.1': 'Overload protection coordination',
  '521.10.1': 'Non-sheathed cables in enclosures',
  '521.10.202': 'Cable support requirements',
  '528.1': 'Band II separated from Band I',
  '651.2': 'Condition assessment — damage/deterioration',
  '651.4': 'SPD functional indicator',
}

// ============================================================
// EARTHING TYPE DESCRIPTIONS
// ============================================================

/** Human-readable earthing type descriptions */
export const EARTHING_TYPE_DESCRIPTIONS: Record<string, string> = {
  'TN_C': 'TN-C — Combined neutral and earth (PEN conductor)',
  'TN_S': 'TN-S — Separate neutral and earth from supply',
  'TN_C_S': 'TN-C-S — PME (protective multiple earthing)',
  'TT': 'TT — Earth rod / installation electrode',
  'IT': 'IT — Isolated earth (rare in UK)',
}
