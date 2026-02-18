/**
 * CertVoice — EICR PDF Generator (Client-Side)
 *
 * Generates official BS 7671:2018+A2:2022 compliant EICR certificates
 * using pdf-lib. Runs entirely in the browser — works offline.
 *
 * Pages:
 *   1. Sections A-D (client, reason, installation, extent/limitations)
 *   2. Sections E-G (summary, recommendations, declaration + signatures)
 *   3. Sections I-J (supply characteristics, installation particulars)
 *   4+. Section K observations table (dynamic, overflows)
 *   N+. Schedule of inspections checklist (dynamic, overflows)
 *   N+. Circuit test results schedule (dynamic, overflows)
 *
 * Signatures:
 *   Fetches PNG images from R2 via worker. Falls back to
 *   "[Signature on file]" if offline or fetch fails.
 *
 * @module services/pdfGenerator
 */

import { PDFDocument, StandardFonts, type PDFPage, type PDFFont } from 'pdf-lib'
import type { EICRCertificate } from '../types/eicr'
import {
  PAGE,
  CONTENT_WIDTH,
  COLOURS,
  FONT,
  SPACING,
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
// SIGNATURE FETCHER
// ============================================================

const R2_BASE_URL = import.meta.env.VITE_R2_BASE_URL ?? import.meta.env.VITE_API_BASE_URL ?? ''

/**
 * Fetch a signature PNG from R2 as raw bytes.
 * Returns null on any failure (offline, auth expired, etc.)
 */
async function fetchSignaturePng(key: string): Promise<Uint8Array | null> {
  try {
    const clerk = (
      window as unknown as {
        Clerk?: { session?: { getToken: () => Promise<string | null> } | null }
      }
    ).Clerk
    const token = clerk?.session ? await clerk.session.getToken() : null
    if (!token) return null

    const res = await fetch(`${BASE_URL}/api/download-url`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ key }),
    })

    if (!res.ok) return null

    const blob = await res.blob()
    const buffer = await blob.arrayBuffer()
    return new Uint8Array(buffer)
  } catch {
    return null
  }
}

// ============================================================
// TYPES
// ============================================================

interface FontSet {
  regular: PDFFont
  bold: PDFFont
}

interface SignatureImages {
  inspector: Uint8Array | null
  qs: Uint8Array | null
}

// ============================================================
// PAGE HEADER (sequential — no totalPages needed)
// ============================================================

function drawHeader(
  page: PDFPage,
  fonts: FontSet,
  reportNumber: string,
  pageNum: number,
): number {
  const y = PAGE.height - PAGE.marginTop

  page.drawRectangle({
    x: PAGE.marginLeft,
    y: y - SPACING.pageHeaderHeight,
    width: CONTENT_WIDTH,
    height: SPACING.pageHeaderHeight,
    color: COLOURS.headerBg,
  })

  page.drawText('ELECTRICAL INSTALLATION CONDITION REPORT', {
    x: PAGE.marginLeft + 10,
    y: y - 20,
    size: 11,
    font: fonts.bold,
    color: COLOURS.white,
  })

  page.drawText('In accordance with BS 7671:2018+A2:2022', {
    x: PAGE.marginLeft + 10,
    y: y - 33,
    size: FONT.small,
    font: fonts.regular,
    color: COLOURS.muted,
  })

  const reportText = `Report: ${reportNumber || '—'}`
  const rw = fonts.bold.widthOfTextAtSize(reportText, FONT.reportNumber)
  page.drawText(reportText, {
    x: PAGE.width - PAGE.marginRight - rw - 10,
    y: y - 20,
    size: FONT.reportNumber,
    font: fonts.bold,
    color: COLOURS.accent,
  })

  const pageText = `Page ${pageNum}`
  const pw = fonts.regular.widthOfTextAtSize(pageText, FONT.pageNumber)
  page.drawText(pageText, {
    x: PAGE.width - PAGE.marginRight - pw - 10,
    y: y - 33,
    size: FONT.pageNumber,
    font: fonts.regular,
    color: COLOURS.muted,
  })

  return y - SPACING.pageHeaderHeight - SPACING.sectionGap
}

// ============================================================
// PAGE 1: SECTIONS A-D
// ============================================================

