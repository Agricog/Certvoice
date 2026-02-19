/**
 * CertVoice — Certificates CRUD API v3
 *
 * v3 changes: Added type_data JSONB support for Minor Works certificates.
 * MW-specific data (description, installation, circuit, test results,
 * declaration, next inspection, scheme notification) stored in type_data.
 * EICR certificates unchanged — continue using individual columns.
 *
 * Extended with nested CRUD for circuits, observations, boards.
 * Plus /sync endpoint for offline-first bulk reconciliation.
 *
 * New endpoints:
 *   POST   /api/certificates/:id/circuits              — Add circuit
 *   PUT    /api/certificates/:id/circuits/:circuitId    — Update circuit
 *   DELETE /api/certificates/:id/circuits/:circuitId    — Delete circuit
 *   POST   /api/certificates/:id/observations           — Add observation
 *   PUT    /api/certificates/:id/observations/:obsId    — Update observation
 *   DELETE /api/certificates/:id/observations/:obsId    — Delete observation
 *   POST   /api/certificates/:id/boards                 — Add distribution board
 *   PUT    /api/certificates/:id/boards/:boardId        — Update board
 *   PUT    /api/certificates/:id/sync                   — Bulk sync (offline-first)
 *
 * Existing endpoints unchanged:
 *   GET    /api/certificates          — List all certificates
 *   GET    /api/certificates/:id      — Get full certificate
 *   POST   /api/certificates          — Create certificate
 *   PUT    /api/certificates/:id      — Update certificate fields
 *   DELETE /api/certificates/:id      — Soft delete
 */

import { neon } from '@neondatabase/serverless'
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis/cloudflare'

// ============================================================
// TYPES
// ============================================================

const MAX_PAGE_SIZE = 100

// ============================================================
// GUARD HELPERS
// ============================================================

function generateRequestId() {
  const timestamp = Date.now().toString(36)
  const random = crypto.randomUUID().slice(0, 8)
  return `cv-cert-${timestamp}-${random}`
}

function structuredLog(log) {
  console.log(JSON.stringify({
    ...log,
    service: 'certvoice-certificates-crud',
    timestamp: new Date().toISOString(),
  }))
}

// ============================================================
// CORS
// ============================================================

function corsHeaders(origin, allowed) {
  const isAllowed =
    origin === allowed ||
    origin === 'http://localhost:5173' ||
    origin === 'http://localhost:3000'

  return {
    'Access-Control-Allow-Origin': isAllowed ? origin : allowed,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
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
    prefix: 'certvoice:certs',
  })
}

// ============================================================
// HELPERS
// ============================================================

async function getEngineerId(sql, clerkUserId) {
  const rows = await sql`
    SELECT id FROM engineers WHERE clerk_user_id = ${clerkUserId} LIMIT 1
  `
  return rows.length > 0 ? rows[0].id : null
}

async function verifyCertOwnership(sql, certId, engineerId) {
  const rows = await sql`
    SELECT id FROM certificates
    WHERE id = ${certId} AND engineer_id = ${engineerId} AND deleted_at IS NULL
    LIMIT 1
  `
  return rows.length > 0
}

async function ensureBoard(sql, certId, engineerId, dbReference, dbLocation) {
  // Find or create distribution board
  const existing = await sql`
    SELECT id FROM distribution_boards
    WHERE certificate_id = ${certId} AND db_reference = ${dbReference}
    LIMIT 1
  `
  if (existing.length > 0) return existing[0].id

  const created = await sql`
    INSERT INTO distribution_boards (certificate_id, engineer_id, db_reference, db_location, sort_order)
    VALUES (${certId}, ${engineerId}, ${dbReference}, ${dbLocation || ''}, 0)
    RETURNING id
  `
  return created[0].id
}

function isValidStatusTransition(current, next) {
  const transitions = {
    DRAFT: ['IN_PROGRESS', 'CANCELLED'],
    IN_PROGRESS: ['REVIEW', 'DRAFT'],
    REVIEW: ['COMPLETE', 'IN_PROGRESS'],
    COMPLETE: ['ISSUED', 'REVIEW'],
    ISSUED: [],
  }
  return transitions[current]?.includes(next) ?? false
}

// ============================================================
// GET /api/certificates — List
// ============================================================

async function handleList(engineerId, env, cors, url, requestId) {
  const sql = neon(env.DATABASE_URL)
  const statusParam = url.searchParams.get('status')
  const limitParam = parseInt(url.searchParams.get('limit') ?? '50', 10)
  const limit = Math.min(Math.max(limitParam, 1), MAX_PAGE_SIZE)

  const baseQuery = `
    SELECT
      c.id, c.report_number, c.status, c.certificate_type,
      c.client_name, c.client_address, c.installation_address,
      c.purpose, c.inspection_dates, c.overall_assessment,
      c.pdf_r2_key, c.type_data, c.created_at, c.updated_at,
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
      FROM observations o WHERE o.certificate_id = c.id
    ) obs ON TRUE
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS circuit_count FROM circuits ci WHERE ci.certificate_id = c.id
    ) circ ON TRUE
    WHERE c.engineer_id = $1 AND c.deleted_at IS NULL
  `

  let rows
  if (statusParam) {
    rows = await sql(baseQuery + ` AND c.status = $2 ORDER BY c.updated_at DESC LIMIT $3`, [engineerId, statusParam, limit])
  } else {
    rows = await sql(baseQuery + ` ORDER BY c.updated_at DESC LIMIT $2`, [engineerId, limit])
  }

  const certificates = rows.map((row) => ({
    id: row.id,
    reportNumber: row.report_number,
    status: row.status,
    certificateType: row.certificate_type,
    typeData: row.type_data ?? {},
    clientDetails: { clientName: row.client_name ?? '', clientAddress: row.client_address ?? '' },
    installationDetails: { installationAddress: row.installation_address ?? '' },
    reportReason: { purpose: row.purpose ?? '', inspectionDates: row.inspection_dates ?? [] },
    overallAssessment: row.overall_assessment,
    circuitCount: Number(row.circuit_count),
    observationCounts: {
      C1: Number(row.c1_count), C2: Number(row.c2_count),
      C3: Number(row.c3_count), FI: Number(row.fi_count),
    },
    hasPdf: !!row.pdf_r2_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }))

  return json({ data: certificates, limit, requestId }, 200, cors)
}

