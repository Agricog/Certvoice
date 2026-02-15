/**
 * CertVoice — Claude AI Extraction Proxy
 *
 * Cloudflare Worker that receives voice transcripts from the frontend
 * and uses Claude to extract structured EICR data (circuits, observations,
 * supply characteristics).
 *
 * Endpoints:
 *   POST /api/extract — Voice transcript → structured EICR data
 *
 * Auth: Clerk JWT verified from Authorization header.
 * Rate limit: 60 requests/hour per engineer via Upstash.
 * Guard: requestId, structured logs, safety switches per Build Standard v3.
 *
 * Deploy: wrangler deploy --env claude-proxy
 *
 * @module workers/claude-proxy
 */

import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis/cloudflare'

// ============================================================
// TYPES
// ============================================================

interface Env {
  DATABASE_URL: string
  ALLOWED_ORIGIN: string
  CLERK_JWKS_URL: string
  UPSTASH_REDIS_REST_URL: string
  UPSTASH_REDIS_REST_TOKEN: string
  ANTHROPIC_API_KEY: string
  READ_ONLY_MODE?: string
}

interface ClerkJWTPayload {
  sub: string
  exp: number
  iat: number
  nbf: number
  iss: string
  azp?: string
}

interface ExtractionRequest {
  transcript: string
  locationContext: string
  dbContext: string
  existingCircuits: string[]
  earthingType: string | null
}

type ExtractionType = 'circuit' | 'observation' | 'supply'

interface ExtractionResult {
  success: boolean
  type: ExtractionType
  confidence: number
  circuit?: Record<string, unknown>
  observation?: Record<string, unknown>
  supply?: Record<string, unknown>
  warnings: string[]
}

interface StructuredLog {
  requestId: string
  route: string
  method: string
  status: number
  latencyMs: number
  userId: string | null
  engineerId: string | null
  message?: string
  error?: string
}

// ============================================================
// GUARD HELPERS
// ============================================================

function generateRequestId(): string {
  const timestamp = Date.now().toString(36)
  const random = crypto.randomUUID().slice(0, 8)
  return `cv-ext-${timestamp}-${random}`
}

function structuredLog(log: StructuredLog): void {
  console.log(JSON.stringify({
    ...log,
    service: 'certvoice-claude-proxy',
    timestamp: new Date().toISOString(),
  }))
}

// ============================================================
// CORS
// ============================================================

function corsHeaders(origin: string, allowedOrigin: string): Record<string, string> {
  const isAllowed = origin === allowedOrigin
  return {
    'Access-Control-Allow-Origin': isAllowed ? origin : '',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  }
}

function corsResponse(origin: string, allowedOrigin: string): Response {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(origin, allowedOrigin),
  })
}

// ============================================================
// AUTH — Clerk JWT verification
// ============================================================

async function verifyClerkJWT(
  authHeader: string | null,
  jwksUrl: string
): Promise<string | null> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null

  const token = authHeader.slice(7)

  try {
    const headerB64 = token.split('.')[0]
    if (!headerB64) return null

    const headerJson = JSON.parse(atob(headerB64.replace(/-/g, '+').replace(/_/g, '/')))
    const kid: string = headerJson.kid
    if (!kid) return null

    const jwksResponse = await fetch(jwksUrl)
    if (!jwksResponse.ok) return null

    const jwks = (await jwksResponse.json()) as { keys: Array<{ kid: string; kty: string; n: string; e: string }> }
    const jwk = jwks.keys.find((k) => k.kid === kid)
    if (!jwk) return null

    const publicKey = await crypto.subtle.importKey(
      'jwk',
      { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    )

    const parts = token.split('.')
    if (parts.length !== 3) return null

    const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
    const signature = Uint8Array.from(
      atob(parts[2].replace(/-/g, '+').replace(/_/g, '/')),
      (c) => c.charCodeAt(0)
    )

    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, signature, data)
    if (!valid) return null

    const payloadB64 = parts[1]
    if (!payloadB64) return null

    const payload: ClerkJWTPayload = JSON.parse(
      atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/'))
    )

    const now = Math.floor(Date.now() / 1000)
    if (payload.exp < now) return null

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
    limiter: Ratelimit.slidingWindow(60, '3600 s'),
    prefix: 'certvoice:extract',
  })
}

// ============================================================
// INPUT VALIDATION
// ============================================================