function drawClientInstallationPage(
  pdfDoc: PDFDocument,
  cert: EICRCertificate,
  fonts: FontSet,
): PDFPage {
  const page = pdfDoc.addPage([PAGE.width, PAGE.height])
  let y = drawHeader(page, fonts, cert.reportNumber, 1)

  // --- Section A: Client Details ---
  y = drawSectionHeader(page, fonts.bold, y, 'Section A — Details of the Client')
  y = drawField(page, fonts.regular, fonts.bold, y, 'Client Name', cert.clientDetails.clientName)
  y = drawField(page, fonts.regular, fonts.bold, y, 'Client Address', cert.clientDetails.clientAddress)
  y -= SPACING.sectionGap

  // --- Section B: Purpose of Report ---
  y = drawSectionHeader(page, fonts.bold, y, 'Section B — Purpose of the Report')

  const purposeMap: Record<string, string> = {
    PERIODIC: 'Periodic inspection',
    CHANGE_OF_OCCUPANCY: 'Change of occupancy',
    MORTGAGE: 'Mortgage / sale',
    INSURANCE: 'Insurance requirement',
    SAFETY_CONCERN: 'Safety concern',
    OTHER: 'Other',
  }
  y = drawField(page, fonts.regular, fonts.bold, y, 'Purpose', purposeMap[cert.reportReason.purpose] ?? cert.reportReason.purpose)

  const dates = cert.reportReason.inspectionDates
    .map((d) => {
      try { return new Date(d).toLocaleDateString('en-GB') } catch { return d }
    })
    .join(', ')
  y = drawField(page, fonts.regular, fonts.bold, y, 'Date(s) of Inspection', dates || '—')
  y -= SPACING.sectionGap

  // --- Section C: Installation Details ---
  y = drawSectionHeader(page, fonts.bold, y, 'Section C — Details of the Installation')
  y = drawField(page, fonts.regular, fonts.bold, y, 'Installation Address', cert.installationDetails.installationAddress)
  y = drawField(page, fonts.regular, fonts.bold, y, 'Occupier', cert.installationDetails.occupier)

  const premisesMap: Record<string, string> = {
    DOMESTIC: 'Domestic', COMMERCIAL: 'Commercial', INDUSTRIAL: 'Industrial',
    OTHER: cert.installationDetails.otherDescription ?? 'Other',
  }
  y = drawField(page, fonts.regular, fonts.bold, y, 'Type of Premises', premisesMap[cert.installationDetails.premisesType] ?? '—')

  y = drawFieldPair(page, fonts.regular, fonts.bold, y,
    { label: 'Est. Age of Wiring', value: cert.installationDetails.estimatedAgeOfWiring != null ? `${cert.installationDetails.estimatedAgeOfWiring} years` : '—' },
    { label: 'Additions/Alterations', value: cert.installationDetails.evidenceOfAdditions ? 'Yes' : 'No' },
  )

  if (cert.installationDetails.evidenceOfAdditions && cert.installationDetails.additionsEstimatedAge != null) {
    y = drawField(page, fonts.regular, fonts.bold, y, 'Est. Age of Additions', `${cert.installationDetails.additionsEstimatedAge} years`)
  }

  y = drawFieldPair(page, fonts.regular, fonts.bold, y,
    { label: 'Previous Records', value: cert.installationDetails.installationRecordsAvailable ? 'Available' : 'Not available' },
    { label: 'Date of Last Inspection', value: cert.installationDetails.dateOfLastInspection ? new Date(cert.installationDetails.dateOfLastInspection).toLocaleDateString('en-GB') : 'N/A' },
  )
  y -= SPACING.sectionGap

  // --- Section D: Extent and Limitations ---
  y = drawSectionHeader(page, fonts.bold, y, 'Section D — Extent and Limitations')
  y = drawField(page, fonts.regular, fonts.bold, y, 'Extent Covered', cert.extentAndLimitations.extentCovered)
  y = drawField(page, fonts.regular, fonts.bold, y, 'Agreed Limitations', cert.extentAndLimitations.agreedLimitations)
  y = drawField(page, fonts.regular, fonts.bold, y, 'Agreed With', cert.extentAndLimitations.agreedWith)
  y = drawField(page, fonts.regular, fonts.bold, y, 'Operational Limitations', cert.extentAndLimitations.operationalLimitations)

  drawPageFooter(page, fonts.regular)
  return page
}

