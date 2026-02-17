/**
 * CertVoice — EICR PDF Generator (Client-Side)
 *
 * Generates a complete Electrical Installation Condition Report PDF
 * using pdf-lib. Works offline — no server round-trip needed.
 *
 * Page structure:
 *   Page 1: Sections A-D (client, reason, installation, extent/limitations)
 *   Page 2: Sections E-G (summary, recommendations, declaration)
 *   Page 3: Sections I-J (supply characteristics, installation particulars)
 *   Page 4+: Section K observations (dynamic overflow)
 *   Page N+: Inspection schedule checklist (dynamic overflow)
 *   Page N+: Circuit test results schedule (dynamic overflow)
 *
 * Design: original CertVoice layout, BS 7671:2018+A2:2022 compliant structure.
 * No IET model forms used.
 *
 * @module services/pdfGenerator
 */

import { PDFDocument, StandardFonts } from 'pdf-lib'
import type { PDFFont, PDFPage } from 'pdf-lib'
import type {
  EICRCertificate,
  Observation,
  InspectionItem,
  ClassificationCode,
} from '../types/eicr'
import {
  PAGE,
  CONTENT_WIDTH,
  COLOURS,
  FONT,
  SPACING,
  drawPageHeader,
  drawSectionHeader,
  drawField,
  drawFieldPair,
  drawHorizontalRule,
  drawTableHeader,
  drawTableRow,
  drawPageFooter,
  wrapText,
  needsNewPage,
  getCodeColour,
} from './pdfStyles'

// ============================================================
// TYPES
// ============================================================

interface PDFContext {
  doc: PDFDocument
  font: PDFFont
  fontBold: PDFFont
  reportNumber: string
  pages: PDFPage[]
}

// ============================================================
// FORMATTING HELPERS
// ============================================================

function fmt(val: string | number | null | undefined, fallback = '—'): string {
  if (val === null || val === undefined || val === '') return fallback
  return String(val)
}

function fmtBool(val: boolean | null | undefined, trueText = 'Yes', falseText = 'No'): string {
  if (val === null || val === undefined) return '—'
  return val ? trueText : falseText
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  } catch {
    return iso
  }
}

function fmtEarthing(code: string | null | undefined): string {
  const map: Record<string, string> = {
    TN_C: 'TN-C', TN_S: 'TN-S', TN_C_S: 'TN-C-S', TT: 'TT', IT: 'IT',
  }
  return code ? (map[code] ?? code) : '—'
}

function fmtConductorConfig(code: string | null | undefined): string {
  const map: Record<string, string> = {
    '1PH_2WIRE': 'Single phase, 2-wire',
    '2PH_3WIRE': 'Two phase, 3-wire',
    '3PH_3WIRE': 'Three phase, 3-wire',
    '3PH_4WIRE': 'Three phase, 4-wire',
  }
  return code ? (map[code] ?? code) : '—'
}

function fmtPremises(code: string | null | undefined): string {
  const map: Record<string, string> = {
    DOMESTIC: 'Domestic', COMMERCIAL: 'Commercial', INDUSTRIAL: 'Industrial', OTHER: 'Other',
  }
  return code ? (map[code] ?? code) : '—'
}

function fmtPurpose(code: string | null | undefined): string {
  const map: Record<string, string> = {
    PERIODIC: 'Periodic inspection',
    CHANGE_OF_OCCUPANCY: 'Change of occupancy',
    MORTGAGE: 'Mortgage/insurance requirement',
    INSURANCE: 'Insurance requirement',
    SAFETY_CONCERN: 'Safety concern',
    OTHER: 'Other',
  }
  return code ? (map[code] ?? code) : '—'
}

function fmtBonding(code: string | null | undefined): string {
  const map: Record<string, string> = { SATISFACTORY: '✓', NA: 'N/A', UNSATISFACTORY: '✗' }
  return code ? (map[code] ?? code) : '—'
}

function fmtTestValue(val: number | string | null | undefined): string {
  if (val === null || val === undefined) return '—'
  if (typeof val === 'string') return val
  return val.toFixed(2)
}

function fmtTickStatus(val: string | null | undefined): string {
  const map: Record<string, string> = { TICK: '✓', CROSS: '✗', NA: 'N/A' }
  return val ? (map[val] ?? val) : '—'
}

// ============================================================
// PAGE CREATION HELPER
// ============================================================

