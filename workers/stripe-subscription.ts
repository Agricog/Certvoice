/**
 * CertVoice — Stripe Subscription Worker
 *
 * Cloudflare Worker handling Stripe integration for CertVoice Pro.
 * Tiered pricing: Solo £29.99/mo, Team £24.99/seat/mo, Business £19.99/seat/mo.
 * Solo tier fully functional at launch. Team/Business gated until Phase F.
 *
 * Endpoints:
 *   GET  /api/stripe/subscription    — Current subscription status
 *   POST /api/stripe/checkout        — Create Stripe Checkout session
 *   POST /api/stripe/billing-portal  — Create Stripe Billing Portal session
 *   POST /api/stripe/webhook         — Stripe webhook handler
 *
 * Auth: Clerk JWT on customer-facing endpoints.
 * Webhook: Stripe signature verification (no Clerk auth) + idempotency.
 * Rate limit: 30 requests/hour per engineer via Upstash.
 * Guard: requestId, structured logs, safety switches per Build Standard v3.
 *
 * Deploy: wrangler deploy (separate from Railway frontend)
 *
 * @module workers/stripe-subscription
 */

import { neon } from '@neondatabase/serverless'
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis/cloudflare'

// ============================================================
// TYPES
// ============================================================

type PlanTier = 'solo' | 'team' | 'business' | 'enterprise'

interface Env {
  DATABASE_URL: string
  ALLOWED_ORIGIN: string
  CLERK_JWKS_URL: string
  STRIPE_SECRET_KEY: string
  STRIPE_WEBHOOK_SECRET: string
  STRIPE_PRICE_ID_SOLO: string
  STRIPE_PRICE_ID_TEAM: string
  STRIPE_PRICE_ID_BUSINESS: string
  UPSTASH_REDIS_REST_URL: string
  UPSTASH_REDIS_REST_TOKEN: string
  READ_ONLY_MODE?: string
  WEBHOOKS_PAUSED?: string
}

interface ClerkJWTPayload {
  sub: string
  exp: number
}

interface SubscriptionResponse {
  status: string
  planTier: PlanTier
  planName: string
  currentPeriodEnd: string | null
  trialEnd: string | null
  cancelAtPeriodEnd: boolean
  amount: number
  currency: string
}

interface StructuredLog {
  requestId: string
  route: string
  method: string
  status: number
  latencyMs: number
  userId: string | null
  message?: string
  error?: string
}

// ============================================================
// PLAN TIER MAPPING
// ============================================================

interface PlanInfo {
  tier: PlanTier
  name: string
  amount: number // pence
}

function getPlanByPriceId(priceId: string, env: Env): PlanInfo | null {
  const map: Record<string, PlanInfo> = {
    [env.STRIPE_PRICE_ID_SOLO]: { tier: 'solo', name: 'CertVoice Solo', amount: 2999 },
    [env.STRIPE_PRICE_ID_TEAM]: { tier: 'team', name: 'CertVoice Team', amount: 2499 },
    [env.STRIPE_PRICE_ID_BUSINESS]: { tier: 'business', name: 'CertVoice Business', amount: 1999 },
  }
  return map[priceId] ?? null
}

function getPlanByTier(tier: PlanTier, env: Env): { priceId: string; info: PlanInfo } | null {
  const map: Record<string, { priceId: string; info: PlanInfo }> = {
    solo: { priceId: env.STRIPE_PRICE_ID_SOLO, info: { tier: 'solo', name: 'CertVoice Solo', amount: 2999 } },
    team: { priceId: env.STRIPE_PRICE_ID_TEAM, info: { tier: 'team', name: 'CertVoice Team', amount: 2499 } },
    business: { priceId: env.STRIPE_PRICE_ID_BUSINESS, info: { tier: 'business', name: 'CertVoice Business', amount: 1999 } },
  }
  return map[tier] ?? null
}

// Tiers gated until Phase F multi-seat implementation
const GATED_TIERS: PlanTier[] = ['team', 'business']

// ============================================================
// GUARD HELPERS
// ============================================================

function generateRequestId(): string {
  const timestamp = Date.now().toString(36)
  const random = crypto.randomUUID().slice(0, 8)
  return `cv-stripe-${timestamp}-${random}`
}

