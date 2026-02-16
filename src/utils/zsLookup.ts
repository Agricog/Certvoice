/**
 * CertVoice — BS 7671:2018+A2:2022 Max Zs Lookup
 *
 * Calculates maximum permitted earth fault loop impedance (Zs)
 * based on OCPD type and rating.
 *
 * Formula: Zs = (Uo × Cmin) / If
 *
 * Where:
 *   Uo   = 230V (UK nominal line voltage)
 *   Cmin = 0.95 (voltage factor per 18th Edition Amendment 2)
 *   If   = fault current causing disconnection in required time
 *
 * Magnetic trip multiples (0.4s — socket/portable circuits, TN systems):
 *   Type B: 5 × In
 *   Type C: 10 × In
 *   Type D: 20 × In
 *
 * Thermal trip multiples (5s — distribution/fixed equipment, TN systems):
 *   Type B: 3 × In (lower bound of magnetic range)
 *   Type C: 5 × In
 *   Type D: 10 × In
 *
 * Note: TT systems rely on RCD protection — Zs limits are
 * determined by RCD rating (Zs ≤ 50V / IΔn), not OCPD.
 * This utility covers TN system OCPD-based Zs only.
 *
 * @module utils/zsLookup
 */

import type { OCPDType } from '../types/eicr'

const UO = 230
const CMIN = 0.95
const EFFECTIVE_VOLTAGE = UO * CMIN // 218.5V

/** Fault current multipliers by disconnection time */
const TRIP_MULTIPLIERS: Record<string, Record<OCPDType, number>> = {
  '0.4': { B: 5, C: 10, D: 20 },
  '5': { B: 3, C: 5, D: 10 },
}

/**
 * Get maximum permitted Zs for a given OCPD type and rating.
 *
 * @param ocpdType  - MCB type letter (B, C, or D)
 * @param ocpdRating - Rated current In (amps)
 * @param disconnectTime - Required disconnection time in seconds (0.4 or 5). Defaults to 0.4.
 * @returns Max permitted Zs in ohms (2dp), or null if inputs are incomplete
 *
 * @example
 * getMaxZs('B', 32)       // → 1.37  (Type B 32A at 0.4s)
 * getMaxZs('C', 32)       // → 0.68  (Type C 32A at 0.4s)
 * getMaxZs('B', 32, 5)    // → 2.28  (Type B 32A at 5s)
 * getMaxZs('', null)       // → null  (incomplete)
 */
export function getMaxZs(
  ocpdType: OCPDType | '' | null,
  ocpdRating: number | null,
  disconnectTime?: number | null
): number | null {
  if (!ocpdType || !ocpdRating || ocpdRating <= 0) return null

  // Map to nearest standard time key
  const timeKey = disconnectTime === 5 ? '5' : '0.4'
  const multipliers = TRIP_MULTIPLIERS[timeKey]
  if (!multipliers) return null

  const multiplier = multipliers[ocpdType as OCPDType]
  if (!multiplier) return null

  const faultCurrent = multiplier * ocpdRating
  const maxZs = EFFECTIVE_VOLTAGE / faultCurrent

  return Math.round(maxZs * 100) / 100
}

/**
 * Check whether a measured Zs exceeds the maximum permitted value.
 *
 * @returns Object with pass/fail status and both values, or null if comparison not possible
 */
export function validateZs(
  measuredZs: number | null,
  ocpdType: OCPDType | '' | null,
  ocpdRating: number | null,
  disconnectTime?: number | null
): { valid: boolean; measured: number; maxPermitted: number } | null {
  if (measuredZs === null) return null

  const maxZs = getMaxZs(ocpdType, ocpdRating, disconnectTime)
  if (maxZs === null) return null

  return {
    valid: measuredZs <= maxZs,
    measured: measuredZs,
    maxPermitted: maxZs,
  }
}