function addPage(ctx: PDFContext, pageNum: number, totalPages: number): { page: PDFPage; y: number } {
  const page = ctx.doc.addPage([PAGE.width, PAGE.height])
  ctx.pages.push(page)
  const y = drawPageHeader(page, ctx.font, ctx.fontBold, ctx.reportNumber, pageNum, totalPages)
  return { page, y }
}

// ============================================================
// PAGE 1: SECTIONS A–D
// ============================================================

function drawPage1(ctx: PDFContext, cert: Partial<EICRCertificate>, pageNum: number, totalPages: number): void {
  const { page, y: startY } = addPage(ctx, pageNum, totalPages)
  const { font, fontBold } = ctx
  let y = startY

  // Section A
  y = drawSectionHeader(page, fontBold, y, 'Section A — Client Details')
  y = drawField(page, font, fontBold, y, 'Client Name', fmt(cert.clientDetails?.clientName))
  y = drawField(page, font, fontBold, y, 'Client Address', fmt(cert.clientDetails?.clientAddress))
  y -= 4

  // Section B
  y = drawSectionHeader(page, fontBold, y, 'Section B — Reason for Producing Report')
  y = drawField(page, font, fontBold, y, 'Purpose of Report', fmtPurpose(cert.reportReason?.purpose))
  const dates = cert.reportReason?.inspectionDates?.map(fmtDate).join(', ') ?? '—'
  y = drawField(page, font, fontBold, y, 'Date(s) of Inspection', dates)
  y -= 4

  // Section C
  y = drawSectionHeader(page, fontBold, y, 'Section C — Details of Installation')
  y = drawField(page, font, fontBold, y, 'Installation Address', fmt(cert.installationDetails?.installationAddress))
  y = drawFieldPair(page, font, fontBold, y,
    { label: 'Occupier', value: fmt(cert.installationDetails?.occupier) },
    { label: 'Premises Type', value: fmtPremises(cert.installationDetails?.premisesType) }
  )
  y = drawFieldPair(page, font, fontBold, y,
    { label: 'Est. Age of Wiring', value: cert.installationDetails?.estimatedAgeOfWiring != null ? `${cert.installationDetails.estimatedAgeOfWiring} years` : '—' },
    { label: 'Evidence of Additions', value: fmtBool(cert.installationDetails?.evidenceOfAdditions) }
  )
  y = drawFieldPair(page, font, fontBold, y,
    { label: 'Records Available', value: fmtBool(cert.installationDetails?.installationRecordsAvailable) },
    { label: 'Date of Last Inspection', value: fmtDate(cert.installationDetails?.dateOfLastInspection) }
  )
  if (cert.installationDetails?.evidenceOfAdditions && cert.installationDetails?.additionsEstimatedAge != null) {
    y = drawField(page, font, fontBold, y, 'Age of Additions', `${cert.installationDetails.additionsEstimatedAge} years`)
  }
  y -= 4

  // Section D
  y = drawSectionHeader(page, fontBold, y, 'Section D — Extent and Limitations')

  const extentLines = wrapText(fmt(cert.extentAndLimitations?.extentCovered), font, FONT.value, CONTENT_WIDTH - 10)
  page.drawText('Extent of Installation Covered', { x: PAGE.marginLeft, y, size: FONT.label, font, color: COLOURS.muted })
  y -= 10
  for (const line of extentLines) {
    page.drawText(line, { x: PAGE.marginLeft + 4, y, size: FONT.value, font: fontBold, color: COLOURS.text })
    y -= FONT.value * SPACING.lineHeight + 2
  }
  y -= 4

  const limitLines = wrapText(fmt(cert.extentAndLimitations?.agreedLimitations), font, FONT.value, CONTENT_WIDTH - 10)
  page.drawText('Agreed Limitations', { x: PAGE.marginLeft, y, size: FONT.label, font, color: COLOURS.muted })
  y -= 10
  for (const line of limitLines) {
    page.drawText(line, { x: PAGE.marginLeft + 4, y, size: FONT.value, font: fontBold, color: COLOURS.text })
    y -= FONT.value * SPACING.lineHeight + 2
  }
  y -= 4

  y = drawFieldPair(page, font, fontBold, y,
    { label: 'Agreed With', value: fmt(cert.extentAndLimitations?.agreedWith) },
    { label: 'Operational Limitations', value: fmt(cert.extentAndLimitations?.operationalLimitations) }
  )

  drawPageFooter(page, font)
}

// ============================================================
// PAGE 2: SECTIONS E–G
// ============================================================

