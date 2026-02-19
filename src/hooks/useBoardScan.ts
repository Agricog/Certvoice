/**
 * CertVoice — useBoardScan Hook
 *
 * Calls the claude-proxy worker to extract circuits from a board
 * schedule photo via Claude Vision.
 *
 * Usage:
 *   const { scan, isScanning, error } = useBoardScan()
 *   const result = await scan(base64Data, 'image/jpeg', getToken)
 *
 * Drop into: src/hooks/useBoardScan.ts
 */

import { useState, useCallback } from 'react'
import type { GetToken } from '../services/uploadService'

// ============================================================
// TYPES
// ============================================================

export interface ScannedCircuit {
  circuitNumber: string
  circuitDescription: string
  ocpdType: string | null
  ocpdRating: number | null
  rcdType: string | null
  rcdRating: number | null
  confidence: 'high' | 'medium' | 'low'
}

export interface BoardScanResult {
  boardReference: string
  circuits: ScannedCircuit[]
  error?: string
}

interface UseBoardScanReturn {
  scan: (
    imageBase64: string,
    mediaType: 'image/jpeg' | 'image/png',
    getToken: GetToken
  ) => Promise<BoardScanResult | null>
  isScanning: boolean
  error: string | null
}

// ============================================================
// CONFIG
// ============================================================

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'https://api.certvoice.co.uk'

// ============================================================
// HOOK
// ============================================================

export function useBoardScan(): UseBoardScanReturn {
  const [isScanning, setIsScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const scan = useCallback(
    async (
      imageBase64: string,
      mediaType: 'image/jpeg' | 'image/png',
      getToken: GetToken
    ): Promise<BoardScanResult | null> => {
      setIsScanning(true)
      setError(null)

      try {
        const token = await getToken()
        if (!token) {
          throw new Error('Not authenticated')
        }

        const response = await fetch(`${API_BASE}/api/extract-board-photo`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({ imageBase64, mediaType }),
        })

        if (!response.ok) {
          const body = await response.json().catch(() => ({ error: 'Board scan request failed' }))
          throw new Error((body as { error?: string }).error ?? `HTTP ${response.status}`)
        }

        const data = (await response.json()) as BoardScanResult

        if (data.error) {
          throw new Error(data.error)
        }

        if (!data.circuits || data.circuits.length === 0) {
          throw new Error('No circuits found in photo. Make sure the circuit schedule label is clearly visible.')
        }

        return data
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Board scan failed'
        setError(message)
        return null
      } finally {
        setIsScanning(false)
      }
    },
    []
  )

  return { scan, isScanning, error }
}
