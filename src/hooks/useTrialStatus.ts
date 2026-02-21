/**
 * useTrialStatus — Trial period management hook
 *
 * Determines whether the current user's trial is active or expired.
 *
 * Logic:
 *   1. If user.publicMetadata.trialEndsAt exists → use that date (manual override)
 *   2. Otherwise → user.createdAt + DEFAULT_TRIAL_DAYS
 *   3. If user.publicMetadata.betaTester is true → skip trial check entirely
 *   4. If user.publicMetadata.subscriptionActive is true → skip trial check
 *
 * Setting trial overrides:
 *   Clerk Dashboard → Users → [user] → Public metadata → Edit:
 *   { "trialEndsAt": "2026-03-23T00:00:00.000Z", "betaTester": true }
 *
 * @module useTrialStatus
 */
import { useUser } from '@clerk/clerk-react'

// ============================================================
// CONSTANTS
// ============================================================

/** Default trial length for new signups (days) */
const DEFAULT_TRIAL_DAYS = 14

// ============================================================
// TYPES
// ============================================================

interface TrialStatus {
  /** Whether trial check has resolved (Clerk user loaded) */
  isLoaded: boolean
  /** Whether the user has an active trial or active subscription */
  hasAccess: boolean
  /** Whether the user is within their trial period */
  isTrialActive: boolean
  /** Whether the trial has expired */
  isTrialExpired: boolean
  /** Whether the user is a beta tester (unlimited access) */
  isBetaTester: boolean
  /** Whether the user has an active subscription */
  isSubscribed: boolean
  /** Trial end date (null if not determinable) */
  trialEndsAt: Date | null
  /** Days remaining in trial (0 if expired, null if not determinable) */
  daysRemaining: number | null
}

interface UserPublicMetadata {
  trialEndsAt?: string
  betaTester?: boolean
  subscriptionActive?: boolean
  lifetimePrice?: number
}

// ============================================================
// HOOK
// ============================================================

export function useTrialStatus(): TrialStatus {
  const { user, isLoaded } = useUser()

  // Not loaded yet — return safe defaults
  if (!isLoaded || !user) {
    return {
      isLoaded,
      hasAccess: false,
      isTrialActive: false,
      isTrialExpired: false,
      isBetaTester: false,
      isSubscribed: false,
      trialEndsAt: null,
      daysRemaining: null,
    }
  }

  const metadata = (user.publicMetadata ?? {}) as UserPublicMetadata

  // ── Beta testers get unlimited access ──
  const isBetaTester = metadata.betaTester === true

  // ── Subscribers get unlimited access ──
  const isSubscribed = metadata.subscriptionActive === true

  // ── Calculate trial end date ──
  let trialEndsAt: Date

  if (metadata.trialEndsAt) {
    // Manual override set in Clerk dashboard
    trialEndsAt = new Date(metadata.trialEndsAt)
  } else if (user.createdAt) {
    // Default: createdAt + 14 days
    trialEndsAt = new Date(user.createdAt)
    trialEndsAt.setDate(trialEndsAt.getDate() + DEFAULT_TRIAL_DAYS)
  } else {
    // Fallback — shouldn't happen but be safe
    trialEndsAt = new Date()
  }

  const now = new Date()
  const isTrialActive = now < trialEndsAt
  const isTrialExpired = !isTrialActive

  // Days remaining (floored, minimum 0)
  const msRemaining = trialEndsAt.getTime() - now.getTime()
  const daysRemaining = Math.max(0, Math.ceil(msRemaining / (1000 * 60 * 60 * 24)))

  // Has access if any of: beta tester, subscribed, or trial active
  const hasAccess = isBetaTester || isSubscribed || isTrialActive

  return {
    isLoaded: true,
    hasAccess,
    isTrialActive,
    isTrialExpired,
    isBetaTester,
    isSubscribed,
    trialEndsAt,
    daysRemaining,
  }
}
