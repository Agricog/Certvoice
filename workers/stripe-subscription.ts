/**
 * CertVoice — Stripe Subscription Worker
 *
 * Cloudflare Worker handling Stripe integration for CertVoice Pro.
 * Single plan: £29.99/month with 14-day free trial.
 *
 * Endpoints:
 *   GET  /api/stripe/subscription    — Current subscription status
 *   POST /api/stripe/checkout        — Create Stripe Checkout session
 *   POST /api/stripe/billing-portal  — Create Stripe Billing Portal session
 *   POST /api/stripe/webhook         — Stripe webhook handler
 *
 * Auth: Clerk JWT on customer-facing endpoints.
 * Webhook: Stripe signature verification (no Clerk auth).
 *
 * Deploy: wrangler deploy (separate from Railway frontend)
 *
 * @module workers/stripe-subscription
 */

import { neon } from '@neondatabase/serverless'

// ============================================================
// TYPES
// ============================================================

interface Env {
  DATABASE_URL: string
  ALLOWED_ORIGIN: string
  CLERK_JWKS_URL: string
  STRIPE_SECRET_KEY: string
  STRIPE_WEBHOOK_SECRET: string
  STRIPE_PRICE_ID: string
}

interface ClerkJWTPayload {
  sub: string
  exp: number
}

interface SubscriptionResponse {
  status: string
  planName: string
  currentPeriodEnd: string | null
  trialEnd: string | null
  cancelAtPeriodEnd: boolean
  amount: number
  currency: string
}

// ============================================================
// CORS
// ============================================================

function corsHeaders(origin: string, allowed: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin === allowed ? origin : '',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  }
}

function json(data: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors },
  })
}

// ============================================================
// AUTH — Clerk JWT verification
// ============================================================

async function verifyClerkJWT(
  authHeader: string | null,
  jwksUrl: string
): Promise<string | null> {
  if (!authHeader?.startsWith('Bearer ')) return null

  const token = authHeader.slice(7)

  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null

    const headerJson = JSON.parse(atob(parts[0].replace(/-/g, '+').replace(/_/g, '/')))
    const kid: string = headerJson.kid
    if (!kid) return null

    const jwksResponse = await fetch(jwksUrl)
    if (!jwksResponse.ok) return null

    const jwks = (await jwksResponse.json()) as {
      keys: Array<{ kid: string; kty: string; n: string; e: string }>
    }
    const jwk = jwks.keys.find((k) => k.kid === kid)
    if (!jwk) return null

    const publicKey = await crypto.subtle.importKey(
      'jwk',
      { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    )

    const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
    const signature = Uint8Array.from(
      atob(parts[2].replace(/-/g, '+').replace(/_/g, '/')),
      (c) => c.charCodeAt(0)
    )

    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, signature, data)
    if (!valid) return null

    const payload: ClerkJWTPayload = JSON.parse(
      atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))
    )

    if (payload.exp < Math.floor(Date.now() / 1000)) return null

    return payload.sub
  } catch {
    return null
  }
}

// ============================================================
// STRIPE HELPERS (REST API — no SDK needed in Workers)
// ============================================================

async function stripeRequest(
  path: string,
  apiKey: string,
  method: 'GET' | 'POST' = 'POST',
  body?: Record<string, string>
): Promise<Record<string, unknown>> {
  const options: RequestInit = {
    method,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  }

  if (body && method === 'POST') {
    options.body = new URLSearchParams(body).toString()
  }

  const response = await fetch(`https://api.stripe.com/v1${path}`, options)
  return (await response.json()) as Record<string, unknown>
}

// ============================================================
// HANDLERS
// ============================================================

/**
 * GET /api/stripe/subscription
 * Returns current subscription status for the authenticated engineer.
 */