function drawPage2(ctx: PDFContext, cert: Partial<EICRCertificate>, pageNum: number, totalPages: number): void {
  const { page, y: startY } = addPage(ctx, pageNum, totalPages)
  const { font, fontBold } = ctx
  let y = startY

  // Section E
  y = drawSectionHeader(page, fontBold, y, 'Section E — Summary of the Condition of the Installation')

  const condLines = wrapText(fmt(cert.summaryOfCondition?.generalCondition), font, FONT.value, CONTENT_WIDTH - 10)
  page.drawText('General Condition', { x: PAGE.marginLeft, y, size: FONT.label, font, color: COLOURS.muted })
  y -= 10
  for (const line of condLines) {
    page.drawText(line, { x: PAGE.marginLeft + 4, y, size: FONT.value, font: fontBold, color: COLOURS.text })
    y -= FONT.value * SPACING.lineHeight + 2
  }
  y -= 4

  const assessment = cert.summaryOfCondition?.overallAssessment ?? 'UNSATISFACTORY'
  const assessColour = assessment === 'SATISFACTORY' ? COLOURS.pass : COLOURS.fail
  y = drawField(page, font, fontBold, y, 'Overall Assessment', assessment, { valueColour: assessColour })
  y -= 4

  // Section F
  y = drawSectionHeader(page, fontBold, y, 'Section F — Recommendations')
  y = drawField(page, font, fontBold, y, 'Next Inspection Date', fmtDate(cert.recommendations?.nextInspectionDate))
  y = drawField(page, font, fontBold, y, 'Reason for Interval', fmt(cert.recommendations?.reasonForInterval))

  if (cert.recommendations?.remedialUrgency) {
    const urgLines = wrapText(cert.recommendations.remedialUrgency, font, FONT.value, CONTENT_WIDTH - 10)
    page.drawText('Remedial Urgency', { x: PAGE.marginLeft, y, size: FONT.label, font, color: COLOURS.muted })
    y -= 10
    for (const line of urgLines) {
      page.drawText(line, { x: PAGE.marginLeft + 4, y, size: FONT.value, font: fontBold, color: COLOURS.text })
      y -= FONT.value * SPACING.lineHeight + 2
    }
  }
  y -= 4

  // Section G
  y = drawSectionHeader(page, fontBold, y, 'Section G — Declaration')

  const declText =
    'I/We, being the person(s) responsible for the inspection and testing of the ' +
    'electrical installation (as indicated by my/our signatures below), particulars ' +
    'of which are described above, having exercised reasonable skill and care when ' +
    'carrying out the inspection and testing, hereby declare that the information in ' +
    'this report, including the observations and the attached schedules, provides an ' +
    'accurate assessment of the condition of the electrical installation.'

  const declLines = wrapText(declText, font, FONT.value, CONTENT_WIDTH - 10)
  for (const line of declLines) {
    page.drawText(line, { x: PAGE.marginLeft + 4, y, size: FONT.value, font, color: COLOURS.text })
    y -= FONT.value * SPACING.lineHeight + 2
  }
  y -= 8

  drawHorizontalRule(page, y + 4)
  y -= 4
  y = drawFieldPair(page, font, fontBold, y,
    { label: 'Inspector Name', value: fmt(cert.declaration?.inspectorName) },
    { label: 'Position', value: fmt(cert.declaration?.position) }
  )
  y = drawFieldPair(page, font, fontBold, y,
    { label: 'Company', value: fmt(cert.declaration?.companyName) },
    { label: 'Registration No.', value: fmt(cert.declaration?.registrationNumber) }
  )
  y = drawField(page, font, fontBold, y, 'Company Address', fmt(cert.declaration?.companyAddress))
  y = drawField(page, font, fontBold, y, 'Date Inspected', fmtDate(cert.declaration?.dateInspected))

  // Signature placeholders
  y -= 6
  page.drawRectangle({
    x: PAGE.marginLeft,
    y: y - 40,
    width: 200,
    height: 40,
    borderColor: COLOURS.border,
    borderWidth: 0.5,
  })
  page.drawText('Inspector Signature', {
    x: PAGE.marginLeft + 4, y: y - 12, size: FONT.label, font, color: COLOURS.muted,
  })

  page.drawRectangle({
    x: PAGE.marginLeft + CONTENT_WIDTH / 2,
    y: y - 40,
    width: 200,
    height: 40,
    borderColor: COLOURS.border,
    borderWidth: 0.5,
  })
  page.drawText('Qualified Supervisor Signature', {
    x: PAGE.marginLeft + CONTENT_WIDTH / 2 + 4, y: y - 12, size: FONT.label, font, color: COLOURS.muted,
  })

  y -= 48
  y = drawFieldPair(page, font, fontBold, y,
    { label: 'QS Name', value: fmt(cert.declaration?.qsName) },
    { label: 'QS Date', value: fmtDate(cert.declaration?.qsDate) }
  )

  drawPageFooter(page, font)
}