function validateRequest(body: unknown): { valid: true; data: ExtractionRequest } | { valid: false; error: string } {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'Request body is required' }
  }

  const req = body as Record<string, unknown>

  if (!req.transcript || typeof req.transcript !== 'string') {
    return { valid: false, error: 'transcript is required and must be a string' }
  }

  const transcript = (req.transcript as string).trim()
  if (transcript.length === 0) {
    return { valid: false, error: 'transcript cannot be empty' }
  }

  if (transcript.length > 10000) {
    return { valid: false, error: 'transcript exceeds maximum length (10000 chars)' }
  }

  return {
    valid: true,
    data: {
      transcript,
      locationContext: typeof req.locationContext === 'string' ? req.locationContext.trim() : '',
      dbContext: typeof req.dbContext === 'string' ? req.dbContext.trim() : '',
      existingCircuits: Array.isArray(req.existingCircuits)
        ? (req.existingCircuits as unknown[]).filter((c): c is string => typeof c === 'string')
        : [],
      earthingType: typeof req.earthingType === 'string' ? req.earthingType : null,
    },
  }
}

// ============================================================
// CLAUDE EXTRACTION PROMPT
// ============================================================

function buildExtractionPrompt(req: ExtractionRequest): string {
  return `You are a BS 7671:2018+A2:2022 compliant EICR data extraction assistant for UK electricians.

The engineer has spoken their findings on site. Extract structured data from their voice transcript.

CONTEXT:
- Location: ${req.locationContext || 'Not specified'}
- Distribution board: ${req.dbContext || 'Not specified'}
- Existing circuit numbers: ${req.existingCircuits.length > 0 ? req.existingCircuits.join(', ') : 'None yet'}
- Earthing type: ${req.earthingType || 'Not specified'}

TRANSCRIPT:
"${req.transcript}"

INSTRUCTIONS:
1. Determine if the transcript describes a CIRCUIT test result, an OBSERVATION/defect, or SUPPLY characteristics.
2. Extract ALL relevant data into the appropriate structured format.
3. For circuits: extract circuit number, description, type (B/C/D), rating, conductor sizes, test results (r1, rn, r2, Zs, RCD trip time, insulation resistance, etc.).
4. For observations: extract the description, location, classification (C1=Danger present, C2=Potentially dangerous, C3=Improvement recommended, FI=Further investigation), and any relevant BS 7671 regulation reference.
5. For supply: extract supply type (TN-C-S, TN-S, TT), Ze, voltage, frequency, PSCC, PEFC, and other supply characteristics.
6. Assign a confidence score (0.0 to 1.0) based on how clearly the transcript maps to structured data.
7. Include warnings for any values that seem unusual or may need verification.

Respond with ONLY valid JSON in this exact format (no markdown, no backticks):
{
  "type": "circuit" | "observation" | "supply",
  "confidence": 0.0-1.0,
  "circuit": { ... } | null,
  "observation": { ... } | null,
  "supply": { ... } | null,
  "warnings": ["string"]
}

For circuit objects use these field names:
circuitNumber, description, type, rating, cableSize, liveCsa, cpcCsa, refMethod, length, maxZs, r1, rn, r2, r1r2, zs, insResLL, insResLN, insResLE, rcdType, rcdRating, rcdTripTime, rcdTripCurrent, polarity, comments

For observation objects use these field names:
description, location, classification, regulationRef, recommendation, photoRequired

For supply objects use these field names:
supplyType, nominalVoltage, nominalFrequency, loopImpedanceZe, pscc, pefc, earthingArrangement, mainSwitchRating, mainSwitchBsEn, mainSwitchPoles, mainSwitchLocation`
}

// ============================================================
// CLAUDE API CALL
// ============================================================