// ============================================================
// GET /api/certificates/:id — Full certificate
// ============================================================

async function handleGet(engineerId, certId, env, cors, requestId) {
  const sql = neon(env.DATABASE_URL)

  const certRows = await sql`
    SELECT * FROM certificates
    WHERE id = ${certId} AND engineer_id = ${engineerId} AND deleted_at IS NULL LIMIT 1
  `
  if (certRows.length === 0) {
    return json({ error: 'Certificate not found', requestId }, 404, cors)
  }

  const cert = certRows[0]
  const [boardRows, circuitRows, obsRows, inspRows] = await Promise.all([
    sql`SELECT * FROM distribution_boards WHERE certificate_id = ${certId} ORDER BY sort_order`,
    sql`SELECT * FROM circuits WHERE certificate_id = ${certId} ORDER BY sort_order`,
    sql`SELECT * FROM observations WHERE certificate_id = ${certId} ORDER BY sort_order`,
    sql`SELECT * FROM inspection_items WHERE certificate_id = ${certId} ORDER BY sort_order`,
  ])

  const response = {
    id: cert.id,
    reportNumber: cert.report_number,
    status: cert.status,
    certificateType: cert.certificate_type,
    typeData: cert.type_data ?? {},
    clientDetails: { clientName: cert.client_name ?? '', clientAddress: cert.client_address ?? '' },
    reportReason: { purpose: cert.purpose ?? '', inspectionDates: cert.inspection_dates ?? [] },
    installationDetails: {
      installationAddress: cert.installation_address ?? '',
      installationPostcode: cert.installation_postcode ?? '',
      premisesType: cert.description_of_premises ?? 'DOMESTIC',
      estimatedAgeOfWiring: cert.estimated_age ? parseInt(cert.estimated_age, 10) : null,
      evidenceOfAdditions: cert.evidence_of_alterations ?? false,
      additionsEstimatedAge: cert.alterations_age ? parseInt(cert.alterations_age, 10) : null,
    },
    extentAndLimitations: {
      extentCovered: cert.extent_of_inspection ?? '',
      agreedLimitations: cert.agreed_limitations ?? '',
      operationalLimitations: cert.operational_limitations ?? '',
    },
    summaryOfCondition: { overallAssessment: cert.overall_assessment ?? null },
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
    circuits: circuitRows.map((c) => mapCircuitRow(c)),
    observations: obsRows.map((o) => mapObservationRow(o)),
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
    requestId,
  }

  return json(response, 200, cors)
}

// ============================================================
// ROW MAPPERS
// ============================================================

function mapCircuitRow(c) {
  return {
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
  }
}

function mapObservationRow(o) {
  return {
    id: o.id,
    itemNumber: o.item_number,
    observationText: o.observation_text,
    classificationCode: o.classification_code,
    location: o.location ?? '',
    regulationReference: o.bs_reference ?? '',
    remedialAction: o.recommendation ?? '',
    photoKeys: o.photo_r2_keys ?? [],
    voiceTranscript: o.voice_transcript ?? null,
    captureMethod: o.capture_method ?? 'manual',
  }
}

// ============================================================
// POST /api/certificates — Create
// ============================================================

async function handleCreate(engineerId, request, env, cors, requestId) {
  const body = await request.json()
  const sql = neon(env.DATABASE_URL)

  const reportRows = await sql`SELECT next_report_number(${engineerId}) AS report_number`
  const reportNumber = reportRows[0].report_number

  const rows = await sql`
    INSERT INTO certificates (
      engineer_id, certificate_type, status, report_number,
      client_name, client_address, installation_address, installation_postcode,
      purpose, inspection_dates, description_of_premises,
      extent_of_inspection, agreed_limitations, operational_limitations,
      type_data
    ) VALUES (
      ${engineerId}, ${body.certificateType ?? 'EICR'}, 'DRAFT', ${reportNumber},
      ${body.clientName ?? null}, ${body.clientAddress ?? null},
      ${body.installationAddress ?? null}, ${body.installationPostcode ?? null},
      ${body.purpose ?? null}, ${body.inspectionDates ?? null},
      ${body.premisesType ?? 'DOMESTIC'},
      ${body.extentOfInspection ?? null}, ${body.agreedLimitations ?? null},
      ${body.operationalLimitations ?? null},
      ${body.typeData ? JSON.stringify(body.typeData) : '{}'}
    )
    RETURNING id, report_number, status, certificate_type, created_at
  `

  return json({
    id: rows[0].id,
    reportNumber: rows[0].report_number,
    status: rows[0].status,
    certificateType: rows[0].certificate_type,
    createdAt: rows[0].created_at,
    requestId,
  }, 201, cors)
}

// ============================================================
// PUT /api/certificates/:id — Update certificate fields
// ============================================================