// ============================================================
// PAGE 3: SECTIONS I–J
// ============================================================

function drawPage3(ctx: PDFContext, cert: Partial<EICRCertificate>, pageNum: number, totalPages: number): void {
  const { page, y: startY } = addPage(ctx, pageNum, totalPages)
  const { font, fontBold } = ctx
  let y = startY

  const supply = cert.supplyCharacteristics
  const parts = cert.installationParticulars

  // Section I
  y = drawSectionHeader(page, fontBold, y, 'Section I — Supply Characteristics and Earthing Arrangements')
  y = drawFieldPair(page, font, fontBold, y,
    { label: 'Earthing System', value: fmtEarthing(supply?.earthingType) },
    { label: 'Supply Type', value: fmt(supply?.supplyType) }
  )
  y = drawFieldPair(page, font, fontBold, y,
    { label: 'Conductor Config.', value: fmtConductorConfig(supply?.conductorConfig) },
    { label: 'Polarity Confirmed', value: fmtBool(supply?.supplyPolarityConfirmed) }
  )
  y = drawFieldPair(page, font, fontBold, y,
    { label: 'Nominal Voltage', value: supply?.nominalVoltage != null ? `${supply.nominalVoltage}V` : '—' },
    { label: 'Nominal Frequency', value: supply?.nominalFrequency != null ? `${supply.nominalFrequency}Hz` : '—' }
  )
  y = drawFieldPair(page, font, fontBold, y,
    { label: 'PFC (Ipf)', value: supply?.ipf != null ? `${supply.ipf} kA` : '—' },
    { label: 'Ze', value: supply?.ze != null ? `${supply.ze}Ω` : '—' }
  )
  y = drawFieldPair(page, font, fontBold, y,
    { label: 'Supply Device BS(EN)', value: fmt(supply?.supplyDeviceBsEn) },
    { label: 'Supply Device Type', value: fmt(supply?.supplyDeviceType) }
  )
  y = drawField(page, font, fontBold, y, 'Supply Device Rating', supply?.supplyDeviceRating != null ? `${supply.supplyDeviceRating}A` : '—')

  if (supply?.otherSourcesPresent) {
    y = drawField(page, font, fontBold, y, 'Other Sources', fmt(supply.otherSourcesDescription, 'Present'))
  }
  y -= 4

  // Section J
  y = drawSectionHeader(page, fontBold, y, 'Section J — Particulars of Installation at the Origin')
  y = drawFieldPair(page, font, fontBold, y,
    { label: 'Main Switch Location', value: fmt(parts?.mainSwitchLocation) },
    { label: 'Main Switch BS(EN)', value: fmt(parts?.mainSwitchBsEn) }
  )
  y = drawFieldPair(page, font, fontBold, y,
    { label: 'No. of Poles', value: fmt(parts?.mainSwitchPoles) },
    { label: 'Current Rating', value: parts?.mainSwitchCurrentRating != null ? `${parts.mainSwitchCurrentRating}A` : '—' }
  )
  y = drawFieldPair(page, font, fontBold, y,
    { label: 'Device Rating', value: parts?.mainSwitchDeviceRating != null ? `${parts.mainSwitchDeviceRating}A` : '—' },
    { label: 'Voltage Rating', value: parts?.mainSwitchVoltageRating != null ? `${parts.mainSwitchVoltageRating}V` : '—' }
  )

  if (parts?.mainSwitchRcdType) {
    y = drawFieldPair(page, font, fontBold, y,
      { label: 'Main RCD Type', value: fmt(parts.mainSwitchRcdType) },
      { label: 'RCD IΔn', value: parts.mainSwitchRcdRating != null ? `${parts.mainSwitchRcdRating}mA` : '—' }
    )
  }

  y -= 4
  drawHorizontalRule(page, y + 4)
  y -= 4

  y = drawFieldPair(page, font, fontBold, y,
    { label: 'Distributor Facility', value: fmtBool(parts?.distributorFacility) },
    { label: 'Installation Electrode', value: fmtBool(parts?.installationElectrode) }
  )

  if (parts?.installationElectrode) {
    y = drawFieldPair(page, font, fontBold, y,
      { label: 'Electrode Type', value: fmt(parts.electrodeType) },
      { label: 'Electrode Resistance', value: parts.electrodeResistance != null ? `${parts.electrodeResistance}Ω` : '—' }
    )
  }

  y = drawFieldPair(page, font, fontBold, y,
    { label: 'Earthing Cond. Material', value: fmt(parts?.earthingConductorMaterial) },
    { label: 'Earthing Cond. CSA', value: parts?.earthingConductorCsa != null ? `${parts.earthingConductorCsa}mm²` : '—' }
  )
  y = drawField(page, font, fontBold, y, 'Earthing Cond. Verified', fmtBool(parts?.earthingConductorVerified))

  y = drawFieldPair(page, font, fontBold, y,
    { label: 'Bonding Cond. Material', value: fmt(parts?.bondingConductorMaterial) },
    { label: 'Bonding Cond. CSA', value: parts?.bondingConductorCsa != null ? `${parts.bondingConductorCsa}mm²` : '—' }
  )
  y = drawField(page, font, fontBold, y, 'Bonding Cond. Verified', fmtBool(parts?.bondingConductorVerified))

  y -= 4
  drawHorizontalRule(page, y + 4)
  y -= 4

  page.drawText('Bonding of Extraneous-Conductive-Parts', {
    x: PAGE.marginLeft, y, size: FONT.label, font, color: COLOURS.muted,
  })
  y -= 12
  y = drawFieldPair(page, font, fontBold, y,
    { label: 'Water', value: fmtBonding(parts?.bondingWater) },
    { label: 'Gas', value: fmtBonding(parts?.bondingGas) }
  )
  y = drawFieldPair(page, font, fontBold, y,
    { label: 'Oil', value: fmtBonding(parts?.bondingOil) },
    { label: 'Structural Steel', value: fmtBonding(parts?.bondingSteel) }
  )
  y = drawFieldPair(page, font, fontBold, y,
    { label: 'Lightning Protection', value: fmtBonding(parts?.bondingLightning) },
    { label: 'Other', value: fmtBonding(parts?.bondingOther) }
  )

  if (parts?.bondingOtherDescription) {
    y = drawField(page, font, fontBold, y, 'Other Description', parts.bondingOtherDescription)
  }

  drawPageFooter(page, font)
}