// ============================================================
// PAGE 2: SECTIONS E-G (DECLARATION + SIGNATURES)
// ============================================================

async function drawDeclarationPage(
  pdfDoc: PDFDocument,
  cert: EICRCertificate,
  fonts: FontSet,
  sigImages: SignatureImages,
): Promise<PDFPage> {
  const page = pdfDoc.addPage([PAGE.width, PAGE.height])
  let y = drawHeader(page, fonts, cert.reportNumber, 2)

  // --- Section E: Summary of Condition ---
  y = drawSectionHeader(page, fonts.bold, y, 'Section E — Summary of the Condition of the Installation')
  y = drawField(page, fonts.regular, fonts.bold, y, 'General Condition', cert.summaryOfCondition.generalCondition)

  const assessment = cert.summaryOfCondition.overallAssessment
  const assessColour = assessment === 'SATISFACTORY' ? COLOURS.pass : COLOURS.fail
  y = drawField(page, fonts.regular, fonts.bold, y, 'Overall Assessment', assessment || '—', { valueColour: assessColour })
  y -= SPACING.sectionGap

  // --- Section F: Recommendations ---
  y = drawSectionHeader(page, fonts.bold, y, 'Section F — Recommendations')

  const nextDate = cert.recommendations.nextInspectionDate
  y = drawField(page, fonts.regular, fonts.bold, y, 'Next Inspection Date', nextDate ? new Date(nextDate).toLocaleDateString('en-GB') : '—')
  y = drawField(page, fonts.regular, fonts.bold, y, 'Reason for Interval', cert.recommendations.reasonForInterval)
  y = drawField(page, fonts.regular, fonts.bold, y, 'Remedial Urgency', cert.recommendations.remedialUrgency)
  y -= SPACING.sectionGap

  // --- Section G: Declaration ---
  y = drawSectionHeader(page, fonts.bold, y, 'Section G — Declaration')

  // Declaration text
  const declText = 'I/We, being the person(s) responsible for the inspection and testing of the electrical installation, particulars of which are described in this report, having exercised reasonable skill and care when carrying out the inspection and testing, hereby declare that the information in this report, including the observations and the attached schedules, provides an accurate assessment of the condition of the electrical installation.'
  const declLines = wrapText(declText, fonts.regular, FONT.label, CONTENT_WIDTH)
  for (const line of declLines) {
    page.drawText(line, {
      x: PAGE.marginLeft,
      y,
      size: FONT.label,
      font: fonts.regular,
      color: COLOURS.text,
    })
    y -= 10
  }
  y -= 6

  // Inspector details
  const decl = cert.declaration

  y = drawField(page, fonts.regular, fonts.bold, y, 'Inspector Name', decl.inspectorName)
  y = drawFieldPair(page, fonts.regular, fonts.bold, y,
    { label: 'Position', value: decl.position },
    { label: 'Registration No', value: decl.registrationNumber },
  )
  y = drawField(page, fonts.regular, fonts.bold, y, 'Company', decl.companyName)
  y = drawField(page, fonts.regular, fonts.bold, y, 'Company Address', decl.companyAddress)

  const inspDate = decl.dateInspected
  y = drawField(page, fonts.regular, fonts.bold, y, 'Date Inspected', inspDate ? new Date(inspDate).toLocaleDateString('en-GB') : '—')

  // Inspector signature
  if (sigImages.inspector) {
    page.drawText('Signature', { x: PAGE.marginLeft, y, size: FONT.label, font: fonts.regular, color: COLOURS.muted })
    try {
      const img = await pdfDoc.embedPng(sigImages.inspector)
      const h = 28
      const w = Math.min(h * (img.width / img.height), 150)
      page.drawImage(img, { x: PAGE.marginLeft + 130, y: y - h + 4, width: w, height: h })
    } catch {
      page.drawText('[Signature on file]', { x: PAGE.marginLeft + 130, y, size: FONT.value, font: fonts.bold, color: COLOURS.text })
    }
  } else {
    y = drawField(page, fonts.regular, fonts.bold, y, 'Signature', decl.inspectorSignatureKey ? '[Signature on file]' : '______________________')
  }
  y -= SPACING.fieldRowGap * 2

  // Divider
  drawHorizontalRule(page, y + 6)
  y -= 8

  // QS details
  y = drawField(page, fonts.regular, fonts.bold, y, 'QS Name', decl.qsName)

  const qsDate = decl.qsDate
  y = drawField(page, fonts.regular, fonts.bold, y, 'Date Authorised', qsDate ? new Date(qsDate).toLocaleDateString('en-GB') : '—')

  // QS signature
  if (sigImages.qs) {
    page.drawText('Signature', { x: PAGE.marginLeft, y, size: FONT.label, font: fonts.regular, color: COLOURS.muted })
    try {
      const img = await pdfDoc.embedPng(sigImages.qs)
      const h = 28
      const w = Math.min(h * (img.width / img.height), 150)
      page.drawImage(img, { x: PAGE.marginLeft + 130, y: y - h + 4, width: w, height: h })
    } catch {
      page.drawText('[Signature on file]', { x: PAGE.marginLeft + 130, y, size: FONT.value, font: fonts.bold, color: COLOURS.text })
    }
  } else {
    drawField(page, fonts.regular, fonts.bold, y, 'Signature', decl.qsSignatureKey ? '[Signature on file]' : '______________________')
  }

  drawPageFooter(page, fonts.regular)
  return page
}