async function handleUpdate(engineerId, certId, request, env, cors, requestId) {
  const body = await request.json()
  const sql = neon(env.DATABASE_URL)

  const existing = await sql`
    SELECT id, status FROM certificates
    WHERE id = ${certId} AND engineer_id = ${engineerId} AND deleted_at IS NULL LIMIT 1
  `
  if (existing.length === 0) return json({ error: 'Certificate not found', requestId }, 404, cors)

  const currentStatus = existing[0].status
  const newStatus = body.status
  if (newStatus && !isValidStatusTransition(currentStatus, newStatus)) {
    return json({ error: `Cannot transition from ${currentStatus} to ${newStatus}`, requestId }, 400, cors)
  }

  const updates = {}
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
  // Section J
  if (body.mainSwitchLocation !== undefined) updates.main_switch_location = body.mainSwitchLocation
  if (body.mainSwitchBsEn !== undefined) updates.main_switch_bs_en = body.mainSwitchBsEn
  if (body.mainSwitchPoles !== undefined) updates.main_switch_poles = body.mainSwitchPoles
  if (body.mainSwitchCurrentRating !== undefined) updates.main_switch_current_rating = body.mainSwitchCurrentRating
  if (body.earthingConductorCsa !== undefined) updates.earthing_conductor_csa = body.earthingConductorCsa
  if (body.bondingConductorCsa !== undefined) updates.bonding_conductor_csa = body.bondingConductorCsa
  // Status
  if (newStatus) updates.status = newStatus

  // type_data (MW / EIC specific) — deep-merge: read existing, overlay new keys
  if (body.typeData !== undefined) {
    const existingRow = await sql`
      SELECT type_data FROM certificates WHERE id = ${certId} LIMIT 1
    `
    const existingData = existingRow[0]?.type_data ?? {}
    const merged = { ...existingData, ...body.typeData }
    updates.type_data = JSON.stringify(merged)
  }

  if (Object.keys(updates).length === 0) {
    return json({ error: 'No fields to update', requestId }, 400, cors)
  }

  const setClauses = Object.entries(updates).map(([key], i) => `${key} = $${i + 3}`).join(', ')
  const values = [certId, engineerId, ...Object.values(updates)]

  const result = await sql(
    `UPDATE certificates SET ${setClauses}, updated_at = NOW() WHERE id = $1 AND engineer_id = $2 AND deleted_at IS NULL RETURNING id, status, updated_at`,
    values
  )

  if (result.length === 0) return json({ error: 'Update failed', requestId }, 500, cors)

  if (newStatus === 'REVIEW' || newStatus === 'COMPLETE') {
    await sql`SELECT recalculate_assessment(${certId})`
  }

  return json({ id: result[0].id, status: result[0].status, updatedAt: result[0].updated_at, requestId }, 200, cors)
}

// ============================================================
// DELETE /api/certificates/:id — Soft delete
// ============================================================

async function handleDelete(engineerId, certId, env, cors, requestId) {
  const sql = neon(env.DATABASE_URL)
  const result = await sql`
    UPDATE certificates SET deleted_at = NOW()
    WHERE id = ${certId} AND engineer_id = ${engineerId} AND deleted_at IS NULL
    RETURNING id
  `
  if (result.length === 0) return json({ error: 'Certificate not found', requestId }, 404, cors)
  return json({ deleted: true, id: result[0].id, requestId }, 200, cors)
}

// ============================================================
// POST /api/certificates/:id/circuits — Add circuit
// ============================================================

async function handleAddCircuit(engineerId, certId, request, env, cors, requestId) {
  const body = await request.json()
  const sql = neon(env.DATABASE_URL)

  // Ensure board exists (auto-create if needed)
  const dbRef = body.dbId ?? body.dbReference ?? 'DB1'
  const boardId = await ensureBoard(sql, certId, engineerId, dbRef, body.dbLocation ?? '')

  // Count existing circuits to set sort_order
  const countRows = await sql`SELECT COUNT(*) AS cnt FROM circuits WHERE certificate_id = ${certId}`
  const sortOrder = Number(countRows[0].cnt)

  const rows = await sql`
    INSERT INTO circuits (
      certificate_id, board_id, engineer_id,
      circuit_number, circuit_description, wiring_type, reference_method,
      number_of_points, live_csa, cpc_csa, max_disconnect_time,
      ocpd_type, ocpd_rating, ocpd_bs_en, max_permitted_zs,
      rcd_type, rcd_rating,
      r1, rn, r2, r1_plus_r2,
      insulation_resistance_live_neutral, insulation_resistance_live_earth,
      insulation_test_voltage,
      measured_zs, polarity,
      rcd_operating_time, rcd_test_button,
      remarks, status,
      voice_transcript, capture_method,
      sort_order
    ) VALUES (
      ${certId}, ${boardId}, ${engineerId},
      ${body.circuitNumber ? parseInt(body.circuitNumber, 10) : sortOrder + 1},
      ${body.circuitDescription ?? ''},
      ${body.wiringType ?? null}, ${body.referenceMethod ?? null},
      ${body.numberOfPoints ?? null}, ${body.liveConductorCsa ?? null},
      ${body.cpcCsa ?? null}, ${body.maxDisconnectTime ?? null},
      ${body.ocpdType ?? null}, ${body.ocpdRating ?? null},
      ${body.ocpdBsEn ?? ''}, ${body.maxPermittedZs ?? null},
      ${body.rcdType ?? null}, ${body.rcdRating ?? null},
      ${body.r1 ?? null}, ${body.rn ?? null}, ${body.r2 ?? null},
      ${body.r1r2 ?? null},
      ${body.irLiveLive ?? null}, ${body.irLiveEarth ?? null},
      ${body.irTestVoltage ?? null},
      ${body.zs ?? null}, ${body.polarity ?? 'NA'},
      ${body.rcdDisconnectionTime ?? null}, ${body.rcdTestButton ?? 'NA'},
      ${body.remarks ?? ''}, ${body.status ?? 'SATISFACTORY'},
      ${body.voiceTranscript ?? null}, ${body.captureMethod ?? 'voice'},
      ${sortOrder}
    )
    RETURNING *
  `

  // Update certificate timestamp
  await sql`UPDATE certificates SET updated_at = NOW() WHERE id = ${certId}`

  return json({ circuit: mapCircuitRow(rows[0]), requestId }, 201, cors)
}