// ============================================================
// DYNAMIC PAGES: OBSERVATIONS (Section K)
// ============================================================

function drawObservationsPages(
  ctx: PDFContext,
  observations: Observation[],
  startPageNum: number,
  totalPages: number
): number {
  if (observations.length === 0) return startPageNum

  const columns = [
    { label: '#', width: 25, align: 'center' as const },
    { label: 'Observation', width: 200, align: 'left' as const },
    { label: 'Code', width: 35, align: 'center' as const },
    { label: 'Location', width: 75, align: 'left' as const },
    { label: 'Regulation', width: 65, align: 'left' as const },
    { label: 'Remedial Action', width: CONTENT_WIDTH - 400, align: 'left' as const },
  ]

  let pageNum = startPageNum
  let { page, y } = addPage(ctx, pageNum, totalPages)
  y = drawSectionHeader(page, ctx.fontBold, y, 'Section K — Observations and Recommendations')
  y = drawTableHeader(page, ctx.fontBold, y, columns)

  for (let i = 0; i < observations.length; i++) {
    const obs = observations[i]
    if (!obs) continue

    if (needsNewPage(y, SPACING.tableRowHeight + 4)) {
      drawPageFooter(page, ctx.font)
      pageNum++
      const newPage = addPage(ctx, pageNum, totalPages)
      page = newPage.page
      y = newPage.y
      y = drawSectionHeader(page, ctx.fontBold, y, 'Section K — Observations (continued)')
      y = drawTableHeader(page, ctx.fontBold, y, columns)
    }

    y = drawTableRow(
      page,
      ctx.font,
      y,
      columns,
      [
        String(obs.itemNumber ?? i + 1),
        obs.observationText ?? '',
        obs.classificationCode ?? '',
        obs.location ?? '',
        obs.regulationReference ?? '',
        obs.remedialAction ?? '',
      ],
      {
        isAlt: i % 2 === 1,
        textColour: obs.classificationCode ? getCodeColour(obs.classificationCode) : undefined,
      }
    )
  }

  // Summary counts
  y -= 10
  if (!needsNewPage(y, 30)) {
    const counts: Record<ClassificationCode, number> = { C1: 0, C2: 0, C3: 0, FI: 0 }
    for (const o of observations) {
      if (o.classificationCode && counts[o.classificationCode] !== undefined) {
        counts[o.classificationCode]++
      }
    }

    const summaryText = `C1: ${counts.C1}  ·  C2: ${counts.C2}  ·  C3: ${counts.C3}  ·  FI: ${counts.FI}  ·  Total: ${observations.length}`
    page.drawText(summaryText, {
      x: PAGE.marginLeft, y, size: FONT.value, font: ctx.fontBold, color: COLOURS.text,
    })
  }

  drawPageFooter(page, ctx.font)
  return pageNum
}

