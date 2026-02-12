/**
 * CertVoice — CSRF Protection
 *
 * OWASP 2024: Protect all state-changing operations with CSRF tokens.
 * Tokens are fetched from the server and included in POST/PUT/DELETE headers.
 */

import type { CSRFTokenResponse } from '../types/security'
import { captureError } from './errorTracking'

// ============================================================
// TOKEN MANAGEMENT
// ============================================================

/** Cached token to avoid unnecessary refetches */
let cachedToken: string | null = null
let tokenExpiresAt: number = 0

/**
 * Get a CSRF token from the server.
 * Returns cached token if still valid, otherwise fetches a new one.
 *
 * @returns CSRF token string
 * @throws Error if token cannot be obtained
 */
export async function getCsrfToken(): Promise<string> {
  // Return cached token if still valid (with 60s buffer)
  const now = Date.now()
  if (cachedToken && tokenExpiresAt > now + 60_000) {
    return cachedToken
  }

  try {
    const response = await fetch('/api/csrf-token', {
      method: 'GET',
      credentials: 'include',
      headers: {
        'Accept': 'application/json',
      },
    })

    if (!response.ok) {
      throw new Error(`CSRF token request failed: ${response.status}`)
    }

    const data: CSRFTokenResponse = await response.json()
    cachedToken = data.token
    tokenExpiresAt = new Date(data.expiresAt).getTime()

    return data.token
  } catch (error) {
    captureError(error, 'getCsrfToken')
    throw new Error('Failed to obtain security token. Please refresh the page.')
  }
}

/**
 * Clear cached CSRF token.
 * Call on logout or when token is rejected by server.
 */
export function clearCsrfToken(): void {
  cachedToken = null
  tokenExpiresAt = 0
}

// ============================================================
// PROTECTED FETCH
// ============================================================

/**
 * Submit a form/data with CSRF protection.
 * Automatically includes the CSRF token in the request header.
 *
 * @param endpoint - Relative API endpoint (e.g. '/api/certificates')
 * @param data - Request body data
 * @param method - HTTP method (default: POST)
 * @returns Fetch Response
 */
export async function protectedFetch(
  endpoint: string,
  data: Record<string, unknown>,
  method: 'POST' | 'PUT' | 'DELETE' = 'POST'
): Promise<Response> {
  // SSRF protection: only allow relative URLs
  if (endpoint.startsWith('http')) {
    throw new Error('SSRF protection: Use relative URLs only')
  }

  const csrfToken = await getCsrfToken()

  return fetch(endpoint, {
    method,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrfToken,
    },
    body: JSON.stringify(data),
  })
}

/**
 * Protected file upload with CSRF token.
 * Uses FormData instead of JSON body.
 *
 * @param endpoint - Relative API endpoint
 * @param formData - FormData with file(s)
 * @returns Fetch Response
 */
export async function protectedUpload(
  endpoint: string,
  formData: FormData
): Promise<Response> {
  // SSRF protection
  if (endpoint.startsWith('http')) {
    throw new Error('SSRF protection: Use relative URLs only')
  }

  const csrfToken = await getCsrfToken()

  return fetch(endpoint, {
    method: 'POST',
    credentials: 'include',
    headers: {
      // Do NOT set Content-Type — browser sets it with boundary for FormData
      'X-CSRF-Token': csrfToken,
    },
    body: formData,
  })
}