// ============================================================
// PUT /api/certificates/:id/circuits/:circuitId — Update circuit
// ============================================================

async function handleUpdateCircuit(engineerId, certId, circuitId, request, env, cors, requestId) {
  const body = await request.json()
  const sql = neon(env.DATABASE_URL)

  // Verify ownership
  const existing = await sql`
    SELECT id FROM circuits
    WHERE id = ${circuitId} AND certificate_id = ${certId} AND engineer_id = ${engineerId}
    LIMIT 1
  `
  if (existing.length === 0) return json({ error: 'Circuit not found', requestId }, 404, cors)

  const updates = {}
  if (body.circuitNumber !== undefined) updates.circuit_number = parseInt(body.circuitNumber, 10)
  if (body.circuitDescription !== undefined) updates.circuit_description = body.circuitDescription
  if (body.wiringType !== undefined) updates.wiring_type = body.wiringType
  if (body.referenceMethod !== undefined) updates.reference_method = body.referenceMethod
  if (body.numberOfPoints !== undefined) updates.number_of_points = body.numberOfPoints
  if (body.liveConductorCsa !== undefined) updates.live_csa = body.liveConductorCsa
  if (body.cpcCsa !== undefined) updates.cpc_csa = body.cpcCsa
  if (body.ocpdType !== undefined) updates.ocpd_type = body.ocpdType
  if (body.ocpdRating !== undefined) updates.ocpd_rating = body.ocpdRating
  if (body.maxPermittedZs !== undefined) updates.max_permitted_zs = body.maxPermittedZs
  if (body.rcdType !== undefined) updates.rcd_type = body.rcdType
  if (body.rcdRating !== undefined) updates.rcd_rating = body.rcdRating
  if (body.r1 !== undefined) updates.r1 = body.r1
  if (body.rn !== undefined) updates.rn = body.rn
  if (body.r2 !== undefined) updates.r2 = body.r2
  if (body.r1r2 !== undefined) updates.r1_plus_r2 = body.r1r2
  if (body.irLiveLive !== undefined) updates.insulation_resistance_live_neutral = body.irLiveLive
  if (body.irLiveEarth !== undefined) updates.insulation_resistance_live_earth = body.irLiveEarth
  if (body.irTestVoltage !== undefined) updates.insulation_test_voltage = body.irTestVoltage
  if (body.zs !== undefined) updates.measured_zs = body.zs
  if (body.polarity !== undefined) updates.polarity = body.polarity
  if (body.rcdDisconnectionTime !== undefined) updates.rcd_operating_time = body.rcdDisconnectionTime
  if (body.rcdTestButton !== undefined) updates.rcd_test_button = body.rcdTestButton
  if (body.remarks !== undefined) updates.remarks = body.remarks
  if (body.status !== undefined) updates.status = body.status

  if (Object.keys(updates).length === 0) {
    return json({ error: 'No fields to update', requestId }, 400, cors)
  }

  const setClauses = Object.entries(updates).map(([key], i) => `${key} = $${i + 4}`).join(', ')
  const values = [circuitId, certId, engineerId, ...Object.values(updates)]

  const result = await sql(
    `UPDATE circuits SET ${setClauses}, updated_at = NOW() WHERE id = $1 AND certificate_id = $2 AND engineer_id = $3 RETURNING *`,
    values
  )

  if (result.length === 0) return json({ error: 'Update failed', requestId }, 500, cors)

  await sql`UPDATE certificates SET updated_at = NOW() WHERE id = ${certId}`

  return json({ circuit: mapCircuitRow(result[0]), requestId }, 200, cors)
}

// ============================================================
// DELETE /api/certificates/:id/circuits/:circuitId
// ============================================================

async function handleDeleteCircuit(engineerId, certId, circuitId, env, cors, requestId) {
  const sql = neon(env.DATABASE_URL)
  const result = await sql`
    DELETE FROM circuits
    WHERE id = ${circuitId} AND certificate_id = ${certId} AND engineer_id = ${engineerId}
    RETURNING id
  `
  if (result.length === 0) return json({ error: 'Circuit not found', requestId }, 404, cors)
  await sql`UPDATE certificates SET updated_at = NOW() WHERE id = ${certId}`
  return json({ deleted: true, id: result[0].id, requestId }, 200, cors)
}

// ============================================================
// POST /api/certificates/:id/observations — Add observation
// ============================================================

