/**
 * CertVoice — R2 Upload Worker
 *
 * Secure file upload/download proxy for Cloudflare R2.
 * All requests authenticated via Clerk JWT + engineer_id isolation.
 *
 * Routes:
 *   POST   /api/upload                — Upload file (multipart or raw binary)
 *   GET    /api/upload/:key           — Download/serve file
 *   DELETE /api/upload/:key           — Delete file
 *
 * Storage key structure:
 *   {engineerId}/photos/{certId}/{uuid}.{ext}
 *   {engineerId}/signatures/{certId}/{uuid}.png
 *   {engineerId}/pdfs/{certId}/{uuid}.pdf
 *
 * Required bindings:
 *   CERTVOICE_STORAGE       — R2 bucket
 *   CLERK_JWKS_URL          — Clerk JWKS endpoint
 *   UPSTASH_REDIS_REST_URL  — Rate limiting
 *   UPSTASH_REDIS_REST_TOKEN
 *   ALLOWED_ORIGIN          — CORS origin
 *   READ_ONLY_MODE          — Safety switch
 *   DATABASE_URL             — Neon (engineer lookup)
 *
 * @module workers/r2-upload
 */

import { neon } from '@neondatabase/serverless'
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis/cloudflare'

// ============================================================
// CONSTANTS
// ============================================================

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB
const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf',
]
const ALLOWED_CATEGORIES = ['photos', 'signatures', 'pdfs']

// ============================================================
// GUARD HELPERS
// ============================================================

function generateRequestId() {
  const timestamp = Date.now().toString(36)
  const random = crypto.randomUUID().slice(0, 8)
  return `cv-r2-${timestamp}-${random}`
}

function structuredLog(log) {
  console.log(JSON.stringify({
    ...log,
    service: 'certvoice-r2-upload',
    timestamp: new Date().toISOString(),
  }))
}

// ============================================================
// CORS
// ============================================================

function corsHeaders(origin, allowed) {
  return {
    'Access-Control-Allow-Origin': origin === allowed ? origin : '',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  }
}

function json(data, status, cors) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors },
  })
}

// ============================================================
// AUTH — Clerk JWT verification
// ============================================================

async function verifyClerkJWT(authHeader, jwksUrl) {
  if (!authHeader?.startsWith('Bearer ')) return null
  const token = authHeader.slice(7)
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const headerJson = JSON.parse(atob(parts[0].replace(/-/g, '+').replace(/_/g, '/')))
    const kid = headerJson.kid
    if (!kid) return null
    const jwksResponse = await fetch(jwksUrl)
    if (!jwksResponse.ok) return null
    const jwks = await jwksResponse.json()
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
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))
    if (payload.exp < Math.floor(Date.now() / 1000)) return null
    return payload.sub
  } catch {
    return null
  }
}

// ============================================================
// RATE LIMITING
// ============================================================

function createRateLimiter(env) {
  return new Ratelimit({
    redis: new Redis({
      url: env.UPSTASH_REDIS_REST_URL,
      token: env.UPSTASH_REDIS_REST_TOKEN,
    }),
    limiter: Ratelimit.slidingWindow(60, '3600 s'),
    prefix: 'certvoice:r2',
  })
}

// ============================================================
// ENGINEER LOOKUP
// ============================================================

async function getEngineerId(sql, clerkUserId) {
  const rows = await sql`
    SELECT id FROM engineers WHERE clerk_user_id = ${clerkUserId} LIMIT 1
  `
  return rows.length > 0 ? rows[0].id : null
}

// ============================================================
// HELPERS
// ============================================================

function getExtensionFromMime(mime) {
  const map = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/heic': 'heic',
    'image/heif': 'heif',
    'application/pdf': 'pdf',
  }
  return map[mime] || 'bin'
}

function getMimeFromExtension(ext) {
  const map = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    heic: 'image/heic',
    heif: 'image/heif',
    pdf: 'application/pdf',
  }
  return map[ext] || 'application/octet-stream'
}

/**
 * Validate that a storage key belongs to this engineer.
 * Keys must start with the engineer's UUID.
 */
function validateKeyOwnership(key, engineerId) {
  return key.startsWith(`${engineerId}/`)
}