// ============================================================
// PAGE 3: SECTIONS I-J (SUPPLY + PARTICULARS)
// ============================================================

function drawSupplyPage(
  pdfDoc: PDFDocument,
  cert: EICRCertificate,
  fonts: FontSet,
): PDFPage {
  const page = pdfDoc.addPage([PAGE.width, PAGE.height])
  let y = drawHeader(page, fonts, cert.reportNumber, 3)

  const supply = cert.supplyCharacteristics
  const install = cert.installationParticulars

  // --- Section I: Supply Characteristics ---
  y = drawSectionHeader(page, fonts.bold, y, 'Section I — Supply Characteristics and Earthing Arrangements')

  const earthingMap: Record<string, string> = {
    TN_C: 'TN-C', TN_S: 'TN-S', TN_C_S: 'TN-C-S', TT: 'TT', IT: 'IT',
  }

  y = drawFieldPair(page, fonts.regular, fonts.bold, y,
    { label: 'Earthing System', value: earthingMap[supply.earthingType ?? ''] ?? '—' },
    { label: 'Supply Type', value: supply.supplyType },
  )

  const configMap: Record<string, string> = {
    '1PH_2WIRE': '1-phase 2-wire', '2PH_3WIRE': '2-phase 3-wire',
    '3PH_3WIRE': '3-phase 3-wire', '3PH_4WIRE': '3-phase 4-wire',
  }
  y = drawFieldPair(page, fonts.regular, fonts.bold, y,
    { label: 'Conductor Config', value: configMap[supply.conductorConfig] ?? '—' },
    { label: 'Nominal Voltage', value: supply.nominalVoltage != null ? `${supply.nominalVoltage}V` : '—' },
  )
  y = drawFieldPair(page, fonts.regular, fonts.bold, y,
    { label: 'Nominal Frequency', value: `${supply.nominalFrequency}Hz` },
    { label: 'Prospective Fault (Ipf)', value: supply.ipf != null ? `${supply.ipf} kA` : '—' },
  )
  y = drawFieldPair(page, fonts.regular, fonts.bold, y,
    { label: 'External Ze', value: supply.ze != null ? `${supply.ze}Ω` : '—' },
    { label: 'Polarity Confirmed', value: supply.supplyPolarityConfirmed ? 'Yes' : 'No' },
  )
  y = drawField(page, fonts.regular, fonts.bold, y, 'Other Sources', supply.otherSourcesPresent ? `Yes — ${supply.otherSourcesDescription ?? ''}` : 'No')
  y = drawFieldPair(page, fonts.regular, fonts.bold, y,
    { label: 'Supply Device BS(EN)', value: supply.supplyDeviceBsEn },
    { label: 'Supply Device Type', value: supply.supplyDeviceType },
  )
  y = drawField(page, fonts.regular, fonts.bold, y, 'Supply Device Rating', supply.supplyDeviceRating != null ? `${supply.supplyDeviceRating}A` : '—')
  y -= SPACING.sectionGap

  // --- Section J: Installation Particulars ---
  y = drawSectionHeader(page, fonts.bold, y, 'Section J — Particulars of the Installation at the Origin')

  y = drawField(page, fonts.regular, fonts.bold, y, 'Means of Earthing',
    install.distributorFacility ? 'Distributor facility' : install.installationElectrode ? 'Installation electrode' : '—')

  if (install.installationElectrode) {
    y = drawFieldPair(page, fonts.regular, fonts.bold, y,
      { label: 'Electrode Type', value: install.electrodeType ?? '—' },
      { label: 'Electrode Location', value: install.electrodeLocation ?? '—' },
    )
    y = drawField(page, fonts.regular, fonts.bold, y, 'Electrode Resistance', install.electrodeResistance != null ? `${install.electrodeResistance}Ω` : '—')
  }

  y = drawFieldPair(page, fonts.regular, fonts.bold, y,
    { label: 'Main Switch Location', value: install.mainSwitchLocation },
    { label: 'Main Switch BS(EN)', value: install.mainSwitchBsEn },
  )
  y = drawFieldPair(page, fonts.regular, fonts.bold, y,
    { label: 'Poles', value: install.mainSwitchPoles != null ? `${install.mainSwitchPoles}P` : '—' },
    { label: 'Current Rating', value: install.mainSwitchCurrentRating != null ? `${install.mainSwitchCurrentRating}A` : '—' },
  )

  y = drawFieldPair(page, fonts.regular, fonts.bold, y,
    { label: 'Earthing Conductor', value: `${install.earthingConductorMaterial} ${install.earthingConductorCsa != null ? `${install.earthingConductorCsa}mm²` : '—'} ${install.earthingConductorVerified ? '✓' : ''}` },
    { label: 'Bonding Conductor', value: `${install.bondingConductorMaterial} ${install.bondingConductorCsa != null ? `${install.bondingConductorCsa}mm²` : '—'} ${install.bondingConductorVerified ? '✓' : ''}` },
  )

  const bondItems = [
    ['Water', install.bondingWater],
    ['Gas', install.bondingGas],
    ['Oil', install.bondingOil],
    ['Steel', install.bondingSteel],
    ['Lightning', install.bondingLightning],
    ['Other', install.bondingOther],
  ] as const

  const bondStr = bondItems
    .filter(([, v]) => v !== 'NA')
    .map(([k, v]) => `${k}: ${v === 'SATISFACTORY' ? '✓' : '✗'}`)
    .join('  |  ')

  if (bondStr) {
    y = drawField(page, fonts.regular, fonts.bold, y, 'Bonding', bondStr)
  }

  drawPageFooter(page, fonts.regular)
  return page
}