async function handleAddObservation(engineerId, certId, request, env, cors, requestId) {
  const body = await request.json()
  const sql = neon(env.DATABASE_URL)

  const countRows = await sql`SELECT COUNT(*) AS cnt FROM observations WHERE certificate_id = ${certId}`
  const sortOrder = Number(countRows[0].cnt)
  const itemNumber = body.itemNumber ?? sortOrder + 1

  const rows = await sql`
    INSERT INTO observations (
      certificate_id, engineer_id,
      item_number, observation_text, classification_code,
      location, bs_reference, recommendation,
      photo_r2_keys, voice_transcript, capture_method,
      sort_order
    ) VALUES (
      ${certId}, ${engineerId},
      ${itemNumber}, ${body.observationText ?? ''},
      ${body.classificationCode ?? 'C3'},
      ${body.location ?? ''}, ${body.regulationReference ?? ''},
      ${body.remedialAction ?? ''},
      ${body.photoKeys ?? null}, ${body.voiceTranscript ?? null},
      ${body.captureMethod ?? 'voice'},
      ${sortOrder}
    )
    RETURNING *
  `

  await sql`UPDATE certificates SET updated_at = NOW() WHERE id = ${certId}`
  await sql`SELECT recalculate_assessment(${certId})`

  return json({ observation: mapObservationRow(rows[0]), requestId }, 201, cors)
}

// ============================================================
// PUT /api/certificates/:id/observations/:obsId
// ============================================================

async function handleUpdateObservation(engineerId, certId, obsId, request, env, cors, requestId) {
  const body = await request.json()
  const sql = neon(env.DATABASE_URL)

  const existing = await sql`
    SELECT id FROM observations
    WHERE id = ${obsId} AND certificate_id = ${certId} AND engineer_id = ${engineerId}
    LIMIT 1
  `
  if (existing.length === 0) return json({ error: 'Observation not found', requestId }, 404, cors)

  const updates = {}
  if (body.observationText !== undefined) updates.observation_text = body.observationText
  if (body.classificationCode !== undefined) updates.classification_code = body.classificationCode
  if (body.location !== undefined) updates.location = body.location
  if (body.regulationReference !== undefined) updates.bs_reference = body.regulationReference
  if (body.remedialAction !== undefined) updates.recommendation = body.remedialAction
  if (body.photoKeys !== undefined) updates.photo_r2_keys = body.photoKeys

  if (Object.keys(updates).length === 0) {
    return json({ error: 'No fields to update', requestId }, 400, cors)
  }

  const setClauses = Object.entries(updates).map(([key], i) => `${key} = $${i + 4}`).join(', ')
  const values = [obsId, certId, engineerId, ...Object.values(updates)]

  const result = await sql(
    `UPDATE observations SET ${setClauses}, updated_at = NOW() WHERE id = $1 AND certificate_id = $2 AND engineer_id = $3 RETURNING *`,
    values
  )

  if (result.length === 0) return json({ error: 'Update failed', requestId }, 500, cors)

  await sql`UPDATE certificates SET updated_at = NOW() WHERE id = ${certId}`
  await sql`SELECT recalculate_assessment(${certId})`

  return json({ observation: mapObservationRow(result[0]), requestId }, 200, cors)
}

// ============================================================
// DELETE /api/certificates/:id/observations/:obsId
// ============================================================

async function handleDeleteObservation(engineerId, certId, obsId, env, cors, requestId) {
  const sql = neon(env.DATABASE_URL)
  const result = await sql`
    DELETE FROM observations
    WHERE id = ${obsId} AND certificate_id = ${certId} AND engineer_id = ${engineerId}
    RETURNING id
  `
  if (result.length === 0) return json({ error: 'Observation not found', requestId }, 404, cors)
  await sql`UPDATE certificates SET updated_at = NOW() WHERE id = ${certId}`
  await sql`SELECT recalculate_assessment(${certId})`
  return json({ deleted: true, id: result[0].id, requestId }, 200, cors)
}

// ============================================================
// POST /api/certificates/:id/boards — Add board
// ============================================================

async function handleAddBoard(engineerId, certId, request, env, cors, requestId) {
  const body = await request.json()
  const sql = neon(env.DATABASE_URL)

  const countRows = await sql`SELECT COUNT(*) AS cnt FROM distribution_boards WHERE certificate_id = ${certId}`
  const sortOrder = Number(countRows[0].cnt)

  const rows = await sql`
    INSERT INTO distribution_boards (
      certificate_id, engineer_id,
      db_reference, db_designation, db_location,
      db_make, db_type,
      ze_at_board, zdb,
      phase_sequence_confirmed, supply_polarity_confirmed,
      sort_order
    ) VALUES (
      ${certId}, ${engineerId},
      ${body.dbReference ?? `DB${sortOrder + 1}`},
      ${body.dbDesignation ?? ''}, ${body.dbLocation ?? ''},
      ${body.dbMake ?? ''}, ${body.dbType ?? ''},
      ${body.zeAtBoard ?? null}, ${body.zdb ?? null},
      ${body.phaseSequenceConfirmed ?? false},
      ${body.supplyPolarityConfirmed ?? false},
      ${sortOrder}
    )
    RETURNING *
  `

  await sql`UPDATE certificates SET updated_at = NOW() WHERE id = ${certId}`

  const b = rows[0]
  return json({
    board: {
      id: b.id, dbReference: b.db_reference, dbDesignation: b.db_designation ?? '',
      dbLocation: b.db_location ?? '', dbMake: b.db_make ?? '', dbType: b.db_type ?? '',
      zeAtBoard: b.ze_at_board ? Number(b.ze_at_board) : null,
      zdb: b.zdb ? Number(b.zdb) : null,
      phaseSequenceConfirmed: b.phase_sequence_confirmed ?? false,
      supplyPolarityConfirmed: b.supply_polarity_confirmed ?? false,
    },
    requestId,
  }, 201, cors)
}

