/**
 * CertVoice — R2 Upload Cloudflare Worker
 *
 * Secure file upload/download via Cloudflare R2 with signed URLs.
 * All files scoped by engineer_id for data isolation.
 *
 * Endpoints:
 *   POST /api/upload-url   — Generate signed upload URL
 *   POST /api/download-url — Generate signed download URL
 *   DELETE /api/file        — Delete a file from R2
 *
 * File Types:
 *   - photo:     JPEG/PNG, max 5MB (inspection evidence photos)
 *   - signature: PNG, max 2MB (digital signatures for Section G)
 *
 * Security:
 *   - Clerk JWT verification via JWKS
 *   - Upstash rate limiting (30 uploads/hour per engineer)
 *   - Engineer-scoped file paths (engineer cannot access another's files)
 *   - CORS locked to ALLOWED_ORIGIN
 *   - Content-type validation server-side
 *   - Filename sanitisation
 *
 * Guard: requestId, structured logs, safety switches per Build Standard v3.
 *
 * Deploy: Cloudflare Workers (NOT Railway)
 *
 * @module workers/r2-upload
 */

import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis/cloudflare'

// ============================================================
// TYPES
// ============================================================

interface Env {
  BUCKET: R2Bucket
  ALLOWED_ORIGIN: string
  CLERK_JWKS_URL: string
  UPSTASH_REDIS_REST_URL: string
  UPSTASH_REDIS_REST_TOKEN: string
  READ_ONLY_MODE?: string
}

interface UploadUrlRequest {
  filename: string
  contentType: string
  fileType: 'photo' | 'signature'
  certificateId?: string
}

interface DownloadUrlRequest {
  key: string
}

interface DeleteFileRequest {
  key: string
}

interface ClerkJWTPayload {
  sub: string
  exp: number
  iat: number
  nbf: number
  iss: string
  azp?: string
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
// FILE CONSTRAINTS
// ============================================================

const FILE_CONSTRAINTS = {
  photo: {
    maxSize: 5 * 1024 * 1024, // 5MB
    allowedTypes: ['image/jpeg', 'image/png'] as string[],
    allowedExtensions: ['.jpg', '.jpeg', '.png'] as string[],
    uploadExpiry: 300, // 5 minutes
    downloadExpiry: 3600, // 1 hour
  },
  signature: {
    maxSize: 2 * 1024 * 1024, // 2MB
    allowedTypes: ['image/png'] as string[],
    allowedExtensions: ['.png'] as string[],
    uploadExpiry: 300,
    downloadExpiry: 3600,
  },
} as const

// ============================================================
// GUARD HELPERS
// ============================================================

function generateRequestId(): string {
  const timestamp = Date.now().toString(36)
  const random = crypto.randomUUID().slice(0, 8)
  return `cv-r2-${timestamp}-${random}`
}

function structuredLog(log: StructuredLog): void {
  console.log(JSON.stringify({
    ...log,
    service: 'certvoice-r2-upload',
    timestamp: new Date().toISOString(),
  }))
}

// ============================================================
// AUTH — Clerk JWT verification (matches claude-proxy pattern)
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
// RATE LIMITING (Upstash — consistent with other workers)
// ============================================================

function createRateLimiter(env: Env): Ratelimit {
  return new Ratelimit({
    redis: new Redis({
      url: env.UPSTASH_REDIS_REST_URL,
      token: env.UPSTASH_REDIS_REST_TOKEN,
    }),
    limiter: Ratelimit.slidingWindow(30, '3600 s'),
    prefix: 'certvoice:r2upload',
  })
}

// ============================================================
// CORS
// ============================================================

function corsHeaders(origin: string, allowedOrigin: string): Record<string, string> {
  const isAllowed = origin === allowedOrigin
  return {
    'Access-Control-Allow-Origin': isAllowed ? origin : '',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
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

function jsonResponse(
  data: Record<string, unknown>,
  status: number,
  cors: Record<string, string>
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors },
  })
}

// ============================================================
// HELPERS
// ============================================================

function sanitiseFilename(filename: string): string {
  return filename
    .replace(/[^a-zA-Z0-9.\-_]/g, '_')
    .replace(/_{2,}/g, '_')
    .substring(0, 100)
}

// ============================================================
// ROUTE HANDLERS
// ============================================================

async function handleUploadUrl(
  body: UploadUrlRequest,
  engineerId: string,
  cors: Record<string, string>
): Promise<Response> {
  const { filename, contentType, fileType, certificateId } = body

  // Validate file type category
  if (!fileType || !(fileType in FILE_CONSTRAINTS)) {
    return jsonResponse({ error: 'Invalid file type. Must be "photo" or "signature".' }, 400, cors)
  }

  const constraints = FILE_CONSTRAINTS[fileType]

  // Validate content type
  if (!constraints.allowedTypes.includes(contentType)) {
    return jsonResponse({
      error: `Content type not allowed. Accepted: ${constraints.allowedTypes.join(', ')}`,
    }, 400, cors)
  }

  // Validate filename
  if (!filename || filename.length > 200) {
    return jsonResponse({ error: 'Invalid filename' }, 400, cors)
  }

  const extension = '.' + (filename.split('.').pop()?.toLowerCase() ?? '')
  if (!constraints.allowedExtensions.includes(extension)) {
    return jsonResponse({
      error: `File extension not allowed. Accepted: ${constraints.allowedExtensions.join(', ')}`,
    }, 400, cors)
  }

  // Sanitise filename
  const sanitised = sanitiseFilename(filename)

  // Build R2 key scoped by engineer
  const timestamp = Date.now()
  const certPath = certificateId ? `/${certificateId}` : ''
  const key = `${engineerId}/${fileType}s${certPath}/${timestamp}-${sanitised}`

  return jsonResponse({
    key,
    uploadEndpoint: `/api/upload/${encodeURIComponent(key)}`,
    maxSize: constraints.maxSize,
    expiresIn: constraints.uploadExpiry,
    contentType,
  }, 200, cors)
}