// ============================================================
// DYNAMIC PAGES: OBSERVATIONS (SECTION K)
// ============================================================

function drawObservationsPages(
  pdfDoc: PDFDocument,
  cert: EICRCertificate,
  fonts: FontSet,
  startPage: number,
): number {
  const observations = cert.observations
  if (observations.length === 0) return startPage

  let page = pdfDoc.addPage([PAGE.width, PAGE.height])
  let pageNum = startPage
  let y = drawHeader(page, fonts, cert.reportNumber, pageNum)

  y = drawSectionHeader(page, fonts.bold, y, 'Section K — Observations and Recommendations')

  const columns = [
    { label: 'Item', width: 30, align: 'center' as const },
    { label: 'Code', width: 35, align: 'center' as const },
    { label: 'Observation', width: 220 },
    { label: 'Location', width: 65 },
    { label: 'Regulation', width: 80 },
    { label: 'Remedial Action', width: 85 },
  ]

  y = drawTableHeader(page, fonts.bold, y, columns)

  for (let i = 0; i < observations.length; i++) {
    const obs = observations[i]
    if (!obs) continue

    if (needsNewPage(y, SPACING.tableRowHeight)) {
      drawPageFooter(page, fonts.regular)
      page = pdfDoc.addPage([PAGE.width, PAGE.height])
      pageNum++
      y = drawHeader(page, fonts, cert.reportNumber, pageNum)
      y = drawSectionHeader(page, fonts.bold, y, 'Section K — Observations (continued)')
      y = drawTableHeader(page, fonts.bold, y, columns)
    }

    const codeColour = getCodeColour(obs.classificationCode)

    y = drawTableRow(
      page, fonts.regular, y,
      columns.map((c) => ({ width: c.width, align: c.align })),
      [
        String(obs.itemNumber),
        obs.classificationCode,
        (obs.observationText ?? '').substring(0, 60),
        (obs.location ?? '').substring(0, 15),
        obs.regulationReference ?? '',
        (obs.remedialAction ?? '').substring(0, 20),
      ],
      { isAlt: i % 2 === 1 },
    )

    // Redraw code cell with colour
    if (codeColour !== COLOURS.text) {
      const codeX = PAGE.marginLeft + (columns[0]?.width ?? 30)
      page.drawText(obs.classificationCode, {
        x: codeX + 3,
        y: y + 4,
        size: FONT.tableBody,
        font: fonts.bold,
        color: codeColour,
      })
    }
  }

  // Summary counts
  const summaryY = y - SPACING.sectionGap
  const c1 = observations.filter((o) => o.classificationCode === 'C1').length
  const c2 = observations.filter((o) => o.classificationCode === 'C2').length
  const c3 = observations.filter((o) => o.classificationCode === 'C3').length
  const fi = observations.filter((o) => o.classificationCode === 'FI').length

  page.drawText(`Summary: C1: ${c1}  |  C2: ${c2}  |  C3: ${c3}  |  FI: ${fi}  |  Total: ${observations.length}`, {
    x: PAGE.marginLeft,
    y: summaryY,
    size: FONT.label,
    font: fonts.bold,
    color: COLOURS.text,
  })

  drawPageFooter(page, fonts.regular)
  return pageNum + 1
}

