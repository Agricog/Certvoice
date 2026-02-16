/**
 * CertVoice — useEngineerProfile Hook
 *
 * Fetches the current engineer's profile from the engineer-settings worker
 * for auto-filling DeclarationForm (Section G).
 *
 * Maps SettingsPayload → EngineerProfile shape from eicr.ts.
 *
 * Fetch strategy:
 *   - Fires once on mount (or when userId changes)
 *   - Caches result in state for the session
 *   - Silently returns null on 404 (new user, no profile yet)
 *   - Does not retry on error (user can still fill manually)
 *
 * @module hooks/useEngineerProfile
 */

import { useState, useEffect, useRef } from 'react'
import { useAuth } from '@clerk/clerk-react'
import type { EngineerProfile, TestInstruments } from '../types/eicr'

// ============================================================
// CONFIGURATION
// ============================================================

/** Engineer settings worker URL — matches vite proxy or direct worker URL */
const ENGINEER_SETTINGS_URL =
  import.meta.env.VITE_ENGINEER_SETTINGS_URL || '/api/engineer/settings'

// ============================================================
// TYPES — matches SettingsPayload from engineer-settings worker
// ============================================================

interface SettingsPayload {
  fullName: string
  phone: string
  email: string
  companyName: string
  companyAddress: string
  companyPhone: string
  companyEmail: string
  registrationBody: string
  registrationNumber: string
  qualifications: string
  signatureKey: string | null
  signatureDataUrl: string | null
  mftSerial: string
  mftCalibrationDate: string
  loopTesterSerial: string
  loopTesterCalibrationDate: string
  rcdTesterSerial: string
  rcdTesterCalibrationDate: string
  irTesterSerial: string
  irTesterCalibrationDate: string
  continuityTesterSerial: string
  continuityTesterCalibrationDate: string
  requestId: string
}

// ============================================================
// MAPPER — SettingsPayload → EngineerProfile
// ============================================================

/**
 * Map the worker's SettingsPayload to the full EngineerProfile
 * interface from eicr.ts.
 *
 * The engineer-settings worker stores test instrument serials
 * individually, so we compose a TestInstruments object from them.
 *
 * `position` is not stored in the settings worker — stays empty,
 * user fills it manually on the DeclarationForm.
 */
function toEngineerProfile(
  payload: SettingsPayload,
  userId: string
): EngineerProfile {
  // Compose test instruments from individual serial/cal fields
  const testInstruments: TestInstruments = {
    multifunctionInstrument: payload.mftSerial || '',
    insulationResistance: payload.irTesterSerial || '',
    continuity: payload.continuityTesterSerial || '',
    earthElectrodeResistance: '',
    earthFaultLoopImpedance: payload.loopTesterSerial || '',
    rcdTester: payload.rcdTesterSerial || '',
  }

  return {
    userId,
    fullName: payload.fullName ?? '',
    companyName: payload.companyName ?? '',
    companyAddress: payload.companyAddress ?? '',
    position: '', // Not stored in engineer-settings — manual entry
    registrationNumber: payload.registrationNumber ?? '',
    schemeBody: payload.registrationBody ?? '',
    signatureKey: payload.signatureKey ?? null,
    testInstruments,
    companyLogoKey: null, // Not yet implemented in settings
    phone: payload.phone ?? '',
    email: payload.email ?? '',
  }
}

// ============================================================
// HOOK
// ============================================================

interface UseEngineerProfileResult {
  /** Engineer profile for auto-fill, null if not loaded or not found */
  profile: EngineerProfile | null
  /** True while the fetch is in progress */
  loading: boolean
  /** Error message if the fetch failed (non-404) */
  error: string | null
}

export default function useEngineerProfile(): UseEngineerProfileResult {
  const { getToken, userId } = useAuth()
  const [profile, setProfile] = useState<EngineerProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const fetchedRef = useRef(false)

  useEffect(() => {
    // Only fetch once per mount, and only if we have a userId
    if (fetchedRef.current || !userId) {
      if (!userId) setLoading(false)
      return
    }

    fetchedRef.current = true

    async function fetchProfile(): Promise<void> {
      try {
        const token = await getToken()
        if (!token) {
          setLoading(false)
          return
        }

        const response = await fetch(ENGINEER_SETTINGS_URL, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        })

        if (response.status === 404) {
          // No profile yet — not an error, user is new
          setProfile(null)
          setLoading(false)
          return
        }

        if (!response.ok) {
          throw new Error(`Settings fetch failed: ${response.status}`)
        }

        const data = (await response.json()) as SettingsPayload
        setProfile(toEngineerProfile(data, userId!))
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load profile'
        setError(message)
        console.error('[useEngineerProfile]', message)
        // Profile stays null — DeclarationForm works fine without it (manual entry)
      } finally {
        setLoading(false)
      }
    }

    fetchProfile()
  }, [userId, getToken])

  return { profile, loading, error }
}