// ============================================================
// DYNAMIC PAGES: INSPECTION SCHEDULE
// ============================================================

function drawChecklistPages(
  ctx: PDFContext,
  items: InspectionItem[],
  startPageNum: number,
  totalPages: number
): number {
  if (items.length === 0) return startPageNum

  const columns = [
    { label: 'Ref', width: 35, align: 'left' as const },
    { label: 'Description', width: 280, align: 'left' as const },
    { label: 'Reg.', width: 70, align: 'left' as const },
    { label: 'Outcome', width: 45, align: 'center' as const },
    { label: 'Notes', width: CONTENT_WIDTH - 430, align: 'left' as const },
  ]

  let pageNum = startPageNum
  let { page, y } = addPage(ctx, pageNum, totalPages)
  y = drawSectionHeader(page, ctx.fontBold, y, 'Schedule of Inspections')
  y = drawTableHeader(page, ctx.fontBold, y, columns)

  let currentSection = -1

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (!item) continue

    // Section divider row
    if (item.section !== currentSection) {
      currentSection = item.section

      if (needsNewPage(y, SPACING.tableRowHeight * 2 + 4)) {
        drawPageFooter(page, ctx.font)
        pageNum++
        const newPage = addPage(ctx, pageNum, totalPages)
        page = newPage.page
        y = newPage.y
        y = drawSectionHeader(page, ctx.fontBold, y, 'Schedule of Inspections (continued)')
        y = drawTableHeader(page, ctx.fontBold, y, columns)
      }

      const sectionRowY = y - SPACING.tableRowHeight
      page.drawRectangle({
        x: PAGE.marginLeft,
        y: sectionRowY,
        width: CONTENT_WIDTH,
        height: SPACING.tableRowHeight,
        color: COLOURS.rowAlt,
      })
      page.drawText(`${item.section}. ${item.sectionTitle ?? ''}`, {
        x: PAGE.marginLeft + 3,
        y: sectionRowY + 4,
        size: FONT.tableBody,
        font: ctx.fontBold,
        color: COLOURS.accent,
      })
      y = sectionRowY
    }

    if (needsNewPage(y, SPACING.tableRowHeight + 4)) {
      drawPageFooter(page, ctx.font)
      pageNum++
      const newPage = addPage(ctx, pageNum, totalPages)
      page = newPage.page
      y = newPage.y
      y = drawSectionHeader(page, ctx.fontBold, y, 'Schedule of Inspections (continued)')
      y = drawTableHeader(page, ctx.fontBold, y, columns)
    }

    let outcomeText = '—'
    let outcomeColour = COLOURS.text
    if (item.outcome) {
      const outcomeMap: Record<string, string> = {
        PASS: '✓', C1: 'C1', C2: 'C2', C3: 'C3', FI: 'FI', NV: 'N/V', LIM: 'LIM', NA: 'N/A',
      }
      outcomeText = outcomeMap[item.outcome] ?? item.outcome
      if (item.outcome === 'PASS') outcomeColour = COLOURS.pass
      else if (item.outcome === 'C1') outcomeColour = COLOURS.c1
      else if (item.outcome === 'C2') outcomeColour = COLOURS.c2
      else outcomeColour = COLOURS.text
    }

    y = drawTableRow(
      page,
      ctx.font,
      y,
      columns,
      [
        item.itemRef ?? '',
        item.description ?? '',
        item.regulationRef ?? '',
        outcomeText,
        item.notes ?? '',
      ],
      {
        isAlt: i % 2 === 1,
        textColour: outcomeColour,
      }
    )
  }

  drawPageFooter(page, ctx.font)
  return pageNum
}