// ============================================================
// DYNAMIC PAGES: INSPECTION SCHEDULE
// ============================================================

function drawInspectionPages(
  pdfDoc: PDFDocument,
  cert: EICRCertificate,
  fonts: FontSet,
  startPage: number,
): number {
  const items = cert.inspectionSchedule
  if (items.length === 0) return startPage

  let page = pdfDoc.addPage([PAGE.width, PAGE.height])
  let pageNum = startPage
  let y = drawHeader(page, fonts, cert.reportNumber, pageNum)

  y = drawSectionHeader(page, fonts.bold, y, 'Schedule of Inspections')

  let currentSection = -1

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (!item) continue

    if (needsNewPage(y, SPACING.fieldRowHeight * 2)) {
      drawPageFooter(page, fonts.regular)
      page = pdfDoc.addPage([PAGE.width, PAGE.height])
      pageNum++
      y = drawHeader(page, fonts, cert.reportNumber, pageNum)
      y = drawSectionHeader(page, fonts.bold, y, 'Schedule of Inspections (continued)')
    }

    if (item.section !== currentSection) {
      currentSection = item.section
      y -= 4
      page.drawText(item.sectionTitle, {
        x: PAGE.marginLeft,
        y,
        size: FONT.label,
        font: fonts.bold,
        color: COLOURS.accent,
      })
      y -= SPACING.fieldRowHeight
    }

    page.drawText(item.itemRef, {
      x: PAGE.marginLeft,
      y,
      size: FONT.tableBody,
      font: fonts.regular,
      color: COLOURS.muted,
    })

    page.drawText((item.description ?? '').substring(0, 70), {
      x: PAGE.marginLeft + 40,
      y,
      size: FONT.tableBody,
      font: fonts.regular,
      color: COLOURS.text,
    })

    const outcome = item.outcome ?? '—'
    const outcomeColour =
      outcome === 'PASS' ? COLOURS.pass
        : outcome === 'C1' ? COLOURS.fail
          : outcome === 'C2' ? COLOURS.c2
            : COLOURS.muted

    const outcomeText = outcome === 'PASS' ? '✓' : outcome
    const ow = fonts.bold.widthOfTextAtSize(outcomeText, FONT.tableBody)
    page.drawText(outcomeText, {
      x: PAGE.width - PAGE.marginRight - ow - 4,
      y,
      size: FONT.tableBody,
      font: fonts.bold,
      color: outcomeColour,
    })

    y -= SPACING.fieldRowHeight
  }

  drawPageFooter(page, fonts.regular)
  return pageNum + 1
}

// ============================================================
// DYNAMIC PAGES: CIRCUIT SCHEDULE
// ============================================================

