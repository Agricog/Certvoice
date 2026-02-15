/**
 * CertVoice — Certificates CRUD API
 *
 * Cloudflare Worker handling certificate lifecycle.
 *
 * Endpoints:
 *   GET    /api/certificates          — List all certificates (with observation counts)
 *   GET    /api/certificates/:id      — Get full certificate with nested data
 *   POST   /api/certificates          — Create new certificate (auto report number)
 *   PUT    /api/certificates/:id      — Update certificate fields
 *   DELETE /api/certificates/:id      — Soft delete (sets deleted_at)
 *
 * Auth: Clerk JWT verified from Authorization header.
 * Data isolation: All queries filtered by engineer_id.
 * Rate limit: 60 requests/hour per engineer via Upstash.
 *
 * Deploy: wrangler deploy (separate from Railway frontend)
 *
 * @module workers/certificates-crud
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
}

interface ClerkJWTPayload {
  sub: string
  exp: number
}

// ============================================================
// CORS
// ============================================================

function corsHeaders(origin: string, allowed: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin === allowed ? origin : '',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
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
    limiter: Ratelimit.slidingWindow(60, '3600 s'),
    prefix: 'certvoice:certs',
  })
}

// ============================================================
// HELPERS — resolve engineer_id from clerk_user_id
// ============================================================

async function getEngineerId(
  sql: ReturnType<typeof neon>,
  clerkUserId: string
): Promise<string | null> {
  const rows = await sql`
    SELECT id FROM engineers WHERE clerk_user_id = ${clerkUserId} LIMIT 1
  `
  return rows.length > 0 ? (rows[0].id as string) : null
}

// ============================================================
// GET /api/certificates — List all certificates
// Returns flat list with observation counts for card display.
// ============================================================

async function handleList(
  engineerId: string,
  env: Env,
  cors: Record<string, string>,
  url: URL
): Promise<Response> {
  const sql = neon(env.DATABASE_URL)

  // Optional status filter from query param
  const statusParam = url.searchParams.get('status')
  const limitParam = parseInt(url.searchParams.get('limit') ?? '50', 10)
  const limit = Math.min(Math.max(limitParam, 1), 200)

  let rows: Record<string, unknown>[]

  if (statusParam) {
    rows = await sql`
      SELECT
        c.id,
        c.report_number,
        c.status,
        c.certificate_type,
        c.client_name,
        c.client_address,
        c.installation_address,
        c.purpose,
        c.inspection_dates,
        c.overall_assessment,
        c.pdf_r2_key,
        c.created_at,
        c.updated_at,
        COALESCE(obs.c1_count, 0) AS c1_count,
        COALESCE(obs.c2_count, 0) AS c2_count,
        COALESCE(obs.c3_count, 0) AS c3_count,
        COALESCE(obs.fi_count, 0) AS fi_count,
        COALESCE(circ.circuit_count, 0) AS circuit_count
      FROM certificates c
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*) FILTER (WHERE classification_code = 'C1') AS c1_count,
          COUNT(*) FILTER (WHERE classification_code = 'C2') AS c2_count,
          COUNT(*) FILTER (WHERE classification_code = 'C3') AS c3_count,
          COUNT(*) FILTER (WHERE classification_code = 'FI') AS fi_count
        FROM observations o
        WHERE o.certificate_id = c.id
      ) obs ON TRUE
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS circuit_count
        FROM circuits ci
        WHERE ci.certificate_id = c.id
      ) circ ON TRUE
      WHERE c.engineer_id = ${engineerId}
        AND c.deleted_at IS NULL
        AND c.status = ${statusParam}
      ORDER BY c.updated_at DESC
      LIMIT ${limit}
    `
  } else {
    rows = await sql`
      SELECT
        c.id,
        c.report_number,
        c.status,
        c.certificate_type,
        c.client_name,
        c.client_address,
        c.installation_address,
        c.purpose,
        c.inspection_dates,
        c.overall_assessment,
        c.pdf_r2_key,
        c.created_at,
        c.updated_at,
        COALESCE(obs.c1_count, 0) AS c1_count,
        COALESCE(obs.c2_count, 0) AS c2_count,
        COALESCE(obs.c3_count, 0) AS c3_count,
        COALESCE(obs.fi_count, 0) AS fi_count,
        COALESCE(circ.circuit_count, 0) AS circuit_count
      FROM certificates c
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*) FILTER (WHERE classification_code = 'C1') AS c1_count,
          COUNT(*) FILTER (WHERE classification_code = 'C2') AS c2_count,
          COUNT(*) FILTER (WHERE classification_code = 'C3') AS c3_count,
          COUNT(*) FILTER (WHERE classification_code = 'FI') AS fi_count
        FROM observations o
        WHERE o.certificate_id = c.id
      ) obs ON TRUE
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS circuit_count
        FROM circuits ci
        WHERE ci.certificate_id = c.id
      ) circ ON TRUE
      WHERE c.engineer_id = ${engineerId}
        AND c.deleted_at IS NULL
      ORDER BY c.updated_at DESC
      LIMIT ${limit}
    `
  }

  const certificates = rows.map((row) => ({
    id: row.id,
    reportNumber: row.report_number,
    status: row.status,
    certificateType: row.certificate_type,
    clientDetails: {
      clientName: row.client_name ?? '',
      clientAddress: row.client_address ?? '',
    },
    installationDetails: {
      installationAddress: row.installation_address ?? '',
    },
    reportReason: {
      purpose: row.purpose ?? '',
      inspectionDates: (row.inspection_dates as string[]) ?? [],
    },
    overallAssessment: row.overall_assessment,
    circuits: Array(Number(row.circuit_count)).fill(null),
    observations: [
      ...Array(Number(row.c1_count)).fill({ classificationCode: 'C1' }),
      ...Array(Number(row.c2_count)).fill({ classificationCode: 'C2' }),
      ...Array(Number(row.c3_count)).fill({ classificationCode: 'C3' }),
      ...Array(Number(row.fi_count)).fill({ classificationCode: 'FI' }),
    ],
    hasPdf: !!row.pdf_r2_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }))

  return json(certificates, 200, cors)
}

// ============================================================
// GET /api/certificates/:id — Full certificate with nested data
// ============================================================

async function handleGet(
  engineerId: string,
  certId: string,
  env: Env,
  cors: Record<string, string>
): Promise<Response> {
  const sql = neon(env.DATABASE_URL)

  // Fetch certificate
  const certRows = await sql`
    SELECT * FROM certificates
    WHERE id = ${certId} AND engineer_id = ${engineerId} AND deleted_at IS NULL
    LIMIT 1
  `

  if (certRows.length === 0) {
    return json({ error: 'Certificate not found' }, 404, cors)
  }

  const cert = certRows[0]

  // Fetch related data in parallel
  const [boardRows, circuitRows, obsRows, inspRows] = await Promise.all([
    sql`SELECT * FROM distribution_boards WHERE certificate_id = ${certId} ORDER BY sort_order`,
    sql`SELECT * FROM circuits WHERE certificate_id = ${certId} ORDER BY sort_order`,
    sql`SELECT * FROM observations WHERE certificate_id = ${certId} ORDER BY sort_order`,
    sql`SELECT * FROM inspection_items WHERE certificate_id = ${certId} ORDER BY sort_order`,
  ])

  // Map to frontend shape
  const response = {
    id: cert.id,
    reportNumber: cert.report_number,
    status: cert.status,
    engineerId: cert.engineer_id,
    clientDetails: {
      clientName: cert.client_name ?? '',
      clientAddress: cert.client_address ?? '',
    },
    reportReason: {
      purpose: cert.purpose ?? '',
      inspectionDates: (cert.inspection_dates as string[]) ?? [],
    },
    installationDetails: {
      installationAddress: cert.installation_address ?? '',
      installationPostcode: cert.installation_postcode ?? '',
      premisesType: cert.description_of_premises ?? 'DOMESTIC',
      estimatedAgeOfWiring: cert.estimated_age ? parseInt(cert.estimated_age as string, 10) : null,
      evidenceOfAdditions: cert.evidence_of_alterations ?? false,
      additionsEstimatedAge: cert.alterations_age ? parseInt(cert.alterations_age as string, 10) : null,
    },
    extentAndLimitations: {
      extentCovered: cert.extent_of_inspection ?? '',
      agreedLimitations: cert.agreed_limitations ?? '',
      operationalLimitations: cert.operational_limitations ?? '',
    },
    summaryOfCondition: {
      overallAssessment: cert.overall_assessment ?? null,
    },
    recommendations: {
      nextInspectionDate: cert.next_inspection_date ?? '',
      recommendationsText: cert.recommendations_text ?? '',
    },
    supplyCharacteristics: {
      earthingType: cert.earthing_type ?? null,
      supplyType: cert.supply_type ?? 'AC',
      conductorConfig: cert.conductor_config ?? '1PH_2WIRE',
      supplyPolarityConfirmed: cert.supply_polarity_confirmed ?? false,
      otherSourcesPresent: cert.other_sources_present ?? false,
      nominalVoltage: cert.nominal_voltage ? Number(cert.nominal_voltage) : null,
      nominalFrequency: cert.nominal_frequency ? Number(cert.nominal_frequency) : 50,
      ipf: cert.ipf ? Number(cert.ipf) : null,
      ze: cert.ze ? Number(cert.ze) : null,
      supplyDeviceBsEn: cert.supply_device_bs_en ?? '',
      supplyDeviceType: cert.supply_device_type ?? '',
      supplyDeviceRating: cert.supply_device_rating ? Number(cert.supply_device_rating) : null,
    },
    installationParticulars: {
      distributorFacility: cert.distributor_facility ?? false,
      installationElectrode: cert.installation_electrode ?? false,
      electrodeType: cert.electrode_type ?? '',
      electrodeLocation: cert.electrode_location ?? '',
      electrodeResistance: cert.electrode_resistance ? Number(cert.electrode_resistance) : null,
      mainSwitchLocation: cert.main_switch_location ?? '',
      mainSwitchBsEn: cert.main_switch_bs_en ?? '',
      mainSwitchPoles: cert.main_switch_poles ? Number(cert.main_switch_poles) : null,
      mainSwitchCurrentRating: cert.main_switch_current_rating ? Number(cert.main_switch_current_rating) : null,
      mainSwitchDeviceRating: cert.main_switch_device_rating ? Number(cert.main_switch_device_rating) : null,
      mainSwitchVoltageRating: cert.main_switch_voltage_rating ? Number(cert.main_switch_voltage_rating) : null,
      earthingConductorMaterial: cert.earthing_conductor_material ?? 'COPPER',
      earthingConductorCsa: cert.earthing_conductor_csa ? Number(cert.earthing_conductor_csa) : null,
      earthingConductorVerified: cert.earthing_conductor_verified ?? false,
      bondingConductorMaterial: cert.bonding_conductor_material ?? 'COPPER',
      bondingConductorCsa: cert.bonding_conductor_csa ? Number(cert.bonding_conductor_csa) : null,
      bondingConductorVerified: cert.bonding_conductor_verified ?? false,
      bondingWater: cert.bonding_water ?? 'NA',
      bondingGas: cert.bonding_gas ?? 'NA',
      bondingOil: cert.bonding_oil ?? 'NA',
      bondingSteel: cert.bonding_steel ?? 'NA',
      bondingLightning: cert.bonding_lightning ?? 'NA',
      bondingOther: cert.bonding_other ?? 'NA',
    },
    observations: obsRows.map((o) => ({
      id: o.id,
      itemNumber: o.item_number,
      observationText: o.observation_text,
      classificationCode: o.classification_code,
      location: o.location ?? '',
      regulationReference: o.bs_reference ?? '',
      remedialAction: o.recommendation ?? '',
      photoKeys: (o.photo_r2_keys as string[]) ?? [],
      voiceTranscript: o.voice_transcript ?? null,
      captureMethod: o.capture_method ?? 'manual',
    })),
    distributionBoards: boardRows.map((b) => ({
      id: b.id,
      dbReference: b.db_reference,
      dbDesignation: b.db_designation ?? '',
      dbLocation: b.db_location ?? '',
      dbMake: b.db_make ?? '',
      dbType: b.db_type ?? '',
      zeAtBoard: b.ze_at_board ? Number(b.ze_at_board) : null,
      zdb: b.zdb ? Number(b.zdb) : null,
      phaseSequenceConfirmed: b.phase_sequence_confirmed ?? false,
      supplyPolarityConfirmed: b.supply_polarity_confirmed ?? false,
    })),
    circuits: circuitRows.map((c) => ({
      id: c.id,
      dbId: c.board_id,
      circuitNumber: String(c.circuit_number),
      circuitDescription: c.circuit_description ?? '',
      wiringType: c.wiring_type ?? null,
      referenceMethod: c.reference_method ?? null,
      numberOfPoints: c.number_of_points ? Number(c.number_of_points) : null,
      liveConductorCsa: c.live_csa ? Number(c.live_csa) : null,
      cpcCsa: c.cpc_csa ? Number(c.cpc_csa) : null,
      maxDisconnectTime: c.max_disconnect_time ? Number(c.max_disconnect_time) : null,
      ocpdType: c.ocpd_type ?? null,
      ocpdRating: c.ocpd_rating ? Number(c.ocpd_rating) : null,
      ocpdBsEn: c.ocpd_bs_en ?? '',
      maxPermittedZs: c.max_permitted_zs ? Number(c.max_permitted_zs) : null,
      rcdType: c.rcd_type ?? null,
      rcdRating: c.rcd_rating ? Number(c.rcd_rating) : null,
      r1: c.r1 ? Number(c.r1) : null,
      rn: c.rn ? Number(c.rn) : null,
      r2: c.r2 ? Number(c.r2) : null,
      r1r2: c.r1_plus_r2 ? Number(c.r1_plus_r2) : null,
      irLiveLive: c.insulation_resistance_live_neutral ? Number(c.insulation_resistance_live_neutral) : null,
      irLiveEarth: c.insulation_resistance_live_earth ? Number(c.insulation_resistance_live_earth) : null,
      irTestVoltage: c.insulation_test_voltage ? Number(c.insulation_test_voltage) : null,
      zs: c.measured_zs ? Number(c.measured_zs) : null,
      polarity: c.polarity ?? 'NA',
      rcdDisconnectionTime: c.rcd_operating_time ? Number(c.rcd_operating_time) : null,
      rcdTestButton: c.rcd_test_button ?? 'NA',
      remarks: c.remarks ?? '',
      status: c.status ?? 'SATISFACTORY',
      zsValid: c.zs_valid ?? null,
      voiceTranscript: c.voice_transcript ?? null,
      captureMethod: c.capture_method ?? 'manual',
    })),
    inspectionSchedule: inspRows.map((i) => ({
      id: i.id,
      itemRef: i.item_number,
      section: i.section,
      description: i.description,
      outcome: i.outcome ?? null,
      notes: i.notes ?? '',
    })),
    pdfKey: cert.pdf_r2_key ?? null,
    createdAt: cert.created_at,
    updatedAt: cert.updated_at,
  }

  return json(response, 200, cors)
}

// ============================================================
// POST /api/certificates — Create new certificate
// ============================================================

async function handleCreate(
  engineerId: string,
  request: Request,
  env: Env,
  cors: Record<string, string>
): Promise<Response> {
  const body = (await request.json()) as Record<string, unknown>
  const sql = neon(env.DATABASE_URL)

  // Generate report number
  const reportRows = await sql`SELECT next_report_number(${engineerId}) AS report_number`
  const reportNumber = reportRows[0].report_number as string

  // Create certificate with initial data
  const rows = await sql`
    INSERT INTO certificates (
      engineer_id,
      certificate_type,
      status,
      report_number,
      client_name,
      client_address,
      installation_address,
      installation_postcode,
      purpose,
      inspection_dates,
      description_of_premises,
      extent_of_inspection,
      agreed_limitations,
      operational_limitations
    ) VALUES (
      ${engineerId},
      ${(body.certificateType as string) ?? 'EICR'},
      'DRAFT',
      ${reportNumber},
      ${(body.clientName as string) ?? null},
      ${(body.clientAddress as string) ?? null},
      ${(body.installationAddress as string) ?? null},
      ${(body.installationPostcode as string) ?? null},
      ${(body.purpose as string) ?? null},
      ${(body.inspectionDates as string[]) ?? null},
      ${(body.premisesType as string) ?? 'DOMESTIC'},
      ${(body.extentOfInspection as string) ?? null},
      ${(body.agreedLimitations as string) ?? null},
      ${(body.operationalLimitations as string) ?? null}
    )
    RETURNING id, report_number, status, created_at
  `

  const cert = rows[0]

  return json(
    {
      id: cert.id,
      reportNumber: cert.report_number,
      status: cert.status,
      createdAt: cert.created_at,
    },
    201,
    cors
  )
}

// ============================================================
// PUT /api/certificates/:id — Update certificate
// ============================================================

async function handleUpdate(
  engineerId: string,
  certId: string,
  request: Request,
  env: Env,
  cors: Record<string, string>
): Promise<Response> {
  const body = (await request.json()) as Record<string, unknown>
  const sql = neon(env.DATABASE_URL)

  // Verify ownership
  const existing = await sql`
    SELECT id, status FROM certificates
    WHERE id = ${certId} AND engineer_id = ${engineerId} AND deleted_at IS NULL
    LIMIT 1
  `

  if (existing.length === 0) {
    return json({ error: 'Certificate not found' }, 404, cors)
  }

  // Validate status transition
  const currentStatus = existing[0].status as string
  const newStatus = body.status as string | undefined
  if (newStatus && !isValidStatusTransition(currentStatus, newStatus)) {
    return json(
      { error: `Cannot transition from ${currentStatus} to ${newStatus}` },
      400,
      cors
    )
  }

  // Build dynamic update — only set fields that were sent
  const updates: Record<string, unknown> = {}

  // Section A
  if (body.clientName !== undefined) updates.client_name = body.clientName
  if (body.clientAddress !== undefined) updates.client_address = body.clientAddress

  // Section B
  if (body.purpose !== undefined) updates.purpose = body.purpose
  if (body.inspectionDates !== undefined) updates.inspection_dates = body.inspectionDates

  // Section C
  if (body.installationAddress !== undefined) updates.installation_address = body.installationAddress
  if (body.installationPostcode !== undefined) updates.installation_postcode = body.installationPostcode
  if (body.premisesType !== undefined) updates.description_of_premises = body.premisesType
  if (body.estimatedAge !== undefined) updates.estimated_age = body.estimatedAge
  if (body.evidenceOfAlterations !== undefined) updates.evidence_of_alterations = body.evidenceOfAlterations

  // Section D
  if (body.extentOfInspection !== undefined) updates.extent_of_inspection = body.extentOfInspection
  if (body.agreedLimitations !== undefined) updates.agreed_limitations = body.agreedLimitations
  if (body.operationalLimitations !== undefined) updates.operational_limitations = body.operationalLimitations

  // Section F
  if (body.nextInspectionDate !== undefined) updates.next_inspection_date = body.nextInspectionDate
  if (body.recommendationsText !== undefined) updates.recommendations_text = body.recommendationsText

  // Section I — Supply
  if (body.earthingType !== undefined) updates.earthing_type = body.earthingType
  if (body.supplyType !== undefined) updates.supply_type = body.supplyType
  if (body.conductorConfig !== undefined) updates.conductor_config = body.conductorConfig
  if (body.nominalVoltage !== undefined) updates.nominal_voltage = body.nominalVoltage
  if (body.nominalFrequency !== undefined) updates.nominal_frequency = body.nominalFrequency
  if (body.ipf !== undefined) updates.ipf = body.ipf
  if (body.ze !== undefined) updates.ze = body.ze
  if (body.supplyDeviceBsEn !== undefined) updates.supply_device_bs_en = body.supplyDeviceBsEn
  if (body.supplyDeviceType !== undefined) updates.supply_device_type = body.supplyDeviceType
  if (body.supplyDeviceRating !== undefined) updates.supply_device_rating = body.supplyDeviceRating

  // Section J — Installation particulars
  if (body.mainSwitchLocation !== undefined) updates.main_switch_location = body.mainSwitchLocation
  if (body.mainSwitchBsEn !== undefined) updates.main_switch_bs_en = body.mainSwitchBsEn
  if (body.mainSwitchPoles !== undefined) updates.main_switch_poles = body.mainSwitchPoles
  if (body.mainSwitchCurrentRating !== undefined) updates.main_switch_current_rating = body.mainSwitchCurrentRating
  if (body.earthingConductorCsa !== undefined) updates.earthing_conductor_csa = body.earthingConductorCsa
  if (body.bondingConductorCsa !== undefined) updates.bonding_conductor_csa = body.bondingConductorCsa

  // Status
  if (newStatus) updates.status = newStatus

  // No fields to update
  if (Object.keys(updates).length === 0) {
    return json({ error: 'No fields to update' }, 400, cors)
  }

  // Build SET clause dynamically
  const setClauses = Object.entries(updates)
    .map(([key], i) => `${key} = $${i + 2}`)
    .join(', ')

  const values = [certId, ...Object.values(updates)]

  // Use raw query for dynamic SET
  const result = await sql(
    `UPDATE certificates SET ${setClauses} WHERE id = $1 AND engineer_id = '${engineerId}' AND deleted_at IS NULL RETURNING id, status, updated_at`,
    values
  )

  if (result.length === 0) {
    return json({ error: 'Update failed' }, 500, cors)
  }

  // Recalculate assessment if status changed to REVIEW or COMPLETE
  if (newStatus === 'REVIEW' || newStatus === 'COMPLETE') {
    await sql`SELECT recalculate_assessment(${certId})`
  }

  return json(
    {
      id: result[0].id,
      status: result[0].status,
      updatedAt: result[0].updated_at,
    },
    200,
    cors
  )
}

// ============================================================
// DELETE /api/certificates/:id — Soft delete
// ============================================================

async function handleDelete(
  engineerId: string,
  certId: string,
  env: Env,
  cors: Record<string, string>
): Promise<Response> {
  const sql = neon(env.DATABASE_URL)

  const result = await sql`
    UPDATE certificates
    SET deleted_at = NOW()
    WHERE id = ${certId} AND engineer_id = ${engineerId} AND deleted_at IS NULL
    RETURNING id
  `

  if (result.length === 0) {
    return json({ error: 'Certificate not found' }, 404, cors)
  }

  return json({ deleted: true, id: result[0].id }, 200, cors)
}

// ============================================================
// STATUS TRANSITION VALIDATION
// ============================================================

function isValidStatusTransition(current: string, next: string): boolean {
  const transitions: Record<string, string[]> = {
    DRAFT: ['IN_PROGRESS', 'CANCELLED'],
    IN_PROGRESS: ['REVIEW', 'DRAFT'],
    REVIEW: ['COMPLETE', 'IN_PROGRESS'],
    COMPLETE: ['ISSUED', 'REVIEW'],
    ISSUED: [],
  }

  return transitions[current]?.includes(next) ?? false
}

// ============================================================
// ROUTE PARSING
// ============================================================

function parsePath(pathname: string): { action: 'list' | 'get' | 'create' | 'update' | 'delete' | null; certId?: string } {
  // /api/certificates
  if (pathname === '/api/certificates') {
    return { action: 'list' }
  }

  // /api/certificates/:id
  const match = pathname.match(/^\/api\/certificates\/([a-f0-9-]{36})$/)
  if (match) {
    return { action: 'get', certId: match[1] }
  }

  return { action: null }
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

    // Parse route
    const route = parsePath(url.pathname)
    if (!route.action) {
      return json({ error: 'Not found' }, 404, cors)
    }

    // Authenticate
    const clerkUserId = await verifyClerkJWT(
      request.headers.get('Authorization'),
      env.CLERK_JWKS_URL
    )

    if (!clerkUserId) {
      return json({ error: 'Unauthorized' }, 401, cors)
    }

    // Rate limit
    try {
      const limiter = createRateLimiter(env)
      const { success } = await limiter.limit(clerkUserId)
      if (!success) {
        return json({ error: 'Too many requests' }, 429, cors)
      }
    } catch {
      // Rate limiter failure should not block requests
    }

    // Resolve engineer_id
    const sql = neon(env.DATABASE_URL)
    const engineerId = await getEngineerId(sql, clerkUserId)

    if (!engineerId) {
      return json({ error: 'Engineer profile not found. Complete settings first.' }, 400, cors)
    }

    try {
      // Route to handler
      if (route.action === 'list' && request.method === 'GET') {
        return await handleList(engineerId, env, cors, url)
      }

      if (route.action === 'get' && request.method === 'GET' && route.certId) {
        return await handleGet(engineerId, route.certId, env, cors)
      }

      if (route.action === 'list' && request.method === 'POST') {
        return await handleCreate(engineerId, request, env, cors)
      }

      if (route.action === 'get' && request.method === 'PUT' && route.certId) {
        return await handleUpdate(engineerId, route.certId, request, env, cors)
      }

      if (route.action === 'get' && request.method === 'DELETE' && route.certId) {
        return await handleDelete(engineerId, route.certId, env, cors)
      }

      return json({ error: 'Method not allowed' }, 405, cors)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal server error'
      return json({ error: message }, 500, cors)
    }
  },
}
