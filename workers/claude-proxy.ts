/**
 * CertVoice — Claude API Proxy (Cloudflare Worker)
 *
 * This Cloudflare Worker:
 *   1. Verifies Clerk JWT from Authorization header
 *   2. Receives voice transcripts from the frontend
 *   3. Sends them to Claude API (Sonnet) with a trade terminology system prompt
 *   4. Returns structured circuit/observation/supply data
 *
 * Security:
 *   - Clerk JWT verified on every request
 *   - Anthropic API key stored in Worker environment (never touches client)
 *   - Rate limited: 60 requests/hour per user via Upstash
 *   - CORS restricted to certvoice.co.uk
 *   - No transcript persistence (processed in memory only)
 *   - Guard: requestId, structured logs per Build Standard v3
 *
 * Deployment:
 *   - Deploy via Cloudflare Dashboard or Wrangler CLI
 *   - NOT part of the Railway frontend deployment
 *   - Requires ANTHROPIC_API_KEY, CLERK_JWKS_URL environment variables
 *
 * Note: This file is NOT bundled with the React app.
 * It's deployed separately as a Cloudflare Worker.
 *
 * @module workers/claude-proxy
 */

import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis/cloudflare'

// ============================================================
// TYPES
// ============================================================

interface Env {
  ANTHROPIC_API_KEY: string
  ALLOWED_ORIGIN: string
  CLERK_JWKS_URL: string
  UPSTASH_REDIS_REST_URL: string
  UPSTASH_REDIS_REST_TOKEN: string
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

interface ClaudeMessage {
  role: 'user' | 'assistant'
  content: string
}

interface ClaudeResponse {
  content: Array<{ type: string; text: string }>
  usage: { input_tokens: number; output_tokens: number }
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
// SYSTEM PROMPT — THE CORE IP OF CERTVOICE
// ============================================================

const SYSTEM_PROMPT = `You are CertVoice AI, a specialist in UK electrical inspection terminology. Your job is to extract structured data from an electrician's spoken inspection notes.

You will receive a voice transcript that has been preprocessed (trade abbreviations normalised). Extract the data into a JSON response.

## RESPONSE FORMAT

Respond with ONLY valid JSON, no markdown, no explanation. The JSON must have this structure:

{
  "success": true,
  "type": "circuit" | "observation" | "supply",
  "confidence": 0.0-1.0,
  "warnings": ["string array of validation warnings"],
  "circuit": { ... } | null,
  "observation": { ... } | null,
  "supply": { ... } | null
}

## DETERMINING TYPE

- **circuit**: Transcript mentions circuit numbers, test results (Zs, R1+R2, IR, RCD times), MCB types/ratings, cable sizes
- **observation**: Transcript mentions defects, damage, non-compliance, classification codes (C1/C2/C3/FI), cracked/broken/missing items
- **supply**: Transcript mentions Ze, PFC/Ipf, earthing type (TN-S, TN-C-S, TT), main fuse, supply voltage

## CIRCUIT FIELDS (when type = "circuit")

Extract these fields from the transcript. Use null for fields not mentioned:

{
  "circuitNumber": "string — e.g. '3', '7 L1'",
  "circuitDescription": "string — e.g. 'Ring Final', 'Lighting', 'Cooker'",
  "wiringType": "A|B|C|D|E|F|G|H|O or null — A=T&E, F=SWA, H=MI",
  "referenceMethod": "A|B|C|D|E|F|G or null",
  "numberOfPoints": "number or null",
  "liveConductorCsa": "number in mm² or null",
  "cpcCsa": "number in mm² or null",
  "ocpdBsEn": "string — e.g. 'BS 60898'",
  "ocpdType": "B|C|D or null",
  "ocpdRating": "number in amps or null",
  "rcdBsEn": "string or empty",
  "rcdType": "A|AC|B|F|S or null",
  "rcdRating": "number in mA or null",
  "r1": "number or null — ring final line end-to-end",
  "rn": "number or null — ring final neutral end-to-end",
  "r2": "number or null — ring final CPC end-to-end",
  "r1r2": "number or '>200' or 'LIM' or 'N/V' or null",
  "irTestVoltage": "number in volts or null (usually 500)",
  "irLiveLive": "number or '>200' or 'LIM' or null — L-N insulation MΩ",
  "irLiveEarth": "number or '>200' or 'LIM' or null — L-E insulation MΩ",
  "zs": "number in ohms or null",
  "polarity": "TICK|CROSS or null — TICK if 'correct' or 'satisfactory'",
  "rcdDisconnectionTime": "number in ms or null",
  "rcdTestButton": "TICK|NA or null",
  "remarks": "string — any additional notes",
  "circuitType": "ring|radial or null — infer from r1/rn/r2 presence (ring) or absence (radial)",
  "status": "SATISFACTORY|UNSATISFACTORY — based on overall assessment"
}

## OBSERVATION FIELDS (when type = "observation")

{
  "observationText": "string — full description of the defect/issue",
  "classificationCode": "C1|C2|C3|FI — must determine from description",
  "dbReference": "string or empty",
  "circuitReference": "string or empty",
  "location": "string — physical location",
  "regulationReference": "string — BS 7671 reg number if mentioned or if you can identify it",
  "remedialAction": "string — what needs to be done to fix it"
}

Classification guidance:
- C1 (Danger Present): Exposed live parts, imminent shock/fire risk, immediate danger
- C2 (Potentially Dangerous): Could become dangerous, loose connections, inadequate protection, overloaded
- C3 (Improvement Recommended): Doesn't meet current regs but not dangerous, missing labels, old cable colours
- FI (Further Investigation): Can't determine severity, hidden wiring, untraceable circuits

## SUPPLY FIELDS (when type = "supply")

{
  "earthingType": "TN_C|TN_S|TN_C_S|TT|IT or null",
  "supplyType": "AC|DC — almost always AC",
  "conductorConfig": "1PH_2WIRE|2PH_3WIRE|3PH_3WIRE|3PH_4WIRE or null",
  "nominalVoltage": "number in volts or null",
  "nominalFrequency": "number in Hz or null (50 in UK)",
  "ipf": "number in kA or null",
  "ze": "number in ohms or null",
  "supplyDeviceBsEn": "string or empty",
  "supplyDeviceType": "string or empty",
  "supplyDeviceRating": "number in amps or null"
}

## VALIDATION WARNINGS

Add warnings to the warnings array for:
- Zs exceeds typical maximum for the MCB type/rating
- IR below 1.0 MΩ (minimum acceptable)
- RCD trip time exceeds 300ms
- Ring final r1 and rn differ by more than 0.05Ω
- Any values that seem unusual or may indicate a recording error

## TRADE TERMINOLOGY

The transcript has been preprocessed but may still contain:
- "T&E" = thermoplastic twin and earth (wiring type A)
- "SWA" = steel wire armoured (wiring type F)
- "MI" = mineral insulated (wiring type H)
- "CPC" = circuit protective conductor (earth wire)
- "MCB" = miniature circuit breaker
- "B32" = Type B MCB rated 32A
- ">200 MΩ" = insulation resistance exceeds meter range (excellent)
- "LIM" = limitation, not tested
- "N/V" = not verified
- "CU" or "DB" = consumer unit / distribution board
- "ring final" = ring circuit (has r1, rn, r2 readings)
- "radial" = radial circuit (has R1+R2 only)`

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
  const isAllowed =
    origin === allowedOrigin ||
    origin === 'http://localhost:5173' ||
    origin === 'http://localhost:3000'

