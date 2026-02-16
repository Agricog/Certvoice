/**
 * CertVoice — EICR PDF Generation Worker
 *
 * Cloudflare Worker that generates BS 7671:2018+A2:2022 compliant
 * A4 EICR PDFs from EICRCertificate JSON data.
 *
 * Uses pdf-lib (V8 isolate compatible, no Node.js APIs).
 *
 * Guard: requestId, structured logs, JWT auth, safety switches per Build Standard v3.
 *
 * Deploy: Cloudflare Workers (NOT Railway)
 * Endpoint: POST /api/pdf/generate
 *
 * @module workers/pdf-generate
 */

import {
  PDFDocument,
  PDFPage,
  PDFFont,
  StandardFonts,
  rgb,
  PageSizes,
  type RGB,
} from 'pdf-lib'
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis/cloudflare'

// ============================================================
// TYPES — mirrors eicr.ts (inline to avoid import issues in Worker)
// ============================================================

type ClassificationCode = 'C1' | 'C2' | 'C3' | 'FI'
type InspectionOutcome = 'PASS' | 'C1' | 'C2' | 'C3' | 'FI' | 'NV' | 'LIM' | 'NA'
type OverallAssessment = 'SATISFACTORY' | 'UNSATISFACTORY'
type EarthingType = 'TN_C' | 'TN_S' | 'TN_C_S' | 'TT' | 'IT'
type SupplyType = 'AC' | 'DC'
type ConductorConfig = '1PH_2WIRE' | '2PH_3WIRE' | '3PH_3WIRE' | '3PH_4WIRE'
type PremisesType = 'DOMESTIC' | 'COMMERCIAL' | 'INDUSTRIAL' | 'OTHER'
type ReportPurpose = 'PERIODIC' | 'CHANGE_OF_OCCUPANCY' | 'MORTGAGE' | 'INSURANCE' | 'SAFETY_CONCERN' | 'OTHER'
type BondingStatus = 'SATISFACTORY' | 'NA' | 'UNSATISFACTORY'
type ConductorMaterial = 'COPPER' | 'ALUMINIUM'
type TickStatus = 'TICK' | 'CROSS' | 'NA'
type TestValue = number | '>200' | 'LIM' | 'N/V'
type CertificateStatus = 'DRAFT' | 'IN_PROGRESS' | 'REVIEW' | 'COMPLETE' | 'ISSUED'

interface ClientDetails {
  clientName: string
  clientAddress: string
}

interface ReportReason {
  purpose: ReportPurpose
  inspectionDates: string[]
}

interface InstallationDetails {
  installationAddress: string
  occupier: string
  premisesType: PremisesType
  otherDescription?: string
  estimatedAgeOfWiring: number | null
  evidenceOfAdditions: boolean
  additionsEstimatedAge?: number | null
  installationRecordsAvailable: boolean
  dateOfLastInspection: string | null
}

interface ExtentAndLimitations {
  extentCovered: string
  agreedLimitations: string
  agreedWith: string
  operationalLimitations: string
}

interface SummaryOfCondition {
  generalCondition: string
  overallAssessment: OverallAssessment
}

interface Recommendations {
  nextInspectionDate: string
  reasonForInterval: string
  remedialUrgency: string
}

interface Declaration {
  inspectorName: string
  inspectorSignatureKey: string | null
  companyName: string
  position: string
  companyAddress: string
  dateInspected: string
  qsName: string
  qsSignatureKey: string | null
  qsDate: string
  registrationNumber: string
}

interface SupplyCharacteristics {
  earthingType: EarthingType | null
  supplyType: SupplyType
  conductorConfig: ConductorConfig
  supplyPolarityConfirmed: boolean
  otherSourcesPresent: boolean
  otherSourcesDescription?: string
  nominalVoltage: number | null
  nominalFrequency: number
  ipf: number | null
  ze: number | null
  supplyDeviceBsEn: string
  supplyDeviceType: string
  supplyDeviceRating: number | null
}

interface InstallationParticulars {
  distributorFacility: boolean
  installationElectrode: boolean
  electrodeType?: string
  electrodeLocation?: string
  electrodeResistance?: number | null
  mainSwitchLocation: string
  mainSwitchBsEn: string
  mainSwitchPoles: number | null
  mainSwitchCurrentRating: number | null
  mainSwitchDeviceRating: number | null
  mainSwitchVoltageRating: number | null
  mainSwitchRcdType?: string | null
  mainSwitchRcdRating?: number | null
  mainSwitchRcdTimeDelay?: number | null
  mainSwitchRcdMeasuredTime?: number | null
  earthingConductorMaterial: ConductorMaterial
  earthingConductorCsa: number | null
  earthingConductorVerified: boolean
  bondingConductorMaterial: ConductorMaterial
  bondingConductorCsa: number | null
  bondingConductorVerified: boolean
  bondingWater: BondingStatus
  bondingGas: BondingStatus
  bondingOil: BondingStatus
  bondingSteel: BondingStatus
  bondingLightning: BondingStatus
  bondingOther: BondingStatus
  bondingOtherDescription?: string
}

interface Observation {
  id: string
  itemNumber: number
  observationText: string
  classificationCode: ClassificationCode
  dbReference: string
  circuitReference: string
  location: string
  regulationReference: string
  photoKeys: string[]
  remedialAction: string
}

interface DistributionBoardHeader {
  id: string
  dbReference: string
  dbLocation: string
  suppliedFrom: string
  distOcpdBsEn: string
  distOcpdType: string
  distOcpdRating: number | null
  numberOfPhases: 1 | 3
  spdType: string
  spdStatusConfirmed: boolean
  polarityConfirmed: boolean
  phaseSequenceConfirmed: boolean | null
  zsAtDb: number | null
  ipfAtDb: number | null
}

interface CircuitDetail {
  id: string
  dbId: string
  circuitNumber: string
  circuitDescription: string
  wiringType: string | null
  referenceMethod: string | null
  numberOfPoints: number | null
  liveConductorCsa: number | null
  cpcCsa: number | null
  maxDisconnectTime: number | null
  ocpdBsEn: string
  ocpdType: string | null
  ocpdRating: number | null
  maxPermittedZs: number | null
  breakingCapacity: number | null
  rcdBsEn: string
  rcdType: string | null
  rcdRating: number | null
  r1: TestValue | null
  rn: TestValue | null
  r2: TestValue | null
  r1r2: TestValue | null
  r1r2OrR2: TestValue | null
  r2Standalone: TestValue | null
  irTestVoltage: number | null
  irLiveLive: TestValue | null
  irLiveEarth: TestValue | null
  zs: number | null
  polarity: TickStatus
  rcdDisconnectionTime: number | null
  rcdTestButton: TickStatus
  afddTestButton: TickStatus
  remarks: string
  circuitType: string | null
  status: string
  validationWarnings: string[]
}

interface InspectionItem {
  id: string
  itemRef: string
  section: number
  sectionTitle: string
  description: string
  regulationRef: string
  outcome: InspectionOutcome | null
  notes: string
}

interface TestInstruments {
  multifunctionInstrument: string
  insulationResistance: string
  continuity: string
  earthElectrodeResistance: string
  earthFaultLoopImpedance: string
  rcdTester: string
}

interface EICRCertificate {
  id: string
  reportNumber: string
  status: CertificateStatus
  engineerId: string
  clientDetails: ClientDetails
  reportReason: ReportReason
  installationDetails: InstallationDetails
  extentAndLimitations: ExtentAndLimitations
  summaryOfCondition: SummaryOfCondition
  recommendations: Recommendations
  declaration: Declaration
  supplyCharacteristics: SupplyCharacteristics
  installationParticulars: InstallationParticulars
  observations: Observation[]
  distributionBoards: DistributionBoardHeader[]
  testInstruments: TestInstruments
  circuits: CircuitDetail[]
  inspectionSchedule: InspectionItem[]
  createdAt: string
  updatedAt: string
  pdfKey: string | null
  syncStatus: string
}

