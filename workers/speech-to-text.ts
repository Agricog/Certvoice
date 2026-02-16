/**
 * CertVoice — Speech-to-Text Worker
 *
 * Cloudflare Worker using Workers AI Whisper for audio transcription.
 * Cross-browser fallback for iOS Safari, Firefox, and any browser where
 * Web Speech API is unreliable or absent.
 *
 * Guard: requestId, structured logs, JWT auth, rate limiting, safety switches
 * per Build Standard v3.
 *
 * Deploy: Cloudflare Workers (bind Workers AI in wrangler.toml)
 * Endpoint: POST /api/speech/transcribe
 *
 * Input: Raw audio binary with Content-Type header (audio/webm, audio/mp4, audio/wav, audio/ogg)
 * Output: JSON { success, transcript, wordCount, confidence, durationSeconds, requestId }
 *
 * wrangler.toml binding:
 *   [ai]
 *   binding = "AI"
 *
 * @module workers/speech-to-text
 */

import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis/cloudflare'

// ============================================================
// TYPES
// ============================================================

interface Env {
  AI: {
    run(model: string, input: Record<string, unknown>): Promise<WhisperResponse>
  }
  ALLOWED_ORIGIN: string
  CLERK_JWKS_URL: string
  UPSTASH_REDIS_REST_URL: string
  UPSTASH_REDIS_REST_TOKEN: string
  READ_ONLY_MODE?: string
}