  return {
    'Access-Control-Allow-Origin': isAllowed ? origin : allowedOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  }
}

// ============================================================
// AUTH — Clerk JWT verification (same pattern as engineer-settings)
// ============================================================

async function verifyClerkJWT(
  authHeader: string | null,
  jwksUrl: string
): Promise<string | null> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null

  const token = authHeader.slice(7)

  try {
    // Decode header to get kid
    const headerB64 = token.split('.')[0]
    if (!headerB64) return null

    const headerJson = JSON.parse(atob(headerB64.replace(/-/g, '+').replace(/_/g, '/')))
    const kid: string = headerJson.kid
    if (!kid) return null

    // Fetch JWKS from Clerk
    const jwksResponse = await fetch(jwksUrl)
    if (!jwksResponse.ok) return null

    const jwks = (await jwksResponse.json()) as { keys: Array<{ kid: string; kty: string; n: string; e: string }> }
    const jwk = jwks.keys.find((k) => k.kid === kid)
    if (!jwk) return null

    // Import public key
    const publicKey = await crypto.subtle.importKey(
      'jwk',
      { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    )

    // Verify signature
    const parts = token.split('.')
    if (parts.length !== 3) return null

    const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
    const signature = Uint8Array.from(
      atob(parts[2].replace(/-/g, '+').replace(/_/g, '/')),
      (c) => c.charCodeAt(0)
    )

    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, signature, data)
    if (!valid) return null

    // Decode payload
    const payloadB64 = parts[1]
    if (!payloadB64) return null

    const payload: ClerkJWTPayload = JSON.parse(
      atob(payloadB64.replace(/-/g, '+').replace(/_/g, '/'))
    )

    // Check expiry
    const now = Math.floor(Date.now() / 1000)
    if (payload.exp < now) return null

    return payload.sub
  } catch {
    return null
  }
}

// ============================================================
// RATE LIMITING — Upstash (same pattern as engineer-settings)
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
// CLAUDE API HELPERS
// ============================================================

function buildUserMessage(body: ExtractionRequest): string {
  let message = `Extract structured data from this electrician's voice transcript:\n\n`
  message += `"${body.transcript}"\n\n`

  if (body.locationContext) {
    message += `Current location: ${body.locationContext}\n`
  }
  if (body.dbContext) {
    message += `Distribution board: ${body.dbContext}\n`
  }
  if (body.earthingType) {
    message += `Earthing type: ${body.earthingType}\n`
  }
  if (body.existingCircuits && body.existingCircuits.length > 0) {
    message += `Existing circuits: ${body.existingCircuits.join(', ')}\n`
  }

  message += `\nRespond with ONLY valid JSON.`

  return message
}