// ============================================================
// PUT /api/certificates/:id/boards/:boardId
// ============================================================

async function handleUpdateBoard(engineerId, certId, boardId, request, env, cors, requestId) {
  const body = await request.json()
  const sql = neon(env.DATABASE_URL)

  const existing = await sql`
    SELECT id FROM distribution_boards
    WHERE id = ${boardId} AND certificate_id = ${certId} AND engineer_id = ${engineerId}
    LIMIT 1
  `
  if (existing.length === 0) return json({ error: 'Board not found', requestId }, 404, cors)

  const updates = {}
  if (body.dbReference !== undefined) updates.db_reference = body.dbReference
  if (body.dbDesignation !== undefined) updates.db_designation = body.dbDesignation
  if (body.dbLocation !== undefined) updates.db_location = body.dbLocation
  if (body.dbMake !== undefined) updates.db_make = body.dbMake
  if (body.dbType !== undefined) updates.db_type = body.dbType
  if (body.zeAtBoard !== undefined) updates.ze_at_board = body.zeAtBoard
  if (body.zdb !== undefined) updates.zdb = body.zdb

  if (Object.keys(updates).length === 0) {
    return json({ error: 'No fields to update', requestId }, 400, cors)
  }

  const setClauses = Object.entries(updates).map(([key], i) => `${key} = $${i + 4}`).join(', ')
  const values = [boardId, certId, engineerId, ...Object.values(updates)]

  const result = await sql(
    `UPDATE distribution_boards SET ${setClauses}, updated_at = NOW() WHERE id = $1 AND certificate_id = $2 AND engineer_id = $3 RETURNING *`,
    values
  )

  if (result.length === 0) return json({ error: 'Update failed', requestId }, 500, cors)

  const b = result[0]
  return json({
    board: {
      id: b.id, dbReference: b.db_reference, dbDesignation: b.db_designation ?? '',
      dbLocation: b.db_location ?? '', dbMake: b.db_make ?? '', dbType: b.db_type ?? '',
      zeAtBoard: b.ze_at_board ? Number(b.ze_at_board) : null,
      zdb: b.zdb ? Number(b.zdb) : null,
    },
    requestId,
  }, 200, cors)
}

// ============================================================
// PUT /api/certificates/:id/sync — Bulk sync (offline-first)
//
// Accepts full certificate state with nested arrays.
// Upserts boards, circuits, observations.
// Used by the offline sync service when connectivity returns.
// ============================================================

