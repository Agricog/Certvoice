/**
 * CertVoice — useApiToken Hook
 *
 * Single source of truth for authenticated API calls.
 * Every component and service that talks to a worker uses this hook.
 *
 * Guarantees:
 *   - Token is always from Clerk's useAuth().getToken()
 *   - Null token throws AuthTokenError (never sends "Bearer null")
 *   - Expired/missing session redirects to sign-in (with returnTo)
 *   - Waits for Clerk to load before making auth decisions
 *   - Provides a stable getToken ref that won't cause re-renders
 *
 * Usage in components:
 *   const { getToken, isSignedIn } = useApiToken()
 *   const certs = await listCertificates(getToken)
 *
 * Usage in services (pass getTokenSafe from the hook):
 *   const sync = createSyncService(getTokenSafe)
 *
 * @module hooks/useApiToken
 */

import { useCallback, useRef, useEffect } from 'react'
import { useAuth } from '@clerk/clerk-react'
import { useNavigate } from 'react-router-dom'

// ============================================================
// ERROR TYPE
// ============================================================

export class AuthTokenError extends Error {
  constructor(message = 'Not authenticated') {
    super(message)
    this.name = 'AuthTokenError'
  }
}

// ============================================================
// HOOK
// ============================================================

export function useApiToken() {
  const { getToken, isSignedIn, isLoaded } = useAuth()
  const navigate = useNavigate()

  // Keep stable refs so callbacks don't cause re-renders
  const signedInRef = useRef(isSignedIn)
  const loadedRef = useRef(isLoaded)
  const navigateRef = useRef(navigate)

  useEffect(() => {
    signedInRef.current = isSignedIn
    loadedRef.current = isLoaded
    navigateRef.current = navigate
  }, [isSignedIn, isLoaded, navigate])

  /**
   * Get a valid Bearer token or throw.
   *
   * - If Clerk hasn't loaded yet: throws (no redirect, avoids false positives)
   * - If Clerk loaded + signed in: returns fresh token string
   * - If session is null/expired: redirects to /sign-in (with returnTo) and throws
   * - Never returns null — callers don't need to check
   */
  const getApiToken = useCallback(async (): Promise<string> => {
    // Don't make auth decisions until Clerk is ready
    if (!loadedRef.current) {
      throw new AuthTokenError('Auth not ready — Clerk still loading')
    }

    if (!signedInRef.current) {
      navigateRef.current('/sign-in', {
        replace: true,
        state: { returnTo: window.location.pathname },
      })
      throw new AuthTokenError('Session expired — redirecting to sign-in')
    }

    const token = await getToken()

    if (!token) {
      navigateRef.current('/sign-in', {
        replace: true,
        state: { returnTo: window.location.pathname },
      })
      throw new AuthTokenError('Session expired — redirecting to sign-in')
    }

    return token
  }, [getToken])

  /**
   * Safe version that returns null instead of throwing.
   * Used by background services (sync) that shouldn't redirect.
   * Returns null while Clerk is loading — sync will retry later.
   */
  const getApiTokenSafe = useCallback(async (): Promise<string | null> => {
    if (!loadedRef.current || !signedInRef.current) return null

    try {
      return await getToken()
    } catch {
      return null
    }
  }, [getToken])

  return {
    /** Get token or throw AuthTokenError (use in components) */
    getToken: getApiToken,
    /** Get token or return null (use in background services) */
    getTokenSafe: getApiTokenSafe,
    /** Whether Clerk has loaded */
    isLoaded: isLoaded ?? false,
    /** Whether user is signed in */
    isSignedIn: isSignedIn ?? false,
  }
}