async function callClaude(apiKey: string, userMessage: string): Promise<string> {
  const messages: ClaudeMessage[] = [
    { role: 'user', content: userMessage },
  ]

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
      system: SYSTEM_PROMPT,
      messages,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Claude API error ${response.status}: ${errorText}`)
  }

  const data = (await response.json()) as ClaudeResponse

  const textBlock = data.content.find((c) => c.type === 'text')
  if (!textBlock) {
    throw new Error('No text content in Claude response')
  }

  return textBlock.text
}

function parseClaudeResponse(text: string): Record<string, unknown> {
  // Strip markdown code fences if present
  let cleaned = text.trim()
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.slice(7)
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.slice(3)
  }
  if (cleaned.endsWith('```')) {
    cleaned = cleaned.slice(0, -3)
  }
  cleaned = cleaned.trim()

  try {
    return JSON.parse(cleaned) as Record<string, unknown>
  } catch {
    return {
      success: false,
      error: 'Failed to parse AI response as JSON',
      code: 'PARSE_FAILED',
      type: 'unknown',
      confidence: 0,
      warnings: [],
    }
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
    const cors = corsHeaders(origin, env.ALLOWED_ORIGIN ?? 'https://certvoice.co.uk')
    let userId: string | null = null
    let status = 200

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors })
    }

    // Only handle POST /api/extract
    if (url.pathname !== '/api/extract' || request.method !== 'POST') {
      status = 404
      structuredLog({
        requestId, route: url.pathname, method: request.method,
        status, latencyMs: Date.now() - startTime, userId: null,
        message: 'Route not found',
      })
      return new Response(
        JSON.stringify({ success: false, error: 'Not found', requestId }),
        { status, headers: { ...cors, 'Content-Type': 'application/json' } }
      )
    }

    // READ_ONLY_MODE safety switch
    if (env.READ_ONLY_MODE === 'true') {
      status = 503
      structuredLog({
        requestId, route: url.pathname, method: request.method,
        status, latencyMs: Date.now() - startTime, userId: null,
        message: 'Read-only mode active — extraction blocked',
      })
      return new Response(
        JSON.stringify({ success: false, error: 'Service temporarily unavailable', code: 'READ_ONLY', requestId }),
        { status, headers: { ...cors, 'Content-Type': 'application/json' } }
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
        status, latencyMs: Date.now() - startTime, userId: null,
        message: 'JWT verification failed',
      })
      return new Response(
        JSON.stringify({ success: false, error: 'Unauthorized', requestId }),
        { status, headers: { ...cors, 'Content-Type': 'application/json' } }
      )
    }

    // Rate limit via Upstash
    try {
      const limiter = createRateLimiter(env)
      const { success } = await limiter.limit(userId)
      if (!success) {
        status = 429
        structuredLog({
          requestId, route: url.pathname, method: request.method,
          status, latencyMs: Date.now() - startTime, userId,
          message: 'Rate limited',
        })
        return new Response(
          JSON.stringify({
            success: false,
            error: 'Rate limited. Please wait before trying again.',
            code: 'RATE_LIMITED',
            retryAfter: 60,
            requestId,
          }),
          { status, headers: { ...cors, 'Content-Type': 'application/json' } }
        )
      }
    } catch {
      // Rate limiter failure should not block the request
    }

    // Parse and validate request body
    try {
      const body = (await request.json()) as ExtractionRequest

      if (!body.transcript || body.transcript.trim().length < 5) {
        status = 400
        structuredLog({
          requestId, route: url.pathname, method: request.method,
          status, latencyMs: Date.now() - startTime, userId,
          message: 'Transcript too short',
        })
        return new Response(
          JSON.stringify({
            success: false,
            error: 'Transcript too short',
            code: 'INVALID_INPUT',
            requestId,
          }),
          { status, headers: { ...cors, 'Content-Type': 'application/json' } }
        )
      }

      // Build user message and call Claude
      const userMessage = buildUserMessage(body)
      const claudeResponse = await callClaude(env.ANTHROPIC_API_KEY, userMessage)
      const extractedData = parseClaudeResponse(claudeResponse)

      status = 200
      structuredLog({
        requestId, route: url.pathname, method: request.method,
        status, latencyMs: Date.now() - startTime, userId,
        message: `Extraction complete — type: ${extractedData.type ?? 'unknown'}`,
      })

      return new Response(JSON.stringify({ ...extractedData, requestId }), {
        status,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal error'
      status = 500
      structuredLog({
        requestId, route: url.pathname, method: request.method,
        status, latencyMs: Date.now() - startTime, userId,
        error: message,
      })
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Extraction failed',
          code: 'API_ERROR',
          requestId,
        }),
        { status, headers: { ...cors, 'Content-Type': 'application/json' } }
      )
    }
  },
}