interface WhisperResponse {
  text: string
  word_count?: number
  words?: Array<{ word: string; start: number; end: number }>
  vtt?: string
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

interface TranscribeResponse {
  success: boolean
  transcript: string
  wordCount: number
  confidence: number
  durationSeconds: number
  requestId: string
}

// ============================================================
// CONSTANTS
// ============================================================

const WHISPER_MODEL = '@cf/openai/whisper'

/** Maximum audio upload size: 10 MB (~10 min compressed audio) */
const MAX_AUDIO_BYTES = 10 * 1024 * 1024

/** Accepted audio MIME types */
const ACCEPTED_AUDIO_TYPES = new Set([
  'audio/webm',
  'audio/mp4',
  'audio/m4a',
  'audio/x-m4a',
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
  'audio/wave',
  'audio/x-wav',
  'audio/flac',
])

/** Minimum audio size: 1 KB (anything smaller is likely empty/corrupt) */
const MIN_AUDIO_BYTES = 1024

// ============================================================
// GUARD HELPERS
// ============================================================

function generateRequestId(): string {
  const timestamp = Date.now().toString(36)
  const random = crypto.randomUUID().slice(0, 8)
  return `cv-stt-${timestamp}-${random}`
}

function structuredLog(log: StructuredLog): void {
  console.log(JSON.stringify({
    ...log,
    service: 'certvoice-speech-to-text',
    timestamp: new Date().toISOString(),
  }))
}

// ============================================================
// AUTH — Clerk JWT verification (matches existing worker pattern)
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
// RATE LIMITING (Upstash — 60 transcriptions per hour per user)
// ============================================================

function createRateLimiter(env: Env): Ratelimit {
  return new Ratelimit({
    redis: new Redis({
      url: env.UPSTASH_REDIS_REST_URL,
      token: env.UPSTASH_REDIS_REST_TOKEN,
    }),
    limiter: Ratelimit.slidingWindow(60, '3600 s'),
    prefix: 'certvoice:stt',
  })
}

// ============================================================
// CORS
// ============================================================

function corsHeaders(origin: string, allowedOrigin: string): Record<string, string> {
  const allowed = allowedOrigin.split(',').map((o) => o.trim())
  const isAllowed = allowed.includes(origin) || allowed.includes('*')
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
// AUDIO VALIDATION
// ============================================================

function isAcceptedAudioType(contentType: string | null): boolean {
  if (!contentType) return false
  // Strip parameters (e.g. "audio/webm;codecs=opus" → "audio/webm")
  const baseType = contentType.split(';')[0]?.trim().toLowerCase() ?? ''
  return ACCEPTED_AUDIO_TYPES.has(baseType)
}

// ============================================================
// WORKER ENTRY POINT
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

    // --- CORS preflight ---
    if (request.method === 'OPTIONS') {
      return corsResponse(origin, env.ALLOWED_ORIGIN)
    }

    // --- POST only ---
    if (request.method !== 'POST') {
      status = 405
      structuredLog({
        requestId, route: url.pathname, method: request.method,
        status, latencyMs: Date.now() - startTime, userId: null,
        message: 'Method not allowed',
      })
      return new Response(
        JSON.stringify({ success: false, error: 'Method not allowed', requestId }),
        { status, headers: { ...cors, 'Content-Type': 'application/json' } }
      )
    }

    // --- READ_ONLY_MODE safety switch ---
    if (env.READ_ONLY_MODE === 'true') {
      status = 503
      structuredLog({
        requestId, route: url.pathname, method: request.method,
        status, latencyMs: Date.now() - startTime, userId: null,
        message: 'Read-only mode active',
      })
      return new Response(
        JSON.stringify({ success: false, error: 'Service temporarily in read-only mode', code: 'READ_ONLY', requestId }),
        { status, headers: { ...cors, 'Content-Type': 'application/json' } }
      )
    }

    // --- Authenticate via Clerk JWT ---
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
        JSON.stringify({ success: false, error: 'Authentication required', requestId }),
        { status, headers: { ...cors, 'Content-Type': 'application/json' } }
      )
    }

    // --- Rate limit ---
    try {
      const limiter = createRateLimiter(env)
      const { success: allowed } = await limiter.limit(userId)
      if (!allowed) {
        status = 429
        structuredLog({
          requestId, route: url.pathname, method: request.method,
          status, latencyMs: Date.now() - startTime, userId,
          message: 'Rate limited',
        })
        return new Response(
          JSON.stringify({
            success: false,
            error: 'Rate limit exceeded. Max 60 transcriptions per hour.',
            code: 'RATE_LIMITED',
            requestId,
          }),
          { status, headers: { ...cors, 'Content-Type': 'application/json' } }
        )
      }
    } catch {
      // Rate limiter failure should not block the request
    }

    // --- Validate Content-Type ---
    const contentType = request.headers.get('Content-Type')
    if (!isAcceptedAudioType(contentType)) {
      status = 415
      structuredLog({
        requestId, route: url.pathname, method: request.method,
        status, latencyMs: Date.now() - startTime, userId,
        message: `Unsupported content type: ${contentType}`,
      })
      return new Response(
        JSON.stringify({
          success: false,
          error: `Unsupported audio format. Accepted: ${[...ACCEPTED_AUDIO_TYPES].join(', ')}`,
          code: 'UNSUPPORTED_FORMAT',
          requestId,
        }),
        { status, headers: { ...cors, 'Content-Type': 'application/json' } }
      )
    }

    // --- Read audio body ---
    let audioBuffer: ArrayBuffer
    try {
      audioBuffer = await request.arrayBuffer()
    } catch {
      status = 400
      structuredLog({
        requestId, route: url.pathname, method: request.method,
        status, latencyMs: Date.now() - startTime, userId,
        message: 'Failed to read audio body',
      })
      return new Response(
        JSON.stringify({ success: false, error: 'Could not read audio data', code: 'INVALID_INPUT', requestId }),
        { status, headers: { ...cors, 'Content-Type': 'application/json' } }
      )
    }

    // --- Validate audio size ---
    if (audioBuffer.byteLength < MIN_AUDIO_BYTES) {
      status = 400
      structuredLog({
        requestId, route: url.pathname, method: request.method,
        status, latencyMs: Date.now() - startTime, userId,
        message: `Audio too small: ${audioBuffer.byteLength} bytes`,
      })
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Audio recording too short. Please try again and speak for at least 2 seconds.',
          code: 'AUDIO_TOO_SHORT',
          requestId,
        }),
        { status, headers: { ...cors, 'Content-Type': 'application/json' } }
      )
    }

    if (audioBuffer.byteLength > MAX_AUDIO_BYTES) {
      status = 413
      structuredLog({
        requestId, route: url.pathname, method: request.method,
        status, latencyMs: Date.now() - startTime, userId,
        message: `Audio too large: ${audioBuffer.byteLength} bytes`,
      })
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Audio recording too large. Maximum 10 minutes per recording.',
          code: 'AUDIO_TOO_LARGE',
          requestId,
        }),
        { status, headers: { ...cors, 'Content-Type': 'application/json' } }
      )
    }

    // --- Transcribe via Cloudflare Workers AI (Whisper) ---
    try {
      const audioArray = [...new Uint8Array(audioBuffer)]

      const whisperStart = Date.now()
      const result: WhisperResponse = await env.AI.run(WHISPER_MODEL, {
        audio: audioArray,
        source_lang: 'en',
      })
      const whisperMs = Date.now() - whisperStart

      const transcript = (result.text ?? '').trim()

      if (!transcript) {
        status = 422
        structuredLog({
          requestId, route: url.pathname, method: request.method,
          status, latencyMs: Date.now() - startTime, userId,
          message: `Whisper returned empty transcript (${whisperMs}ms, ${audioBuffer.byteLength} bytes)`,
        })
        return new Response(
          JSON.stringify({
            success: false,
            error: 'No speech detected in audio. Please try again and speak clearly.',
            code: 'NO_SPEECH',
            requestId,
          }),
          { status, headers: { ...cors, 'Content-Type': 'application/json' } }
        )
      }

      // Calculate approximate duration from word timestamps if available
      let durationSeconds = 0
      if (result.words && result.words.length > 0) {
        const lastWord = result.words[result.words.length - 1]
        if (lastWord) {
          durationSeconds = Math.ceil(lastWord.end)
        }
      }

      const wordCount = result.word_count ?? transcript.split(/\s+/).length

      const response: TranscribeResponse = {
        success: true,
        transcript,
        wordCount,
        confidence: 1.0, // Whisper doesn't return per-result confidence; 1.0 as placeholder
        durationSeconds,
        requestId,
      }

      structuredLog({
        requestId, route: url.pathname, method: request.method,
        status: 200, latencyMs: Date.now() - startTime, userId,
        message: `Transcribed: ${wordCount} words, ${durationSeconds}s audio, ${whisperMs}ms Whisper, ${audioBuffer.byteLength} bytes`,
      })

      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Transcription failed'
      status = 500

      structuredLog({
        requestId, route: url.pathname, method: request.method,
        status, latencyMs: Date.now() - startTime, userId,
        error: message,
      })

      return new Response(
        JSON.stringify({
          success: false,
          error: 'Speech transcription failed. Please try again.',
          code: 'TRANSCRIPTION_ERROR',
          requestId,
        }),
        { status, headers: { ...cors, 'Content-Type': 'application/json' } }
      )
    }
  },
}