async function handleGetSubscription(
  clerkUserId: string,
  env: Env,
  cors: Record<string, string>
): Promise<Response> {
  const sql = neon(env.DATABASE_URL)

  const rows = await sql`
    SELECT subscription_status, subscription_plan, stripe_customer_id,
           trial_ends_at, current_period_end
    FROM engineers
    WHERE clerk_user_id = ${clerkUserId}
    LIMIT 1
  `

  if (rows.length === 0) {
    return json({ status: 'none' }, 404, cors)
  }

  const row = rows[0]
  const status = (row.subscription_status as string) ?? 'none'

  // If active/trialing, fetch live status from Stripe for accuracy
  if (row.stripe_customer_id && (status === 'active' || status === 'trialing')) {
    try {
      const subs = await stripeRequest(
        `/subscriptions?customer=${row.stripe_customer_id}&status=all&limit=1`,
        env.STRIPE_SECRET_KEY,
        'GET'
      )

      const subData = (subs.data as Array<Record<string, unknown>>)?.[0]
      if (subData) {
        const response: SubscriptionResponse = {
          status: subData.status as string,
          planName: 'CertVoice Pro',
          currentPeriodEnd: subData.current_period_end
            ? new Date((subData.current_period_end as number) * 1000).toISOString()
            : null,
          trialEnd: subData.trial_end
            ? new Date((subData.trial_end as number) * 1000).toISOString()
            : null,
          cancelAtPeriodEnd: (subData.cancel_at_period_end as boolean) ?? false,
          amount: 2999,
          currency: 'gbp',
        }
        return json(response, 200, cors)
      }
    } catch {
      // Fall through to DB data if Stripe call fails
    }
  }

  const response: SubscriptionResponse = {
    status,
    planName: 'CertVoice Pro',
    currentPeriodEnd: row.current_period_end
      ? new Date(row.current_period_end as string).toISOString()
      : null,
    trialEnd: row.trial_ends_at
      ? new Date(row.trial_ends_at as string).toISOString()
      : null,
    cancelAtPeriodEnd: false,
    amount: 2999,
    currency: 'gbp',
  }

  return json(response, 200, cors)
}

/**
 * POST /api/stripe/checkout
 * Creates a Stripe Checkout Session with 14-day trial.
 * Returns { url } for frontend redirect.
 */
async function handleCheckout(
  clerkUserId: string,
  request: Request,
  env: Env,
  cors: Record<string, string>
): Promise<Response> {
  const body = (await request.json()) as { successUrl: string; cancelUrl: string }
  const sql = neon(env.DATABASE_URL)

  // Get or create Stripe customer
  const rows = await sql`
    SELECT id, stripe_customer_id, email, full_name
    FROM engineers
    WHERE clerk_user_id = ${clerkUserId}
    LIMIT 1
  `

  if (rows.length === 0) {
    return json({ error: 'Engineer not found. Complete settings first.' }, 400, cors)
  }

  const engineer = rows[0]
  let customerId = engineer.stripe_customer_id as string | null

  if (!customerId) {
    // Create Stripe customer
    const customer = await stripeRequest('/customers', env.STRIPE_SECRET_KEY, 'POST', {
      email: (engineer.email as string) ?? '',
      name: (engineer.full_name as string) ?? '',
      'metadata[clerk_user_id]': clerkUserId,
      'metadata[engineer_id]': engineer.id as string,
    })

    customerId = customer.id as string

    // Store customer ID
    await sql`
      UPDATE engineers
      SET stripe_customer_id = ${customerId}
      WHERE clerk_user_id = ${clerkUserId}
    `
  }

  // Create Checkout Session with 14-day trial
  const session = await stripeRequest(
    '/checkout/sessions',
    env.STRIPE_SECRET_KEY,
    'POST',
    {
      'customer': customerId,
      'mode': 'subscription',
      'line_items[0][price]': env.STRIPE_PRICE_ID,
      'line_items[0][quantity]': '1',
      'subscription_data[trial_period_days]': '14',
      'subscription_data[metadata][clerk_user_id]': clerkUserId,
      'success_url': body.successUrl,
      'cancel_url': body.cancelUrl,
      'allow_promotion_codes': 'true',
    }
  )

  if (!session.url) {
    return json({ error: 'Failed to create checkout session' }, 500, cors)
  }

  return json({ url: session.url as string }, 200, cors)
}

/**
 * POST /api/stripe/billing-portal
 * Creates a Stripe Billing Portal session.
 * Returns { url } for frontend redirect.
 */
async function handleBillingPortal(
  clerkUserId: string,
  request: Request,
  env: Env,
  cors: Record<string, string>
): Promise<Response> {
  const body = (await request.json()) as { returnUrl: string }
  const sql = neon(env.DATABASE_URL)

  const rows = await sql`
    SELECT stripe_customer_id
    FROM engineers
    WHERE clerk_user_id = ${clerkUserId}
    LIMIT 1
  `

  if (rows.length === 0 || !rows[0].stripe_customer_id) {
    return json({ error: 'No active subscription found.' }, 400, cors)
  }

  const session = await stripeRequest(
    '/billing_portal/sessions',
    env.STRIPE_SECRET_KEY,
    'POST',
    {
      customer: rows[0].stripe_customer_id as string,
      return_url: body.returnUrl,
    }
  )

  if (!session.url) {
    return json({ error: 'Failed to create billing portal session' }, 500, cors)
  }

  return json({ url: session.url as string }, 200, cors)
}

/**
 * POST /api/stripe/webhook
 * Handles Stripe webhook events to keep Neon in sync.
 * No Clerk auth — uses Stripe signature verification.
 */