interface GenerateOptions {
  includePhotos: boolean
  companyLogo: string | null
  outputFormat: 'buffer' | 'r2'
}

interface Env {
  ALLOWED_ORIGIN: string
  CLERK_JWKS_URL: string
  UPSTASH_REDIS_REST_URL: string
  UPSTASH_REDIS_REST_TOKEN: string
  STORAGE_BUCKET: R2Bucket
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
  return `cv-pdf-${timestamp}-${random}`
}

function structuredLog(log: StructuredLog): void {
  console.log(JSON.stringify({
    ...log,
    service: 'certvoice-pdf-generate',
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
// RATE LIMITING (Upstash — consistent with claude-proxy)
// ============================================================

function createRateLimiter(env: Env): Ratelimit {
  return new Ratelimit({
    redis: new Redis({
      url: env.UPSTASH_REDIS_REST_URL,
      token: env.UPSTASH_REDIS_REST_TOKEN,
    }),
    limiter: Ratelimit.slidingWindow(20, '3600 s'),
    prefix: 'certvoice:pdf',
  })
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
// CONSTANTS
// ============================================================

const A4_WIDTH = PageSizes.A4[0]   // 595.28
const A4_HEIGHT = PageSizes.A4[1]  // 841.89

const MARGIN = {
  top: 60,
  bottom: 50,
  left: 40,
  right: 40,
} as const

const CONTENT_WIDTH = A4_WIDTH - MARGIN.left - MARGIN.right

const COLOURS = {
  black: rgb(0, 0, 0),
  darkGrey: rgb(0.25, 0.25, 0.25),
  midGrey: rgb(0.5, 0.5, 0.5),
  lightGrey: rgb(0.85, 0.85, 0.85),
  headerBg: rgb(0.12, 0.12, 0.18),
  headerText: rgb(1, 1, 1),
  accent: rgb(0.24, 0.55, 1),
  c1Red: rgb(0.85, 0.15, 0.15),
  c2Amber: rgb(0.9, 0.55, 0.05),
  c3Blue: rgb(0.2, 0.45, 0.85),
  fiPurple: rgb(0.55, 0.2, 0.75),
  green: rgb(0.15, 0.65, 0.15),
  white: rgb(1, 1, 1),
  rowAlt: rgb(0.95, 0.95, 0.97),
  satisfactory: rgb(0.1, 0.55, 0.1),
  unsatisfactory: rgb(0.8, 0.1, 0.1),
} as const

const FONT_SIZE = {
  title: 14,
  sectionHeader: 11,
  label: 8,
  value: 9,
  body: 8.5,
  small: 7,
  tiny: 6,
  footer: 7,
} as const

const COMPLIANCE_STATEMENT =
  'This form is based on the model shown in Appendix 6 of BS 7671:2018+A2:2022'

const VALIDITY_NOTICE =
  'This report is valid only when accompanied by the attached Schedule of Inspections and Schedule of Circuit Details and Test Results.'

const CODE_DEFINITIONS: Record<ClassificationCode, { label: string; definition: string }> = {
  C1: {
    label: 'Danger Present',
    definition: 'Risk of injury exists. Immediate remedial action required.',
  },
  C2: {
    label: 'Potentially Dangerous',
    definition: 'Risk of injury may arise. Urgent remedial action required.',
  },
  C3: {
    label: 'Improvement Recommended',
    definition: 'Improvement is recommended but does not indicate danger.',
  },
  FI: {
    label: 'Further Investigation',
    definition: 'Further investigation required without delay.',
  },
}

const GUIDANCE_TEXT = `GUIDANCE FOR RECIPIENTS

This Electrical Installation Condition Report has been prepared by a competent person for the purpose of reporting on the condition of the electrical installation at the date of inspection.

The report is intended to be for the benefit of the person ordering the report, and is not intended for the use of any other party unless specifically agreed.

Where the overall assessment of the installation is stated as UNSATISFACTORY, the person ordering the report should ensure that any observations coded C1 (Danger Present) or C2 (Potentially Dangerous) are rectified as a matter of urgency by a competent person.

Observations coded C3 (Improvement Recommended) indicate where improvements could be made to bring the installation closer to current standards. These are advisory and do not indicate danger.

Observations coded FI (Further Investigation) indicate that further investigation is required without delay to determine the nature and extent of the deficiency.

It is recommended that this report be retained in a safe place and be shown to any person inspecting or undertaking work on the electrical installation in the future. If the property is vacated, this report should be passed to the new occupier.`

// ============================================================
// HELPER: PDF Drawing Context
// ============================================================

interface DrawContext {
  doc: PDFDocument
  font: PDFFont
  fontBold: PDFFont
  pages: PDFPage[]
  currentPage: PDFPage
  y: number
  pageNumber: number
  totalPages: number
  reportNumber: string
}

function createPage(ctx: DrawContext, landscape: boolean = false): PDFPage {
  const page = landscape
    ? ctx.doc.addPage([A4_HEIGHT, A4_WIDTH])
    : ctx.doc.addPage(PageSizes.A4)
  ctx.pages.push(page)
  ctx.currentPage = page
  ctx.pageNumber = ctx.pages.length
  ctx.y = (landscape ? A4_WIDTH : A4_HEIGHT) - MARGIN.top
  return page
}

function getPageHeight(page: PDFPage): number {
  return page.getHeight()
}

function getPageWidth(page: PDFPage): number {
  return page.getWidth()
}

function ensureSpace(ctx: DrawContext, needed: number, landscape: boolean = false): void {
  if (ctx.y - needed < MARGIN.bottom) {
    createPage(ctx, landscape)
  }
}

// ============================================================
// HELPER: Text Drawing
// ============================================================

function drawText(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  font: PDFFont,
  size: number,
  colour: RGB = COLOURS.black,
  maxWidth?: number
): void {
  let displayText = text
  if (maxWidth) {
    const charWidth = font.widthOfTextAtSize('M', size)
    const maxChars = Math.floor(maxWidth / charWidth)
    if (displayText.length > maxChars) {
      displayText = displayText.substring(0, maxChars - 1) + '…'
    }
  }
  page.drawText(displayText, { x, y, size, font, color: colour })
}

function drawWrappedText(
  page: PDFPage,
  text: string,
  x: number,
  startY: number,
  font: PDFFont,
  size: number,
  maxWidth: number,
  lineHeight: number,
  colour: RGB = COLOURS.black
): number {
  const words = text.split(' ')
  let line = ''
  let y = startY

  for (const word of words) {
    const testLine = line ? `${line} ${word}` : word
    const testWidth = font.widthOfTextAtSize(testLine, size)
    if (testWidth > maxWidth && line) {
      page.drawText(line, { x, y, size, font, color: colour })
      y -= lineHeight
      line = word
    } else {
      line = testLine
    }
  }
  if (line) {
    page.drawText(line, { x, y, size, font, color: colour })
    y -= lineHeight
  }
  return y
}

function textWidth(text: string, font: PDFFont, size: number): number {
  return font.widthOfTextAtSize(text, size)
}

// ============================================================
// HELPER: Box & Table Drawing
// ============================================================

function drawRect(
  page: PDFPage,
  x: number,
  y: number,
  w: number,
  h: number,
  fillColour?: RGB,
  borderColour?: RGB,
  borderWidth: number = 0.5
): void {
  if (fillColour) {
    page.drawRectangle({ x, y, width: w, height: h, color: fillColour })
  }
  if (borderColour) {
    page.drawRectangle({
      x,
      y,
      width: w,
      height: h,
      borderColor: borderColour,
      borderWidth,
    })
  }
}

function drawLine(
  page: PDFPage,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  colour: RGB = COLOURS.lightGrey,
  thickness: number = 0.5
): void {
  page.drawLine({
    start: { x: x1, y: y1 },
    end: { x: x2, y: y2 },
    color: colour,
    thickness,
  })
}

function drawSectionHeader(
  ctx: DrawContext,
  title: string,
  landscape: boolean = false
): void {
  const pageW = getPageWidth(ctx.currentPage)
  const w = pageW - MARGIN.left - MARGIN.right
  const h = 18

  ensureSpace(ctx, h + 10, landscape)

  drawRect(ctx.currentPage, MARGIN.left, ctx.y - h, w, h, COLOURS.headerBg)
  drawText(
    ctx.currentPage,
    title.toUpperCase(),
    MARGIN.left + 8,
    ctx.y - h + 5,
    ctx.fontBold,
    FONT_SIZE.sectionHeader,
    COLOURS.headerText
  )
  ctx.y -= h + 6
}

function drawLabelValue(
  ctx: DrawContext,
  label: string,
  value: string,
  x: number,
  width: number,
  labelWidth: number = 120
): void {
  drawText(ctx.currentPage, label, x, ctx.y, ctx.font, FONT_SIZE.label, COLOURS.midGrey)
  drawText(
    ctx.currentPage,
    value || '—',
    x + labelWidth,
    ctx.y,
    ctx.fontBold,
    FONT_SIZE.value,
    COLOURS.black,
    width - labelWidth
  )
}

function drawFieldRow(
  ctx: DrawContext,
  fields: Array<{ label: string; value: string; width: number; labelWidth?: number }>
): void {
  let x = MARGIN.left
  for (const field of fields) {
    drawLabelValue(ctx, field.label, field.value, x, field.width, field.labelWidth ?? 100)
    x += field.width
  }
  ctx.y -= 14
}

// ============================================================
// HELPER: Formatting
// ============================================================

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString('en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })
  } catch {
    return iso
  }
}

function formatEarthing(type: EarthingType | null): string {
  if (!type) return '—'
  return type.replace(/_/g, '-')
}

function formatConductorConfig(config: ConductorConfig): string {
  const map: Record<ConductorConfig, string> = {
    '1PH_2WIRE': '1-phase 2-wire',
    '2PH_3WIRE': '2-phase 3-wire',
    '3PH_3WIRE': '3-phase 3-wire',
    '3PH_4WIRE': '3-phase 4-wire',
  }
  return map[config] ?? config
}

function formatPurpose(purpose: ReportPurpose): string {
  const map: Record<ReportPurpose, string> = {
    PERIODIC: 'Periodic Inspection',
    CHANGE_OF_OCCUPANCY: 'Change of Occupancy',
    MORTGAGE: 'Mortgage / Sale',
    INSURANCE: 'Insurance',
    SAFETY_CONCERN: 'Safety Concern',
    OTHER: 'Other',
  }
  return map[purpose] ?? purpose
}

function formatPremises(type: PremisesType, other?: string): string {
  if (type === 'OTHER' && other) return other
  const map: Record<PremisesType, string> = {
    DOMESTIC: 'Domestic',
    COMMERCIAL: 'Commercial',
    INDUSTRIAL: 'Industrial',
    OTHER: 'Other',
  }
  return map[type] ?? type
}

function formatTestValue(val: TestValue | null): string {
  if (val === null || val === undefined) return ''
  if (typeof val === 'number') return val.toFixed(2)
  return String(val)
}

function formatTick(val: TickStatus): string {
  if (val === 'TICK') return '✓'
  if (val === 'CROSS') return '✗'
  return 'N/A'
}

function formatBonding(val: BondingStatus): string {
  if (val === 'SATISFACTORY') return '✓'
  if (val === 'UNSATISFACTORY') return '✗'
  return 'N/A'
}

function formatNum(val: number | null, unit: string = ''): string {
  if (val === null || val === undefined) return '—'
  return `${val}${unit}`
}

function yesNo(val: boolean): string {
  return val ? 'Yes' : 'No'
}

function codeColour(code: ClassificationCode): RGB {
  const map: Record<ClassificationCode, RGB> = {
    C1: COLOURS.c1Red,
    C2: COLOURS.c2Amber,
    C3: COLOURS.c3Blue,
    FI: COLOURS.fiPurple,
  }
  return map[code] ?? COLOURS.black
}

function outcomeDisplay(outcome: InspectionOutcome | null): string {
  if (!outcome) return ''
  const map: Record<InspectionOutcome, string> = {
    PASS: '✓',
    C1: 'C1',
    C2: 'C2',
    C3: 'C3',
    FI: 'FI',
    NV: 'N/V',
    LIM: 'LIM',
    NA: 'N/A',
  }
  return map[outcome] ?? outcome
}

// ============================================================
// PAGE HEADERS & FOOTERS (applied after all pages created)
// ============================================================

function applyHeadersFooters(ctx: DrawContext): void {
  const total = ctx.pages.length
  for (let i = 0; i < total; i++) {
    const page = ctx.pages[i]
    const pageW = getPageWidth(page)
    const pageH = getPageHeight(page)

    // Header line
    drawLine(page, MARGIN.left, pageH - 35, pageW - MARGIN.right, pageH - 35, COLOURS.accent, 1.5)

    // Header: CertVoice branding
    drawText(page, 'CertVoice', MARGIN.left, pageH - 30, ctx.fontBold, 10, COLOURS.accent)

    // Header: Report number
    const reportText = `Report: ${ctx.reportNumber}`
    const rw = textWidth(reportText, ctx.font, FONT_SIZE.footer)
    drawText(page, reportText, pageW - MARGIN.right - rw, pageH - 30, ctx.font, FONT_SIZE.footer, COLOURS.midGrey)

    // Footer line
    drawLine(page, MARGIN.left, MARGIN.bottom - 15, pageW - MARGIN.right, MARGIN.bottom - 15, COLOURS.lightGrey, 0.5)

    // Footer: Page number
    const pageText = `Page ${i + 1} of ${total}`
    const pw = textWidth(pageText, ctx.font, FONT_SIZE.footer)
    drawText(page, pageText, pageW - MARGIN.right - pw, MARGIN.bottom - 25, ctx.font, FONT_SIZE.footer, COLOURS.midGrey)

    // Footer: Compliance
    drawText(page, COMPLIANCE_STATEMENT, MARGIN.left, MARGIN.bottom - 25, ctx.font, FONT_SIZE.tiny, COLOURS.midGrey)
  }
}

// ============================================================
// SECTION RENDERERS
// ============================================================

function renderCoverPage(ctx: DrawContext, cert: EICRCertificate): void {
  const page = ctx.currentPage

  // Title
  ctx.y -= 10
  drawText(page, 'ELECTRICAL INSTALLATION', MARGIN.left, ctx.y, ctx.fontBold, FONT_SIZE.title, COLOURS.black)
  ctx.y -= 18
  drawText(page, 'CONDITION REPORT', MARGIN.left, ctx.y, ctx.fontBold, FONT_SIZE.title, COLOURS.black)
  ctx.y -= 14
  drawText(page, '(EICR)', MARGIN.left, ctx.y, ctx.font, FONT_SIZE.sectionHeader, COLOURS.midGrey)
  ctx.y -= 20

  // Validity notice
  drawRect(page, MARGIN.left, ctx.y - 30, CONTENT_WIDTH, 30, COLOURS.rowAlt, COLOURS.lightGrey)
  ctx.y -= 12
  drawWrappedText(page, VALIDITY_NOTICE, MARGIN.left + 6, ctx.y, ctx.font, FONT_SIZE.small, CONTENT_WIDTH - 12, 10, COLOURS.darkGrey)
  ctx.y -= 28

  // --- Section A ---
  drawSectionHeader(ctx, 'Section A — Details of the Client')
  drawFieldRow(ctx, [
    { label: 'Client Name:', value: cert.clientDetails.clientName, width: CONTENT_WIDTH, labelWidth: 90 },
  ])
  drawFieldRow(ctx, [
    { label: 'Client Address:', value: cert.clientDetails.clientAddress, width: CONTENT_WIDTH, labelWidth: 90 },
  ])
  ctx.y -= 6

  // --- Section B ---
  drawSectionHeader(ctx, 'Section B — Reason for Producing This Report')
  drawFieldRow(ctx, [
    { label: 'Purpose:', value: formatPurpose(cert.reportReason.purpose), width: CONTENT_WIDTH / 2, labelWidth: 90 },
    {
      label: 'Date(s) of Inspection:',
      value: cert.reportReason.inspectionDates.map(formatDate).join(', '),
      width: CONTENT_WIDTH / 2,
      labelWidth: 120,
    },
  ])
  ctx.y -= 6

  // --- Section C ---
  drawSectionHeader(ctx, 'Section C — Details of the Installation')
  drawFieldRow(ctx, [
    { label: 'Installation Address:', value: cert.installationDetails.installationAddress, width: CONTENT_WIDTH, labelWidth: 120 },
  ])
  drawFieldRow(ctx, [
    { label: 'Occupier:', value: cert.installationDetails.occupier, width: CONTENT_WIDTH / 2, labelWidth: 120 },
    { label: 'Premises Type:', value: formatPremises(cert.installationDetails.premisesType, cert.installationDetails.otherDescription), width: CONTENT_WIDTH / 2, labelWidth: 100 },
  ])
  drawFieldRow(ctx, [
    { label: 'Est. Age of Wiring:', value: formatNum(cert.installationDetails.estimatedAgeOfWiring, ' years'), width: CONTENT_WIDTH / 3, labelWidth: 110 },
    { label: 'Evidence of Additions:', value: yesNo(cert.installationDetails.evidenceOfAdditions), width: CONTENT_WIDTH / 3, labelWidth: 120 },
    { label: 'Last Inspection:', value: formatDate(cert.installationDetails.dateOfLastInspection), width: CONTENT_WIDTH / 3, labelWidth: 90 },
  ])
  if (cert.installationDetails.evidenceOfAdditions && cert.installationDetails.additionsEstimatedAge) {
    drawFieldRow(ctx, [
      { label: 'Additions Est. Age:', value: formatNum(cert.installationDetails.additionsEstimatedAge, ' years'), width: CONTENT_WIDTH / 2, labelWidth: 110 },
      { label: 'Records Available:', value: yesNo(cert.installationDetails.installationRecordsAvailable), width: CONTENT_WIDTH / 2, labelWidth: 110 },
    ])
  }
  ctx.y -= 6

  // --- Section D ---
  drawSectionHeader(ctx, 'Section D — Extent and Limitations of the Inspection')
  ensureSpace(ctx, 80)
  drawText(ctx.currentPage, 'Extent Covered:', MARGIN.left, ctx.y, ctx.fontBold, FONT_SIZE.label, COLOURS.midGrey)
  ctx.y -= 10
  ctx.y = drawWrappedText(ctx.currentPage, cert.extentAndLimitations.extentCovered, MARGIN.left + 4, ctx.y, ctx.font, FONT_SIZE.body, CONTENT_WIDTH - 8, 11, COLOURS.black)
  ctx.y -= 6

  drawText(ctx.currentPage, 'Agreed Limitations:', MARGIN.left, ctx.y, ctx.fontBold, FONT_SIZE.label, COLOURS.midGrey)
  ctx.y -= 10
  ctx.y = drawWrappedText(ctx.currentPage, cert.extentAndLimitations.agreedLimitations, MARGIN.left + 4, ctx.y, ctx.font, FONT_SIZE.body, CONTENT_WIDTH - 8, 11, COLOURS.black)
  ctx.y -= 6

  drawFieldRow(ctx, [
    { label: 'Agreed With:', value: cert.extentAndLimitations.agreedWith, width: CONTENT_WIDTH, labelWidth: 90 },
  ])

  if (cert.extentAndLimitations.operationalLimitations) {
    drawText(ctx.currentPage, 'Operational Limitations:', MARGIN.left, ctx.y, ctx.fontBold, FONT_SIZE.label, COLOURS.midGrey)
    ctx.y -= 10
    ctx.y = drawWrappedText(ctx.currentPage, cert.extentAndLimitations.operationalLimitations, MARGIN.left + 4, ctx.y, ctx.font, FONT_SIZE.body, CONTENT_WIDTH - 8, 11, COLOURS.black)
  }
}

function renderSummaryPage(ctx: DrawContext, cert: EICRCertificate): void {
  createPage(ctx)

  // --- Section E ---
  drawSectionHeader(ctx, 'Section E — Summary of the Condition of the Installation')
  ctx.y -= 4

  const assessment = cert.summaryOfCondition?.overallAssessment ?? 'UNSATISFACTORY'
  const isSatisfactory = assessment === 'SATISFACTORY'
  const assessColour = isSatisfactory ? COLOURS.satisfactory : COLOURS.unsatisfactory

  // Assessment box
  const boxH = 40
  drawRect(ctx.currentPage, MARGIN.left, ctx.y - boxH, CONTENT_WIDTH, boxH, undefined, assessColour, 2)
  drawText(ctx.currentPage, 'Overall Assessment:', MARGIN.left + 10, ctx.y - 16, ctx.fontBold, FONT_SIZE.sectionHeader, COLOURS.black)
  const assessText = assessment
  const aw = textWidth(assessText, ctx.fontBold, 16)
  drawText(ctx.currentPage, assessText, MARGIN.left + CONTENT_WIDTH - aw - 10, ctx.y - 20, ctx.fontBold, 16, assessColour)
  ctx.y -= boxH + 10

  if (cert.summaryOfCondition?.generalCondition) {
    drawText(ctx.currentPage, 'General Condition:', MARGIN.left, ctx.y, ctx.fontBold, FONT_SIZE.label, COLOURS.midGrey)
    ctx.y -= 10
    ctx.y = drawWrappedText(ctx.currentPage, cert.summaryOfCondition.generalCondition, MARGIN.left + 4, ctx.y, ctx.font, FONT_SIZE.body, CONTENT_WIDTH - 8, 11, COLOURS.black)
    ctx.y -= 10
  }

  // --- Section F ---
  drawSectionHeader(ctx, 'Section F — Recommendations')
  if (cert.recommendations) {
    drawFieldRow(ctx, [
      { label: 'Next Inspection Due:', value: formatDate(cert.recommendations.nextInspectionDate), width: CONTENT_WIDTH / 2, labelWidth: 120 },
      { label: 'Reason for Interval:', value: cert.recommendations.reasonForInterval, width: CONTENT_WIDTH / 2, labelWidth: 120 },
    ])
    if (cert.recommendations.remedialUrgency) {
      drawText(ctx.currentPage, 'Remedial Urgency:', MARGIN.left, ctx.y, ctx.fontBold, FONT_SIZE.label, COLOURS.midGrey)
      ctx.y -= 10
      ctx.y = drawWrappedText(ctx.currentPage, cert.recommendations.remedialUrgency, MARGIN.left + 4, ctx.y, ctx.font, FONT_SIZE.body, CONTENT_WIDTH - 8, 11, COLOURS.black)
    }
  } else {
    drawText(ctx.currentPage, 'No recommendations recorded.', MARGIN.left + 4, ctx.y, ctx.font, FONT_SIZE.body, COLOURS.midGrey)
    ctx.y -= 14
  }
  ctx.y -= 10

  // --- Section G ---
  drawSectionHeader(ctx, 'Section G — Declaration')
  if (cert.declaration) {
    const d = cert.declaration
    drawFieldRow(ctx, [
      { label: 'Inspector:', value: d.inspectorName, width: CONTENT_WIDTH / 2, labelWidth: 90 },
      { label: 'Position:', value: d.position, width: CONTENT_WIDTH / 2, labelWidth: 90 },
    ])
    drawFieldRow(ctx, [
      { label: 'Company:', value: d.companyName, width: CONTENT_WIDTH, labelWidth: 90 },
    ])
    drawFieldRow(ctx, [
      { label: 'Address:', value: d.companyAddress, width: CONTENT_WIDTH, labelWidth: 90 },
    ])
    drawFieldRow(ctx, [
      { label: 'Registration No.:', value: d.registrationNumber, width: CONTENT_WIDTH / 2, labelWidth: 110 },
      { label: 'Date Inspected:', value: formatDate(d.dateInspected), width: CONTENT_WIDTH / 2, labelWidth: 100 },
    ])
    ctx.y -= 6

    // Signature placeholders
    drawText(ctx.currentPage, 'Inspector Signature:', MARGIN.left, ctx.y, ctx.fontBold, FONT_SIZE.label, COLOURS.midGrey)
    drawRect(ctx.currentPage, MARGIN.left + 110, ctx.y - 4, 150, 30, COLOURS.rowAlt, COLOURS.lightGrey)
    ctx.y -= 40

    drawFieldRow(ctx, [
      { label: 'Qualified Supervisor:', value: d.qsName, width: CONTENT_WIDTH / 2, labelWidth: 120 },
      { label: 'QS Date:', value: formatDate(d.qsDate), width: CONTENT_WIDTH / 2, labelWidth: 90 },
    ])
    drawText(ctx.currentPage, 'QS Signature:', MARGIN.left, ctx.y, ctx.fontBold, FONT_SIZE.label, COLOURS.midGrey)
    drawRect(ctx.currentPage, MARGIN.left + 110, ctx.y - 4, 150, 30, COLOURS.rowAlt, COLOURS.lightGrey)
    ctx.y -= 40
  } else {
    drawText(ctx.currentPage, 'Declaration not yet completed.', MARGIN.left + 4, ctx.y, ctx.font, FONT_SIZE.body, COLOURS.midGrey)
    ctx.y -= 14
  }
}

function renderSupplyPage(ctx: DrawContext, cert: EICRCertificate): void {
  createPage(ctx)

  // --- Section I ---
  drawSectionHeader(ctx, 'Section I — Supply Characteristics and Earthing Arrangements')
  const s = cert.supplyCharacteristics
  if (s) {
    drawFieldRow(ctx, [
      { label: 'Earthing System:', value: formatEarthing(s.earthingType), width: CONTENT_WIDTH / 3, labelWidth: 90 },
      { label: 'Supply Type:', value: s.supplyType, width: CONTENT_WIDTH / 3, labelWidth: 80 },
      { label: 'Configuration:', value: formatConductorConfig(s.conductorConfig), width: CONTENT_WIDTH / 3, labelWidth: 90 },
    ])
    drawFieldRow(ctx, [
      { label: 'Nominal Voltage:', value: formatNum(s.nominalVoltage, ' V'), width: CONTENT_WIDTH / 3, labelWidth: 95 },
      { label: 'Frequency:', value: `${s.nominalFrequency} Hz`, width: CONTENT_WIDTH / 3, labelWidth: 80 },
      { label: 'Polarity Confirmed:', value: yesNo(s.supplyPolarityConfirmed), width: CONTENT_WIDTH / 3, labelWidth: 105 },
    ])
    drawFieldRow(ctx, [
      { label: 'Ipf (kA):', value: formatNum(s.ipf, ' kA'), width: CONTENT_WIDTH / 3, labelWidth: 90 },
      { label: 'Ze (Ω):', value: formatNum(s.ze, ' Ω'), width: CONTENT_WIDTH / 3, labelWidth: 80 },
      { label: 'Other Sources:', value: yesNo(s.otherSourcesPresent), width: CONTENT_WIDTH / 3, labelWidth: 90 },
    ])
    if (s.otherSourcesPresent && s.otherSourcesDescription) {
      drawFieldRow(ctx, [
        { label: 'Other Sources Desc.:', value: s.otherSourcesDescription, width: CONTENT_WIDTH, labelWidth: 120 },
      ])
    }
    drawFieldRow(ctx, [
      { label: 'Supply Device BS(EN):', value: s.supplyDeviceBsEn, width: CONTENT_WIDTH / 3, labelWidth: 120 },
      { label: 'Device Type:', value: s.supplyDeviceType, width: CONTENT_WIDTH / 3, labelWidth: 80 },
      { label: 'Rating:', value: formatNum(s.supplyDeviceRating, ' A'), width: CONTENT_WIDTH / 3, labelWidth: 60 },
    ])
  }
  ctx.y -= 10

  // --- Section J ---
  drawSectionHeader(ctx, 'Section J — Particulars of the Installation at the Origin')
  const p = cert.installationParticulars
  if (p) {
    // Means of earthing
    drawText(ctx.currentPage, 'Means of Earthing', MARGIN.left, ctx.y, ctx.fontBold, FONT_SIZE.label, COLOURS.accent)
    ctx.y -= 12
    drawFieldRow(ctx, [
      { label: 'Distributor Facility:', value: yesNo(p.distributorFacility), width: CONTENT_WIDTH / 2, labelWidth: 120 },
      { label: 'Installation Electrode:', value: yesNo(p.installationElectrode), width: CONTENT_WIDTH / 2, labelWidth: 130 },
    ])
    if (p.installationElectrode) {
      drawFieldRow(ctx, [
        { label: 'Electrode Type:', value: p.electrodeType ?? '—', width: CONTENT_WIDTH / 3, labelWidth: 95 },
        { label: 'Location:', value: p.electrodeLocation ?? '—', width: CONTENT_WIDTH / 3, labelWidth: 65 },
        { label: 'Resistance:', value: formatNum(p.electrodeResistance ?? null, ' Ω'), width: CONTENT_WIDTH / 3, labelWidth: 75 },
      ])
    }
    ctx.y -= 4

    // Main switch
    drawText(ctx.currentPage, 'Main Switch / Switch-Fuse', MARGIN.left, ctx.y, ctx.fontBold, FONT_SIZE.label, COLOURS.accent)
    ctx.y -= 12
    drawFieldRow(ctx, [
      { label: 'Location:', value: p.mainSwitchLocation, width: CONTENT_WIDTH / 2, labelWidth: 70 },
      { label: 'BS(EN):', value: p.mainSwitchBsEn, width: CONTENT_WIDTH / 2, labelWidth: 60 },
    ])
    drawFieldRow(ctx, [
      { label: 'No. of Poles:', value: formatNum(p.mainSwitchPoles), width: CONTENT_WIDTH / 4, labelWidth: 80 },
      { label: 'Current Rating:', value: formatNum(p.mainSwitchCurrentRating, ' A'), width: CONTENT_WIDTH / 4, labelWidth: 90 },
      { label: 'Device Rating:', value: formatNum(p.mainSwitchDeviceRating, ' A'), width: CONTENT_WIDTH / 4, labelWidth: 90 },
      { label: 'Voltage:', value: formatNum(p.mainSwitchVoltageRating, ' V'), width: CONTENT_WIDTH / 4, labelWidth: 60 },
    ])
    ctx.y -= 4

    // Earthing conductor
    drawText(ctx.currentPage, 'Earthing Conductor', MARGIN.left, ctx.y, ctx.fontBold, FONT_SIZE.label, COLOURS.accent)
    ctx.y -= 12
    drawFieldRow(ctx, [
      { label: 'Material:', value: p.earthingConductorMaterial, width: CONTENT_WIDTH / 3, labelWidth: 65 },
      { label: 'CSA:', value: formatNum(p.earthingConductorCsa, ' mm²'), width: CONTENT_WIDTH / 3, labelWidth: 40 },
      { label: 'Verified:', value: yesNo(p.earthingConductorVerified), width: CONTENT_WIDTH / 3, labelWidth: 60 },
    ])

    // Bonding conductor
    drawText(ctx.currentPage, 'Main Protective Bonding', MARGIN.left, ctx.y, ctx.fontBold, FONT_SIZE.label, COLOURS.accent)
    ctx.y -= 12
    drawFieldRow(ctx, [
      { label: 'Material:', value: p.bondingConductorMaterial, width: CONTENT_WIDTH / 3, labelWidth: 65 },
      { label: 'CSA:', value: formatNum(p.bondingConductorCsa, ' mm²'), width: CONTENT_WIDTH / 3, labelWidth: 40 },
      { label: 'Verified:', value: yesNo(p.bondingConductorVerified), width: CONTENT_WIDTH / 3, labelWidth: 60 },
    ])

    // Bonding connections
    drawText(ctx.currentPage, 'Bonding of Extraneous-Conductive-Parts', MARGIN.left, ctx.y, ctx.fontBold, FONT_SIZE.label, COLOURS.accent)
    ctx.y -= 12
    drawFieldRow(ctx, [
      { label: 'Water:', value: formatBonding(p.bondingWater), width: CONTENT_WIDTH / 3, labelWidth: 55 },
      { label: 'Gas:', value: formatBonding(p.bondingGas), width: CONTENT_WIDTH / 3, labelWidth: 40 },
      { label: 'Oil:', value: formatBonding(p.bondingOil), width: CONTENT_WIDTH / 3, labelWidth: 40 },
    ])
    drawFieldRow(ctx, [
      { label: 'Steel:', value: formatBonding(p.bondingSteel), width: CONTENT_WIDTH / 3, labelWidth: 55 },
      { label: 'Lightning:', value: formatBonding(p.bondingLightning), width: CONTENT_WIDTH / 3, labelWidth: 70 },
      { label: 'Other:', value: formatBonding(p.bondingOther), width: CONTENT_WIDTH / 3, labelWidth: 50 },
    ])
  }
}

function renderObservationsPage(ctx: DrawContext, cert: EICRCertificate): void {
  createPage(ctx)
  drawSectionHeader(ctx, 'Section K — Observations and Recommendations')

  // Code legend
  drawRect(ctx.currentPage, MARGIN.left, ctx.y - 52, CONTENT_WIDTH, 52, COLOURS.rowAlt, COLOURS.lightGrey)
  ctx.y -= 10
  for (const [code, def] of Object.entries(CODE_DEFINITIONS) as Array<[ClassificationCode, { label: string; definition: string }]>) {
    drawText(ctx.currentPage, code, MARGIN.left + 6, ctx.y, ctx.fontBold, FONT_SIZE.body, codeColour(code))
    drawText(ctx.currentPage, `— ${def.label}:`, MARGIN.left + 22, ctx.y, ctx.fontBold, FONT_SIZE.small, COLOURS.black)
    drawText(ctx.currentPage, def.definition, MARGIN.left + 130, ctx.y, ctx.font, FONT_SIZE.small, COLOURS.darkGrey)
    ctx.y -= 11
  }
  ctx.y -= 8

  if (cert.observations.length === 0) {
    drawText(ctx.currentPage, 'No observations recorded.', MARGIN.left + 4, ctx.y, ctx.font, FONT_SIZE.body, COLOURS.midGrey)
    ctx.y -= 14
    return
  }

  // Table header
  const colWidths = [25, 30, 160, 55, 55, 80, CONTENT_WIDTH - 405]
  const headers = ['No.', 'Code', 'Observation', 'Board', 'Location', 'Regulation', 'Remedial Action']
  const rowH = 14

  function drawObsHeader(): void {
    let x = MARGIN.left
    drawRect(ctx.currentPage, MARGIN.left, ctx.y - rowH, CONTENT_WIDTH, rowH, COLOURS.headerBg)
    for (let i = 0; i < headers.length; i++) {
      drawText(ctx.currentPage, headers[i], x + 2, ctx.y - rowH + 4, ctx.fontBold, FONT_SIZE.tiny, COLOURS.headerText)
      x += colWidths[i]
    }
    ctx.y -= rowH
  }

  drawObsHeader()

  cert.observations.forEach((obs, idx) => {
    ensureSpace(ctx, rowH + 4)
    if (ctx.y > A4_HEIGHT - MARGIN.top - 10) {
      drawObsHeader()
    }

    const isAlt = idx % 2 === 1
    if (isAlt) {
      drawRect(ctx.currentPage, MARGIN.left, ctx.y - rowH, CONTENT_WIDTH, rowH, COLOURS.rowAlt)
    }

    let x = MARGIN.left
    const vals = [
      String(obs.itemNumber),
      obs.classificationCode,
      obs.observationText,
      obs.dbReference,
      obs.location,
      obs.regulationReference,
      obs.remedialAction,
    ]

    for (let i = 0; i < vals.length; i++) {
      const colour = i === 1 ? codeColour(obs.classificationCode) : COLOURS.black
      const f = i === 1 ? ctx.fontBold : ctx.font
      drawText(ctx.currentPage, vals[i], x + 2, ctx.y - rowH + 4, f, FONT_SIZE.tiny, colour, colWidths[i] - 4)
      x += colWidths[i]
    }
    ctx.y -= rowH
  })
}

function renderInspectionSchedule(ctx: DrawContext, cert: EICRCertificate): void {
  createPage(ctx)
  drawSectionHeader(ctx, 'Schedule of Inspections')

  if (cert.inspectionSchedule.length === 0) {
    drawText(ctx.currentPage, 'No inspection items recorded.', MARGIN.left + 4, ctx.y, ctx.font, FONT_SIZE.body, COLOURS.midGrey)
    return
  }

  const colWidths = [35, 200, 120, 45, CONTENT_WIDTH - 400]
  const headers = ['Ref', 'Description', 'Regulation', 'Result', 'Notes']
  const rowH = 12

  function drawScheduleHeader(): void {
    let x = MARGIN.left
    drawRect(ctx.currentPage, MARGIN.left, ctx.y - rowH, CONTENT_WIDTH, rowH, COLOURS.headerBg)
    for (let i = 0; i < headers.length; i++) {
      drawText(ctx.currentPage, headers[i], x + 2, ctx.y - rowH + 3, ctx.fontBold, FONT_SIZE.tiny, COLOURS.headerText)
      x += colWidths[i]
    }
    ctx.y -= rowH
  }

  let lastSection = -1

  for (let idx = 0; idx < cert.inspectionSchedule.length; idx++) {
    const item = cert.inspectionSchedule[idx]

    // Section header row
    if (item.section !== lastSection) {
      ensureSpace(ctx, rowH * 2 + 4)
      lastSection = item.section

      // Section title row
      drawRect(ctx.currentPage, MARGIN.left, ctx.y - rowH, CONTENT_WIDTH, rowH, rgb(0.9, 0.92, 0.96))
      drawText(ctx.currentPage, `Section ${item.section}: ${item.sectionTitle}`, MARGIN.left + 4, ctx.y - rowH + 3, ctx.fontBold, FONT_SIZE.small, COLOURS.accent)
      ctx.y -= rowH

      drawScheduleHeader()
    }

    ensureSpace(ctx, rowH + 2)
    if (ctx.y > A4_HEIGHT - MARGIN.top - 10) {
      drawScheduleHeader()
    }

    const isAlt = idx % 2 === 1
    if (isAlt) {
      drawRect(ctx.currentPage, MARGIN.left, ctx.y - rowH, CONTENT_WIDTH, rowH, COLOURS.rowAlt)
    }

    const outcome = outcomeDisplay(item.outcome)
    let outcomeColour = COLOURS.black
    if (item.outcome === 'PASS') outcomeColour = COLOURS.green
    else if (item.outcome === 'C1') outcomeColour = COLOURS.c1Red
    else if (item.outcome === 'C2') outcomeColour = COLOURS.c2Amber

    let x = MARGIN.left
    drawText(ctx.currentPage, item.itemRef, x + 2, ctx.y - rowH + 3, ctx.font, FONT_SIZE.tiny, COLOURS.black)
    x += colWidths[0]
    drawText(ctx.currentPage, item.description, x + 2, ctx.y - rowH + 3, ctx.font, FONT_SIZE.tiny, COLOURS.black, colWidths[1] - 4)
    x += colWidths[1]
    drawText(ctx.currentPage, item.regulationRef, x + 2, ctx.y - rowH + 3, ctx.font, FONT_SIZE.tiny, COLOURS.midGrey)
    x += colWidths[2]
    drawText(ctx.currentPage, outcome, x + 2, ctx.y - rowH + 3, ctx.fontBold, FONT_SIZE.tiny, outcomeColour)
    x += colWidths[3]
    drawText(ctx.currentPage, item.notes, x + 2, ctx.y - rowH + 3, ctx.font, FONT_SIZE.tiny, COLOURS.black, colWidths[4] - 4)
    ctx.y -= rowH
  }
}

function renderCircuitSchedule(ctx: DrawContext, cert: EICRCertificate): void {
  if (cert.distributionBoards.length === 0 && cert.circuits.length === 0) return

  for (const board of cert.distributionBoards) {
    const boardCircuits = cert.circuits.filter((c) => c.dbId === board.id || c.dbId === board.dbReference)
    if (boardCircuits.length === 0) continue

    // Landscape page for circuit schedule
    createPage(ctx, true)
    const pageW = A4_HEIGHT  // landscape
    const pageH = A4_WIDTH
    const contentW = pageW - MARGIN.left - MARGIN.right

    // Board header
    drawSectionHeader(ctx, `Schedule of Circuit Details and Test Results — ${board.dbReference}`)
    ctx.y -= 2

    // Board info row
    drawFieldRow(ctx, [
      { label: 'Board:', value: board.dbReference, width: contentW / 4, labelWidth: 45 },
      { label: 'Location:', value: board.dbLocation, width: contentW / 4, labelWidth: 60 },
      { label: 'Supplied From:', value: board.suppliedFrom ?? '—', width: contentW / 4, labelWidth: 90 },
      { label: 'Zs at DB:', value: formatNum(board.zsAtDb, ' Ω'), width: contentW / 4, labelWidth: 60 },
    ])
    ctx.y -= 4

    // Column definitions — abbreviated headers
    const circuitCols = [
      { header: 'Cct', width: 22 },
      { header: 'Description', width: 60 },
      { header: 'Type', width: 18 },
      { header: 'Ref', width: 16 },
      { header: 'Pts', width: 18 },
      { header: 'Live', width: 22 },
      { header: 'CPC', width: 22 },
      { header: 'tmax', width: 20 },
      { header: 'BS', width: 24 },
      { header: 'Ty', width: 14 },
      { header: 'In', width: 18 },
      { header: 'Zs max', width: 26 },
      { header: 'Icn', width: 20 },
      { header: 'RCD BS', width: 24 },
      { header: 'RCD Ty', width: 22 },
      { header: 'IΔn', width: 20 },
      { header: 'r1', width: 22 },
      { header: 'rn', width: 22 },
      { header: 'r2', width: 22 },
      { header: 'R1R2', width: 24 },
      { header: 'R1R2/', width: 24 },
      { header: 'R2', width: 22 },
      { header: 'Vt', width: 18 },
      { header: 'IR LL', width: 24 },
      { header: 'IR LE', width: 24 },
      { header: 'Zs', width: 24 },
      { header: 'Pol', width: 18 },
      { header: 'RCD t', width: 24 },
      { header: 'Btn', width: 18 },
      { header: 'AFDD', width: 20 },
      { header: 'Remarks', width: 0 },
    ]

    // Calculate remaining width for remarks
    const usedWidth = circuitCols.slice(0, -1).reduce((sum, c) => sum + c.width, 0)
    circuitCols[circuitCols.length - 1].width = Math.max(40, contentW - usedWidth)

    const rowH = 11

    // Draw column headers
    function drawCircuitHeader(): void {
      let x = MARGIN.left
      drawRect(ctx.currentPage, MARGIN.left, ctx.y - rowH - 2, contentW, rowH + 2, COLOURS.headerBg)
      for (const col of circuitCols) {
        drawText(ctx.currentPage, col.header, x + 1, ctx.y - rowH, ctx.fontBold, FONT_SIZE.tiny - 0.5, COLOURS.headerText, col.width - 2)
        x += col.width
      }
      ctx.y -= rowH + 2
    }

    drawCircuitHeader()

    // Draw each circuit row
    boardCircuits.forEach((circuit, idx) => {
      ensureSpace(ctx, rowH + 2, true)
      if (ctx.y > pageH - MARGIN.top - 10) {
        drawCircuitHeader()
      }

      if (idx % 2 === 1) {
        drawRect(ctx.currentPage, MARGIN.left, ctx.y - rowH, contentW, rowH, COLOURS.rowAlt)
      }

      const vals: string[] = [
        circuit.circuitNumber,
        circuit.circuitDescription,
        circuit.wiringType ?? '',
        circuit.referenceMethod ?? '',
        formatNum(circuit.numberOfPoints),
        formatNum(circuit.liveConductorCsa),
        formatNum(circuit.cpcCsa),
        formatNum(circuit.maxDisconnectTime),
        circuit.ocpdBsEn,
        circuit.ocpdType ?? '',
        formatNum(circuit.ocpdRating),
        formatNum(circuit.maxPermittedZs),
        formatNum(circuit.breakingCapacity),
        circuit.rcdBsEn,
        circuit.rcdType ?? '',
        formatNum(circuit.rcdRating),
        formatTestValue(circuit.r1),
        formatTestValue(circuit.rn),
        formatTestValue(circuit.r2),
        formatTestValue(circuit.r1r2),
        formatTestValue(circuit.r1r2OrR2),
        formatTestValue(circuit.r2Standalone),
        formatNum(circuit.irTestVoltage),
        formatTestValue(circuit.irLiveLive),
        formatTestValue(circuit.irLiveEarth),
        formatNum(circuit.zs),
        formatTick(circuit.polarity),
        formatNum(circuit.rcdDisconnectionTime),
        formatTick(circuit.rcdTestButton),
        formatTick(circuit.afddTestButton),
        circuit.remarks,
      ]

      let x = MARGIN.left
      for (let i = 0; i < vals.length; i++) {
        const fontSize = FONT_SIZE.tiny - 0.5
        drawText(ctx.currentPage, vals[i], x + 1, ctx.y - rowH + 3, ctx.font, fontSize, COLOURS.black, circuitCols[i].width - 2)
        x += circuitCols[i].width
      }

      // Zs validation highlight — col 26 red if > maxPermittedZs
      if (circuit.zs !== null && circuit.maxPermittedZs !== null && circuit.zs > circuit.maxPermittedZs) {
        const zsX = MARGIN.left + circuitCols.slice(0, 25).reduce((s, c) => s + c.width, 0)
        drawRect(ctx.currentPage, zsX, ctx.y - rowH, circuitCols[25].width, rowH, undefined, COLOURS.c1Red, 0.8)
      }

      ctx.y -= rowH
    })
  }
}

function renderGuidancePage(ctx: DrawContext): void {
  createPage(ctx)
  drawSectionHeader(ctx, 'Guidance for Recipients')
  ctx.y -= 4

  const paragraphs = GUIDANCE_TEXT.split('\n\n')
  for (const para of paragraphs) {
    const trimmed = para.trim()
    if (!trimmed) continue

    ensureSpace(ctx, 30)

    if (trimmed === 'GUIDANCE FOR RECIPIENTS') {
      // Skip — already in section header
      continue
    }

    ctx.y = drawWrappedText(
      ctx.currentPage,
      trimmed,
      MARGIN.left + 4,
      ctx.y,
      ctx.font,
      FONT_SIZE.body,
      CONTENT_WIDTH - 8,
      12,
      COLOURS.darkGrey
    )
    ctx.y -= 8
  }
}

// ============================================================
// MAIN GENERATION FUNCTION
// ============================================================

async function generatePDF(cert: EICRCertificate): Promise<Uint8Array> {
  const doc = await PDFDocument.create()

  doc.setTitle(`EICR ${cert.reportNumber}`)
  doc.setAuthor(cert.declaration?.companyName ?? 'CertVoice')
  doc.setSubject('Electrical Installation Condition Report')
  doc.setCreator('CertVoice')
  doc.setProducer('CertVoice / pdf-lib')

  const font = await doc.embedFont(StandardFonts.Helvetica)
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold)

  const firstPage = doc.addPage(PageSizes.A4)

  const ctx: DrawContext = {
    doc,
    font,
    fontBold,
    pages: [firstPage],
    currentPage: firstPage,
    y: A4_HEIGHT - MARGIN.top,
    pageNumber: 1,
    totalPages: 0,
    reportNumber: cert.reportNumber,
  }

  // Render all sections
  renderCoverPage(ctx, cert)
  renderSummaryPage(ctx, cert)
  renderSupplyPage(ctx, cert)
  renderObservationsPage(ctx, cert)
  renderInspectionSchedule(ctx, cert)
  renderCircuitSchedule(ctx, cert)
  renderGuidancePage(ctx)

  // Apply headers/footers to all pages
  ctx.totalPages = ctx.pages.length
  applyHeadersFooters(ctx)

  // Draft watermark
  if (cert.status === 'DRAFT' || cert.status === 'IN_PROGRESS') {
    for (const page of ctx.pages) {
      const pageW = getPageWidth(page)
      const pageH = getPageHeight(page)
      page.drawText('DRAFT', {
        x: pageW / 2 - 80,
        y: pageH / 2 - 30,
        size: 72,
        font: fontBold,
        color: rgb(0.9, 0.9, 0.9),
        opacity: 0.3,
      })
    }
  }

  return doc.save()
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

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return corsResponse(origin, env.ALLOWED_ORIGIN)
    }

    // Only POST
    if (request.method !== 'POST') {
      status = 405
      structuredLog({
        requestId, route: url.pathname, method: request.method,
        status, latencyMs: Date.now() - startTime, userId: null,
        message: 'Method not allowed',
      })
      return new Response(
        JSON.stringify({ error: 'Method not allowed', requestId }),
        { status, headers: { ...cors, 'Content-Type': 'application/json' } }
      )
    }

    // READ_ONLY_MODE safety switch
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
        JSON.stringify({ error: 'Authentication required', requestId }),
        { status, headers: { ...cors, 'Content-Type': 'application/json' } }
      )
    }

    // Rate limit (20 PDFs/hr via Upstash)
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
          JSON.stringify({ error: 'Rate limit exceeded. Max 20 PDFs per hour.', code: 'RATE_LIMITED', requestId }),
          { status, headers: { ...cors, 'Content-Type': 'application/json' } }
        )
      }
    } catch {
      // Rate limiter failure should not block the request
    }

    // Parse body
    let body: { certificate: EICRCertificate; options?: Partial<GenerateOptions> }
    try {
      body = (await request.json()) as { certificate: EICRCertificate; options?: Partial<GenerateOptions> }
    } catch {
      status = 400
      structuredLog({
        requestId, route: url.pathname, method: request.method,
        status, latencyMs: Date.now() - startTime, userId,
        message: 'Invalid JSON body',
      })
      return new Response(
        JSON.stringify({ error: 'Invalid JSON', code: 'INVALID_INPUT', requestId }),
        { status, headers: { ...cors, 'Content-Type': 'application/json' } }
      )
    }

    if (!body.certificate?.id || !body.certificate?.reportNumber) {
      status = 400
      structuredLog({
        requestId, route: url.pathname, method: request.method,
        status, latencyMs: Date.now() - startTime, userId,
        message: 'Missing certificate id or reportNumber',
      })
      return new Response(
        JSON.stringify({ error: 'Invalid certificate data', code: 'INVALID_INPUT', requestId }),
        { status, headers: { ...cors, 'Content-Type': 'application/json' } }
      )
    }

    // Verify ownership — engineer can only generate PDFs for their own certificates
    if (body.certificate.engineerId !== userId) {
      status = 403
      structuredLog({
        requestId, route: url.pathname, method: request.method,
        status, latencyMs: Date.now() - startTime, userId,
        message: `Tenant violation: userId=${userId} attempted cert owned by ${body.certificate.engineerId}`,
      })
      return new Response(
        JSON.stringify({ error: 'Access denied', requestId }),
        { status, headers: { ...cors, 'Content-Type': 'application/json' } }
      )
    }

    // Generate PDF
    try {
      const pdfBytes = await generatePDF(body.certificate)
      const outputFormat = body.options?.outputFormat ?? 'buffer'

      if (outputFormat === 'r2') {
        // Upload to R2
        const pdfKey = `certificates/${body.certificate.id}/${body.certificate.reportNumber}.pdf`
        await env.STORAGE_BUCKET.put(pdfKey, pdfBytes, {
          httpMetadata: { contentType: 'application/pdf' },
          customMetadata: {
            reportNumber: body.certificate.reportNumber,
            engineerId: userId,
            generatedAt: new Date().toISOString(),
          },
        })

        structuredLog({
          requestId, route: url.pathname, method: request.method,
          status: 200, latencyMs: Date.now() - startTime, userId,
          message: `PDF uploaded to R2: ${pdfKey} (${pdfBytes.length} bytes)`,
        })

        return new Response(
          JSON.stringify({ pdfKey, size: pdfBytes.length, requestId }),
          { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } }
        )
      }

      // Return binary PDF
      structuredLog({
        requestId, route: url.pathname, method: request.method,
        status: 200, latencyMs: Date.now() - startTime, userId,
        message: `PDF generated: ${body.certificate.reportNumber} (${pdfBytes.length} bytes)`,
      })

      return new Response(pdfBytes, {
        status: 200,
        headers: {
          ...cors,
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${body.certificate.reportNumber}.pdf"`,
          'Content-Length': String(pdfBytes.length),
        },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'PDF generation failed'
      status = 500

      structuredLog({
        requestId, route: url.pathname, method: request.method,
        status, latencyMs: Date.now() - startTime, userId,
        error: message,
      })

      return new Response(
        JSON.stringify({ error: 'PDF generation failed', code: 'GENERATION_ERROR', requestId }),
        { status, headers: { ...cors, 'Content-Type': 'application/json' } }
      )
    }
  },
}