function structuredLog(log: StructuredLog): void {
  console.log(JSON.stringify({
    ...log,
    service: 'certvoice-stripe-subscription',
    timestamp: new Date().toISOString(),
  }))
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
// RATE LIMITING
// ============================================================

function createRateLimiter(env: Env): Ratelimit {
  return new Ratelimit({
    redis: new Redis({
      url: env.UPSTASH_REDIS_REST_URL,
      token: env.UPSTASH_REDIS_REST_TOKEN,
    }),
    limiter: Ratelimit.slidingWindow(30, '3600 s'),
    prefix: 'certvoice:stripe',
  })
}

// ============================================================
// WEBHOOK IDEMPOTENCY — Upstash Redis
// Stripe can retry webhooks for up to 72 hours.
// We store processed event IDs with 96-hour TTL.
// ============================================================

async function isEventProcessed(eventId: string, env: Env): Promise<boolean> {
  try {
    const redis = new Redis({
      url: env.UPSTASH_REDIS_REST_URL,
      token: env.UPSTASH_REDIS_REST_TOKEN,
    })
    const existing = await redis.get(`certvoice:webhook:${eventId}`)
    return existing !== null
  } catch {
    return false // Fail open — process rather than drop
  }
}

async function markEventProcessed(eventId: string, env: Env): Promise<void> {
  try {
    const redis = new Redis({
      url: env.UPSTASH_REDIS_REST_URL,
      token: env.UPSTASH_REDIS_REST_TOKEN,
    })
    // 96 hours TTL (Stripe retries up to 72hrs, plus buffer)
    await redis.set(`certvoice:webhook:${eventId}`, '1', { ex: 96 * 3600 })
  } catch {
    // Non-critical — worst case is a duplicate process
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
// HANDLERS
// ============================================================

/**
 * GET /api/stripe/subscription
 * Returns current subscription status for the authenticated engineer.
 * Now includes plan_tier and tier-specific amount.
 */
async function handleGetSubscription(
  clerkUserId: string,
  env: Env,
  cors: Record<string, string>,
  requestId: string
): Promise<Response> {
  const sql = neon(env.DATABASE_URL)

  const rows = await sql`
    SELECT subscription_status, subscription_plan, stripe_customer_id,
           trial_ends_at, current_period_end, plan_tier
    FROM engineers
    WHERE clerk_user_id = ${clerkUserId}
    LIMIT 1
  `

  if (rows.length === 0) {
    return json({ status: 'none', requestId }, 404, cors)
  }

  const row = rows[0]
  const status = (row.subscription_status as string) ?? 'none'
  const planTier = (row.plan_tier as PlanTier) ?? 'solo'

  // Resolve tier-specific display info
  const planData = getPlanByTier(planTier, env)
  const planName = planData?.info.name ?? 'CertVoice Solo'
  const amount = planData?.info.amount ?? 2999

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
          planTier,
          planName,
          currentPeriodEnd: subData.current_period_end
            ? new Date((subData.current_period_end as number) * 1000).toISOString()
            : null,
          trialEnd: subData.trial_end
            ? new Date((subData.trial_end as number) * 1000).toISOString()
            : null,
          cancelAtPeriodEnd: (subData.cancel_at_period_end as boolean) ?? false,
          amount,
          currency: 'gbp',
        }
        return json({ ...response, requestId }, 200, cors)
      }
    } catch {
      // Fall through to DB data if Stripe call fails
    }
  }

  const response: SubscriptionResponse = {
    status,
    planTier,
    planName,
    currentPeriodEnd: row.current_period_end
      ? new Date(row.current_period_end as string).toISOString()
      : null,
    trialEnd: row.trial_ends_at
      ? new Date(row.trial_ends_at as string).toISOString()
      : null,
    cancelAtPeriodEnd: false,
    amount,
    currency: 'gbp',
  }

  return json({ ...response, requestId }, 200, cors)
}

/**
 * POST /api/stripe/checkout
 * Creates a Stripe Checkout Session with 14-day trial.
 * Accepts { tier, successUrl, cancelUrl } — defaults to 'solo'.
 * Team/Business tiers gated until Phase F.
 * Returns { url } for frontend redirect.
 */