async function callClaude(
  prompt: string,
  apiKey: string
): Promise<ExtractionResult> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    }),
  })

  if (!response.ok) {
    const errorBody = await response.text()
    throw new Error(`Claude API error (${response.status}): ${errorBody}`)
  }

  const result = (await response.json()) as {
    content: Array<{ type: string; text?: string }>
  }

  const textBlock = result.content.find((b) => b.type === 'text')
  if (!textBlock?.text) {
    throw new Error('No text response from Claude')
  }

  // Parse JSON response — strip any accidental markdown fences
  const cleaned = textBlock.text.replace(/```json\s?/g, '').replace(/```/g, '').trim()
  const parsed = JSON.parse(cleaned) as Record<string, unknown>

  const extractionType = parsed.type as ExtractionType
  if (!['circuit', 'observation', 'supply'].includes(extractionType)) {
    throw new Error(`Invalid extraction type: ${extractionType}`)
  }

  const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0.5
  const warnings = Array.isArray(parsed.warnings)
    ? (parsed.warnings as unknown[]).filter((w): w is string => typeof w === 'string')
    : []

  return {
    success: true,
    type: extractionType,
    confidence,
    circuit: extractionType === 'circuit' ? (parsed.circuit as Record<string, unknown>) ?? undefined : undefined,
    observation: extractionType === 'observation' ? (parsed.observation as Record<string, unknown>) ?? undefined : undefined,
    supply: extractionType === 'supply' ? (parsed.supply as Record<string, unknown>) ?? undefined : undefined,
    warnings,
  }
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
    let userId: string | null = null
    let status = 200

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return corsResponse(origin, env.ALLOWED_ORIGIN)
    }

    // Only handle /api/extract
    if (url.pathname !== '/api/extract') {
      status = 404
      structuredLog({
        requestId, route: url.pathname, method: request.method,
        status, latencyMs: Date.now() - startTime,
        userId: null, engineerId: null, message: 'Route not found',
      })
      return new Response(JSON.stringify({ error: 'Not found', requestId }), {
        status,
        headers: { 'Content-Type': 'application/json', ...cors },
      })
    }

    // Only POST
    if (request.method !== 'POST') {
      status = 405
      structuredLog({
        requestId, route: url.pathname, method: request.method,
        status, latencyMs: Date.now() - startTime,
        userId: null, engineerId: null, message: 'Method not allowed',
      })
      return new Response(JSON.stringify({ error: 'Method not allowed', requestId }), {
        status,
        headers: { 'Content-Type': 'application/json', ...cors },
      })
    }

    // READ_ONLY_MODE safety switch
    if (env.READ_ONLY_MODE === 'true') {
      status = 503
      structuredLog({
        requestId, route: url.pathname, method: request.method,
        status, latencyMs: Date.now() - startTime,
        userId: null, engineerId: null, message: 'Read-only mode active',
      })
      return new Response(
        JSON.stringify({ success: false, error: 'Service temporarily in read-only mode', code: 'READ_ONLY', requestId }),
        { status, headers: { 'Content-Type': 'application/json', ...cors } }
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
        requestId, route: url.pathname, method: request.method,
        status, latencyMs: Date.now() - startTime,
        userId: null, engineerId: null, message: 'JWT verification failed',
      })
      return new Response(JSON.stringify({ error: 'Unauthorized', requestId }), {
        status,
        headers: { 'Content-Type': 'application/json', ...cors },
      })
    }

    // Rate limit (keyed by Clerk userId)
    try {
      const limiter = createRateLimiter(env)
      const { success } = await limiter.limit(userId)
      if (!success) {
        status = 429
        structuredLog({
          requestId, route: url.pathname, method: request.method,
          status, latencyMs: Date.now() - startTime,
          userId, engineerId: null, message: 'Rate limited',
        })
        return new Response(
          JSON.stringify({
            success: false,
            error: 'Too many requests. Try again later.',
            code: 'RATE_LIMITED',
            requestId,
          }),
          { status, headers: { 'Content-Type': 'application/json', ...cors } }
        )
      }
    } catch {
      // Rate limiter failure should not block the request
    }

    // Parse and validate request
    let body: unknown
    try {
      body = await request.json()
    } catch {
      status = 400
      structuredLog({
        requestId, route: url.pathname, method: request.method,
        status, latencyMs: Date.now() - startTime,
        userId, engineerId: null, message: 'Invalid JSON body',
      })
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid JSON', code: 'INVALID_INPUT', requestId }),
        { status, headers: { 'Content-Type': 'application/json', ...cors } }
      )
    }

    const validation = validateRequest(body)
    if (!validation.valid) {
      status = 400
      structuredLog({
        requestId, route: url.pathname, method: request.method,
        status, latencyMs: Date.now() - startTime,
        userId, engineerId: null, message: `Validation failed: ${validation.error}`,
      })
      return new Response(
        JSON.stringify({ success: false, error: validation.error, code: 'INVALID_INPUT', requestId }),
        { status, headers: { 'Content-Type': 'application/json', ...cors } }
      )
    }

    // Build prompt and call Claude
    try {
      const prompt = buildExtractionPrompt(validation.data)
      const result = await callClaude(prompt, env.ANTHROPIC_API_KEY)

      structuredLog({
        requestId, route: url.pathname, method: request.method,
        status: 200, latencyMs: Date.now() - startTime,
        userId, engineerId: null,
        message: `Extraction OK: type=${result.type} confidence=${result.confidence}`,
      })

      return new Response(JSON.stringify({ ...result, requestId }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...cors },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Extraction failed'
      const code = message.includes('Claude API error') ? 'API_ERROR' : 'PARSE_FAILED'
      status = 500

      structuredLog({
        requestId, route: url.pathname, method: request.method,
        status, latencyMs: Date.now() - startTime,
        userId, engineerId: null,
        error: message,
      })

      return new Response(
        JSON.stringify({ success: false, error: message, code, requestId }),
        { status, headers: { 'Content-Type': 'application/json', ...cors } }
      )
    }
  },
}