function drawCircuitPages(
  pdfDoc: PDFDocument,
  cert: EICRCertificate,
  fonts: FontSet,
  startPage: number,
): number {
  const circuits = cert.circuits
  if (circuits.length === 0) return startPage

  let page = pdfDoc.addPage([PAGE.width, PAGE.height])
  let pageNum = startPage
  let y = drawHeader(page, fonts, cert.reportNumber, pageNum)

  y = drawSectionHeader(page, fonts.bold, y, 'Schedule of Circuit Details and Test Results')

  const ti = cert.testInstruments
  if (ti.multifunctionInstrument) {
    page.drawText(`Instruments: ${ti.multifunctionInstrument}`, {
      x: PAGE.marginLeft,
      y,
      size: FONT.small,
      font: fonts.regular,
      color: COLOURS.muted,
    })
    y -= SPACING.fieldRowHeight
  }

  const row1Cols = [
    { label: 'Cct', width: 28 },
    { label: 'Description', width: 90 },
    { label: 'Type', width: 24, align: 'center' as const },
    { label: 'Ref', width: 22, align: 'center' as const },
    { label: 'Pts', width: 24, align: 'center' as const },
    { label: 'Live', width: 28, align: 'center' as const },
    { label: 'CPC', width: 28, align: 'center' as const },
    { label: 'OCPD', width: 32, align: 'center' as const },
    { label: 'Rating', width: 34, align: 'center' as const },
    { label: 'RCD', width: 28, align: 'center' as const },
    { label: 'IΔn', width: 28, align: 'center' as const },
  ]

  const row2Cols = [
    { label: 'r1', width: 28, align: 'center' as const },
    { label: 'rn', width: 28, align: 'center' as const },
    { label: 'r2', width: 28, align: 'center' as const },
    { label: 'R1+R2', width: 36, align: 'center' as const },
    { label: 'IR V', width: 30, align: 'center' as const },
    { label: 'IR L-L', width: 36, align: 'center' as const },
    { label: 'IR L-E', width: 36, align: 'center' as const },
    { label: 'Zs', width: 34, align: 'center' as const },
    { label: 'Pol', width: 26, align: 'center' as const },
    { label: 'RCD ms', width: 38, align: 'center' as const },
    { label: 'Rmks', width: 46 },
  ]

  const boards = cert.distributionBoards

  for (const board of boards) {
    const boardCircuits = circuits.filter((c) => c.dbId === board.id)
    if (boardCircuits.length === 0) continue

    if (needsNewPage(y, SPACING.tableHeaderHeight * 3 + SPACING.tableRowHeight * 2)) {
      drawPageFooter(page, fonts.regular)
      page = pdfDoc.addPage([PAGE.width, PAGE.height])
      pageNum++
      y = drawHeader(page, fonts, cert.reportNumber, pageNum)
    }

    y -= 4
    page.drawRectangle({
      x: PAGE.marginLeft,
      y: y - 14,
      width: CONTENT_WIDTH,
      height: 18,
      color: COLOURS.headerBg,
    })
    page.drawText(`DB: ${board.dbReference} — ${board.dbLocation}  |  Zs at DB: ${board.zsAtDb ?? '—'}Ω  |  Ipf: ${board.ipfAtDb ?? '—'} kA`, {
      x: PAGE.marginLeft + 4,
      y: y - 10,
      size: FONT.tableBody,
      font: fonts.bold,
      color: COLOURS.white,
    })
    y -= 24

    y = drawTableHeader(page, fonts.bold, y, row1Cols)
    y = drawTableHeader(page, fonts.bold, y, row2Cols)

    for (let ci = 0; ci < boardCircuits.length; ci++) {
      const c = boardCircuits[ci]
      if (!c) continue

      if (needsNewPage(y, SPACING.tableRowHeight * 2 + 4)) {
        drawPageFooter(page, fonts.regular)
        page = pdfDoc.addPage([PAGE.width, PAGE.height])
        pageNum++
        y = drawHeader(page, fonts, cert.reportNumber, pageNum)
        y = drawSectionHeader(page, fonts.bold, y, `Circuit Schedule (continued) — ${board.dbReference}`)
        y = drawTableHeader(page, fonts.bold, y, row1Cols)
        y = drawTableHeader(page, fonts.bold, y, row2Cols)
      }

      const fmtVal = (v: number | string | null | undefined): string => {
        if (v == null) return '—'
        return String(v)
      }

      y = drawTableRow(
        page, fonts.regular, y,
        row1Cols.map((col) => ({ width: col.width, align: col.align })),
        [
          c.circuitNumber,
          (c.circuitDescription ?? '').substring(0, 18),
          c.wiringType ?? '—',
          c.referenceMethod ?? '—',
          fmtVal(c.numberOfPoints),
          fmtVal(c.liveConductorCsa),
          fmtVal(c.cpcCsa),
          `${c.ocpdType ?? ''}${c.ocpdRating ?? ''}`,
          c.ocpdBsEn ? c.ocpdBsEn.substring(0, 6) : '—',
          c.rcdType ?? '—',
          fmtVal(c.rcdRating),
        ],
        { isAlt: ci % 2 === 1 },
      )

      const zsExceeded = c.zs != null && c.maxPermittedZs != null && c.zs > c.maxPermittedZs

      y = drawTableRow(
        page, fonts.regular, y,
        row2Cols.map((col) => ({ width: col.width, align: col.align })),
        [
          fmtVal(c.r1),
          fmtVal(c.rn),
          fmtVal(c.r2),
          fmtVal(c.r1r2),
          fmtVal(c.irTestVoltage),
          fmtVal(c.irLiveLive),
          fmtVal(c.irLiveEarth),
          fmtVal(c.zs),
          c.polarity === 'TICK' ? '✓' : c.polarity === 'CROSS' ? '✗' : '—',
          fmtVal(c.rcdDisconnectionTime),
          (c.remarks ?? '').substring(0, 12),
        ],
        { isAlt: ci % 2 === 1, textColour: zsExceeded ? COLOURS.fail : undefined },
      )
    }
  }

  drawPageFooter(page, fonts.regular)
  return pageNum + 1
}