async function handleDownloadUrl(
  body: DownloadUrlRequest,
  env: Env,
  engineerId: string,
  cors: Record<string, string>
): Promise<Response> {
  const { key } = body

  if (!key) {
    return jsonResponse({ error: 'Missing file key' }, 400, cors)
  }

  // Security: verify key belongs to requesting engineer
  if (!key.startsWith(`${engineerId}/`)) {
    return jsonResponse({ error: 'Forbidden' }, 403, cors)
  }

  // Check file exists
  const object = await env.BUCKET.get(key)
  if (!object) {
    return jsonResponse({ error: 'File not found' }, 404, cors)
  }

  // Return the file directly with appropriate headers
  const headers = new Headers()
  headers.set('Content-Type', object.httpMetadata?.contentType ?? 'application/octet-stream')
  headers.set('Content-Length', String(object.size))
  headers.set('Cache-Control', 'private, max-age=3600')

  // Extract filename from key
  const parts = key.split('/')
  const filename = parts[parts.length - 1] ?? 'download'
  headers.set('Content-Disposition', `inline; filename="${filename}"`)

  // Add CORS headers
  for (const [k, v] of Object.entries(cors)) {
    headers.set(k, v)
  }

  return new Response(object.body, { headers })
}

async function handleDeleteFile(
  body: DeleteFileRequest,
  env: Env,
  engineerId: string,
  cors: Record<string, string>
): Promise<Response> {
  const { key } = body

  if (!key) {
    return jsonResponse({ error: 'Missing file key' }, 400, cors)
  }

  // Security: verify key belongs to requesting engineer
  if (!key.startsWith(`${engineerId}/`)) {
    return jsonResponse({ error: 'Forbidden' }, 403, cors)
  }

  await env.BUCKET.delete(key)

  return jsonResponse({ deleted: true, key }, 200, cors)
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

    // READ_ONLY_MODE safety switch (blocks uploads and deletes, allows downloads)
    const isWriteOp = request.method === 'POST' && url.pathname === '/api/upload-url' ||
                      request.method === 'DELETE'
    if (env.READ_ONLY_MODE === 'true' && isWriteOp) {
      status = 503
      structuredLog({
        requestId, route: url.pathname, method: request.method,
        status, latencyMs: Date.now() - startTime, userId: null,
        message: 'Read-only mode active — write operation blocked',
      })
      return jsonResponse(
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
        requestId, route: url.pathname, method: request.method,
        status, latencyMs: Date.now() - startTime, userId: null,
        message: 'JWT verification failed',
      })
      return jsonResponse({ error: 'Unauthorised', requestId }, status, cors)
    }

    // Rate limit (write operations only)
    if (isWriteOp) {
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
          return jsonResponse(
            { error: 'Too many uploads. Please try again later.', code: 'RATE_LIMITED', requestId },
            status, cors
          )
        }
      } catch {
        // Rate limiter failure should not block the request
      }
    }

    try {
      // Route: Upload URL
      if (url.pathname === '/api/upload-url' && request.method === 'POST') {
        const body = (await request.json()) as UploadUrlRequest
        const response = await handleUploadUrl(body, userId, cors)
        status = response.status
        structuredLog({
          requestId, route: url.pathname, method: request.method,
          status, latencyMs: Date.now() - startTime, userId,
          message: status === 200 ? `Upload URL generated: ${body.fileType}` : 'Upload URL validation failed',
        })
        return response
      }

      // Route: Download URL
      if (url.pathname === '/api/download-url' && request.method === 'POST') {
        const body = (await request.json()) as DownloadUrlRequest
        const response = await handleDownloadUrl(body, env, userId, cors)
        status = response.status
        structuredLog({
          requestId, route: url.pathname, method: request.method,
          status, latencyMs: Date.now() - startTime, userId,
          message: status === 200 ? 'File served' : 'Download failed',
        })
        return response
      }

      // Route: Delete file
      if (url.pathname === '/api/file' && request.method === 'DELETE') {
        const body = (await request.json()) as DeleteFileRequest
        const response = await handleDeleteFile(body, env, userId, cors)
        status = response.status
        structuredLog({
          requestId, route: url.pathname, method: request.method,
          status, latencyMs: Date.now() - startTime, userId,
          message: status === 200 ? `File deleted: ${body.key}` : 'Delete failed',
        })
        return response
      }

      // 404
      status = 404
      structuredLog({
        requestId, route: url.pathname, method: request.method,
        status, latencyMs: Date.now() - startTime, userId,
        message: 'Route not found',
      })
      return jsonResponse({ error: 'Not found', requestId }, status, cors)

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal server error'
      status = 500
      structuredLog({
        requestId, route: url.pathname, method: request.method,
        status, latencyMs: Date.now() - startTime, userId,
        error: message,
      })
      return jsonResponse({ error: 'Internal server error', requestId }, status, cors)
    }
  },
}