async function handleSync(engineerId, certId, request, env, cors, requestId) {
  const body = await request.json()
  const sql = neon(env.DATABASE_URL)

  // Verify ownership
  if (!(await verifyCertOwnership(sql, certId, engineerId))) {
    return json({ error: 'Certificate not found', requestId }, 404, cors)
  }

  const stats = { boardsUpserted: 0, circuitsUpserted: 0, observationsUpserted: 0 }

  // --- Sync boards ---
  const boards = body.distributionBoards ?? []
  const boardIdMap = {} // dbReference -> UUID

  for (const board of boards) {
    const dbRef = board.dbReference ?? 'DB1'
    const existing = await sql`
      SELECT id FROM distribution_boards
      WHERE certificate_id = ${certId} AND db_reference = ${dbRef} LIMIT 1
    `

    if (existing.length > 0) {
      boardIdMap[dbRef] = existing[0].id
      await sql`
        UPDATE distribution_boards SET
          db_designation = ${board.dbDesignation ?? ''},
          db_location = ${board.dbLocation ?? ''},
          db_make = ${board.dbMake ?? ''},
          db_type = ${board.dbType ?? ''},
          ze_at_board = ${board.zeAtBoard ?? null},
          zdb = ${board.zdb ?? null},
          updated_at = NOW()
        WHERE id = ${existing[0].id}
      `
    } else {
      const created = await sql`
        INSERT INTO distribution_boards (
          certificate_id, engineer_id, db_reference, db_designation,
          db_location, db_make, db_type, ze_at_board, zdb, sort_order
        ) VALUES (
          ${certId}, ${engineerId}, ${dbRef}, ${board.dbDesignation ?? ''},
          ${board.dbLocation ?? ''}, ${board.dbMake ?? ''}, ${board.dbType ?? ''},
          ${board.zeAtBoard ?? null}, ${board.zdb ?? null}, ${stats.boardsUpserted}
        ) RETURNING id
      `
      boardIdMap[dbRef] = created[0].id
    }
    stats.boardsUpserted++
  }

  // --- Sync circuits ---
  const circuits = body.circuits ?? []
  for (let i = 0; i < circuits.length; i++) {
    const c = circuits[i]
    const dbRef = c.dbId ?? c.dbReference ?? 'DB1'
    const boardId = boardIdMap[dbRef] ?? await ensureBoard(sql, certId, engineerId, dbRef, '')

    // Check if circuit exists by ID or by circuit_number + board
    let existingId = null
    if (c.id) {
      const byId = await sql`SELECT id FROM circuits WHERE id = ${c.id} AND certificate_id = ${certId} LIMIT 1`
      if (byId.length > 0) existingId = byId[0].id
    }

    if (existingId) {
      await sql`
        UPDATE circuits SET
          board_id = ${boardId},
          circuit_number = ${c.circuitNumber ? parseInt(c.circuitNumber, 10) : i + 1},
          circuit_description = ${c.circuitDescription ?? ''},
          wiring_type = ${c.wiringType ?? null},
          reference_method = ${c.referenceMethod ?? null},
          number_of_points = ${c.numberOfPoints ?? null},
          live_csa = ${c.liveConductorCsa ?? null},
          cpc_csa = ${c.cpcCsa ?? null},
          ocpd_type = ${c.ocpdType ?? null},
          ocpd_rating = ${c.ocpdRating ?? null},
          max_permitted_zs = ${c.maxPermittedZs ?? null},
          rcd_type = ${c.rcdType ?? null},
          rcd_rating = ${c.rcdRating ?? null},
          r1 = ${c.r1 ?? null}, rn = ${c.rn ?? null}, r2 = ${c.r2 ?? null},
          r1_plus_r2 = ${c.r1r2 ?? null},
          insulation_resistance_live_neutral = ${c.irLiveLive ?? null},
          insulation_resistance_live_earth = ${c.irLiveEarth ?? null},
          insulation_test_voltage = ${c.irTestVoltage ?? null},
          measured_zs = ${c.zs ?? null},
          polarity = ${c.polarity ?? 'NA'},
          rcd_operating_time = ${c.rcdDisconnectionTime ?? null},
          rcd_test_button = ${c.rcdTestButton ?? 'NA'},
          remarks = ${c.remarks ?? ''},
          status = ${c.status ?? 'SATISFACTORY'},
          voice_transcript = ${c.voiceTranscript ?? null},
          capture_method = ${c.captureMethod ?? 'voice'},
          sort_order = ${i},
          updated_at = NOW()
        WHERE id = ${existingId}
      `
    } else {
      await sql`
        INSERT INTO circuits (
          certificate_id, board_id, engineer_id,
          circuit_number, circuit_description, wiring_type, reference_method,
          number_of_points, live_csa, cpc_csa,
          ocpd_type, ocpd_rating, max_permitted_zs,
          rcd_type, rcd_rating,
          r1, rn, r2, r1_plus_r2,
          insulation_resistance_live_neutral, insulation_resistance_live_earth,
          insulation_test_voltage, measured_zs, polarity,
          rcd_operating_time, rcd_test_button,
          remarks, status, voice_transcript, capture_method, sort_order
        ) VALUES (
          ${certId}, ${boardId}, ${engineerId},
          ${c.circuitNumber ? parseInt(c.circuitNumber, 10) : i + 1},
          ${c.circuitDescription ?? ''}, ${c.wiringType ?? null}, ${c.referenceMethod ?? null},
          ${c.numberOfPoints ?? null}, ${c.liveConductorCsa ?? null}, ${c.cpcCsa ?? null},
          ${c.ocpdType ?? null}, ${c.ocpdRating ?? null}, ${c.maxPermittedZs ?? null},
          ${c.rcdType ?? null}, ${c.rcdRating ?? null},
          ${c.r1 ?? null}, ${c.rn ?? null}, ${c.r2 ?? null}, ${c.r1r2 ?? null},
          ${c.irLiveLive ?? null}, ${c.irLiveEarth ?? null},
          ${c.irTestVoltage ?? null}, ${c.zs ?? null}, ${c.polarity ?? 'NA'},
          ${c.rcdDisconnectionTime ?? null}, ${c.rcdTestButton ?? 'NA'},
          ${c.remarks ?? ''}, ${c.status ?? 'SATISFACTORY'},
          ${c.voiceTranscript ?? null}, ${c.captureMethod ?? 'voice'}, ${i}
        )
      `
    }
    stats.circuitsUpserted++
  }

  // --- Sync observations ---
  const observations = body.observations ?? []
  for (let i = 0; i < observations.length; i++) {
    const o = observations[i]

    let existingId = null
    if (o.id) {
      const byId = await sql`SELECT id FROM observations WHERE id = ${o.id} AND certificate_id = ${certId} LIMIT 1`
      if (byId.length > 0) existingId = byId[0].id
    }

    if (existingId) {
      await sql`
        UPDATE observations SET
          item_number = ${o.itemNumber ?? i + 1},
          observation_text = ${o.observationText ?? ''},
          classification_code = ${o.classificationCode ?? 'C3'},
          location = ${o.location ?? ''},
          bs_reference = ${o.regulationReference ?? ''},
          recommendation = ${o.remedialAction ?? ''},
          photo_r2_keys = ${o.photoKeys ?? null},
          voice_transcript = ${o.voiceTranscript ?? null},
          capture_method = ${o.captureMethod ?? 'voice'},
          sort_order = ${i},
          updated_at = NOW()
        WHERE id = ${existingId}
      `
    } else {
      await sql`
        INSERT INTO observations (
          certificate_id, engineer_id,
          item_number, observation_text, classification_code,
          location, bs_reference, recommendation,
          photo_r2_keys, voice_transcript, capture_method, sort_order
        ) VALUES (
          ${certId}, ${engineerId},
          ${o.itemNumber ?? i + 1}, ${o.observationText ?? ''},
          ${o.classificationCode ?? 'C3'},
          ${o.location ?? ''}, ${o.regulationReference ?? ''},
          ${o.remedialAction ?? ''},
          ${o.photoKeys ?? null}, ${o.voiceTranscript ?? null},
          ${o.captureMethod ?? 'voice'}, ${i}
        )
      `
    }
    stats.observationsUpserted++
  }

  // Update certificate timestamp and recalculate
  await sql`UPDATE certificates SET updated_at = NOW() WHERE id = ${certId}`
  await sql`SELECT recalculate_assessment(${certId})`

  return json({ synced: true, stats, requestId }, 200, cors)
}

// ============================================================
// ROUTE PARSING
// ============================================================

