/**
 * CertVoice — Subscription Page
 *
 * Stripe integration for CertVoice Pro subscription.
 * Single plan: £29.99/month with 14-day free trial.
 *
 * Features:
 *   - Plan display with feature comparison
 *   - Stripe Checkout for new subscriptions
 *   - Billing portal for existing subscribers (update card, cancel)
 *   - Subscription status display
 *   - Trial countdown
 *
 * Uses @stripe/stripe-js for client-side, backend handles Checkout Session creation.
 *
 * @module pages/Subscription
 */

import { useState, useEffect, useCallback } from 'react'
import { Helmet } from 'react-helmet-async'
import { Link } from 'react-router-dom'
import { loadStripe } from '@stripe/stripe-js'
import {
  ArrowLeft,
  Check,
  Crown,
  CreditCard,
  AlertTriangle,
  Loader2,
  Mic,
  FileText,
  ShieldCheck,
  Zap,
  Clock,
  ExternalLink,
  Sparkles,
} from 'lucide-react'
import { captureError } from '../utils/errorTracking'

// ============================================================
// TYPES
// ============================================================

type SubscriptionStatus =
  | 'active'
  | 'trialing'
  | 'past_due'
  | 'canceled'
  | 'incomplete'
  | 'none'

interface SubscriptionInfo {
  status: SubscriptionStatus
  planName: string
  currentPeriodEnd: string | null
  trialEnd: string | null
  cancelAtPeriodEnd: boolean
  amount: number
  currency: string
}

// ============================================================
// CONSTANTS
// ============================================================

const STRIPE_PUBLIC_KEY = import.meta.env.VITE_STRIPE_PUBLIC_KEY ?? ''
const CHECKOUT_API = '/api/stripe/checkout'
const BILLING_API = '/api/stripe/billing-portal'
const SUBSCRIPTION_API = '/api/stripe/subscription'

const PLAN_FEATURES = [
  { icon: Mic, text: 'Unlimited voice capture' },
  { icon: Zap, text: 'AI circuit & observation extraction' },
  { icon: FileText, text: 'Unlimited BS 7671 PDF certificates' },
  { icon: ShieldCheck, text: 'EICR + CP12 support' },
  { icon: Clock, text: 'Offline capture & background sync' },
  { icon: CreditCard, text: 'Email certificates to clients' },
] as const

const stripePromise = STRIPE_PUBLIC_KEY ? loadStripe(STRIPE_PUBLIC_KEY) : null

// ============================================================
// COMPONENT
// ============================================================

