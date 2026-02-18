/**
 * CertVoice — useAIExtraction Hook
 *
 * Sends voice transcripts to the Claude API proxy (Cloudflare Worker)
 * for field extraction. Returns typed circuit/observation/supply data.
 *
 * Flow:
 *   1. Voice transcript (from useVoiceCapture)
 *   2. Preprocessed by speechParser (trade terminology normalisation)
 *   3. Sent to api.certvoice.co.uk/api/extract (Cloudflare Worker)
 *   4. Worker calls Claude API with system prompt + trade dictionary
 *   5. Returns structured data matching EICR types
 *
 * Security:
 *   - API key never touches the client (Worker holds it)
 *   - Clerk JWT Bearer token on every request
 *   - Rate limited: 60 extractions/hour per user
 *   - Transcript is NOT persisted server-side
 */

import { useState, useCallback, useRef } from 'react'
import { useAuth } from '@clerk/clerk-react'
import type {
  AIExtractionRequest,
  AIExtractionResponse,
  AIExtractionError,
} from '../types/api'
import { preprocessTranscript } from '../utils/speechParser'
import { captureAIError } from '../utils/errorTracking'
import { trackAIExtraction, trackAIExtractionError } from '../utils/analytics'

// ============================================================
// TYPES
// ============================================================

export type ExtractionStatus = 'idle' | 'extracting' | 'success' | 'error'

export interface ExtractionContext {
  /** Current room/location from room selector */
  locationContext: string
  /** Current distribution board reference */
  dbContext: string
  /** Existing circuit numbers (to avoid duplicates) */
  existingCircuits: string[]
  /** Earthing type (for max Zs lookups) */
  earthingType: string | null
  /** What type of extraction to perform */
  extractionType?: 'circuit' | 'observation' | 'supply'
}

export interface UseAIExtractionReturn {
  /** Current extraction status */
  status: ExtractionStatus
  /** Extracted data result */
  result: AIExtractionResponse | null
  /** Error details */
  error: string | null
  /** Whether rate limited */
  isRateLimited: boolean
  /** Seconds until rate limit resets */
  retryAfterSeconds: number
  /** Extract fields from a voice transcript */
  extract: (transcript: string, context: ExtractionContext) => Promise<AIExtractionResponse | null>
  /** Reset state */
  reset: () => void
}

// ============================================================
// CONSTANTS
// ============================================================

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? ''
const EXTRACT_ENDPOINT = `${API_BASE}/api/extract`
const REQUEST_TIMEOUT_MS = 30_000 // 30 seconds max

// ============================================================
// HOOK
// ============================================================

