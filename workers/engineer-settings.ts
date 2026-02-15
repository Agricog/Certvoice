/**
 * CertVoice — Engineer Settings API
 *
 * Cloudflare Worker handling GET/PUT for engineer profile settings.
 * Reads/writes the `engineers` table in Neon PostgreSQL.
 *
 * Endpoints:
 *   GET  /api/engineer/settings  — Load current engineer settings
 *   PUT  /api/engineer/settings  — Create or update engineer settings
 *
 * Auth: Clerk JWT verified from Authorization header.
 * Storage: Signature PNG uploaded to R2, key stored in Neon.
 * Rate limit: 30 requests/hour per engineer via Upstash.
 * Guard: requestId, structured logs, safety switches per Build Standard v3.
 *
 * Deploy: wrangler deploy (separate from Railway frontend)
 *
 * @module workers/engineer-settings
 */

import { neon } from '@neondatabase/serverless'
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
  SIGNATURES_BUCKET: R2Bucket
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

/** Frontend camelCase shape from Settings.tsx */
interface SettingsPayload {
  fullName: string
  phone: string
  email: string
  companyName: string
  companyAddress: string
  companyPhone: string
  companyEmail: string
  registrationBody: string
  registrationNumber: string
  qualifications: string
  signatureKey: string | null
  signatureDataUrl: string | null
  mftSerial: string
  mftCalibrationDate: string
  loopTesterSerial: string
  loopTesterCalibrationDate: string
  rcdTesterSerial: string
  rcdTesterCalibrationDate: string
  irTesterSerial: string
  irTesterCalibrationDate: string
  continuityTesterSerial: string
  continuityTesterCalibrationDate: string
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
// GUARD HELPERS
// ============================================================

function generateRequestId(): string {
  const timestamp = Date.now().toString(36)
  const random = crypto.randomUUID().slice(0, 8)
  return `cv-eng-${timestamp}-${random}`
}

function structuredLog(log: StructuredLog): void {
  console.log(JSON.stringify({
    ...log,
    service: 'certvoice-engineer-settings',
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
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
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
// RATE LIMITING
// ============================================================

function createRateLimiter(env: Env): Ratelimit {
  return new Ratelimit({
    redis: new Redis({
      url: env.UPSTASH_REDIS_REST_URL,
      token: env.UPSTASH_REDIS_REST_TOKEN,
    }),
    limiter: Ratelimit.slidingWindow(30, '3600 s'),
    prefix: 'certvoice:settings',
  })
}

// ============================================================
// FIELD MAPPING — camelCase ↔ snake_case
// ============================================================

/** Map DB row (snake_case) → frontend payload (camelCase) */
function dbToPayload(row: Record<string, unknown>): SettingsPayload {
  return {
    fullName: (row.full_name as string) ?? '',
    phone: (row.phone as string) ?? '',
    email: (row.email as string) ?? '',
    companyName: (row.company_name as string) ?? '',
    companyAddress: (row.company_address as string) ?? '',
    companyPhone: (row.company_phone as string) ?? '',
    companyEmail: (row.company_email as string) ?? '',
    registrationBody: (row.registration_body as string) ?? '',
    registrationNumber: (row.registration_number as string) ?? '',
    qualifications: (row.qualifications as string) ?? '',
    signatureKey: (row.signature_r2_key as string) ?? null,
    signatureDataUrl: null, // Populated separately from R2
    mftSerial: (row.mft_serial as string) ?? '',
    mftCalibrationDate: (row.mft_calibration_date as string) ?? '',
    loopTesterSerial: (row.loop_tester_serial as string) ?? '',
    loopTesterCalibrationDate: (row.loop_tester_cal_date as string) ?? '',
    rcdTesterSerial: (row.rcd_tester_serial as string) ?? '',
    rcdTesterCalibrationDate: (row.rcd_tester_cal_date as string) ?? '',
    irTesterSerial: (row.ir_tester_serial as string) ?? '',
    irTesterCalibrationDate: (row.ir_tester_cal_date as string) ?? '',
    continuityTesterSerial: (row.continuity_tester_serial as string) ?? '',
    continuityTesterCalibrationDate: (row.continuity_tester_cal_date as string) ?? '',
  }
}

// ============================================================
// SIGNATURE — R2 upload/download
// ============================================================

async function uploadSignature(
  bucket: R2Bucket,
  clerkUserId: string,
  dataUrl: string
): Promise<string> {
  // Extract base64 from data URL (data:image/png;base64,XXXX)
  const match = dataUrl.match(/^data:image\/png;base64,(.+)$/)
  if (!match || !match[1]) {
    throw new Error('Invalid signature data URL format')
  }

  const binaryStr = atob(match[1])
  const bytes = new Uint8Array(binaryStr.length)
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i)
  }

  // Validate size (max 2MB)
  if (bytes.length > 2 * 1024 * 1024) {
    throw new Error('Signature too large (max 2MB)')
  }

  const key = `signatures/${clerkUserId}/${Date.now()}.png`
  await bucket.put(key, bytes.buffer, {
    httpMetadata: { contentType: 'image/png' },
  })

  return key
}

async function getSignatureDataUrl(
  bucket: R2Bucket,
  key: string
): Promise<string | null> {
  try {
    const object = await bucket.get(key)
    if (!object) return null

    const arrayBuffer = await object.arrayBuffer()
    const bytes = new Uint8Array(arrayBuffer)
    let binary = ''
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i])
    }
    const base64 = btoa(binary)
    return `data:image/png;base64,${base64}`
  } catch {
    return null
  }
}

