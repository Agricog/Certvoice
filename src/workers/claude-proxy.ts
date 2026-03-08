/**
 * CertVoice — Claude API Proxy (Cloudflare Worker)
 *
 * This Cloudflare Worker:
 *   1. Receives voice transcripts from the frontend
 *   2. Sends them to Claude API (Sonnet) with a trade terminology system prompt
 *   3. Returns structured circuit/observation/supply data
 *
 * Security:
 *   - API key stored in Worker environment (never touches client)
 *   - Rate limited: 60 requests/hour per user
 *   - CORS restricted to certvoice.co.uk
 *   - No transcript persistence (processed in memory only)
 *
 * Deployment:
 *   - Deploy via Cloudflare Dashboard or Wrangler CLI
 *   - NOT part of the Railway frontend deployment
 *   - Requires ANTHROPIC_API_KEY environment variable
 *
 * Note: This file is NOT bundled with the React app.
 * It's deployed separately as a Cloudflare Worker.
 */

// ============================================================
// TYPES
// ============================================================

interface Env {
  ANTHROPIC_API_KEY: string
  ALLOWED_ORIGIN: string
  RATE_LIMITER: RateLimit
}

interface RateLimit {
  limit: (options: { key: string }) => Promise<{ success: boolean }>
}

interface ExtractionRequest {
  transcript: string
  locationContext?: string
  dbContext?: string
  existingCircuits?: string[]
  earthingType?: string | null
  type?: string
}

interface ClaudeMessage {
  role: 'user' | 'assistant'
  content: string
}

interface ClaudeResponse {
  content: Array<{ type: string; text: string }>
  usage: { input_tokens: number; output_tokens: number }
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
  "r1r2": "number or null — R1+R2 continuity reading",
  "irTestVoltage": "number in volts or null (usually 500)",
  "irLiveLive": "string or number or null — L-N insulation MΩ. MUST return '>200' as the string '>200', NOT null",
  "irLiveEarth": "string or number or null — L-E insulation MΩ. MUST return '>200' as the string '>200', NOT null",
  "zs": "number in ohms or null",
  "polarity": "TICK|CROSS or null — TICK if 'correct' or 'satisfactory'",
  "rcdDisconnectionTime": "number in ms or null",
  "rcdTestButton": "TICK|NA or null",
  "remarks": "string — any additional notes",
  "circuitType": "ring|radial or null — infer from r1/rn/r2 presence (ring) or absence (radial)",
  "status": "SATISFACTORY|UNSATISFACTORY — based on overall assessment"
}

## CRITICAL: FIELD MAPPING RULES FOR CIRCUIT DATA

Electricians speak readings in a natural order. You MUST map each value to the CORRECT field based on the LABEL the electrician says, not the order they appear.

**MATCHING RULES — always match the spoken label to the field:**
- "Zs" followed by a number → zs field (earth fault loop impedance, typically 0.1–5.0 Ω)
- "R1+R2" or "R1 plus R2" followed by a number → r1r2 field (continuity, typically 0.01–2.0 Ω)
- "r1" followed by a number → r1 field (ring line end-to-end, typically 0.05–1.0 Ω)
- "rn" followed by a number → rn field (ring neutral end-to-end, typically 0.05–1.0 Ω)
- "r2" followed by a number → r2 field (ring CPC end-to-end, typically 0.05–1.5 Ω)
- "R2" (uppercase, standalone) → r2 field
- "insulation" or "IR" or "L to N" or "live to neutral" → irLiveLive
- "L to E" or "live to earth" → irLiveEarth
- "greater than 200" or ">200" or "more than 200" → the string ">200" (NOT null, NOT a number)
- "RCD trips at" followed by a number → rcdDisconnectionTime in ms
- "test button works/ok" → rcdTestButton: "TICK"
- "polarity correct" → polarity: "TICK"

**EXAMPLE:**
Transcript: "Circuit 5, upstairs sockets, Zs 0.38 ohms, r1 0.21, rn 0.21, r2 0.35, R1+R2 0.11, insulation tested at 500 volts, L to N greater than 200 meg, L to E greater than 200 meg, polarity correct, RCD trips at 18 milliseconds, test button works, satisfactory"

