/**
 * CertVoice — API Service Layer
 *
 * Centralised fetch wrapper for all Cloudflare Worker endpoints.
 * Handles auth headers, error parsing, and base URL configuration.
 *
 * Auth: Attaches Clerk JWT when available, falls back gracefully
 * when Clerk is not yet initialised.
 *
 * Usage:
 *   import { api } from '../services/api'
 *   const certs = await api.get<Certificate[]>('/api/certificates')
 *
 * @module services/api
 */

import { captureError } from '../utils/errorTracking'

// ============================================================
// CONFIG
// ============================================================

/**
 * Base URL for Cloudflare Workers.
 * In development: empty string (proxied via Vite or same-origin).
 * In production: set via VITE_API_BASE_URL env var.
 */
const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? ''

// ============================================================
// TYPES
// ============================================================

export interface ApiError {
  status: number
  message: string
}

export interface ApiResponse<T> {
  data: T | null
  error: ApiError | null
}

// ============================================================
// AUTH TOKEN
// ============================================================

/**
 * Attempts to get Clerk session token.
 * Returns null if Clerk is not initialised or user is not signed in.
 * Uses window.__clerk__ which ClerkProvider exposes once mounted.
 */
async function getAuthToken(): Promise<string | null> {
  try {
    const win = window as unknown as Record<string, unknown>

    // Clerk exposes itself on window when ClerkProvider is mounted
    const clerk = win.__clerk_frontend_api ? win.Clerk : null

    if (!clerk) {
      // Try the newer Clerk SDK pattern
      const clerkInstance = win.Clerk as
        | { session?: { getToken: () => Promise<string> } }
        | undefined

      if (clerkInstance?.session) {
        return await clerkInstance.session.getToken()
      }

      return null
    }

    const session = (clerk as { session?: { getToken: () => Promise<string> } }).session
    if (!session) return null

    return await session.getToken()
  } catch {
    return null
  }
}

// ============================================================
// FETCH WRAPPER
// ============================================================

async function apiFetch<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
  const url = `${BASE_URL}${endpoint}`

  try {
    // Get auth token (non-blocking — null if unavailable)
    const token = await getAuthToken()

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    }

    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }

    const response = await fetch(url, {
      ...options,
      headers,
      credentials: 'include',
    })

    // No content
    if (response.status === 204) {
      return { data: null, error: null }
    }

    // Parse response
    const body = await response.json()

    if (!response.ok) {
      const errorMessage =
        (body as Record<string, unknown>).error as string ??
        `Request failed (${response.status})`

      return {
        data: null,
        error: { status: response.status, message: errorMessage },
      }
    }

    return { data: body as T, error: null }
  } catch (error) {
    captureError(error, `api.${options.method ?? 'GET'} ${endpoint}`)

    return {
      data: null,
      error: {
        status: 0,
        message: error instanceof Error ? error.message : 'Network error',
      },
    }
  }
}

// ============================================================
// PUBLIC API METHODS
// ============================================================

export const api = {
  /**
   * GET request.
   * @param endpoint - API path (e.g. '/api/certificates')
   * @param params - Optional query parameters
   */
  async get<T>(endpoint: string, params?: Record<string, string>): Promise<ApiResponse<T>> {
    let url = endpoint
    if (params) {
      const searchParams = new URLSearchParams(params)
      url = `${endpoint}?${searchParams.toString()}`
    }
    return apiFetch<T>(url, { method: 'GET' })
  },

  /**
   * POST request.
   * @param endpoint - API path
   * @param body - Request body (will be JSON stringified)
   */
  async post<T>(endpoint: string, body?: unknown): Promise<ApiResponse<T>> {
    return apiFetch<T>(endpoint, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    })
  },

  /**
   * PUT request.
   * @param endpoint - API path
   * @param body - Request body (will be JSON stringified)
   */
  async put<T>(endpoint: string, body?: unknown): Promise<ApiResponse<T>> {
    return apiFetch<T>(endpoint, {
      method: 'PUT',
      body: body ? JSON.stringify(body) : undefined,
    })
  },

  /**
   * DELETE request.
   * @param endpoint - API path
   */
  async delete<T>(endpoint: string): Promise<ApiResponse<T>> {
    return apiFetch<T>(endpoint, { method: 'DELETE' })
  },
}
