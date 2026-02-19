/**
 * CertVoice — useObservationPolish Hook
 *
 * Calls the claude-proxy worker to polish raw observation text
 * into professional BS 7671 wording with regulation references.
 *
 * Usage:
 *   const { polish, isPolishing, error } = useObservationPolish()
 *   const result = await polish(rawText, 'C2', { location, circuitRef })
 *
 * Drop into: src/hooks/useObservationPolish.ts
 */

import { useState, useCallback } from 'react'

// ============================================================
// TYPES
// ============================================================

interface PolishContext {
  location?: string
  circuitReference?: string
  dbReference?: string
}

interface PolishResult {
  polishedText: string
  regulationReference: string
  remedialAction: string
}

interface UseObservationPolishReturn {
  polish: (
    rawText: string,
    classificationCode: string,
    context?: PolishContext
  ) => Promise<PolishResult | null>
  isPolishing: boolean
  error: string | null
}

// ============================================================
// CONFIG
// ============================================================

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'https://api.certvoice.co.uk'

// ============================================================
// HOOK
// ============================================================

export function useObservationPolish(): UseObservationPolishReturn {
  const [isPolishing, setIsPolishing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const polish = useCallback(
    async (
      rawText: string,
      classificationCode: string,
      context?: PolishContext
    ): Promise<PolishResult | null> => {
      setIsPolishing(true)
      setError(null)

      try {
        const response = await fetch(`${API_BASE}/api/polish-observation`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rawText,
            classificationCode,
            location: context?.location ?? '',
            circuitReference: context?.circuitReference ?? '',
            dbReference: context?.dbReference ?? '',
          }),
        })

        if (!response.ok) {
          const body = await response.json().catch(() => ({ error: 'Polish request failed' }))
          throw new Error((body as { error?: string }).error ?? `HTTP ${response.status}`)
        }

        const data = (await response.json()) as PolishResult
        return data
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Polish failed'
        setError(message)
        return null
      } finally {
        setIsPolishing(false)
      }
    },
    []
  )

  return { polish, isPolishing, error }
}