// ============================================================
// DYNAMIC PAGES: CIRCUIT TEST RESULTS
// ============================================================

function drawCircuitPages(
  ctx: PDFContext,
  cert: Partial<EICRCertificate>,
  startPageNum: number,
  totalPages: number
): number {
  const circuits = cert.circuits ?? []
  const boards = cert.distributionBoards ?? []
  if (circuits.length === 0) return startPageNum

  let pageNum = startPageNum

  for (const board of boards) {
    const boardCircuits = circuits.filter((c) => c.dbId === board.dbReference)
    if (boardCircuits.length === 0) continue

    let { page, y } = addPage(ctx, pageNum, totalPages)

    y = drawSectionHeader(
      page,
      ctx.fontBold,
      y,
      `Schedule of Circuit Details and Test Results — ${board.dbReference} (${board.dbLocation || 'No location'})`
    )

    if (board.zsAtDb != null || board.ipfAtDb != null) {
      const meta = [
        board.zsAtDb != null ? `Zs at DB: ${board.zsAtDb}Ω` : '',
        board.ipfAtDb != null ? `Ipf at DB: ${board.ipfAtDb}kA` : '',
        board.spdType && board.spdType !== 'NA' ? `SPD: ${board.spdType}` : '',
      ]
        .filter(Boolean)
        .join('  ·  ')

      page.drawText(meta, {
        x: PAGE.marginLeft, y, size: FONT.small, font: ctx.font, color: COLOURS.muted,
      })
      y -= 12
    }

    // Row A: Circuit Identity columns
    const colsA = [
      { label: 'Cct', width: 28, align: 'center' as const },
      { label: 'Description', width: 100, align: 'left' as const },
      { label: 'Wiring', width: 30, align: 'center' as const },
      { label: 'Ref', width: 22, align: 'center' as const },
      { label: 'Pts', width: 22, align: 'center' as const },
      { label: 'Live', width: 28, align: 'center' as const },
      { label: 'CPC', width: 28, align: 'center' as const },
      { label: 'Type', width: 25, align: 'center' as const },
      { label: 'Rating', width: 30, align: 'center' as const },
      { label: 'kA', width: 25, align: 'center' as const },
      { label: 'RCD', width: 25, align: 'center' as const },
      { label: 'IΔn', width: 28, align: 'center' as const },
      { label: 'Max Zs', width: 36, align: 'center' as const },
      { label: 'Meas Zs', width: CONTENT_WIDTH - 427, align: 'center' as const },
    ]

    // Row B: Test Results columns
    const colsB = [
      { label: 'r1', width: 35, align: 'center' as const },
      { label: 'rn', width: 35, align: 'center' as const },
      { label: 'r2', width: 35, align: 'center' as const },
      { label: 'R1+R2', width: 38, align: 'center' as const },
      { label: 'IR L-L', width: 38, align: 'center' as const },
      { label: 'IR L-E', width: 38, align: 'center' as const },
      { label: 'Pol', width: 28, align: 'center' as const },
      { label: 'RCD ms', width: 38, align: 'center' as const },
      { label: 'RCD Btn', width: 38, align: 'center' as const },
      { label: 'AFDD', width: 32, align: 'center' as const },
      { label: 'Remarks', width: CONTENT_WIDTH - 355, align: 'left' as const },
    ]

    y = drawTableHeader(page, ctx.fontBold, y, colsA)

    for (let i = 0; i < boardCircuits.length; i++) {
      const c = boardCircuits[i]
      if (!c) continue

      // Need space for 2 rows (A + B header + B row)
      const neededHeight = SPACING.tableRowHeight * 3 + SPACING.tableHeaderHeight + 8
      if (needsNewPage(y, neededHeight)) {
        drawPageFooter(page, ctx.font)
        pageNum++
        const newPage = addPage(ctx, pageNum, totalPages)
        page = newPage.page
        y = newPage.y
        y = drawSectionHeader(page, ctx.fontBold, y, `Circuit Details — ${board.dbReference} (continued)`)
        y = drawTableHeader(page, ctx.fontBold, y, colsA)
      }

      // Row A values
      y = drawTableRow(page, ctx.font, y, colsA, [
        fmt(c.circuitNumber),
        fmt(c.circuitDescription),
        fmt(c.wiringType),
        fmt(c.referenceMethod),
        fmt(c.numberOfPoints),
        c.liveConductorCsa != null ? String(c.liveConductorCsa) : '—',
        c.cpcCsa != null ? String(c.cpcCsa) : '—',
        fmt(c.ocpdType),
        c.ocpdRating != null ? String(c.ocpdRating) : '—',
        c.breakingCapacity != null ? String(c.breakingCapacity) : '—',
        fmt(c.rcdType),
        c.rcdRating != null ? String(c.rcdRating) : '—',
        c.maxPermittedZs != null ? c.maxPermittedZs.toFixed(2) : '—',
        c.zs != null ? c.zs.toFixed(2) : '—',
      ], { isAlt: i % 2 === 1 })

      // Row B header + values
      y = drawTableHeader(page, ctx.fontBold, y, colsB)

      y = drawTableRow(page, ctx.font, y, colsB, [
        fmtTestValue(c.r1),
        fmtTestValue(c.rn),
        fmtTestValue(c.r2),
        fmtTestValue(c.r1r2),
        fmtTestValue(c.irLiveLive),
        fmtTestValue(c.irLiveEarth),
        fmtTickStatus(c.polarity),
        c.rcdDisconnectionTime != null ? String(c.rcdDisconnectionTime) : '—',
        fmtTickStatus(c.rcdTestButton),
        fmtTickStatus(c.afddTestButton),
        fmt(c.remarks),
      ], { isAlt: i % 2 === 1 })

      y -= 4
    }

    drawPageFooter(page, ctx.font)
    pageNum++
  }

  // We incremented one too many at the end
  return pageNum - 1
}

