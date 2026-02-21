/**
 * ProtectedRoute — Clerk auth gate + trial period enforcement
 *
 * Wraps any route that requires a signed-in user with an active trial
 * or subscription.
 *
 * Check order:
 *   1. Clerk still loading → branded spinner
 *   2. Not signed in → redirect to /sign-in
 *   3. Trial expired (and not subscribed/beta) → trial expired screen
 *   4. All clear → render children
 *
 * Trial logic delegated to useTrialStatus hook.
 *
 * @module ProtectedRoute
 */
import { useAuth } from '@clerk/clerk-react'
import { Navigate, useLocation, Link } from 'react-router-dom'
import { Clock, CreditCard, MessageCircle, Zap } from 'lucide-react'
import { useTrialStatus } from '../hooks/useTrialStatus'

// ============================================================
// TYPES
// ============================================================

interface ProtectedRouteProps {
  children: React.ReactNode
}

// ============================================================
// COMPONENT
// ============================================================

export default function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { isSignedIn, isLoaded: isAuthLoaded } = useAuth()
  const location = useLocation()
  const trial = useTrialStatus()

  // ── Clerk still resolving — show branded loading state ──
  if (!isAuthLoaded || !trial.isLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-certvoice-bg">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-3 border-certvoice-accent border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-certvoice-muted">Loading…</p>
        </div>
      </div>
    )
  }

  // ── Not signed in — redirect to Clerk hosted sign-in ──
  if (!isSignedIn) {
    return (
      <Navigate
        to="/sign-in"
        state={{ returnTo: location.pathname + location.search }}
        replace
      />
    )
  }

  // ── Trial expired and no subscription — show expiry screen ──
  if (!trial.hasAccess) {
    return <TrialExpiredScreen />
  }

  // ── All clear — render the page ──
  // Show trial banner if < 3 days remaining
  return (
    <>
      {trial.isTrialActive && !trial.isBetaTester && !trial.isSubscribed && trial.daysRemaining !== null && trial.daysRemaining <= 3 && (
        <TrialWarningBanner daysRemaining={trial.daysRemaining} />
      )}
      {children}
    </>
  )
}

// ============================================================
// TRIAL EXPIRED SCREEN
// ============================================================

function TrialExpiredScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-certvoice-bg p-4">
      <div className="cv-panel max-w-md w-full space-y-6 text-center">
        {/* Icon */}
        <div className="flex justify-center">
          <div className="w-16 h-16 rounded-full bg-amber-500/10 flex items-center justify-center">
            <Clock className="w-8 h-8 text-amber-500" />
          </div>
        </div>

        {/* Heading */}
        <div className="space-y-2">
          <h1 className="text-xl font-bold text-certvoice-text">
            Your Free Trial Has Ended
          </h1>
          <p className="text-sm text-certvoice-muted leading-relaxed">
            Thanks for trying CertVoice. Your 14-day trial has expired.
            Subscribe to keep using voice-to-certificate for your inspections.
          </p>
        </div>

        {/* What you get */}
        <div className="space-y-3 text-left">
          <p className="text-xs font-semibold text-certvoice-muted uppercase tracking-wider">
            What&apos;s included
          </p>
          <div className="space-y-2">
            <FeatureItem icon={<Zap className="w-4 h-4" />} text="Unlimited voice-to-certificate captures" />
            <FeatureItem icon={<CreditCard className="w-4 h-4" />} text="EICR, Minor Works & EIC certificates" />
            <FeatureItem icon={<MessageCircle className="w-4 h-4" />} text="AI-powered BS 7671 field extraction" />
          </div>
        </div>

        {/* Price */}
        <div className="cv-panel bg-certvoice-surface2 border-certvoice-accent/30">
          <div className="flex items-baseline justify-center gap-1">
            <span className="text-3xl font-bold text-certvoice-text">£29.99</span>
            <span className="text-sm text-certvoice-muted">/month</span>
          </div>
          <p className="text-xs text-certvoice-muted mt-1">
            Cancel anytime. No long-term contract.
          </p>
        </div>

        {/* CTA */}
        <Link
          to="/subscription"
          className="cv-btn-primary w-full flex items-center justify-center gap-2 py-3"
        >
          <CreditCard className="w-4 h-4" />
          Subscribe Now
        </Link>

        {/* Contact */}
        <p className="text-xs text-certvoice-muted">
          Questions? Email{' '}
          <a
            href="mailto:support@certvoice.co.uk"
            className="text-certvoice-accent hover:underline"
          >
            support@certvoice.co.uk
          </a>
        </p>
      </div>
    </div>
  )
}

// ============================================================
// FEATURE ITEM
// ============================================================

interface FeatureItemProps {
  icon: React.ReactNode
  text: string
}

function FeatureItem({ icon, text }: FeatureItemProps) {
  return (
    <div className="flex items-center gap-3 text-sm text-certvoice-text">
      <div className="text-certvoice-accent flex-shrink-0">{icon}</div>
      <span>{text}</span>
    </div>
  )
}

// ============================================================
// TRIAL WARNING BANNER (< 3 days remaining)
// ============================================================

interface TrialWarningBannerProps {
  daysRemaining: number
}

function TrialWarningBanner({ daysRemaining }: TrialWarningBannerProps) {
  const message = daysRemaining === 0
    ? 'Your trial expires today!'
    : daysRemaining === 1
      ? 'Your trial expires tomorrow'
      : `Your trial expires in ${daysRemaining} days`

  return (
    <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-2 flex items-center justify-between">
      <div className="flex items-center gap-2 text-sm text-amber-400">
        <Clock className="w-4 h-4 flex-shrink-0" />
        <span>{message}</span>
      </div>
      <Link
        to="/subscription"
        className="text-xs font-semibold text-amber-400 hover:text-amber-300 whitespace-nowrap"
      >
        Subscribe →
      </Link>
    </div>
  )
}