// ============================================================
// HANDLERS
// ============================================================

async function handleGet(
  clerkUserId: string,
  env: Env,
  cors: Record<string, string>,
  requestId: string
): Promise<Response> {
  const sql = neon(env.DATABASE_URL)

  const rows = await sql`
    SELECT * FROM engineers WHERE clerk_user_id = ${clerkUserId} LIMIT 1
  `

  if (rows.length === 0) {
    return new Response(JSON.stringify({ data: null, requestId }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', ...cors },
    })
  }

  const row = rows[0] as Record<string, unknown>
  const payload = dbToPayload(row)

  // Fetch signature from R2 if key exists
  if (row.signature_r2_key) {
    payload.signatureDataUrl = await getSignatureDataUrl(
      env.SIGNATURES_BUCKET,
      row.signature_r2_key as string
    )
  }

  return new Response(JSON.stringify({ ...payload, requestId }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...cors },
  })
}

async function handlePut(
  clerkUserId: string,
  request: Request,
  env: Env,
  cors: Record<string, string>,
  requestId: string
): Promise<Response> {
  const body = (await request.json()) as SettingsPayload
  const sql = neon(env.DATABASE_URL)

  // Validate required fields
  if (!body.fullName || body.fullName.trim().length === 0) {
    return new Response(
      JSON.stringify({ error: 'Full name is required', requestId }),
      { status: 400, headers: { 'Content-Type': 'application/json', ...cors } }
    )
  }

  // Handle signature upload to R2
  let signatureR2Key: string | null = null
  if (body.signatureDataUrl) {
    try {
      signatureR2Key = await uploadSignature(env.SIGNATURES_BUCKET, clerkUserId, body.signatureDataUrl)
    } catch {
      return new Response(
        JSON.stringify({ error: 'Failed to upload signature', requestId }),
        { status: 400, headers: { 'Content-Type': 'application/json', ...cors } }
      )
    }
  }

  // Normalise empty strings to null for optional date fields
  const toDateOrNull = (val: string): string | null => (val && val.trim() ? val.trim() : null)

  // Upsert: insert if new, update if exists (keyed on clerk_user_id)
  const rows = await sql`
    INSERT INTO engineers (
      clerk_user_id,
      full_name,
      email,
      phone,
      qualifications,
      company_name,
      company_address,
      company_phone,
      company_email,
      registration_body,
      registration_number,
      signature_r2_key,
      mft_serial,
      mft_calibration_date,
      loop_tester_serial,
      loop_tester_cal_date,
      rcd_tester_serial,
      rcd_tester_cal_date,
      ir_tester_serial,
      ir_tester_cal_date,
      continuity_tester_serial,
      continuity_tester_cal_date
    ) VALUES (
      ${clerkUserId},
      ${body.fullName.trim()},
      ${body.email.trim()},
      ${body.phone.trim() || null},
      ${body.qualifications.trim() || null},
      ${body.companyName.trim() || null},
      ${body.companyAddress.trim() || null},
      ${body.companyPhone.trim() || null},
      ${body.companyEmail.trim() || null},
      ${body.registrationBody || null},
      ${body.registrationNumber.trim() || null},
      ${signatureR2Key},
      ${body.mftSerial.trim() || null},
      ${toDateOrNull(body.mftCalibrationDate)},
      ${body.loopTesterSerial.trim() || null},
      ${toDateOrNull(body.loopTesterCalibrationDate)},
      ${body.rcdTesterSerial.trim() || null},
      ${toDateOrNull(body.rcdTesterCalibrationDate)},
      ${body.irTesterSerial.trim() || null},
      ${toDateOrNull(body.irTesterCalibrationDate)},
      ${body.continuityTesterSerial.trim() || null},
      ${toDateOrNull(body.continuityTesterCalibrationDate)}
    )
    ON CONFLICT (clerk_user_id) DO UPDATE SET
      full_name = EXCLUDED.full_name,
      email = EXCLUDED.email,
      phone = EXCLUDED.phone,
      qualifications = EXCLUDED.qualifications,
      company_name = EXCLUDED.company_name,
      company_address = EXCLUDED.company_address,
      company_phone = EXCLUDED.company_phone,
      company_email = EXCLUDED.company_email,
      registration_body = EXCLUDED.registration_body,
      registration_number = EXCLUDED.registration_number,
      signature_r2_key = CASE
        WHEN ${signatureR2Key}::TEXT IS NOT NULL THEN ${signatureR2Key}
        ELSE engineers.signature_r2_key
      END,
      mft_serial = EXCLUDED.mft_serial,
      mft_calibration_date = EXCLUDED.mft_calibration_date,
      loop_tester_serial = EXCLUDED.loop_tester_serial,
      loop_tester_cal_date = EXCLUDED.loop_tester_cal_date,
      rcd_tester_serial = EXCLUDED.rcd_tester_serial,
      rcd_tester_cal_date = EXCLUDED.rcd_tester_cal_date,
      ir_tester_serial = EXCLUDED.ir_tester_serial,
      ir_tester_cal_date = EXCLUDED.ir_tester_cal_date,
      continuity_tester_serial = EXCLUDED.continuity_tester_serial,
      continuity_tester_cal_date = EXCLUDED.continuity_tester_cal_date
    RETURNING id
  `

  const engineerId = rows[0]?.id as string

  return new Response(
    JSON.stringify({ success: true, engineerId, requestId }),
    { status: 200, headers: { 'Content-Type': 'application/json', ...cors } }
  )
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

    // Only handle /api/engineer/settings
    if (url.pathname !== '/api/engineer/settings') {
      status = 404
      structuredLog({
        requestId, route: url.pathname, method: request.method,
        status, latencyMs: Date.now() - startTime, userId: null,
        message: 'Route not found',
      })
      return new Response(JSON.stringify({ error: 'Not found', requestId }), {
        status,
        headers: { 'Content-Type': 'application/json', ...cors },
      })
    }

    // Only GET and PUT
    if (request.method !== 'GET' && request.method !== 'PUT') {
      status = 405
      structuredLog({
        requestId, route: url.pathname, method: request.method,
        status, latencyMs: Date.now() - startTime, userId: null,
        message: 'Method not allowed',
      })
      return new Response(JSON.stringify({ error: 'Method not allowed', requestId }), {
        status,
        headers: { 'Content-Type': 'application/json', ...cors },
      })
    }

    // READ_ONLY_MODE safety switch (blocks PUT, allows GET)
    if (env.READ_ONLY_MODE === 'true' && request.method === 'PUT') {
      status = 503
      structuredLog({
        requestId, route: url.pathname, method: request.method,
        status, latencyMs: Date.now() - startTime, userId: null,
        message: 'Read-only mode active — write operation blocked',
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
        status, latencyMs: Date.now() - startTime, userId: null,
        message: 'JWT verification failed',
      })
      return new Response(JSON.stringify({ error: 'Unauthorized', requestId }), {
        status,
        headers: { 'Content-Type': 'application/json', ...cors },
      })
    }

    // Rate limit
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
          JSON.stringify({ error: 'Too many requests. Try again later.', code: 'RATE_LIMITED', requestId }),
          { status, headers: { 'Content-Type': 'application/json', ...cors } }
        )
      }
    } catch {
      // Rate limiter failure should not block the request
    }

    // Route
    try {
      let response: Response
      if (request.method === 'GET') {
        response = await handleGet(userId, env, cors, requestId)
      } else {
        response = await handlePut(userId, request, env, cors, requestId)
      }

      status = response.status
      structuredLog({
        requestId, route: url.pathname, method: request.method,
        status, latencyMs: Date.now() - startTime, userId,
        message: request.method === 'GET'
          ? (status === 200 ? 'Settings loaded' : 'Settings not found')
          : (status === 200 ? 'Settings saved' : 'Settings save failed'),
      })

      return response
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal server error'
      status = 500
      structuredLog({
        requestId, route: url.pathname, method: request.method,
        status, latencyMs: Date.now() - startTime, userId,
        error: message,
      })
      return new Response(
        JSON.stringify({ error: 'Internal server error', requestId }),
        { status, headers: { 'Content-Type': 'application/json', ...cors } }
      )
    }
  },
}