// ============================================================
// POST /api/upload — Upload file
//
// Body: raw binary or multipart/form-data
// Headers:
//   X-Upload-Category: photos | signatures | pdfs
//   X-Certificate-Id: UUID of certificate
//   Content-Type: file MIME type (for raw) or multipart/form-data
//
// Returns: { key, url, size, contentType, requestId }
// ============================================================

async function handleUpload(engineerId, request, env, cors, requestId) {
  const category = request.headers.get('X-Upload-Category') ?? 'photos'
  const certificateId = request.headers.get('X-Certificate-Id')

  // Validate category
  if (!ALLOWED_CATEGORIES.includes(category)) {
    return json({ error: `Invalid category. Must be one of: ${ALLOWED_CATEGORIES.join(', ')}`, requestId }, 400, cors)
  }

  // Certificate ID required
  if (!certificateId || !/^[a-f0-9-]{36}$/.test(certificateId)) {
    return json({ error: 'Valid X-Certificate-Id header required', requestId }, 400, cors)
  }

  let fileBytes
  let contentType

  const ct = request.headers.get('Content-Type') ?? ''

  if (ct.includes('multipart/form-data')) {
    // Multipart upload — extract first file
    const formData = await request.formData()
    const file = formData.get('file')
    if (!file || !(file instanceof File)) {
      return json({ error: 'No file found in form data', requestId }, 400, cors)
    }
    contentType = file.type
    fileBytes = await file.arrayBuffer()
  } else {
    // Raw binary upload
    contentType = ct.split(';')[0].trim()
    fileBytes = await request.arrayBuffer()
  }

  // Validate MIME type
  if (!ALLOWED_MIME_TYPES.includes(contentType)) {
    return json({
      error: `File type not allowed: ${contentType}. Accepted: ${ALLOWED_MIME_TYPES.join(', ')}`,
      requestId,
    }, 400, cors)
  }

  // Validate size
  if (fileBytes.byteLength > MAX_FILE_SIZE) {
    return json({
      error: `File too large (${Math.round(fileBytes.byteLength / 1024 / 1024)}MB). Max: ${MAX_FILE_SIZE / 1024 / 1024}MB`,
      requestId,
    }, 400, cors)
  }

  if (fileBytes.byteLength === 0) {
    return json({ error: 'Empty file', requestId }, 400, cors)
  }

  // Build storage key: {engineerId}/{category}/{certId}/{uuid}.{ext}
  const ext = getExtensionFromMime(contentType)
  const fileId = crypto.randomUUID()
  const key = `${engineerId}/${category}/${certificateId}/${fileId}.${ext}`

  // Upload to R2
  await env.CERTVOICE_STORAGE.put(key, fileBytes, {
    httpMetadata: {
      contentType,
    },
    customMetadata: {
      engineerId,
      certificateId,
      category,
      uploadedAt: new Date().toISOString(),
    },
  })

  return json({
    key,
    size: fileBytes.byteLength,
    contentType,
    requestId,
  }, 201, cors)
}

// ============================================================
// GET /api/upload/* — Download/serve file
//
// Key extracted from URL path after /api/upload/
// Engineer isolation enforced — key must start with engineerId
// ============================================================

async function handleDownload(engineerId, key, env, cors, requestId) {
  // Enforce ownership — key must belong to this engineer
  if (!validateKeyOwnership(key, engineerId)) {
    return json({ error: 'Access denied', requestId }, 403, cors)
  }

  const object = await env.CERTVOICE_STORAGE.get(key)
  if (!object) {
    return json({ error: 'File not found', requestId }, 404, cors)
  }

  const headers = new Headers(cors)
  headers.set('Content-Type', object.httpMetadata?.contentType ?? 'application/octet-stream')
  headers.set('Content-Length', String(object.size))
  headers.set('Cache-Control', 'private, max-age=3600')
  headers.set('ETag', object.httpEtag ?? '')

  return new Response(object.body, { status: 200, headers })
}

// ============================================================
// DELETE /api/upload/* — Delete file
// ============================================================

async function handleDelete(engineerId, key, env, cors, requestId) {
  if (!validateKeyOwnership(key, engineerId)) {
    return json({ error: 'Access denied', requestId }, 403, cors)
  }

  // Verify file exists before deleting
  const head = await env.CERTVOICE_STORAGE.head(key)
  if (!head) {
    return json({ error: 'File not found', requestId }, 404, cors)
  }

  await env.CERTVOICE_STORAGE.delete(key)

  return json({ deleted: true, key, requestId }, 200, cors)
}