Correct extraction:
- circuitNumber: "5"
- circuitDescription: "upstairs sockets"
- zs: 0.38         ← "Zs 0.38"
- r1: 0.21          ← "r1 0.21"
- rn: 0.21          ← "rn 0.21"
- r2: 0.35          ← "r2 0.35"
- r1r2: 0.11        ← "R1+R2 0.11"
- irTestVoltage: 500 ← "tested at 500 volts"
- irLiveLive: ">200" ← "L to N greater than 200 meg" (STRING, not null!)
- irLiveEarth: ">200" ← "L to E greater than 200 meg" (STRING, not null!)
- polarity: "TICK"   ← "polarity correct"
- rcdDisconnectionTime: 18 ← "RCD trips at 18 milliseconds"
- rcdTestButton: "TICK" ← "test button works"
- status: "SATISFACTORY"
- circuitType: "ring" ← r1/rn/r2 present means ring final

**WRONG (do NOT do this):**
- Putting 0.38 into r1r2 instead of zs
- Putting 0.11 into zs instead of r1r2
- Returning null for irLiveLive when ">200" was spoken

## INSULATION RESISTANCE — SPECIAL STRING VALUES

These are VALID string values for irLiveLive and irLiveEarth. Return them as STRINGS, not null:
- ">200" — meter reads above 200 MΩ (excellent, most common domestic reading)
- "LIM" — limitation, not tested (e.g. sensitive equipment)
- "N/V" — not verified

If the electrician says "greater than 200 meg" or "more than 200 megohms" or just ">200", return the string ">200".
NEVER return null when the electrician has given an insulation reading.

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
// CORS HEADERS
// ============================================================

function corsHeaders(origin: string, allowedOrigin: string): Record<string, string> {
  // Allow the configured origin and localhost for development
  const isAllowed =
    origin === allowedOrigin ||
    origin === 'http://localhost:5173' ||
    origin === 'http://localhost:3000'

  return {
    'Access-Control-Allow-Origin': isAllowed ? origin : allowedOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-CSRF-Token, Authorization',
    'Access-Control-Max-Age': '86400',
  }
}

// ============================================================
// WORKER ENTRY
// ============================================================

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const origin = request.headers.get('Origin') ?? ''
    const headers = corsHeaders(origin, env.ALLOWED_ORIGIN ?? 'https://certvoice.co.uk')

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers })
    }

    // Only handle POST /api/extract
    if (url.pathname !== '/api/extract' || request.method !== 'POST') {
      return new Response(
        JSON.stringify({ success: false, error: 'Not found' }),
        { status: 404, headers: { ...headers, 'Content-Type': 'application/json' } }
      )
    }

    // Rate limiting (if configured)
    if (env.RATE_LIMITER) {
      const clientIp = request.headers.get('CF-Connecting-IP') ?? 'unknown'
      try {
        const { success } = await env.RATE_LIMITER.limit({ key: clientIp })
        if (!success) {
          return new Response(
            JSON.stringify({
              success: false,
              error: 'Rate limited. Please wait before trying again.',
              code: 'RATE_LIMITED',
              retryAfter: 60,
            }),
            { status: 429, headers: { ...headers, 'Content-Type': 'application/json' } }
          )
        }
      } catch {
        // Rate limiter failure should not block the request
      }
    }

    try {
      // Parse request
      const body = (await request.json()) as ExtractionRequest

      if (!body.transcript || body.transcript.trim().length < 5) {
        return new Response(
          JSON.stringify({
            success: false,
            error: 'Transcript too short',
            code: 'INVALID_INPUT',
          }),
          { status: 400, headers: { ...headers, 'Content-Type': 'application/json' } }
        )
      }

      // Build user message with context
      const userMessage = buildUserMessage(body)

      // Call Claude API
      const claudeResponse = await callClaude(env.ANTHROPIC_API_KEY, userMessage)

      // Parse Claude's JSON response
      const extractedData = parseClaudeResponse(claudeResponse)

      return new Response(JSON.stringify(extractedData), {
        status: 200,
        headers: { ...headers, 'Content-Type': 'application/json' },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal error'
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Extraction failed: ' + message,
          code: 'API_ERROR',
        }),
        { status: 500, headers: { ...headers, 'Content-Type': 'application/json' } }
      )
    }
  },
}

// ============================================================
// HELPERS
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

  message += `\nRespond with ONLY valid JSON. Remember: ">200" for insulation readings must be returned as the STRING ">200", never as null.`

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