// ============================================================
// MAIN GENERATOR
// ============================================================

/**
 * Generate a complete EICR PDF from certificate data.
 * Returns raw bytes — use downloadEICRPdf() for browser download.
 */
export async function generateEICRPdf(cert: EICRCertificate): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create()

  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
  const fonts: FontSet = { regular, bold }

  pdfDoc.setTitle(`EICR Report ${cert.reportNumber}`)
  pdfDoc.setAuthor(cert.declaration.inspectorName || 'CertVoice')
  pdfDoc.setSubject('Electrical Installation Condition Report')
  pdfDoc.setCreator('CertVoice — certvoice.co.uk')
  pdfDoc.setCreationDate(new Date())

  // Page 1: Sections A-D
  drawClientInstallationPage(pdfDoc, cert, fonts)

  // Fetch signatures (graceful fallback if offline)
  const [inspSig, qsSig] = await Promise.all([
    cert.declaration.inspectorSignatureKey
      ? fetchSignaturePng(cert.declaration.inspectorSignatureKey)
      : Promise.resolve(null),
    cert.declaration.qsSignatureKey
      ? fetchSignaturePng(cert.declaration.qsSignatureKey)
      : Promise.resolve(null),
  ])

  // Page 2: Sections E-G (declaration + signatures)
  await drawDeclarationPage(pdfDoc, cert, fonts, { inspector: inspSig, qs: qsSig })

  // Page 3: Sections I-J
  drawSupplyPage(pdfDoc, cert, fonts)

  // Dynamic pages
  let nextPage = 4
  nextPage = drawObservationsPages(pdfDoc, cert, fonts, nextPage)
  nextPage = drawInspectionPages(pdfDoc, cert, fonts, nextPage)
  drawCircuitPages(pdfDoc, cert, fonts, nextPage)

  const pdfBytes = await pdfDoc.save()
  return pdfBytes
}

// ============================================================
// BROWSER DOWNLOAD
// ============================================================

/**
 * Generate and trigger browser download of the EICR PDF.
 */
export async function downloadEICRPdf(cert: EICRCertificate): Promise<void> {
  const pdfBytes = await generateEICRPdf(cert)

  const buffer = new ArrayBuffer(pdfBytes.byteLength)
  new Uint8Array(buffer).set(pdfBytes)

  const blob = new Blob([buffer], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)

  const a = document.createElement('a')
  a.href = url
  a.download = `EICR-${cert.reportNumber || cert.id}.pdf`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)

  URL.revokeObjectURL(url)
}