// ============================================================
// ROUTE PARSING
// ============================================================

function parseRoute(pathname) {
  // POST /api/upload
  if (pathname === '/api/upload') return { action: 'upload', key: null }

  // GET/DELETE /api/upload/{engineerId}/{category}/{certId}/{filename}
  const match = pathname.match(/^\/api\/upload\/(.+)$/)
  if (match) {
    const key = decodeURIComponent(match[1])
    // Validate key format: uuid/category/uuid/filename
    if (/^[a-f0-9-]{36}\/[a-z]+\/[a-f0-9-]{36}\/[a-f0-9-]{36}\.\w+$/.test(key)) {
      return { action: 'file', key }
    }
    return { action: null }
  }

  return { action: null }
}

// ============================================================
// WORKER ENTRY
// ============================================================

export default {
  async fetch(request, env) {
    const startTime = Date.now()
    const requestId = generateRequestId()
    const url = new URL(request.url)
    const origin = request.headers.get('Origin') ?? ''
    const cors = corsHeaders(origin, env.ALLOWED_ORIGIN)
    let userId = null
    let engineerId = null
    let status = 200

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors })
    }

    // Parse route
    const route = parseRoute(url.pathname)
    if (!route.action) {
      status = 404
      structuredLog({ requestId, route: url.pathname, method: request.method, status, latencyMs: Date.now() - startTime, userId: null, message: 'Route not found' })
      return json({ error: 'Not found', requestId }, status, cors)
    }

    // READ_ONLY_MODE — block uploads and deletes
    const isWriteOp = request.method === 'POST' || request.method === 'DELETE'
    if (env.READ_ONLY_MODE === 'true' && isWriteOp) {
      status = 503
      structuredLog({ requestId, route: url.pathname, method: request.method, status, latencyMs: Date.now() - startTime, userId: null, message: 'Read-only mode' })
      return json({ error: 'Service temporarily in read-only mode', requestId }, status, cors)
    }

    // Authenticate
    userId = await verifyClerkJWT(request.headers.get('Authorization'), env.CLERK_JWKS_URL)
    if (!userId) {
      status = 401
      structuredLog({ requestId, route: url.pathname, method: request.method, status, latencyMs: Date.now() - startTime, userId: null, message: 'JWT failed' })
      return json({ error: 'Unauthorized', requestId }, status, cors)
    }

    // Rate limit
    try {
      const limiter = createRateLimiter(env)
      const { success } = await limiter.limit(userId)
      if (!success) {
        status = 429
        structuredLog({ requestId, route: url.pathname, method: request.method, status, latencyMs: Date.now() - startTime, userId, message: 'Rate limited' })
        return json({ error: 'Too many requests', requestId }, status, cors)
      }
    } catch { /* fail open */ }

    // Resolve engineer_id
    const sql = neon(env.DATABASE_URL)
    engineerId = await getEngineerId(sql, userId)
    if (!engineerId) {
      status = 400
      structuredLog({ requestId, route: url.pathname, method: request.method, status, latencyMs: Date.now() - startTime, userId, message: 'No engineer profile' })
      return json({ error: 'Engineer profile not found. Complete settings first.', requestId }, status, cors)
    }

    try {
      let response

      switch (route.action) {
        case 'upload':
          if (request.method === 'POST') {
            response = await handleUpload(engineerId, request, env, cors, requestId)
          } else {
            return json({ error: 'Method not allowed', requestId }, 405, cors)
          }
          break

        case 'file':
          if (request.method === 'GET') {
            response = await handleDownload(engineerId, route.key, env, cors, requestId)
          } else if (request.method === 'DELETE') {
            response = await handleDelete(engineerId, route.key, env, cors, requestId)
          } else {
            return json({ error: 'Method not allowed', requestId }, 405, cors)
          }
          break

        default:
          return json({ error: 'Not found', requestId }, 404, cors)
      }

      status = response.status
      structuredLog({
        requestId, route: url.pathname, method: request.method,
        status, latencyMs: Date.now() - startTime, userId, engineerId,
        message: `${request.method} ${route.action}`,
      })
      return response

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal server error'
      status = 500
      structuredLog({
        requestId, route: url.pathname, method: request.method,
        status, latencyMs: Date.now() - startTime, userId, engineerId,
        error: message,
      })
      return json({ error: 'Internal server error', requestId }, status, cors)
    }
  },
}