export function useAIExtraction(): UseAIExtractionReturn {
  const { getToken } = useAuth()

  const [status, setStatus] = useState<ExtractionStatus>('idle')
  const [result, setResult] = useState<AIExtractionResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isRateLimited, setIsRateLimited] = useState(false)
  const [retryAfterSeconds, setRetryAfterSeconds] = useState(0)

  const abortControllerRef = useRef<AbortController | null>(null)

  // --- Extract fields from transcript ---
  const extract = useCallback(
    async (
      transcript: string,
      context: ExtractionContext
    ): Promise<AIExtractionResponse | null> => {
      // Validate input
      const trimmed = transcript.trim()
      if (!trimmed) {
        setError('No transcript to extract from.')
        setStatus('error')
        return null
      }

      if (trimmed.length < 5) {
        setError('Transcript too short. Please speak a full observation or test result.')
        setStatus('error')
        return null
      }

      // Cancel any in-flight request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }

      setStatus('extracting')
      setError(null)
      setResult(null)

      const startTime = Date.now()
      const abortController = new AbortController()
      abortControllerRef.current = abortController

      // Auto-timeout
      const timeoutId = setTimeout(() => {
        abortController.abort()
      }, REQUEST_TIMEOUT_MS)

      try {
        // Preprocess transcript (normalise trade terminology)
        const processedTranscript = preprocessTranscript(trimmed)

        // Get Clerk JWT token
        const token = await getToken()

        // Build request
        const requestBody: AIExtractionRequest = {
          transcript: processedTranscript,
          locationContext: context.locationContext,
          dbContext: context.dbContext,
          existingCircuits: context.existingCircuits,
          earthingType: context.earthingType,
          type: context.extractionType ?? 'circuit',
        }

        // Send to proxy
        const response = await fetch(EXTRACT_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(requestBody),
          signal: abortController.signal,
        })

        clearTimeout(timeoutId)
        const durationMs = Date.now() - startTime

        // Handle rate limiting
        if (response.status === 429) {
          const errorData = (await response.json()) as AIExtractionError
          const retryAfter = errorData.retryAfter ?? 60
          setIsRateLimited(true)
          setRetryAfterSeconds(retryAfter)
          setError(`Rate limited. Please wait ${retryAfter} seconds before trying again.`)
          setStatus('error')

          trackAIExtractionError('unknown', 'RATE_LIMITED')

          // Auto-clear rate limit after retry period
          setTimeout(() => {
            setIsRateLimited(false)
            setRetryAfterSeconds(0)
          }, retryAfter * 1000)

          return null
        }

        // Handle other errors
        if (!response.ok) {
          let errorMessage = 'AI extraction failed. Please try again.'

          try {
            const errorData = (await response.json()) as AIExtractionError
            if (errorData.error) {
              errorMessage = errorData.error
            }
            trackAIExtractionError('unknown', errorData.code)
          } catch {
            trackAIExtractionError('unknown', 'API_ERROR')
          }

          setError(errorMessage)
          setStatus('error')

          captureAIError(
            new Error(`AI extraction HTTP ${response.status}`),
            { transcriptLength: trimmed.length, extractionType: 'unknown' }
          )

          return null
        }

        // Parse successful response
        const data = (await response.json()) as AIExtractionResponse

        if (!data.success) {
          setError('Could not extract fields from that recording. Please try again with clearer speech.')
          setStatus('error')
          trackAIExtractionError(data.type, 'PARSE_FAILED')
          return null
        }

        // Success
        setResult(data)
        setStatus('success')

        // Count extracted fields
        const fieldCount = countExtractedFields(data)

        trackAIExtraction(data.type, data.confidence, fieldCount, durationMs)

        return data
      } catch (err) {
        clearTimeout(timeoutId)

        // Abort is expected when user cancels or timeout
        if (err instanceof DOMException && err.name === 'AbortError') {
          setError('Request timed out. Please try again.')
          setStatus('error')
          trackAIExtractionError('unknown', 'API_ERROR')
          return null
        }

        // Network or other error
        const message =
          err instanceof Error ? err.message : 'Unknown extraction error'
        setError(message)
        setStatus('error')

        captureAIError(err, { transcriptLength: trimmed.length, extractionType: 'unknown' })
        trackAIExtractionError('unknown', 'API_ERROR')

        return null
      } finally {
        abortControllerRef.current = null
      }
    },
    [getToken]
  )

  // --- Reset ---
  const reset = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    setStatus('idle')
    setResult(null)
    setError(null)
    setIsRateLimited(false)
    setRetryAfterSeconds(0)
  }, [])

  return {
    status,
    result,
    error,
    isRateLimited,
    retryAfterSeconds,
    extract,
    reset,
  }
}

// ============================================================
// HELPERS
// ============================================================

/**
 * Count the number of non-null fields in an extraction result.
 * Used for analytics tracking.
 */
function countExtractedFields(data: AIExtractionResponse): number {
  let count = 0

  const target = data.circuit ?? data.observation ?? data.supply
  if (!target) return 0

  for (const value of Object.values(target)) {
    if (value !== null && value !== undefined && value !== '') {
      count++
    }
  }

  return count
}