async function handleCheckout(
  clerkUserId: string,
  request: Request,
  env: Env,
  cors: Record<string, string>,
  requestId: string
): Promise<Response> {
  const body = (await request.json()) as {
    tier?: PlanTier
    successUrl: string
    cancelUrl: string
  }

  const tier: PlanTier = body.tier ?? 'solo'

  // Validate tier
  const planData = getPlanByTier(tier, env)
  if (!planData) {
    return json({ error: 'Invalid plan tier', requestId }, 400, cors)
  }

  // Gate team/business until Phase F
  if (GATED_TIERS.includes(tier)) {
    return json({
      error: 'Multi-seat plans coming soon. Solo plan available now.',
      code: 'TIER_NOT_AVAILABLE',
      requestId,
    }, 400, cors)
  }

  const sql = neon(env.DATABASE_URL)

  // Get or create Stripe customer
  const rows = await sql`
    SELECT id, stripe_customer_id, email, full_name
    FROM engineers
    WHERE clerk_user_id = ${clerkUserId}
    LIMIT 1
  `

  if (rows.length === 0) {
    return json({ error: 'Engineer not found. Complete settings first.', requestId }, 400, cors)
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
      'line_items[0][price]': planData.priceId,
      'line_items[0][quantity]': '1',
      'subscription_data[trial_period_days]': '14',
      'subscription_data[metadata][clerk_user_id]': clerkUserId,
      'subscription_data[metadata][plan_tier]': tier,
      'success_url': body.successUrl,
      'cancel_url': body.cancelUrl,
      'allow_promotion_codes': 'true',
    }
  )

  if (!session.url) {
    return json({ error: 'Failed to create checkout session', requestId }, 500, cors)
  }

  return json({ url: session.url as string, requestId }, 200, cors)
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
  cors: Record<string, string>,
  requestId: string
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
    return json({ error: 'No active subscription found.', requestId }, 400, cors)
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
    return json({ error: 'Failed to create billing portal session', requestId }, 500, cors)
  }

  return json({ url: session.url as string, requestId }, 200, cors)
}

/**
 * POST /api/stripe/webhook
 * Handles Stripe webhook events to keep Neon in sync.
 * No Clerk auth — uses Stripe signature verification.
 * Idempotent — duplicate event IDs are skipped via Upstash Redis.
 * Now extracts plan_tier from subscription metadata.
 */