// ============================================================
// PRE-CALCULATE TOTAL PAGES
// ============================================================

function estimateTotalPages(cert: Partial<EICRCertificate>): number {
  let pages = 3

  const obsCount = cert.observations?.length ?? 0
  if (obsCount > 0) pages += Math.ceil(obsCount / 35)

  const checklistCount = cert.inspectionSchedule?.length ?? 0
  if (checklistCount > 0) pages += Math.ceil(checklistCount / 40)

  const circuitCount = cert.circuits?.length ?? 0
  if (circuitCount > 0) pages += Math.ceil(circuitCount / 8)

  return Math.max(pages, 3)
}

// ============================================================
// MAIN EXPORT
// ============================================================

/**
 * Generate a complete EICR PDF from certificate data.
 * Returns a Uint8Array of the PDF bytes.
 */
export async function generateEICRPdf(cert: Partial<EICRCertificate>): Promise<Uint8Array> {
  const doc = await PDFDocument.create()

  const font = await doc.embedFont(StandardFonts.Helvetica)
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold)

  const reportNumber = cert.reportNumber ?? 'DRAFT'
  const totalPages = estimateTotalPages(cert)

  const ctx: PDFContext = { doc, font, fontBold, reportNumber, pages: [] }

  // Fixed pages
  drawPage1(ctx, cert, 1, totalPages)
  drawPage2(ctx, cert, 2, totalPages)
  drawPage3(ctx, cert, 3, totalPages)

  // Dynamic pages
  let nextPage = 4

  if ((cert.observations?.length ?? 0) > 0) {
    nextPage = drawObservationsPages(ctx, cert.observations!, nextPage, totalPages) + 1
  }

  if ((cert.inspectionSchedule?.length ?? 0) > 0) {
    nextPage = drawChecklistPages(ctx, cert.inspectionSchedule!, nextPage, totalPages) + 1
  }

  if ((cert.circuits?.length ?? 0) > 0) {
    drawCircuitPages(ctx, cert, nextPage, totalPages)
  }

  // Metadata
  doc.setTitle(`EICR ${reportNumber}`)
  doc.setAuthor(cert.declaration?.inspectorName ?? 'CertVoice')
  doc.setSubject('Electrical Installation Condition Report')
  doc.setCreator('CertVoice — certvoice.co.uk')
  doc.setProducer('pdf-lib')
  doc.setCreationDate(new Date())

  return doc.save()
}

/**
 * Generate and trigger browser download of the EICR PDF.
 */
export async function downloadEICRPdf(
  cert: Partial<EICRCertificate>,
  filename?: string
): Promise<void> {
  const bytes = await generateEICRPdf(cert)

  // Copy into a plain ArrayBuffer to satisfy strict BlobPart typing
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)

  const blob = new Blob([buffer], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)

  const reportNum = cert.reportNumber ?? 'DRAFT'
  const name = filename ?? `EICR-${reportNum}.pdf`

  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)

  setTimeout(() => URL.revokeObjectURL(url), 5000)
}