async function handleWebhook(
  request: Request,
  env: Env,
  cors: Record<string, string>
): Promise<Response> {
  const signature = request.headers.get('stripe-signature')
  if (!signature) {
    return json({ error: 'Missing signature' }, 400, cors)
  }

  const rawBody = await request.text()

  // Verify Stripe signature
  const verified = await verifyStripeSignature(rawBody, signature, env.STRIPE_WEBHOOK_SECRET)
  if (!verified) {
    return json({ error: 'Invalid signature' }, 400, cors)
  }

  const event = JSON.parse(rawBody) as {
    type: string
    data: { object: Record<string, unknown> }
  }

  const sql = neon(env.DATABASE_URL)
  const obj = event.data.object

  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const customerId = obj.customer as string
      const status = obj.status as string
      const trialEnd = obj.trial_end
        ? new Date((obj.trial_end as number) * 1000).toISOString()
        : null
      const periodEnd = obj.current_period_end
        ? new Date((obj.current_period_end as number) * 1000).toISOString()
        : null

      await sql`
        UPDATE engineers
        SET subscription_status = ${status},
            trial_ends_at = ${trialEnd},
            current_period_end = ${periodEnd}
        WHERE stripe_customer_id = ${customerId}
      `
      break
    }

    case 'customer.subscription.deleted': {
      const customerId = obj.customer as string

      await sql`
        UPDATE engineers
        SET subscription_status = 'canceled',
            current_period_end = NULL
        WHERE stripe_customer_id = ${customerId}
      `
      break
    }

    case 'invoice.payment_failed': {
      const customerId = obj.customer as string

      await sql`
        UPDATE engineers
        SET subscription_status = 'past_due'
        WHERE stripe_customer_id = ${customerId}
      `
      break
    }

    default:
      // Unhandled event type — acknowledge receipt
      break
  }

  return json({ received: true }, 200, cors)
}

// ============================================================
// STRIPE WEBHOOK SIGNATURE VERIFICATION
// ============================================================

async function verifyStripeSignature(
  payload: string,
  header: string,
  secret: string
): Promise<boolean> {
  try {
    // Parse header: t=timestamp,v1=signature
    const pairs = header.split(',')
    const timestamp = pairs.find((p) => p.startsWith('t='))?.slice(2)
    const sig = pairs.find((p) => p.startsWith('v1='))?.slice(3)

    if (!timestamp || !sig) return false

    // Check timestamp tolerance (5 minutes)
    const age = Math.abs(Date.now() / 1000 - parseInt(timestamp, 10))
    if (age > 300) return false

    // Compute expected signature
    const signedPayload = `${timestamp}.${payload}`
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )

    const expectedBytes = await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(signedPayload)
    )

    const expectedHex = Array.from(new Uint8Array(expectedBytes))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')

    // Constant-time comparison
    if (sig.length !== expectedHex.length) return false
    let result = 0
    for (let i = 0; i < sig.length; i++) {
      result |= sig.charCodeAt(i) ^ expectedHex.charCodeAt(i)
    }
    return result === 0
  } catch {
    return false
  }
}

// ============================================================
// WORKER ENTRY
// ============================================================

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const origin = request.headers.get('Origin') ?? ''
    const cors = corsHeaders(origin, env.ALLOWED_ORIGIN)

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors })
    }

    const path = url.pathname

    // Webhook — no Clerk auth, uses Stripe signature
    if (path === '/api/stripe/webhook' && request.method === 'POST') {
      try {
        return await handleWebhook(request, env, cors)
      } catch (error) {
        return json({ error: 'Webhook processing failed' }, 500, cors)
      }
    }

    // All other endpoints require Clerk auth
    const clerkUserId = await verifyClerkJWT(
      request.headers.get('Authorization'),
      env.CLERK_JWKS_URL
    )

    if (!clerkUserId) {
      return json({ error: 'Unauthorized' }, 401, cors)
    }

    try {
      // GET /api/stripe/subscription
      if (path === '/api/stripe/subscription' && request.method === 'GET') {
        return await handleGetSubscription(clerkUserId, env, cors)
      }

      // POST /api/stripe/checkout
      if (path === '/api/stripe/checkout' && request.method === 'POST') {
        return await handleCheckout(clerkUserId, request, env, cors)
      }

      // POST /api/stripe/billing-portal
      if (path === '/api/stripe/billing-portal' && request.method === 'POST') {
        return await handleBillingPortal(clerkUserId, request, env, cors)
      }

      return json({ error: 'Not found' }, 404, cors)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal server error'
      return json({ error: message }, 500, cors)
    }
  },
}