export default function Subscription() {
  const [subscription, setSubscription] = useState<SubscriptionInfo | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [checkoutLoading, setCheckoutLoading] = useState<boolean>(false)
  const [portalLoading, setPortalLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)

  // ---- Load subscription status ----
  useEffect(() => {
    loadSubscription()
  }, [])

  const loadSubscription = async () => {
    setLoading(true)
    try {
      const response = await fetch(SUBSCRIPTION_API, {
        method: 'GET',
        credentials: 'include',
      })

      if (response.ok) {
        const data = (await response.json()) as SubscriptionInfo
        setSubscription(data)
      } else if (response.status === 404) {
        // No subscription — show signup
        setSubscription({ status: 'none' } as SubscriptionInfo)
      }
    } catch (err) {
      captureError(err, 'Subscription.loadSubscription')
      setError('Failed to load subscription details.')
    } finally {
      setLoading(false)
    }
  }

  // ---- Start Checkout ----
  const handleCheckout = useCallback(async () => {
    if (!stripePromise) {
      setError('Payment system not configured.')
      return
    }

    setCheckoutLoading(true)
    setError(null)

    try {
      const response = await fetch(CHECKOUT_API, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          successUrl: `${window.location.origin}/subscription?success=true`,
          cancelUrl: `${window.location.origin}/subscription?canceled=true`,
        }),
      })

      if (!response.ok) throw new Error('Failed to create checkout session')

      const { url } = (await response.json()) as { url: string }

      if (!url) throw new Error('No checkout URL returned')

      window.location.href = url

      trackEvent('checkout_started')
    } catch (err) {
      captureError(err, 'Subscription.handleCheckout')
      setError('Failed to start checkout. Please try again.')
    } finally {
      setCheckoutLoading(false)
    }
  }, [])

  // ---- Open Billing Portal ----
  const handleBillingPortal = useCallback(async () => {
    setPortalLoading(true)
    setError(null)

    try {
      const response = await fetch(BILLING_API, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          returnUrl: `${window.location.origin}/subscription`,
        }),
      })

      if (!response.ok) throw new Error('Failed to create billing portal session')

      const { url } = (await response.json()) as { url: string }
      window.location.href = url

      trackEvent('billing_portal_opened')
    } catch (err) {
      captureError(err, 'Subscription.handleBillingPortal')
      setError('Failed to open billing portal. Please try again.')
    } finally {
      setPortalLoading(false)
    }
  }, [])

  // ---- Helpers ----
  const isActive = subscription?.status === 'active' || subscription?.status === 'trialing'

  const trialDaysRemaining = (() => {
    if (subscription?.status !== 'trialing' || !subscription.trialEnd) return null
    const end = new Date(subscription.trialEnd).getTime()
    const now = Date.now()
    return Math.max(0, Math.ceil((end - now) / (1000 * 60 * 60 * 24)))
  })()

  const periodEndFormatted = subscription?.currentPeriodEnd
    ? new Date(subscription.currentPeriodEnd).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : null

  const trackEvent = (action: string) => {
    try {
      if (typeof window !== 'undefined' && (window as unknown as Record<string, unknown>).gtag) {
        const gtag = (window as unknown as Record<string, unknown>).gtag as (
          command: string,
          action: string,
          params: Record<string, string>
        ) => void
        gtag('event', action, { event_category: 'subscription' })
      }
    } catch {
      // Never break for analytics
    }
  }

  // ---- URL params (success/cancel from Stripe redirect) ----
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('success') === 'true') {
      // Reload subscription after successful checkout
      loadSubscription()
      trackEvent('checkout_success')
      // Clean URL
      window.history.replaceState({}, '', '/subscription')
    }
    if (params.get('canceled') === 'true') {
      trackEvent('checkout_canceled')
      window.history.replaceState({}, '', '/subscription')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ============================================================
  // RENDER
  // ============================================================

  if (loading) {
    return (
      <div className="min-h-screen bg-certvoice-bg flex items-center justify-center">
        <div className="flex items-center gap-3 text-certvoice-muted">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-sm">Loading subscription...</span>
        </div>
      </div>
    )
  }

  return (
    <>
      <Helmet>
        <title>Subscription | CertVoice</title>
        <meta name="description" content="Manage your CertVoice Pro subscription." />
      </Helmet>

      <div className="min-h-screen bg-certvoice-bg">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-certvoice-surface border-b border-certvoice-border px-4 py-3">
          <div className="max-w-lg mx-auto flex items-center gap-3">
            <Link
              to="/"
              className="w-8 h-8 rounded-lg border border-certvoice-border flex items-center justify-center
                         text-certvoice-muted hover:text-certvoice-text transition-colors"
              aria-label="Back to dashboard"
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <h1 className="flex-1 text-sm font-bold text-certvoice-text">
              Subscription
            </h1>
          </div>
        </div>

        <div className="max-w-lg mx-auto px-4 py-8 space-y-6">
          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 bg-certvoice-red/10 border border-certvoice-red/30 rounded-lg px-3 py-2">
              <AlertTriangle className="w-4 h-4 text-certvoice-red shrink-0" />
              <p className="text-xs text-certvoice-red">{error}</p>
            </div>
          )}

          {/* Active subscription status */}
          {isActive && subscription && (
            <div className="cv-card space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-certvoice-accent/15 flex items-center justify-center">
                  <Crown className="w-5 h-5 text-certvoice-accent" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-certvoice-text">CertVoice Pro</h2>
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      subscription.status === 'trialing'
                        ? 'bg-certvoice-amber/15 text-certvoice-amber'
                        : 'bg-certvoice-green/15 text-certvoice-green'
                    }`}>
                      {subscription.status === 'trialing' ? 'Free Trial' : 'Active'}
                    </span>
                    {subscription.cancelAtPeriodEnd && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-certvoice-red/15 text-certvoice-red">
                        Cancelling
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Trial countdown */}
              {trialDaysRemaining !== null && (
                <div className="bg-certvoice-amber/10 border border-certvoice-amber/30 rounded-lg px-3 py-2">
                  <p className="text-xs text-certvoice-amber font-semibold">
                    {trialDaysRemaining} day{trialDaysRemaining !== 1 ? 's' : ''} remaining on your free trial
                  </p>
                  <p className="text-[10px] text-certvoice-muted mt-0.5">
                    Your card will be charged £29.99/month when the trial ends.
                  </p>
                </div>
              )}

              {/* Billing details */}
              <div className="space-y-2 text-xs text-certvoice-muted">
                <div className="flex justify-between">
                  <span>Plan</span>
                  <span className="text-certvoice-text font-semibold">£29.99/month</span>
                </div>
                {periodEndFormatted && (
                  <div className="flex justify-between">
                    <span>{subscription.cancelAtPeriodEnd ? 'Access until' : 'Next billing date'}</span>
                    <span className="text-certvoice-text">{periodEndFormatted}</span>
                  </div>
                )}
              </div>

              {/* Manage button */}
              <button
                type="button"
                onClick={handleBillingPortal}
                disabled={portalLoading}
                className="w-full px-4 py-2.5 rounded-lg border border-certvoice-border text-xs font-semibold
                           text-certvoice-muted hover:text-certvoice-text hover:border-certvoice-muted
                           transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {portalLoading ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Opening portal...
                  </>
                ) : (
                  <>
                    <ExternalLink className="w-3.5 h-3.5" />
                    Manage Billing
                  </>
                )}
              </button>
            </div>
          )}

          {/* Past due warning */}
          {subscription?.status === 'past_due' && (
            <div className="cv-card border-certvoice-red/30 space-y-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-certvoice-red" />
                <h2 className="text-sm font-bold text-certvoice-red">Payment Failed</h2>
              </div>
              <p className="text-xs text-certvoice-muted">
                Your last payment failed. Please update your card to continue using CertVoice Pro.
              </p>
              <button
                type="button"
                onClick={handleBillingPortal}
                disabled={portalLoading}
                className="cv-btn-primary w-full flex items-center justify-center gap-2"
              >
                <CreditCard className="w-4 h-4" />
                Update Payment Method
              </button>
            </div>
          )}

          {/* Plan card (for non-subscribers or canceled) */}
          {(!isActive || subscription?.status === 'none' || subscription?.status === 'canceled') && (
            <div className="cv-card space-y-5">
              <div className="text-center space-y-2">
                <div className="w-12 h-12 rounded-2xl bg-certvoice-accent/15 flex items-center justify-center mx-auto">
                  <Sparkles className="w-6 h-6 text-certvoice-accent" />
                </div>
                <h2 className="text-base font-bold text-certvoice-text">CertVoice Pro</h2>
                <div className="flex items-baseline justify-center gap-1">
                  <span className="text-2xl font-bold text-certvoice-text">£29.99</span>
                  <span className="text-xs text-certvoice-muted">/month</span>
                </div>
                <p className="text-xs text-certvoice-accent font-semibold">
                  14-day free trial included
                </p>
              </div>

              <div className="space-y-3">
                {PLAN_FEATURES.map(({ icon: Icon, text }) => (
                  <div key={text} className="flex items-center gap-3">
                    <div className="w-7 h-7 rounded-lg bg-certvoice-green/10 flex items-center justify-center shrink-0">
                      <Icon className="w-3.5 h-3.5 text-certvoice-green" />
                    </div>
                    <span className="text-xs text-certvoice-text">{text}</span>
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={handleCheckout}
                disabled={checkoutLoading}
                className="cv-btn-primary w-full py-3 flex items-center justify-center gap-2 text-sm disabled:opacity-50"
              >
                {checkoutLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Loading checkout...
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    Start Free Trial
                  </>
                )}
              </button>

              <p className="text-[10px] text-certvoice-muted/60 text-center">
                Cancel anytime during your trial. No charge until day 15.
              </p>
            </div>
          )}

          {/* What you get section */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold text-certvoice-muted uppercase tracking-wider">
              Why CertVoice Pro?
            </h3>
            <div className="cv-card space-y-3">
              <ComparisonRow label="Complete a 12-circuit EICR" before="2-3 hours" after="30 minutes" />
              <ComparisonRow label="Transcribe observations" before="Handwritten notes at home" after="Speak, confirm, done" />
              <ComparisonRow label="Generate PDF certificate" before="Manual entry into Castline" after="One tap, BS 7671 compliant" />
              <ComparisonRow label="Email to client" before="Separate email with attachment" after="Built-in, one tap" />
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

// ============================================================
// SUB-COMPONENTS
// ============================================================

interface ComparisonRowProps {
  label: string
  before: string
  after: string
}

function ComparisonRow({ label, before, after }: ComparisonRowProps) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold text-certvoice-text">{label}</p>
      <div className="grid grid-cols-2 gap-2">
        <div className="text-[10px] text-certvoice-muted/60 line-through">{before}</div>
        <div className="text-[10px] text-certvoice-green font-semibold">{after}</div>
      </div>
    </div>
  )
}