async function handleWebhook(
  request: Request,
  env: Env,
  cors: Record<string, string>,
  requestId: string
): Promise<Response> {
  const signature = request.headers.get('stripe-signature')
  if (!signature) {
    return json({ error: 'Missing signature', requestId }, 400, cors)
  }

  const rawBody = await request.text()

  // Verify Stripe signature
  const verified = await verifyStripeSignature(rawBody, signature, env.STRIPE_WEBHOOK_SECRET)
  if (!verified) {
    return json({ error: 'Invalid signature', requestId }, 400, cors)
  }

  const event = JSON.parse(rawBody) as {
    id: string
    type: string
    data: { object: Record<string, unknown> }
  }

  // Idempotency check — skip if already processed
  const alreadyProcessed = await isEventProcessed(event.id, env)
  if (alreadyProcessed) {
    structuredLog({
      requestId, route: '/api/stripe/webhook', method: 'POST',
      status: 200, latencyMs: 0, userId: null,
      message: `Duplicate webhook skipped: ${event.id} (${event.type})`,
    })
    return json({ received: true, duplicate: true, requestId }, 200, cors)
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

      // Extract plan_tier from subscription metadata (set during checkout)
      const metadata = (obj.metadata ?? {}) as Record<string, string>
      const planTier = metadata.plan_tier ?? 'solo'

      // Also resolve tier from price ID as fallback
      const items = obj.items as { data?: Array<{ price?: { id?: string } }> } | undefined
      const priceId = items?.data?.[0]?.price?.id
      let resolvedTier = planTier
      if (priceId) {
        const planInfo = getPlanByPriceId(priceId, env)
        if (planInfo) {
          resolvedTier = planInfo.tier
        }
      }

      await sql`
        UPDATE engineers
        SET subscription_status = ${status},
            trial_ends_at = ${trialEnd},
            current_period_end = ${periodEnd},
            plan_tier = ${resolvedTier}
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

  // Mark event as processed (idempotency)
  await markEventProcessed(event.id, env)

  return json({ received: true, requestId }, 200, cors)
}

// ============================================================
// WORKER ENTRY
// ============================================================

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const startTime = Date.now()
    const requestId = generateRequestId()
    const url = new URL(request.url)
    const origin = request.headers.get('Origin') ?? ''
    const cors = corsHeaders(origin, env.ALLOWED_ORIGIN)
    const path = url.pathname
    let userId: string | null = null
    let status = 200

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors })
    }

    // ── Webhook route (no Clerk auth, uses Stripe signature) ──
    if (path === '/api/stripe/webhook' && request.method === 'POST') {
      // WEBHOOKS_PAUSED safety switch
      if (env.WEBHOOKS_PAUSED === 'true') {
        status = 503
        structuredLog({
          requestId, route: path, method: 'POST',
          status, latencyMs: Date.now() - startTime, userId: null,
          message: 'Webhooks paused — event not processed',
        })
        return json(
          { success: false, error: 'Webhooks temporarily paused', code: 'WEBHOOKS_PAUSED', requestId },
          status, cors
        )
      }

      try {
        const response = await handleWebhook(request, env, cors, requestId)
        status = response.status
        structuredLog({
          requestId, route: path, method: 'POST',
          status, latencyMs: Date.now() - startTime, userId: null,
          message: status === 200 ? 'Webhook processed' : 'Webhook rejected',
        })
        return response
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Webhook processing failed'
        status = 500
        structuredLog({
          requestId, route: path, method: 'POST',
          status, latencyMs: Date.now() - startTime, userId: null,
          error: message,
        })
        return json({ error: 'Webhook processing failed', requestId }, status, cors)
      }
    }

    // ── Customer-facing routes (Clerk auth required) ──

    // Validate route exists before auth
    const validPaths = ['/api/stripe/subscription', '/api/stripe/checkout', '/api/stripe/billing-portal']
    if (!validPaths.includes(path)) {
      status = 404
      structuredLog({
        requestId, route: path, method: request.method,
        status, latencyMs: Date.now() - startTime, userId: null,
        message: 'Route not found',
      })
      return json({ error: 'Not found', requestId }, status, cors)
    }

    // READ_ONLY_MODE safety switch (blocks checkout/billing-portal, allows subscription reads)
    const isWriteOp = request.method === 'POST'
    if (env.READ_ONLY_MODE === 'true' && isWriteOp) {
      status = 503
      structuredLog({
        requestId, route: path, method: request.method,
        status, latencyMs: Date.now() - startTime, userId: null,
        message: 'Read-only mode active — write operation blocked',
      })
      return json(
        { success: false, error: 'Service temporarily in read-only mode', code: 'READ_ONLY', requestId },
        status, cors
      )
    }

    // Authenticate via Clerk JWT
    userId = await verifyClerkJWT(
      request.headers.get('Authorization'),
      env.CLERK_JWKS_URL
    )

    if (!userId) {
      status = 401
      structuredLog({
        requestId, route: path, method: request.method,
        status, latencyMs: Date.now() - startTime, userId: null,
        message: 'JWT verification failed',
      })
      return json({ error: 'Unauthorized', requestId }, status, cors)
    }

    // Rate limit
    try {
      const limiter = createRateLimiter(env)
      const { success } = await limiter.limit(userId)
      if (!success) {
        status = 429
        structuredLog({
          requestId, route: path, method: request.method,
          status, latencyMs: Date.now() - startTime, userId,
          message: 'Rate limited',
        })
        return json({ error: 'Too many requests', code: 'RATE_LIMITED', requestId }, status, cors)
      }
    } catch {
      // Rate limiter failure should not block the request
    }

    try {
      let response: Response

      // GET /api/stripe/subscription
      if (path === '/api/stripe/subscription' && request.method === 'GET') {
        response = await handleGetSubscription(userId, env, cors, requestId)
      }
      // POST /api/stripe/checkout
      else if (path === '/api/stripe/checkout' && request.method === 'POST') {
        response = await handleCheckout(userId, request, env, cors, requestId)
      }
      // POST /api/stripe/billing-portal
      else if (path === '/api/stripe/billing-portal' && request.method === 'POST') {
        response = await handleBillingPortal(userId, request, env, cors, requestId)
      }
      // Method not allowed
      else {
        status = 405
        structuredLog({
          requestId, route: path, method: request.method,
          status, latencyMs: Date.now() - startTime, userId,
          message: 'Method not allowed',
        })
        return json({ error: 'Method not allowed', requestId }, status, cors)
      }

      status = response.status
      structuredLog({
        requestId, route: path, method: request.method,
        status, latencyMs: Date.now() - startTime, userId,
        message: `${request.method} ${path.split('/').pop()}`,
      })

      return response
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal server error'
      status = 500
      structuredLog({
        requestId, route: path, method: request.method,
        status, latencyMs: Date.now() - startTime, userId,
        error: message,
      })
      return json({ error: 'Internal server error', requestId }, status, cors)
    }
  },
}