function parsePath(pathname) {
  // /api/certificates
  if (pathname === '/api/certificates') return { action: 'certificates' }

  // /api/certificates/:id/circuits/:circuitId
  let match = pathname.match(/^\/api\/certificates\/([a-f0-9-]{36})\/circuits\/([a-f0-9-]{36})$/)
  if (match) return { action: 'circuit-item', certId: match[1], itemId: match[2] }

  // /api/certificates/:id/circuits
  match = pathname.match(/^\/api\/certificates\/([a-f0-9-]{36})\/circuits$/)
  if (match) return { action: 'circuits', certId: match[1] }

  // /api/certificates/:id/observations/:obsId
  match = pathname.match(/^\/api\/certificates\/([a-f0-9-]{36})\/observations\/([a-f0-9-]{36})$/)
  if (match) return { action: 'observation-item', certId: match[1], itemId: match[2] }

  // /api/certificates/:id/observations
  match = pathname.match(/^\/api\/certificates\/([a-f0-9-]{36})\/observations$/)
  if (match) return { action: 'observations', certId: match[1] }

  // /api/certificates/:id/boards/:boardId
  match = pathname.match(/^\/api\/certificates\/([a-f0-9-]{36})\/boards\/([a-f0-9-]{36})$/)
  if (match) return { action: 'board-item', certId: match[1], itemId: match[2] }

  // /api/certificates/:id/boards
  match = pathname.match(/^\/api\/certificates\/([a-f0-9-]{36})\/boards$/)
  if (match) return { action: 'boards', certId: match[1] }

  // /api/certificates/:id/sync
  match = pathname.match(/^\/api\/certificates\/([a-f0-9-]{36})\/sync$/)
  if (match) return { action: 'sync', certId: match[1] }

  // /api/certificates/:id
  match = pathname.match(/^\/api\/certificates\/([a-f0-9-]{36})$/)
  if (match) return { action: 'certificate-item', certId: match[1] }

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
    const route = parsePath(url.pathname)
    if (!route.action) {
      status = 404
      structuredLog({ requestId, route: url.pathname, method: request.method, status, latencyMs: Date.now() - startTime, userId: null, message: 'Route not found' })
      return json({ error: 'Not found', requestId }, status, cors)
    }

    // READ_ONLY_MODE
    const isWriteOp = request.method === 'POST' || request.method === 'PUT' || request.method === 'DELETE'
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

    // Verify cert ownership for nested routes
    if (route.certId && route.action !== 'certificates') {
      const owns = await verifyCertOwnership(sql, route.certId, engineerId)
      if (!owns && route.action !== 'certificate-item') {
        // certificate-item handles its own 404
        status = 404
        structuredLog({ requestId, route: url.pathname, method: request.method, status, latencyMs: Date.now() - startTime, userId, engineerId, message: 'Cert not found' })
        return json({ error: 'Certificate not found', requestId }, status, cors)
      }
    }

    try {
      let response

      switch (route.action) {
        // --- Certificate CRUD ---
        case 'certificates':
          if (request.method === 'GET') response = await handleList(engineerId, env, cors, url, requestId)
          else if (request.method === 'POST') response = await handleCreate(engineerId, request, env, cors, requestId)
          else return json({ error: 'Method not allowed', requestId }, 405, cors)
          break

        case 'certificate-item':
          if (request.method === 'GET') response = await handleGet(engineerId, route.certId, env, cors, requestId)
          else if (request.method === 'PUT') response = await handleUpdate(engineerId, route.certId, request, env, cors, requestId)
          else if (request.method === 'DELETE') response = await handleDelete(engineerId, route.certId, env, cors, requestId)
          else return json({ error: 'Method not allowed', requestId }, 405, cors)
          break

        // --- Circuit CRUD ---
        case 'circuits':
          if (request.method === 'POST') response = await handleAddCircuit(engineerId, route.certId, request, env, cors, requestId)
          else return json({ error: 'Method not allowed', requestId }, 405, cors)
          break

        case 'circuit-item':
          if (request.method === 'PUT') response = await handleUpdateCircuit(engineerId, route.certId, route.itemId, request, env, cors, requestId)
          else if (request.method === 'DELETE') response = await handleDeleteCircuit(engineerId, route.certId, route.itemId, env, cors, requestId)
          else return json({ error: 'Method not allowed', requestId }, 405, cors)
          break

        // --- Observation CRUD ---
        case 'observations':
          if (request.method === 'POST') response = await handleAddObservation(engineerId, route.certId, request, env, cors, requestId)
          else return json({ error: 'Method not allowed', requestId }, 405, cors)
          break

        case 'observation-item':
          if (request.method === 'PUT') response = await handleUpdateObservation(engineerId, route.certId, route.itemId, request, env, cors, requestId)
          else if (request.method === 'DELETE') response = await handleDeleteObservation(engineerId, route.certId, route.itemId, env, cors, requestId)
          else return json({ error: 'Method not allowed', requestId }, 405, cors)
          break

        // --- Board CRUD ---
        case 'boards':
          if (request.method === 'POST') response = await handleAddBoard(engineerId, route.certId, request, env, cors, requestId)
          else return json({ error: 'Method not allowed', requestId }, 405, cors)
          break

        case 'board-item':
          if (request.method === 'PUT') response = await handleUpdateBoard(engineerId, route.certId, route.itemId, request, env, cors, requestId)
          else return json({ error: 'Method not allowed', requestId }, 405, cors)
          break

        // --- Sync ---
        case 'sync':
          if (request.method === 'PUT') response = await handleSync(engineerId, route.certId, request, env, cors, requestId)
          else return json({ error: 'Method not allowed', requestId }, 405, cors)
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
